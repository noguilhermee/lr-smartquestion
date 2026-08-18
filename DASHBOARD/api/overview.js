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
  if (p.includes('SEMEAR')) return 'Danone';
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

    const { getRegiaoMap } = require('./azurePostgres');
    const [{ data: agrosDB }, consultoresDB, regiaoMap] = await Promise.all([
      supabase.from('tab_agroindustria').select('nomeAgroindustria').order('nomeAgroindustria', { ascending: true }),
      fetchAll(() => supabase.from('tab_consultor').select('nomeConsultor, formacaoConsultor')),
      getRegiaoMap(supabase, fetchAll)
    ]);
    const agroindustriasOficiais = (agrosDB || []).map(a => a.nomeAgroindustria).filter(Boolean);

    function normalizeName(str) {
      return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    }

    const profissaoMap = new Map();
    (consultoresDB || []).forEach(c => {
      if (c.nomeConsultor && c.formacaoConsultor) {
        profissaoMap.set(normalizeName(c.nomeConsultor), String(c.formacaoConsultor).trim());
      }
    });

    function getRegiao(codigoLr, fallback) {
      if (codigoLr && regiaoMap.has(String(codigoLr).trim())) {
        return regiaoMap.get(String(codigoLr).trim());
      }
      if (fallback && fallback !== 'LABOR RURAL' && fallback !== 'UNIDADE GENERICA') {
        return fallback;
      }
      return 'NÃO INFORMADA';
    }

    // 1. Descobrir mês de referência mais recente nas visitas (limitado ao mês atual maxAllowedMonth)
    const maxAllowedMonth = new Date().toISOString().slice(0, 7) + '-01';
    const { data: ultimasVisitas } = await supabase
      .from('f_visitas_bi_lr')
      .select('mes_referencia')
      .lte('mes_referencia', maxAllowedMonth)
      .order('mes_referencia', { ascending: false })
      .limit(1);

    const requestedMonth = String(req.query?.month || '').slice(0, 10);
    const latestAvailableMonth = (ultimasVisitas && ultimasVisitas.length > 0)
      ? ultimasVisitas[0].mes_referencia
      : maxAllowedMonth;
    // Regra M-1: o mês selecionado pelo usuário mapeia para o mês anterior como referência de dados
    const refMonth = /^\d{4}-\d{2}-\d{2}$/.test(requestedMonth)
      ? (shiftMonthMinus1(requestedMonth) || latestAvailableMonth)
      : latestAvailableMonth;

    // 2. Consultar produtores ativos no mês de referência
    const produtoresListRaw = await fetchAll(() => supabase
      .from('tab_produtores_ativos_mensal')
      .select('codigo_lr, nome_produtor, nome_propriedade, nome_consultor, projeto, unidade_atendimento, data_referencia')
      .eq('data_referencia', refMonth)
      .order('codigo_lr', { ascending: true }));
    const produtoresList = (produtoresListRaw || []).filter(p => !isTestData(p.nome_consultor, p.projeto));

    // 3. Consultar visitas do mês de referência
    const visitasListRaw = await fetchAll(() => supabase
      .from('f_visitas_bi_lr')
      .select('id, codigo_lr, nome_consultor, nome_produtor, nome_propriedade, data_visita, id_atendimento, projeto, mes_referencia')
      .eq('mes_referencia', refMonth)
      .order('data_visita', { ascending: false }));
    const visitasList = (visitasListRaw || []).filter(v => !isTestData(v.nome_consultor, v.projeto));

    // Histórico necessário para os gráficos. Consultas exclusivamente de leitura com ordenação determinística.
    const [visitasHistoricas, produtoresHistoricos] = await Promise.all([
      fetchAll(() => supabase
        .from('f_visitas_bi_lr')
        .select('codigo_lr, nome_consultor, nome_produtor, projeto, mes_referencia, data_visita')
        .order('mes_referencia', { ascending: false })
        .order('codigo_lr', { ascending: true })),
      fetchAll(() => supabase
        .from('tab_produtores_ativos_mensal')
        .select('codigo_lr, nome_consultor, nome_produtor, projeto, unidade_atendimento, data_referencia')
        .order('data_referencia', { ascending: false })
        .order('codigo_lr', { ascending: true }))
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
    const visitasFiltradas = visitasList.filter(rowMatches);
    const produtoresHistFiltrados = (produtoresHistoricos || []).filter(rowMatches);
    const visitasHistFiltradas = (visitasHistoricas || []).filter(rowMatches);

    // 4. Consultar movimentação (entradas/saídas)
    const movimentacoes = await fetchAll(() => supabase
      .from('tab_movimentacao_produtor')
      .select('codigo_lr, nome_consultor, data_movimentacao, movimentacao, motivo_inativacao, outro_motivo')
      .order('data_movimentacao', { ascending: false }));

    // 5. Consultar consistência do mês de referência
    const consistenciaList = await fetchAll(() => supabase
      .from('f_consistente_bi_lr')
      .select('codigo_lr, consistencia_mensal, consistencia_anual, mes_elabore, mes_referencia')
      .eq('mes_referencia', refMonth)
      .order('codigo_lr', { ascending: true }));

    const produtoresMap = new Map((produtoresFiltrados || []).map(p => [p.codigo_lr, p]));
    const consistenciaFiltrada = consistenciaList.filter(c => {
      if (!produtoresMap.has(c.codigo_lr)) return false;
      const p = produtoresMap.get(c.codigo_lr);
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

    // Consistência
    const consistentesCount = consistenciaFiltrada.filter(c => String(c.consistencia_mensal || '').toLowerCase() === 'consistente').length;
    const avaliadosCount = consistenciaFiltrada.filter(c => c.consistencia_mensal !== null).length;
    const percConsistente = avaliadosCount > 0 
      ? ((consistentesCount / avaliadosCount) * 100).toFixed(1)
      : '0.0';
    const comDadosCount = consistenciaFiltrada.filter(c => c.mes_elabore !== null || c.consistencia_mensal !== null).length;

    // Evolução mensal calculada com as referências disponíveis nas fontes analíticas.
    const todosMesesDisponiveis = [...new Set([
      ...(produtoresHistoricos || []).map(p => p.data_referencia),
      ...(visitasHistoricas || []).map(v => v.mes_referencia),
      maxAllowedMonth // Garante que o mês corrente aparece para que o usuário possa selecionar (M-1)
    ].filter(Boolean))]
      .filter(m => m <= maxAllowedMonth)
      .sort();

    const referencias = todosMesesDisponiveis
      .filter(ref => !refMonth || ref <= refMonth);
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

    // Tabela: Produtores sem visita
    // Definir data de corte: se refMonth for mês passado, usar o fim do mês; caso contrário, usar a data atual (hoje).
    const hoje = new Date();
    let dataCorte = hoje;
    if (refMonth) {
      const parts = String(refMonth).slice(0, 10).split('-');
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
        const dataUltimaVisita = ultimaVisitaMap.get(p.codigo_lr);
        if (dataUltimaVisita) {
          const diffMs = dataCorte.getTime() - dataUltimaVisita.getTime();
          diasSemVisita = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        } else if (p.data_referencia) {
          const dataVinc = new Date(`${String(p.data_referencia).slice(0, 10)}T12:00:00`);
          if (!Number.isNaN(dataVinc.getTime())) {
            const diffMs = dataCorte.getTime() - dataVinc.getTime();
            diasSemVisita = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
          }
        }

        return {
          consultor: p.nome_consultor || 'NÃO ATRIBUÍDO',
          codigo_lr: p.codigo_lr || '-',
          produtor: p.nome_produtor || 'PRODUTOR SEM NOME',
          propriedade: p.nome_propriedade || '-',
          agroindustria: mapAgroindustria(p.projeto),
          regiao: getRegiao(p.codigo_lr, p.unidade_atendimento),
          projeto: p.projeto || 'NÃO INFORMADO',
          status: 'ATIVO',
          mes_referencia: refMonth,
          data_vinculacao: formatDate(p.data_referencia),
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
          elabore_ok: true
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
      refMonth,
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
        projetos: ['ALVOAR ASSIST', 'ALVOAR ECO', 'ATEG_CCPR', 'LPA', 'REGENERA', 'SEMEAR'],
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
