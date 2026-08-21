const { Client } = require('pg');

// ─── Utilitários de Tratamento e Sanitização de Regiões ─────────────────────

function fixMojibake(str) {
  if (!str) return '';
  return String(str)
    .replace(/Ã§/g, 'ç')
    .replace(/Ã‡/g, 'Ç')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã /g, 'Á')
    .replace(/Ã¢/g, 'â')
    .replace(/Ã‚/g, 'Â')
    .replace(/Ã£/g, 'ã')
    .replace(/Ãƒ/g, 'Ã')
    .replace(/Ã©/g, 'é')
    .replace(/Ã‰/g, 'É')
    .replace(/Ãª/g, 'ê')
    .replace(/ÃŠ/g, 'Ê')
    .replace(/Ã­/g, 'í')
    .replace(/Ã /g, 'Í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ã“/g, 'Ó')
    .replace(/Ã´/g, 'ô')
    .replace(/Ã”/g, 'Ô')
    .replace(/Ãµ/g, 'õ')
    .replace(/Ã•/g, 'Õ')
    .replace(/Ãº/g, 'ú')
    .replace(/Ãš/g, 'Ú');
}

const KNOWN_ACRONYMS = new Set(['AL', 'MG', 'SP', 'GO', 'CE', 'BA', 'SE', 'PE', 'RJ', 'PR', 'SC', 'RS', 'ES', 'MT', 'MS', 'RO', 'AC', 'AM', 'PA', 'MA', 'PI', 'RN', 'PB', 'TO', 'DF']);
const LOWERCASE_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

function formatSingleRegionName(raw) {
  const str = fixMojibake(raw).trim();
  if (!str) return null;

  const explicitMap = {
    'alagoas': 'Alagoas',
    'aracatuba': 'Araçatuba',
    'bahia': 'Bahia',
    'batalha/al': 'Batalha/AL',
    'ceara': 'Ceará',
    'goiania': 'Goiânia',
    'ibia': 'Ibiá',
    'independente': 'Independente',
    'itambacuri': 'Itambacuri',
    'ituiutaba': 'Ituiutaba',
    'minas gerais': 'Minas Gerais',
    'montes claros': 'Montes Claros',
    'patos de minas': 'Patos de Minas',
    'pedra do forte': 'Pedra do Forte',
    'pernambuco': 'Pernambuco',
    'ponte nova': 'Ponte Nova',
    'quixeramobim': 'Quixeramobim',
    'sergipe': 'Sergipe',
    'sertao norte': 'Sertão Norte',
    'sul de minas': 'Sul de Minas',
    'triangulo mineiro': 'Triângulo Mineiro'
  };

  // Tratar sufixos como " - 0460", " - 1217", " - 2155", " - 9655", " - 1215", " - 9264", " - 9188"
  const suffixMatch = str.match(/\s*-\s*(\d+)\s*$/);
  let base = str;
  let suffix = '';
  if (suffixMatch) {
    base = str.substring(0, suffixMatch.index).trim();
    suffix = ` - ${suffixMatch[1]}`;
  }

  const baseKey = base.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (explicitMap[baseKey]) {
    return explicitMap[baseKey] + suffix;
  }

  // Fallback: Title Case com preservação de siglas
  const words = base.split(/\s+/);
  const formattedWords = words.map((w, idx) => {
    const wUpper = w.toUpperCase();
    if (KNOWN_ACRONYMS.has(wUpper)) return wUpper;
    const wLower = w.toLowerCase();
    if (idx > 0 && LOWERCASE_WORDS.has(wLower)) return wLower;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });

  return formattedWords.join(' ') + suffix;
}

function sanitizeRegiao(rawRegion) {
  if (!rawRegion) return null;
  const str = fixMojibake(String(rawRegion).trim());
  if (!str) return null;

  const upper = str.toUpperCase().trim();

  // 1. Excluir valores de teste ou genéricos
  if (
    upper === '1' ||
    upper === '0' ||
    upper === 'TESTE' ||
    upper === 'TEST' ||
    upper === 'LABOR RURAL' ||
    upper === 'UNIDADE GENERICA' ||
    upper === 'NÃO INFORMADA' ||
    upper === 'NAO INFORMADA' ||
    /^\d+$/.test(upper)
  ) {
    return null;
  }

  // 2. Se for composto por '/', tratar cada parte
  if (str.includes('/')) {
    const parts = str.split('/').map(p => p.trim()).filter(Boolean);
    const cleanParts = parts.map(part => formatSingleRegionName(part)).filter(Boolean);
    if (cleanParts.length === 0) return null;

    // Preservar formato Cidade/UF (ex: BATALHA/AL)
    const lastPart = cleanParts[cleanParts.length - 1];
    if (cleanParts.length === 2 && KNOWN_ACRONYMS.has(lastPart.toUpperCase())) {
      return `${cleanParts[0]}/${lastPart.toUpperCase()}`;
    }

    // Ordenar alfabeticamente para estados compostos (ex: Sergipe/Bahia -> Bahia/Sergipe)
    cleanParts.sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return cleanParts.join('/');
  }

  return formatSingleRegionName(str);
}

// ─── Consulta ao Banco de Dados ─────────────────────────────────────────────

async function getRegiaoMap(supabase, fetchAll) {
  const regiaoMap = new Map();

  if (process.env.PG_HOST && process.env.PG_USER && process.env.PG_PASSWORD) {
    try {
      const client = new Client({
        host: process.env.PG_HOST,
        port: Number(process.env.PG_PORT || 5432),
        database: process.env.PG_DATABASE || 'postgres',
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 3000
      });
      await client.connect();
      const schema = process.env.PG_SCHEMA || 'analytics_mart';
      const res = await client.query(`SELECT labor_rural_code, dairy_region FROM ${schema}.vw_dim_property WHERE dairy_region IS NOT NULL AND labor_rural_code IS NOT NULL AND property_status = 'active_approved';`);
      (res.rows || []).forEach(r => {
        if (r.labor_rural_code && r.dairy_region) {
          const cleanRegiao = sanitizeRegiao(r.dairy_region);
          if (cleanRegiao) {
            regiaoMap.set(String(r.labor_rural_code).trim(), cleanRegiao);
          }
        }
      });
      await client.end();
      if (regiaoMap.size > 0) return regiaoMap;
    } catch (err) {
      console.warn('⚠️ Erro ao consultar Azure PostgreSQL (vw_dim_property), recorrendo ao Supabase:', err.message);
    }
  }

  // Fallback para sq_dim_fazenda no Supabase se o Postgres não estiver disponível
  try {
    const fazendasDB = await fetchAll(() => supabase.from('sq_dim_fazenda').select('cod_agroindustria, regiao_leiteira, codAgroindustria, regiaoLeiteira'));
    (fazendasDB || []).forEach(f => {
      const cod = f.cod_agroindustria || f.codAgroindustria;
      const reg = f.regiao_leiteira || f.regiaoLeiteira;
      if (cod && reg) {
        const cleanRegiao = sanitizeRegiao(reg);
        if (cleanRegiao) {
          regiaoMap.set(String(cod).trim(), cleanRegiao);
        }
      }
    });
  } catch (errSupabase) {
    console.error('Erro no fallback Supabase sq_dim_fazenda:', errSupabase.message);
  }

  return regiaoMap;
}

module.exports = { getRegiaoMap, sanitizeRegiao, fixMojibake };
