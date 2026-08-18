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

function isConsistent(value) {
  const normalized = String(value || '').toLowerCase();
  return normalized.includes('consistente') && !normalized.includes('inconsistente');
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
  if (p.includes('CARGILL')) return 'Cargill';
  if (p.includes('PIRACANJUBA')) return 'Piracanjuba';
  if (p.includes('OFI')) return 'OFI';
  if (p.includes('CAMPILEITE')) return 'Campileite';
  if (p.includes('SENAR')) return 'Senar';
  if (p.includes('COPRIL')) return 'Copril';
  if (p.includes('M&E')) return 'M&E / Cargill';
  if (p.includes('GRAOS')) return 'Mais Grãos';
  return projeto;
}

function monthLabel(value) {
  if (!value) return '-';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const month = parsed.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${month.charAt(0).toUpperCase()}${month.slice(1)}/${String(parsed.getFullYear()).slice(-2)}`;
}

// ─── Utilitários de sanitização e regras de negócio ─────────────────────────

const LAC_CONSULTORIA_RAW = new Set([
  'CELIO ROBERTO OLIVEIRA (REGENERA)',
  'SUELY DE JESUS OLIVEIRA (REGENERA)'
]);

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

function isTestData(nome_consultor, projeto) {
  return String(nome_consultor || '').toUpperCase().includes('MATEUS CARNIELLI') &&
         String(projeto || '').toUpperCase().includes('ALVOAR ECO');
}

function shiftMonthMinus1(monthStr) {
  if (!monthStr) return null;
  const d = new Date(`${String(monthStr).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
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
    const regiaoMap = await getRegiaoMap(supabase, fetchAll);

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
    
    // Descobrir mês mais recente
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
    // Regra M-1: mês selecionado pelo usuário mapeia para o mês anterior como referência de dados
    const refMonth = /^\d{4}-\d{2}-\d{2}$/.test(requestedMonth)
      ? (shiftMonthMinus1(requestedMonth) || latestAvailableMonth)
      : latestAvailableMonth;

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

    const [consistenciaHistoricaBruta, produtoresAtivosBrutos, vinculosFallback] = await Promise.all([
      fetchAll(() => supabase
        .from('f_consistente_bi_lr')
        .select('codigo_lr, nome_consultor, projeto, mes_referencia, data_carencia_fim, mes_elabore, consistencia_mensal, consistencia_anual, excecao, meses_sequenciais, detalhamento_inconsistencia')
        .order('mes_referencia', { ascending: false })
        .order('codigo_lr', { ascending: true })),
      fetchAll(() => supabase
        .from('tab_produtores_ativos_mensal')
        .select('codigo_lr, nome_produtor, nome_consultor, projeto, unidade_atendimento, data_referencia')
        .eq('data_referencia', refMonth)
        .order('codigo_lr', { ascending: true })),
      fetchAll(() => supabase
        .from('tab_vinculos_sq')
        .select('codigo_lr, nome_produtor, projeto, unidade_atendimento'))
    ]);

    const fallbackMetaMap = new Map((vinculosFallback || []).map(v => [v.codigo_lr, v]));
    const produtoresAtivos = (produtoresAtivosBrutos || []).filter(rowMatches);
    const produtoresMap = new Map((produtoresAtivos || []).map(p => [p.codigo_lr, p]));

    const consistenciaHistorica = (consistenciaHistoricaBruta || []).filter(c => {
      if (!produtoresMap.has(c.codigo_lr)) return false; // REGRA: Desconsidera produtores fora do SmartQuestion
      const p = produtoresMap.get(c.codigo_lr) || fallbackMetaMap.get(c.codigo_lr);
      return rowMatches({ ...c, unidade_atendimento: p?.unidade_atendimento, nome_produtor: p?.nome_produtor });
    });

    const consistenciaFiltrada = (consistenciaHistorica || []).filter(c => c.mes_referencia === refMonth);
    const total = consistenciaFiltrada.length;

    let consistentes = 0;
    let inconsistentes = 0;
    let carencia = 0;
    let excecoes = 0;
    let semDados = 0;

    const mesesSequenciaisDist = { '0-3 meses': 0, '4-6 meses': 0, '7-9 meses': 0, '10-12 meses': 0, '12+ meses': 0 };
    const listaInconsistentes = [];

    if (consistenciaFiltrada && consistenciaFiltrada.length > 0) {
      consistenciaFiltrada.forEach(c => {
        if (c.excecao == 1 || c.excecao === true) excecoes++;
        if (c.data_carencia_fim && new Date(c.data_carencia_fim) > new Date()) carencia++;

        const seq = Number(c.meses_sequenciais) || 0;
        if (seq <= 3) mesesSequenciaisDist['0-3 meses']++;
        else if (seq <= 6) mesesSequenciaisDist['4-6 meses']++;
        else if (seq <= 9) mesesSequenciaisDist['7-9 meses']++;
        else if (seq <= 12) mesesSequenciaisDist['10-12 meses']++;
        else mesesSequenciaisDist['12+ meses']++;

        const statusConsist = String(c.consistencia_mensal || '').toLowerCase();
        const refMonthStr = String(c.mes_referencia || '').slice(0, 7);
        const isCinthiaMissingMay = (c.codigo_lr === 'LR10245' || String(c.nome_produtor || '').toLowerCase().includes('cinthia')) && refMonthStr === '2026-05';
        const isSemDadosExplicit = !c.consistencia_mensal || statusConsist.includes('sem dados') || statusConsist.includes('sem_dados') || statusConsist.includes('não calculado') || statusConsist.includes('nao calculado');

        const isSemDados = !c.mes_elabore || isSemDadosExplicit || isCinthiaMissingMay;
        const isConsistente = !isSemDados && statusConsist.includes('consistente') && !statusConsist.includes('inconsistente');
        const isInconsistente = !isSemDados && !isConsistente && statusConsist.includes('inconsistente');

        if (isConsistente) {
          consistentes++;
        } else if (isInconsistente) {
          inconsistentes++;
          const produtorAtivo = produtoresMap.get(c.codigo_lr);
          const metaFallback = fallbackMetaMap.get(c.codigo_lr);
          const nomeProdutor = produtorAtivo?.nome_produtor || metaFallback?.nome_produtor || c.codigo_lr || 'PRODUTOR';
          listaInconsistentes.push({
            codigo_lr: c.codigo_lr || 'PRODUTOR',
            produtor: nomeProdutor,
            consultor: c.nome_consultor || 'NÃO INFORMADO',
            agroindustria: mapAgroindustria(produtorAtivo?.projeto || metaFallback?.projeto || c.projeto),
            regiao: getRegiao(c.codigo_lr, produtorAtivo?.unidade_atendimento || metaFallback?.unidade_atendimento),
            projeto: c.projeto || produtorAtivo?.projeto || metaFallback?.projeto || 'NÃO INFORMADO',
            status: produtorAtivo ? 'ATIVO' : 'INATIVO',
            mes_referencia: c.mes_referencia || refMonth,
            meses_sequenciais: seq,
            consistencia: 'Inconsistente',
            detalhamento: c.detalhamento_inconsistencia || null
          });
        } else {
          semDados++;
          const produtorAtivo = produtoresMap.get(c.codigo_lr);
          const metaFallback = fallbackMetaMap.get(c.codigo_lr);
          const nomeProdutor = produtorAtivo?.nome_produtor || metaFallback?.nome_produtor || c.codigo_lr || 'PRODUTOR';
          listaInconsistentes.push({
            codigo_lr: c.codigo_lr || 'PRODUTOR',
            produtor: nomeProdutor,
            consultor: c.nome_consultor || 'NÃO INFORMADO',
            agroindustria: mapAgroindustria(produtorAtivo?.projeto || metaFallback?.projeto || c.projeto),
            regiao: getRegiao(c.codigo_lr, produtorAtivo?.unidade_atendimento || metaFallback?.unidade_atendimento),
            projeto: c.projeto || produtorAtivo?.projeto || metaFallback?.projeto || 'NÃO INFORMADO',
            status: produtorAtivo ? 'ATIVO' : 'INATIVO',
            mes_referencia: c.mes_referencia || refMonth,
            meses_sequenciais: seq,
            consistencia: 'Sem dados',
            detalhamento: c.detalhamento_inconsistencia || null
          });
        }
      });
    }

    const percConsistente = ((consistentes / (total || 1)) * 100).toFixed(1);
    const percInconsistente = ((inconsistentes / (total || 1)) * 100).toFixed(1);
    const anualAvaliados = consistenciaFiltrada.filter(c => c.consistencia_anual !== null && c.consistencia_anual !== undefined);
    const anualConsistentes = anualAvaliados.filter(c => isConsistent(c.consistencia_anual)).length;
    const percAnual = anualAvaliados.length > 0 ? ((anualConsistentes / anualAvaliados.length) * 100).toFixed(1) : percConsistente;
    const produtoresComDados = new Set(consistenciaFiltrada.filter(c => {
      const statusConsist = String(c.consistencia_mensal || '').toLowerCase();
      const refMonthStr = String(c.mes_referencia || '').slice(0, 7);
      const isCinthiaMissingMay = c.codigo_lr === 'LR10245' && refMonthStr === '2026-05';
      const isSemDados = !c.mes_elabore || isCinthiaMissingMay || statusConsist.includes('sem dados') || statusConsist.includes('não calculado');
      return !isSemDados && c.mes_elabore;
    }).map(c => c.codigo_lr).filter(Boolean)).size;

    const referencias = [...new Set((consistenciaHistorica || []).map(c => c.mes_referencia).filter(Boolean))]
      .filter(ref => !refMonth || ref <= refMonth)
      .sort();
    const evolucaoConsistencia = { labels: [], mensal: [], anual: [] };
    referencias.forEach(ref => {
      const registros = (consistenciaHistorica || []).filter(c => c.mes_referencia === ref);
      const mensalAvaliado = registros.filter(c => c.mes_elabore && c.consistencia_mensal !== null && c.consistencia_mensal !== undefined);
      const anualAvaliado = registros.filter(c => c.mes_elabore && c.consistencia_anual !== null && c.consistencia_anual !== undefined);
      evolucaoConsistencia.labels.push(monthLabel(ref));
      evolucaoConsistencia.mensal.push(mensalAvaliado.length ? Number(((mensalAvaliado.filter(c => isConsistent(c.consistencia_mensal)).length / mensalAvaliado.length) * 100).toFixed(1)) : 0);
      evolucaoConsistencia.anual.push(anualAvaliado.length ? Number(((anualAvaliado.filter(c => isConsistent(c.consistencia_anual)).length / anualAvaliado.length) * 100).toFixed(1)) : 0);
    });

    const tabelaProdutoresComDados = consistenciaFiltrada.map(c => {
      const produtor = produtoresMap.get(c.codigo_lr);
      const metaFallback = fallbackMetaMap.get(c.codigo_lr);
      const statusConsist = String(c.consistencia_mensal || '').toLowerCase();
      const refMonthStr = String(c.mes_referencia || '').slice(0, 7);
      const isCinthiaMissingMay = (c.codigo_lr === 'LR10245' || String(produtor?.nome_produtor || '').toLowerCase().includes('cinthia')) && refMonthStr === '2026-05';
      const isSemDados = !c.mes_elabore || isCinthiaMissingMay || statusConsist.includes('sem dados') || statusConsist.includes('não calculado');
      const possuiDados = Boolean(!isSemDados && c.mes_elabore && isConsistent(c.consistencia_mensal));
      const prodName = produtor?.nome_produtor || metaFallback?.nome_produtor || c.codigo_lr || 'PRODUTOR';

      return {
        codigo_lr: c.codigo_lr || '-',
        produtor: prodName,
        consultor: c.nome_consultor || produtor?.nome_consultor || metaFallback?.nome_consultor || 'NÃO INFORMADO',
        agroindustria: mapAgroindustria(produtor?.projeto || metaFallback?.projeto || c.projeto),
        regiao: getRegiao(c.codigo_lr, produtor?.unidade_atendimento || metaFallback?.unidade_atendimento),
        projeto: c.projeto || produtor?.projeto || metaFallback?.projeto || 'NÃO INFORMADO',
        mes_referencia: c.mes_referencia || refMonth,
        possui_dados: possuiDados,
        referencia: c.mes_referencia ? new Date(`${String(c.mes_referencia).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '-',
        status: produtoresMap.has(c.codigo_lr) ? 'ATIVO' : 'INATIVO'
      };
    });

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      refMonth,
      kpis: {
        perc_consistente: percConsistente,
        perc_anual: percAnual,
        perc_inconsistente: percInconsistente,
        produtores_com_dados: produtoresComDados,
        fazendas_aptas: consistentes,
        base_analisada: total,
        registros_divergentes: inconsistentes,
        produtores_carencia: carencia,
        excecoes_ativas: excecoes
      },
      distribuicaoDonut: {
        labels: ['Registros aptos', 'Registros incompletos', 'Registros divergentes'],
        values: [consistentes, semDados + carencia, inconsistentes]
      },
      evolucaoConsistencia,
      histogramaMeses: {
        labels: Object.keys(mesesSequenciaisDist),
        values: Object.values(mesesSequenciaisDist)
      },
      tabelaProdutoresComDados,
      tabelaInconsistentes: listaInconsistentes
    });
  } catch (error) {
    console.error('Erro em /api/consistency:', error);
    return res.status(500).json({ error: error.message });
  }
};
