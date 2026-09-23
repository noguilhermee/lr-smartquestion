/**
 * Módulo compartilhado do backend do Dashboard.
 *
 * Contém exclusivamente utilitários técnicos: cliente Supabase, paginação,
 * cache em memória e formatação de datas/rótulos. Nenhuma regra de negócio
 * (cadeia de leite, whitelist de visitas, sanitização de consultores,
 * mapeamento de agroindústria/região etc.) vive aqui — tudo isso é resolvido
 * uma única vez no ETL (scripts/functions/regras_negocio.py e
 * camada_consumo.py) e gravado nas tabelas sq_fato_*. A API só lê.
 */

// Cache em memória no processo Node.js
const memoryCache = new Map();
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutos

function getCached(key) {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data, ttlMs = DEFAULT_TTL_MS) {
  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
  if (memoryCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of memoryCache.entries()) {
      if (now > v.expiresAt) memoryCache.delete(k);
    }
  }
}

async function fetchWithCache(cacheKey, fetcherFn, ttlMs = DEFAULT_TTL_MS) {
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;
  const result = await fetcherFn();
  setCached(cacheKey, result, ttlMs);
  return result;
}

function getSupabaseClient() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase credentials missing in environment variables');
  }
  return createClient(url, key);
}

/** Executa uma query paginando via .range() até esgotar os resultados. */
/**
 * Pagina uma query via .range() até esgotar os resultados.
 *
 * IMPORTANTE: sem uma ordenação explícita e estável, o Postgrest/Supabase não garante
 * que duas chamadas .range() sucessivas vejam o mesmo "snapshot" de ordenação em tabelas
 * grandes — o que causa linhas duplicadas e/ou linhas nunca retornadas entre páginas
 * (detectado em 2026-09-23 em sq_fato_economico: .range() sem order() devolvia 15.872
 * linhas onde a contagem real, via SQL direto, era 12.519). Por isso, sempre que a tabela
 * tiver uma coluna de chave natural, ela deve ser passada em `orderColumn`.
 */
async function fetchAll(createQuery, pageSize = 1000, orderColumn = null) {
  const rows = [];
  let from = 0;
  while (true) {
    let query = createQuery().range(from, from + pageSize - 1);
    if (orderColumn) query = query.order(orderColumn, { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    if (data && data.length > 0) rows.push(...data);
    if (!data || data.length < pageSize) break;
    from += pageSize;
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

function shiftMonthMinus1(monthStr) {
  if (!monthStr) return null;
  const d = new Date(`${String(monthStr).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Extrai e normaliza os filtros comuns compartilhados por todos os endpoints. */
function parseFilters(query) {
  return {
    month: String(query?.month || '').slice(0, 10),
    industry: String(query?.industry || '').trim(),
    region: String(query?.region || '').trim(),
    project: String(query?.project || '').trim(),
    consultant: String(query?.consultant || '').trim(),
    producer: String(query?.producer || '').trim(),
    status: String(query?.status || '').trim().toUpperCase()
  };
}

/** Aplica os filtros comuns a uma linha já resolvida pelo ETL (campos: agroindustria, regiao, projeto, consultor/nome_consultor, nome_produtor/codigo_lr, status_*). */
function rowMatchesFilters(row, filters) {
  if (filters.industry && row.agroindustria !== filters.industry) return false;
  if (filters.region && row.regiao !== filters.region) return false;
  if (filters.project && String(row.projeto || '') !== filters.project) return false;
  if (filters.consultant) {
    const consultor = String(row.consultor || row.nome_consultor || '').toLowerCase();
    if (consultor !== filters.consultant.toLowerCase()) return false;
  }
  if (filters.producer) {
    const target = filters.producer.trim().toLowerCase();
    const nome = String(row.nome_produtor || row.produtor || '').trim().toLowerCase();
    const codigo = String(row.codigo_lr || '').trim().toLowerCase();
    if (nome !== target && codigo !== target) return false;
  }
  if (filters.status) {
    const status = String(row.status || row.status_produtor || 'ATIVO').toUpperCase();
    if (filters.status === 'ATIVO' && status.includes('INATIV')) return false;
    if (filters.status === 'INATIVO' && !status.includes('INATIV')) return false;
  }
  return true;
}

module.exports = {
  fetchWithCache,
  getCached,
  setCached,
  getSupabaseClient,
  fetchAll,
  monthLabel,
  formatDate,
  shiftMonthMinus1,
  parseFilters,
  rowMatchesFilters
};
