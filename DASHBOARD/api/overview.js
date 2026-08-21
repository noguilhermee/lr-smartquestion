const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase credentials missing in environment variables');
  }
  return createClient(url, key);
}

async function fetchAll(createQuery, pageSize = 1000) {
  const { data: firstPage, error: err0 } = await createQuery().range(0, pageSize - 1);
  if (err0) throw err0;
  const rows = firstPage ? [...firstPage] : [];
  if (rows.length < pageSize) return rows;

  let from = pageSize;
  while (true) {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      const pageFrom = from + i * pageSize;
      promises.push(createQuery().range(pageFrom, pageFrom + pageSize - 1));
    }
    const results = await Promise.all(promises);
    let done = false;
    for (const res of results) {
      if (res.error) throw res.error;
      const page = res.data || [];
      rows.push(...page);
      if (page.length < pageSize) {
        done = true;
        break;
      }
    }
    if (done) break;
    from += 5 * pageSize;
  }
  return rows;
}

function monthLabel(value) {
  if (!value) return '-';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const month = parsed.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${month.charAt(0).toUpperCase()}${month.slice(1)}/${String(parsed.getFullYear()).slice(-2)}`;
}

function formatDate(value) {
  if (!value) return '-';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString('pt-BR');
}

function mapAgroindustria(projeto) {
  if (!projeto) return 'NÃO INFORMADA';
  const p = String(projeto).toUpperCase();
  if (p.includes('ALVOAR')) return 'Alvoar';
  if (p.includes('CCPR')) return 'CCPR';
  if (p.includes('LPA')) return 'Laticínios Porto Alegre';
  if (p.includes('REGENERA')) return 'Nestlé';
  if (p.includes('SEMEAR') || p.includes('DANONE')) return 'Danone';
  return projeto;
}

// ─── Utilitários de sanitização e regras de negócio ─────────────────────────

/** Nomes RAW que devem ser substituídos por "LAC CONSULTORIA" */
const LAC_CONSULTORIA_RAW = new Set([
  'CELIO ROBERTO OLIVEIRA (REGENERA)',
  'SUELY DE JESUS OLIVEIRA (REGENERA)'
]);

/**
 * Recebe o conteúdo bruto do campo "Grupo de atendimento" e retorna um array
 * com os nomes de consultores já saneados (sem sufixo de projeto, LAC aplicado).
 */
function sanitizeConsultorList(rawName) {
  if (!rawName) return [null];
  return String(rawName)
    .split('/')
    .map(p => p.trim())
    .filter(Boolean)
    .map(part => {
      const upper = part.toUpperCase();
      if (LAC_CONSULTORIA_RAW.has(upper)) return 'LAC CONSULTORIA';
      return part.replace(/\s*\([^)]+\)\s*$/, '').trim() || part;
    });
}

/** Retorna true para registros de teste (MATEUS CARNIELLI / ALVOAR ECO). */
function isTestData(nome_consultor, projeto) {
  return String(nome_consultor || '').toUpperCase().includes('MATEUS CARNIELLI') &&
         String(projeto || '').toUpperCase().includes('ALVOAR ECO');
}

/** Subtrai 1 mês de uma string YYYY-MM-DD e retorna YYYY-MM-DD. */
function shiftMonthMinus1(monthStr) {
  if (!monthStr) return null;
  const d = new Date(`${String(monthStr).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Expande rows com múltiplos consultores (separados por "/") em linhas individuais,
 * aplica sanitização e exclui dados de teste.
 */
function expandRows(rows) {
  const result = [];
  for (const row of (rows || [])) {
    const consultores = sanitizeConsultorList(row.nome_consultor);
    for (const c of consultores) {
      if (!isTestData(c, row.projeto)) {
        result.push({ ...row, nome_consultor: c });
      }
    }
  }
  return result;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabase = getSupabaseClient();

    const { getRegiaoMap, sanitizeRegiao } = require('./azurePostgres');
    const [agrosRes, consultoresDB, regiaoMap] = await Promise.all([
      Promise.resolve(supabase.from('sq_dim_agroindustria').select('nome_agroindustria, nomeAgroindustria')).catch(() => ({ data: [] })),
      fetchAll(() => supabase.from('sq_dim_consultor').select('nome_consultor, formacao_consultor, nomeConsultor, formacaoConsultor')).catch(() => []),
      getRegiaoMap(supabase, fetchAll).catch(() => new Map())
    ]);
    const agrosDB = agrosRes?.data || [];
    const agroindustriasOficiais = (agrosDB || []).map(a => a.nome_agroindustria || a.nomeAgroindustria).filter(Boolean);

    function normalizeName(str) {
      return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    }

    const profissaoMap = new Map();
    (consultoresDB || []).forEach(c => {
      const nome = c.nome_consultor || c.nomeConsultor;
      const formacao = c.formacao_consultor || c.formacaoConsultor;
      if (nome && formacao) {
        profissaoMap.set(normalizeName(nome), String(formacao).trim());
      }
    });

    function getRegiao(codigoLr, fallback) {
      if (codigoLr && regiaoMap.has(String(codigoLr).trim())) {
        return regiaoMap.get(String(codigoLr).trim());
      }
      if (fallback) {
        const cleanFallback = sanitizeRegiao(fallback);
        if (cleanFallback) return cleanFallback;
      }
      return 'NÃO INFORMADA';
    }

    // 1. Descobrir mês de referência (Mês Atual no fuso horário do Brasil)
    const nowLocal = new Date();
    const nowUtc3 = new Date(nowLocal.getTime() - (nowLocal.getTimezoneOffset() * 60000));
    const maxAllowedMonth = nowUtc3.toISOString().slice(0, 7) + '-01';

    const requestedMonth = String(req.query?.month || '').slice(0, 10);
    const isAllMonths = !/^\d{4}-\d{2}-\d{2}$/.test(requestedMonth);

    // Se o usuário selecionou um mês específico:
    // - Visitas e Cobertura: usa o mês solicitado
    // - Consistência e Lançamentos: usa 1 mês retroativo (M-1 / fechamento zootécnico)
    // Se não selecionou nenhum mês (isAllMonths), traz todas as informações
    const visitasMonth = isAllMonths ? null : requestedMonth;
    const consistencyMonth = isAllMonths ? null : (shiftMonthMinus1(requestedMonth) || requestedMonth);

    // 2. Consultar produtores ativos no mês de visitas e no mês de consistência (ou todo o histórico)
    const [produtoresListRaw, produtoresConsistenciaRaw] = await Promise.all([
      fetchAll(() => {
        let q = supabase
          .from('sq_base_produtores_ativos')
          .select('codigo_lr, nome_produtor, nome_propriedade, nome_consultor, projeto, unidade_atendimento, data_referencia');
        if (visitasMonth) q = q.eq('data_referencia', visitasMonth);
        else q = q.lte('data_referencia', maxAllowedMonth);
        return q.order('data_referencia', { ascending: false }).order('codigo_lr', { ascending: true });
      }),
      fetchAll(() => {
        let q = supabase
          .from('sq_base_produtores_ativos')
          .select('codigo_lr, nome_produtor, nome_propriedade, nome_consultor, projeto, unidade_atendimento, data_referencia');
        if (consistencyMonth) q = q.eq('data_referencia', consistencyMonth);
        else q = q.lte('data_referencia', maxAllowedMonth);
        return q.order('data_referencia', { ascending: false }).order('codigo_lr', { ascending: true });
      })
    ]);
    const produtoresList = (produtoresListRaw || []).filter(p => !isTestData(p.nome_consultor, p.projeto));
    const produtoresConsistencia = (produtoresConsistenciaRaw || []).filter(p => !isTestData(p.nome_consultor, p.projeto));

    // 3. Consultar visitas do mês selecionado (ou todas as visitas)
    const visitasListRaw = await fetchAll(() => {
      let q = supabase
        .from('sq_fato_visitas')
        .select('id, codigo_lr, nome_consultor, nome_produtor, nome_propriedade, data_visita, id_atendimento, projeto, mes_referencia');
      if (visitasMonth) q = q.eq('mes_referencia', visitasMonth);
      return q.order('data_visita', { ascending: false });
    });
    let visitasList = (visitasListRaw || []).filter(v => !isTestData(v.nome_consultor, v.projeto));

    if (visitasList.length === 0 && visitasMonth) {
      const [anoRef, mesRef] = visitasMonth.split('-');
      const ultimoDiaMes = new Date(Number(anoRef), Number(mesRef), 0).getDate();
      const dtInicio = `${visitasMonth}`;
      const dtFim = `${anoRef}-${mesRef}-${String(ultimoDiaMes).padStart(2, '0')}`;
      const visitasFallback = await fetchAll(() => supabase
        .from('sq_raw_visitas')
        .select('id_atendimento, codigo_lr, nome_consultor, nome_produtor, data_visita')
        .gte('data_visita', dtInicio)
        .lte('data_visita', dtFim)
        .order('data_visita', { ascending: false }));
      if (visitasFallback && visitasFallback.length > 0) {
        visitasList = visitasFallback.map(v => ({
          ...v,
          nome_propriedade: 'PROPRIEDADE',
          projeto: 'Leite',
          mes_referencia: visitasMonth
        }));
      }
    }

    // Histórico necessário para os gráficos e datas de associação. Consultas exclusivamente de leitura com ordenação determinística.
    const [visitasHistoricas, produtoresHistoricos, vinculosSQRaw] = await Promise.all([
      fetchAll(() => supabase
        .from('sq_fato_visitas')
        .select('codigo_lr, nome_consultor, nome_produtor, projeto, mes_referencia, data_visita')
        .order('mes_referencia', { ascending: false })
        .order('codigo_lr', { ascending: true })).catch(() => []),
      fetchAll(() => supabase
        .from('sq_base_produtores_ativos')
        .select('codigo_lr, nome_consultor, nome_produtor, projeto, unidade_atendimento, data_referencia')
        .order('data_referencia', { ascending: false })
        .order('codigo_lr', { ascending: true })).catch(() => []),
      fetchAll(() => supabase
        .from('sq_raw_vinculos')
        .select('codigo_lr, data_associacao')
        .not('data_associacao', 'is', null)
        .order('data_associacao', { ascending: true })).catch(() => [])
    ]);

    // Filtros selecionados no frontend
    const filters = {
      industry: String(req.query?.industry || '').trim(),
      region: String(req.query?.region || '').trim(),
      project: String(req.query?.project || '').trim(),
      consultant: String(req.query?.consultant || '').trim(),
      producer: String(req.query?.producer || '').trim(),
      status: String(req.query?.status || '').trim()
    };

    function rowMatches(row) {
      if (filters.industry && mapAgroindustria(row.projeto || row.agroindustria) !== filters.industry) return false;
      if (filters.region && getRegiao(row.codigo_lr, row.unidade_atendimento || row.regiao) !== filters.region) return false;
      if (filters.project && String(row.projeto || '') !== filters.project) return false;
      if (filters.consultant) {
        // Suporte a múltiplos consultores concatenados (ex: "NOME A (PROJ) / NOME B (PROJ)")
        const consultorNames = sanitizeConsultorList(row.nome_consultor || row.consultor);
        if (!consultorNames.some(c => c && c.toLowerCase() === filters.consultant.toLowerCase())) return false;
      }
      if (filters.producer) {
        const pName = String(row.nome_produtor || row.produtor || row.codigo_lr || '').toLowerCase();
        if (!pName.includes(filters.producer.toLowerCase())) return false;
      }
      if (filters.status) {
        const rowStatus = String(row.status || 'ATIVO').toUpperCase();
        if (filters.status.toUpperCase() === 'ATIVO' && rowStatus.includes('INATIV')) return false;
        if (filters.status.toUpperCase() === 'INATIVO' && !rowStatus.includes('INATIV')) return false;
      }
      return true;
    }

    const produtoresFiltrados = produtoresList.filter(rowMatches);
    const produtoresConsistenciaFiltrados = produtoresConsistencia.filter(rowMatches);
    const visitasFiltradas = visitasList.filter(rowMatches);
    const produtoresHistFiltrados = (produtoresHistoricos || []).filter(rowMatches);
    const visitasHistFiltradas = (visitasHistoricas || []).filter(rowMatches);

    // 4. Consultar movimentação (entradas/saídas)
    const movimentacoes = await fetchAll(() => supabase
      .from('sq_fato_movimentacao')
      .select('codigo_lr, nome_consultor, data_movimentacao, movimentacao, motivo_inativacao, outro_motivo')
      .order('data_movimentacao', { ascending: false }));

    // 5. Consultar consistência do mês M-1 (consistencyMonth ou todo o histórico)
    const [consistenciaList, elaboreMensalList] = await Promise.all([
      fetchAll(() => {
        let q = supabase
          .from('sq_fato_consistencia')
          .select('codigo_lr, consistencia_mensal, consistencia_anual, mes_elabore, mes_referencia');
        if (consistencyMonth) q = q.eq('mes_referencia', consistencyMonth);
        return q.order('mes_referencia', { ascending: false }).order('codigo_lr', { ascending: true });
      }),
      fetchAll(() => {
        let q = supabase
          .from('sq_raw_consistencia_mensal')
          .select('codigo_lr, mes_elabore, consistencia_mensal, mes_referencia');
        if (consistencyMonth) q = q.eq('mes_referencia', consistencyMonth);
        return q.order('mes_referencia', { ascending: false });
      })
    ]);

    const elaboreMensalMap = new Map(
      (elaboreMensalList || []).map(item => [
        `${String(item.codigo_lr).trim().toUpperCase()}_${String(item.mes_referencia || '').slice(0, 7)}`,
        item
      ])
    );

    const produtoresMap = new Map((produtoresFiltrados || []).map(p => [p.codigo_lr, p]));
    const produtoresConsistenciaMap = new Map((produtoresConsistenciaFiltrados || []).map(p => [p.codigo_lr, p]));
    const consistenciaFiltrada = (consistenciaList || []).filter(c => {
      const p = produtoresConsistenciaMap.get(c.codigo_lr);
      return rowMatches({ ...c, unidade_atendimento: p?.unidade_atendimento, nome_produtor: p?.nome_produtor });
    });

    // Cálculos de KPIs
    const totalAtivos = new Set(produtoresFiltrados.map(p => p.codigo_lr).filter(Boolean)).size || produtoresFiltrados.length;
    const totalVisitas = visitasFiltradas.length;
    const consultoresAtivos = new Set(
      produtoresFiltrados.flatMap(p => sanitizeConsultorList(p.nome_consultor)).filter(Boolean)
    ).size;

    // Produtores visitados (únicos)
    const codigosVisitados = new Set(visitasFiltradas.map(v => v.codigo_lr).filter(Boolean));
    const totalVisitadosUnicos = codigosVisitados.size;

    const percVisitados = totalAtivos > 0 ? Math.min(100.0, (totalVisitadosUnicos / totalAtivos) * 100).toFixed(1) : '0.0';
    const visitasPorProdutor = totalAtivos > 0 ? (totalVisitas / totalAtivos).toFixed(1) : '0.0';

    // Consistência baseada estritamente na tab_consistencia_mensal
    let consistentesCount = 0;
    let avaliadosCount = 0;
    let comDadosCount = 0;

    consistenciaFiltrada.forEach(c => {
      const cdLrUpper = String(c.codigo_lr || '').trim().toUpperCase();
      const monthKey = String(c.mes_referencia || '').slice(0, 7);
      const mensalItem = elaboreMensalMap.get(`${cdLrUpper}_${monthKey}`) || c;
      const status = String(mensalItem.consistencia_mensal || c.consistencia_mensal || '').toLowerCase();
      if (status && !status.includes('sem dados') && !status.includes('não calculado')) {
        comDadosCount++;
        avaliadosCount++;
        if (status.includes('consistente') && !status.includes('inconsistente')) {
          consistentesCount++;
        }
      }
    });

    const percConsistente = avaliadosCount > 0 
      ? ((consistentesCount / avaliadosCount) * 100).toFixed(1)
      : '0.0';

    // Evolução mensal calculada com as referências disponíveis nas fontes analíticas.
    function gerarMesesHistoricos(inicioStr, fimStr) {
      const meses = [];
      const [anoInicio, mesInicio] = inicioStr.split('-').map(Number);
      const [anoFim, mesFim] = fimStr.split('-').map(Number);
      let curAno = anoInicio;
      let curMes = mesInicio;
      while (curAno < anoFim || (curAno === anoFim && curMes <= mesFim)) {
        const strMes = `${curAno}-${String(curMes).padStart(2, '0')}-01`;
        meses.push(strMes);
        curMes++;
        if (curMes > 12) {
          curMes = 1;
          curAno++;
        }
      }
      return meses;
    }

    const mesesComDados = [...new Set([
      ...(produtoresHistoricos || []).map(p => p.data_referencia),
      ...(visitasHistoricas || []).map(v => v.mes_referencia)
    ].filter(Boolean))].sort();

    const primeiroMesReal = mesesComDados.length > 0 ? mesesComDados[0] : '2026-01-01';
    const mesesHistoricosPadrao = gerarMesesHistoricos(primeiroMesReal, maxAllowedMonth);
    const todosMesesDisponiveis = [...new Set([
      ...mesesHistoricosPadrao,
      ...mesesComDados,
      maxAllowedMonth
    ].filter(Boolean))]
      .filter(m => m <= maxAllowedMonth)
      .sort();

    const referencias = todosMesesDisponiveis
      .filter(ref => !visitasMonth || ref <= visitasMonth);
    const visitasPorMes = new Map();
    const ativosPorMes = new Map();
    (visitasHistFiltradas || []).forEach(v => {
      if (!v.mes_referencia) return;
      if (!visitasPorMes.has(v.mes_referencia)) visitasPorMes.set(v.mes_referencia, { total: 0, produtores: new Set() });
      const item = visitasPorMes.get(v.mes_referencia);
      item.total += 1;
      if (v.codigo_lr) item.produtores.add(v.codigo_lr);
    });
    (produtoresHistFiltrados || []).forEach(p => {
      if (!p.data_referencia) return;
      if (!ativosPorMes.has(p.data_referencia)) ativosPorMes.set(p.data_referencia, new Set());
      if (p.codigo_lr) ativosPorMes.get(p.data_referencia).add(p.codigo_lr);
    });

    const evolucaoMensal = {
      labels: referencias.map(monthLabel),
      fazendasAtivas: referencias.map(ref => ativosPorMes.get(ref)?.size || 0),
      fazendasVisitadas: referencias.map(ref => visitasPorMes.get(ref)?.produtores.size || 0),
      percCobertura: referencias.map(ref => {
        const ativos = ativosPorMes.get(ref)?.size || 0;
        const visitados = visitasPorMes.get(ref)?.produtores.size || 0;
        if (ativos === 0) return 0;
        const ratio = (visitados / ativos) * 100;
        return Number(Math.min(100.0, Math.max(0, ratio)).toFixed(1));
      })
    };

    const evolucaoVisitas = {
      labels: referencias.map(monthLabel),
      values: referencias.map(ref => visitasPorMes.get(ref)?.total || 0)
    };

    const rankingMap = new Map();
    visitasFiltradas.forEach(v => {
      const nome = v.nome_produtor || v.codigo_lr || 'Produtor não identificado';
      rankingMap.set(nome, (rankingMap.get(nome) || 0) + 1);
    });
    const ranking = [...rankingMap.entries()].sort((a, b) => b[1] - a[1]);

    // Mapear última data de visita por codigo_lr no histórico
    const ultimaVisitaMap = new Map();
    (visitasHistFiltradas || []).forEach(v => {
      if (!v.codigo_lr || !v.data_visita) return;
      const d = new Date(v.data_visita);
      if (Number.isNaN(d.getTime())) return;
      const prev = ultimaVisitaMap.get(v.codigo_lr);
      if (!prev || d > prev) {
        ultimaVisitaMap.set(v.codigo_lr, d);
      }
    });

    // Mapear data de associação por codigo_lr (data de entrada/associação original)
    const dataAssociacaoMap = new Map();
    (vinculosSQRaw || []).forEach(v => {
      if (!v.codigo_lr || !v.data_associacao) return;
      const cod = String(v.codigo_lr).trim().toUpperCase();
      const d = new Date(v.data_associacao);
      if (Number.isNaN(d.getTime())) return;
      const prev = dataAssociacaoMap.get(cod);
      if (!prev || d < prev) {
        dataAssociacaoMap.set(cod, d);
      }
    });

    // Tabela: Produtores sem visita
    // Definir data de corte: se refMonth for mês passado, usar o fim do mês; caso contrário, usar a data atual (hoje).
    const hoje = new Date();
    let dataCorte = hoje;
    if (visitasMonth) {
      const parts = String(visitasMonth).slice(0, 10).split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const lastDayOfMonth = new Date(year, month, 0, 23, 59, 59);
        if (lastDayOfMonth < hoje) {
          dataCorte = lastDayOfMonth;
        }
      }
    }

    // Expande produtores com múltiplos consultores em linhas separadas para a tabela
    const semVisita = expandRows(
      produtoresFiltrados.filter(p => !codigosVisitados.has(p.codigo_lr))
    ).map(p => {
        let diasSemVisita = null;
        const codNorm = String(p.codigo_lr || '').trim().toUpperCase();
        const dataUltimaVisita = ultimaVisitaMap.get(p.codigo_lr) || (codNorm ? ultimaVisitaMap.get(codNorm) : null);
        const dataAssoc = dataAssociacaoMap.get(p.codigo_lr) || (codNorm ? dataAssociacaoMap.get(codNorm) : null);

        if (dataUltimaVisita) {
          const diffMs = dataCorte.getTime() - dataUltimaVisita.getTime();
          diasSemVisita = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        } else if (dataAssoc) {
          const diffMs = dataCorte.getTime() - dataAssoc.getTime();
          diasSemVisita = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        } else if (p.data_referencia) {
          const dataVinc = new Date(`${String(p.data_referencia).slice(0, 10)}T12:00:00`);
          if (!Number.isNaN(dataVinc.getTime())) {
            const diffMs = dataCorte.getTime() - dataVinc.getTime();
            diasSemVisita = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
          }
        }

        const dataExibicao = dataAssoc
          ? formatDate(dataAssoc.toISOString().slice(0, 10))
          : formatDate(p.data_referencia);

        return {
          consultor: p.nome_consultor || 'NÃO ATRIBUÍDO',
          codigo_lr: p.codigo_lr || '-',
          produtor: p.nome_produtor || 'PRODUTOR SEM NOME',
          propriedade: p.nome_propriedade || '-',
          agroindustria: mapAgroindustria(p.projeto),
          regiao: getRegiao(p.codigo_lr, p.unidade_atendimento),
          projeto: p.projeto || 'NÃO INFORMADO',
          status: 'ATIVO',
          mes_referencia: visitasMonth,
          data_associacao: dataExibicao,
          data_vinculacao: dataExibicao,
          dias_sem_visita: diasSemVisita
        };
      });

    // Tabela: Produtores visitados — expande múltiplos consultores em linhas separadas
    const visitados = expandRows(visitasFiltradas)
      .map(v => {
        const produtorAtivo = produtoresMap.get(v.codigo_lr);
        const normConsultor = normalizeName(v.nome_consultor);
        const profissao = profissaoMap.get(normConsultor) || '-';

        let numAtendimento = '-';
        if (v.id_atendimento !== null && v.id_atendimento !== undefined && !Number.isNaN(Number(v.id_atendimento))) {
          numAtendimento = `AT-${Math.floor(Number(v.id_atendimento))}`;
        } else if (v.id) {
          numAtendimento = `VIS-${v.id}`;
        }

        const codLrNorm = String(v.codigo_lr || '').trim().toUpperCase();
        const hasElabore = elaboreMensalMap.has(codLrNorm);

        return ({
          consultor: v.nome_consultor || 'CONSULTOR',
          codigo_lr: v.codigo_lr || '-',
          produtor: v.nome_produtor || 'PRODUTOR',
          agroindustria: mapAgroindustria(v.projeto || produtorAtivo?.projeto),
          regiao: getRegiao(v.codigo_lr, produtorAtivo?.unidade_atendimento),
          projeto: v.projeto || produtorAtivo?.projeto || 'NÃO INFORMADO',
          status: 'ATIVO',
          mes_referencia: v.mes_referencia || refMonth,
          profissao: profissao,
          atendimento: numAtendimento,
          data_visita: formatDate(v.data_visita || v.mes_referencia),
          elabore_ok: hasElabore
        });
      });

    // Tabela: Movimentações recentes
    const listaMovimentacao = (movimentacoes || []).map(m => ({
      produtor: m.codigo_lr || 'PRODUTOR',
      movimentacao: String(m.movimentacao || '').toLowerCase().includes('sa') ? 'SAÍDA' : 'ENTRADA',
      grupo: m.nome_consultor || 'GRUPO',
      motivo: m.motivo_inativacao || m.outro_motivo || 'NOVO VÍNCULO'
    }));

    // Carregar metadados de proveniência das fontes de dados
    let dataProvenance = null;
    try {
      const fs = require('fs');
      const path = require('path');
      const metaPath = path.join(__dirname, '..', 'public', 'data', 'fontes_metadados.json');
      if (fs.existsSync(metaPath)) {
        dataProvenance = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
    } catch (e) {
      console.warn('Metadados de proveniência não carregados:', e.message);
    }

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      refMonth: visitasMonth,
      visitasMonth,
      consistencyMonth,
      dataProvenance,
      kpis: {
        total_visitas: totalVisitas,
        consultores_ativos: consultoresAtivos,
        produtores_ativos: totalAtivos,
        produtores_visitados: totalVisitadosUnicos,
        visitas_por_produtor: visitasPorProdutor,
        perc_visitados: percVisitados,
        produtores_com_dados: comDadosCount,
        perc_consistente: percConsistente,
        visitas_nao_realizadas: null
      },
      evolucaoMensal,
      evolucaoVisitas,
      rankingProdutores: {
        labels: ranking.map(item => item[0]),
        values: ranking.map(item => item[1])
      },
      filterOptions: {
        agroindustrias: [...new Set([...agroindustriasOficiais, ...produtoresList.map(p => mapAgroindustria(p.projeto))])].filter(Boolean).sort(),
        regioes: [...new Set([...Array.from(regiaoMap.values()), ...produtoresList.map(p => getRegiao(p.codigo_lr, p.unidade_atendimento))])].filter(Boolean).sort(),
        projetos: [...new Set([...produtoresList.map(p => p.projeto), ...visitasList.map(v => v.projeto)])].filter(Boolean).sort(),
        status: ['ATIVO', 'INATIVO'],
        meses: todosMesesDisponiveis
      },
      tabelas: {
        movimentacao: listaMovimentacao,
        sem_visita: semVisita,
        visitados: visitados
      }
    });
  } catch (error) {
    console.error('Erro em /api/overview:', error);
    return res.status(500).json({ error: error.message });
  }
};
