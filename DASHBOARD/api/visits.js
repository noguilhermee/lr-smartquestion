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
    
    // Descobrir mês mais recente (limitado ao mês atual maxAllowedMonth)
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
    // Visitas e cobertura refletem exatamente o mês selecionado no filtro (operação em campo em tempo real)
    const refMonth = /^\d{4}-\d{2}-\d{2}$/.test(requestedMonth)
      ? requestedMonth
      : latestAvailableMonth;

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

    const produtoresBrutos = await fetchAll(() => supabase
      .from('tab_produtores_ativos_mensal')
      .select('codigo_lr, nome_produtor, nome_consultor, projeto, unidade_atendimento, data_referencia')
      .eq('data_referencia', refMonth)
      .order('codigo_lr', { ascending: true }));

    const visitasBrutas = await fetchAll(() => supabase
      .from('f_visitas_bi_lr')
      .select('codigo_lr, nome_consultor, nome_produtor, projeto, mes_referencia')
      .eq('mes_referencia', refMonth)
      .order('codigo_lr', { ascending: true }));

    const produtoresFiltrados = (produtoresBrutos || []).filter(p => !isTestData(p.nome_consultor, p.projeto)).filter(rowMatches);
    const visitasFiltradas = (visitasBrutas || []).filter(v => !isTestData(v.nome_consultor, v.projeto)).filter(rowMatches);

    const totalAtivos = produtoresFiltrados.length;
    const totalVisitas = visitasFiltradas.length;

    // Agrupamento por consultor com sanitização de nomes
    const consultoresMap = {};
    produtoresFiltrados.forEach(p => {
      const consultores = sanitizeConsultorList(p.nome_consultor);
      consultores.forEach(sanitizedC => {
        const c = sanitizedC || 'NÃO ATRIBUÍDO';
        if (isTestData(c, p.projeto)) return;
        if (!consultoresMap[c]) {
          consultoresMap[c] = { consultor: c, totalFarms: 0, visitedFarms: new Set(), visitasCount: 0, industries: new Set(), projects: new Set(), regions: new Set() };
        }
        consultoresMap[c].totalFarms++;
        if (p.projeto) {
          consultoresMap[c].projects.add(p.projeto);
          consultoresMap[c].industries.add(mapAgroindustria(p.projeto));
        }
        const reg = getRegiao(p.codigo_lr, p.unidade_atendimento);
        if (reg) consultoresMap[c].regions.add(reg);
      });
    });

    visitasFiltradas.forEach(v => {
      const consultores = sanitizeConsultorList(v.nome_consultor);
      consultores.forEach(sanitizedC => {
        const c = sanitizedC || 'NÃO ATRIBUÍDO';
        if (!consultoresMap[c]) {
          consultoresMap[c] = { consultor: c, totalFarms: 0, visitedFarms: new Set(), visitasCount: 0, industries: new Set(), regions: new Set() };
        }
        consultoresMap[c].visitasCount++;
        if (v.codigo_lr) consultoresMap[c].visitedFarms.add(v.codigo_lr);
      });
    });

    const consultoresList = Object.values(consultoresMap).map(c => {
      const visitedCount = c.visitedFarms.size;
      const total = c.totalFarms || visitedCount || 1;
      const cob = ((visitedCount / total) * 100).toFixed(1);
      return {
        consultor: c.consultor,
        total_fazendas: total,
        fazendas_visitadas: visitedCount,
        total_visitas: c.visitasCount,
        perc_cobertura: Number(cob),
        agroindustrias: [...c.industries],
        regioes: [...c.regions],
        projetos: [...(c.projects || [])],
        status: 'ATIVO',
        mes_referencia: refMonth
      };
    }).sort((a, b) => b.perc_cobertura - a.perc_cobertura);

    const topConsultores = consultoresList;
    const totalConsultoresAtivos = consultoresList.length;
    const mediaVisitasConsultor = (totalVisitas / (totalConsultoresAtivos || 1)).toFixed(1);

    const visitadosUnicos = new Set(visitasFiltradas.map(v => v.codigo_lr).filter(Boolean)).size;
    const fazendasNaoVisitadas = Math.max(0, totalAtivos - visitadosUnicos);

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      refMonth,
      kpis: {
        perc_cobertura_geral: totalAtivos > 0 ? ((visitadosUnicos / totalAtivos) * 100).toFixed(1) : '0.0',
        total_visitas: totalVisitas,
        media_visitas_consultor: mediaVisitasConsultor,
        fazendas_nao_visitadas: fazendasNaoVisitadas
      },
      rankingConsultores: {
        labels: topConsultores.map(c => c.consultor),
        coberturas: topConsultores.map(c => c.perc_cobertura),
        visitas: topConsultores.map(c => c.total_visitas)
      },
      tabelaConsultores: consultoresList
    });
  } catch (error) {
    console.error('Erro em /api/visits:', error);
    return res.status(500).json({ error: error.message });
  }
};
