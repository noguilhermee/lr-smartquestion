const { Client } = require('pg');

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
        ssl: { rejectUnauthorized: false }
      });
      await client.connect();
      const schema = process.env.PG_SCHEMA || 'analytics_mart';
      const res = await client.query(`SELECT labor_rural_code, dairy_region FROM ${schema}.vw_dim_property WHERE dairy_region IS NOT NULL AND labor_rural_code IS NOT NULL AND property_status = 'active_approved';`);
      (res.rows || []).forEach(r => {
        if (r.labor_rural_code && r.dairy_region) {
          regiaoMap.set(String(r.labor_rural_code).trim(), String(r.dairy_region).trim());
        }
      });
      await client.end();
      if (regiaoMap.size > 0) return regiaoMap;
    } catch (err) {
      console.warn('⚠️ Erro ao consultar Azure PostgreSQL (vw_dim_property), recorrendo ao Supabase:', err.message);
    }
  }

  // Fallback para tab_fazenda no Supabase se o Postgres não estiver disponível
  try {
    const fazendasDB = await fetchAll(() => supabase.from('tab_fazenda').select('codAgroindustria, regiaoLeiteira').not('regiaoLeiteira', 'is', null));
    (fazendasDB || []).forEach(f => {
      if (f.codAgroindustria && f.regiaoLeiteira) {
        regiaoMap.set(String(f.codAgroindustria).trim(), String(f.regiaoLeiteira).trim());
      }
    });
  } catch (errSupabase) {
    console.error('Erro no fallback Supabase tab_fazenda:', errSupabase.message);
  }

  return regiaoMap;
}

module.exports = { getRegiaoMap };
