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

    const maxAllowedMonth = new Date().toISOString().slice(0, 7) + '-01';
    const [movimentacoesBrutas, produtoresBrutos, inativacoesFallback, vinculosFallback] = await Promise.all([
      fetchAll(() => supabase
        .from('tab_movimentacao_produtor')
        .select('codigo_lr, nome_consultor, data_movimentacao, movimentacao, motivo_inativacao, outro_motivo')
        .order('data_movimentacao', { ascending: false })
        .order('codigo_lr', { ascending: true })),
      fetchAll(() => supabase
        .from('tab_produtores_ativos_mensal')
        .select('codigo_lr, nome_produtor, nome_consultor, projeto, unidade_atendimento, data_referencia')
        .lte('data_referencia', maxAllowedMonth)
        .order('data_referencia', { ascending: false })
        .order('codigo_lr', { ascending: true })),
      fetchAll(() => supabase
        .from('tab_inativacoes_sq')
        .select('id_atendimento, codigo_lr, nome_produtor, nome_propriedade, projeto, grupo_ponto_atendimento')),
      fetchAll(() => supabase
        .from('tab_vinculos_sq')
        .select('codigo_lr, nome_produtor, nome_propriedade, projeto, unidade_atendimento'))
    ]);

    const fallbackMetaMap = new Map();
    (vinculosFallback || []).forEach(v => {
      if (v.codigo_lr && !fallbackMetaMap.has(v.codigo_lr)) {
        fallbackMetaMap.set(v.codigo_lr, { nome_produtor: v.nome_produtor, projeto: v.projeto, unidade_atendimento: v.unidade_atendimento });
      }
    });
    (inativacoesFallback || []).forEach(i => {
      const meta = {
        nome_produtor: i.nome_produtor,
        projeto: i.projeto,
        unidade_atendimento: i.grupo_ponto_atendimento
      };
      if (i.codigo_lr) {
        const prev = fallbackMetaMap.get(i.codigo_lr) || {};
        fallbackMetaMap.set(i.codigo_lr, {
          nome_produtor: i.nome_produtor || prev.nome_produtor,
          projeto: i.projeto || prev.projeto,
          unidade_atendimento: i.unidade_atendimento || prev.unidade_atendimento
        });
      }
      if (i.id_atendimento) {
        fallbackMetaMap.set(`INAT_${i.id_atendimento}`, meta);
        fallbackMetaMap.set(String(i.id_atendimento), meta);
      }
    });

    const produtores = (produtoresBrutos || []).filter(rowMatches);

    const produtoresMap = new Map();
    (produtores || []).forEach((produtor) => {
      if (produtor.codigo_lr && !produtoresMap.has(produtor.codigo_lr)) produtoresMap.set(produtor.codigo_lr, produtor);
    });

    const movimentacoes = (movimentacoesBrutas || []).filter(m => {
      const p = produtoresMap.get(m.codigo_lr) || fallbackMetaMap.get(m.codigo_lr);
      return rowMatches({ ...m, projeto: p?.projeto, unidade_atendimento: p?.unidade_atendimento, nome_produtor: p?.nome_produtor });
    });

    const maxDataRef = (produtores && produtores.length > 0) ? produtores[0].data_referencia : null;
    const latestMovementKey = String(movimentacoes?.[0]?.data_movimentacao || '').slice(0, 7);
    const latestMovementMonth = /^\d{4}-\d{2}$/.test(latestMovementKey) ? `${latestMovementKey}-01` : null;
    const requestedMonth = String(req.query?.month || '').slice(0, 10);
    // Produtores ativos e movimentação no mês selecionado
    const refMonth = /^\d{4}-\d{2}-\d{2}$/.test(requestedMonth)
      ? requestedMonth
      : (latestMovementMonth || maxDataRef);
    const produtoresFiltrados = refMonth
      ? produtores.filter(p => p.data_referencia === refMonth)
      : (produtores || []);

    // Filtrar dados de teste de movimentações
    const movimentacoesFiltradas = (movimentacoes || []).filter(m => !isTestData(m.nome_consultor, null));

    const totalAtivos = new Set(produtoresFiltrados.map(p => p.codigo_lr).filter(Boolean)).size || produtoresFiltrados.length;
    const totalConsultores = new Set(produtoresFiltrados.map(p => p.nome_consultor).filter(Boolean)).size;

    const currentMonthKey = refMonth ? String(refMonth).slice(0, 7) : null;
    const movimentacoesDoMes = currentMonthKey
      ? (movimentacoesFiltradas || []).filter(m => String(m.data_movimentacao || '').slice(0, 7) === currentMonthKey)
      : (movimentacoesFiltradas || []);

    let entradas = 0;
    let saidas = 0;
    const motivosMap = {};
    const tabelaMov = [];

    movimentacoesDoMes.forEach(m => {
      const isSaida = String(m.movimentacao || '').toLowerCase().includes('sa');
      const tipo = isSaida ? 'SAÍDA' : 'ENTRADA';
      if (tipo === 'ENTRADA') {
        entradas++;
      } else {
        saidas++;
        const mot = m.motivo_inativacao || m.outro_motivo || 'Outro Motivo';
        motivosMap[mot] = (motivosMap[mot] || 0) + 1;
      }
    });

    (movimentacoesFiltradas || []).forEach(m => {
      const isSaida = String(m.movimentacao || '').toLowerCase().includes('sa');
      const tipo = isSaida ? 'SAÍDA' : 'ENTRADA';
      const produtorAtivo = produtoresMap.get(m.codigo_lr);
      const movementMonthKey = String(m.data_movimentacao || '').slice(0, 7);
      const metaFallback = fallbackMetaMap.get(m.codigo_lr);
      const nomeFinal = produtorAtivo?.nome_produtor || metaFallback?.nome_produtor;
      // Desconsidera contas puramente de supervisao do SmartQuestion se nao houver nome
      const produtorNome = nomeFinal || (String(m.codigo_lr).includes('_CONSULTOR') ? 'CONTA DE SUPERVISÃO' : m.codigo_lr || 'PRODUTOR');
      // Sanitiza o nome do consultor removendo sufixo de projeto
      const consultorSanitizado = (sanitizeConsultorList(m.nome_consultor)[0]) || 'NÃO ATRIBUÍDO';
      tabelaMov.push({
        produtor: produtorNome,
        consultor: consultorSanitizado,
        grupo: consultorSanitizado,
        agroindustria: mapAgroindustria(produtorAtivo?.projeto || metaFallback?.projeto),
        regiao: getRegiao(m.codigo_lr, produtorAtivo?.unidade_atendimento || metaFallback?.unidade_atendimento),
        projeto: produtorAtivo?.projeto || metaFallback?.projeto || 'NÃO INFORMADO',
        status: tipo === 'SAÍDA' ? 'INATIVO' : 'ATIVO',
        mes_referencia: /^\d{4}-\d{2}$/.test(movementMonthKey) ? `${movementMonthKey}-01` : refMonth,
        tipo,
        data: m.data_movimentacao ? new Date(`${String(m.data_movimentacao).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '-',
        motivo: m.motivo_inativacao || m.outro_motivo || (tipo === 'ENTRADA' ? 'Novo Cadastro' : 'Desligamento')
      });
    });

    const saldo = entradas - saidas;
    const taxaChurn = ((saidas / (totalAtivos || 1)) * 100).toFixed(1);

    const referencias = [...new Set((produtores || []).map(p => p.data_referencia).filter(Boolean))]
      .filter(ref => !refMonth || ref <= refMonth)
      .sort();
    const movimentosPorMes = new Map();
    (movimentacoes || []).forEach(m => {
      const key = String(m.data_movimentacao || '').slice(0, 7);
      if (!key) return;
      if (!movimentosPorMes.has(key)) movimentosPorMes.set(key, { entradas: 0, saidas: 0 });
      const item = movimentosPorMes.get(key);
      if (String(m.movimentacao || '').toLowerCase().includes('sa')) item.saidas += 1;
      else item.entradas += 1;
    });
    const historicoMovimentacao = {
      labels: referencias.map(monthLabel),
      entradas: referencias.map(ref => movimentosPorMes.get(String(ref).slice(0, 7))?.entradas || 0),
      saidas: referencias.map(ref => movimentosPorMes.get(String(ref).slice(0, 7))?.saidas || 0),
      porcentagens: referencias.map(ref => {
        const item = movimentosPorMes.get(String(ref).slice(0, 7)) || { entradas: 0, saidas: 0 };
        const total = item.entradas + item.saidas;
        return total > 0 ? Number(((item.saidas / total) * 100).toFixed(1)) : 0;
      })
    };

    const carteiraPorMes = new Map();
    (produtores || []).forEach(p => {
      if (!p.data_referencia) return;
      if (!carteiraPorMes.has(p.data_referencia)) carteiraPorMes.set(p.data_referencia, new Set());
      if (p.codigo_lr) carteiraPorMes.get(p.data_referencia).add(p.codigo_lr);
    });

    const topMotivos = Object.entries(motivosMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      refMonth,
      kpis: {
        entradas_mes: entradas,
        saidas_mes: saidas,
        saldo: saldo,
        taxa_churn: taxaChurn,
        produtores_ativos: totalAtivos,
        consultores_ativos: totalConsultores
      },
      historicoMovimentacao,
      historicoCarteira: {
        labels: referencias.map(monthLabel),
        values: referencias.map(ref => carteiraPorMes.get(ref)?.size || 0)
      },
      motivosInativacao: {
        labels: topMotivos.map(m => m[0]),
        values: topMotivos.map(m => m[1])
      },
      tabelaMovimentacao: tabelaMov
    });
  } catch (error) {
    console.error('Erro em /api/turnover:', error);
    return res.status(500).json({ error: error.message });
  }
};
