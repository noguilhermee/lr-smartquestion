from __future__ import annotations
import os
import sys
from pathlib import Path
from datetime import datetime
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

# Localizar raiz do projeto
caminho_atual = Path.cwd().resolve()
for candidato in [caminho_atual, *caminho_atual.parents]:
    if (candidato / "SCRIPTS").is_dir() and (candidato / "DB").is_dir():
        raiz_projeto = candidato
        break
else:
    raiz_projeto = caminho_atual

# Carregar variáveis de ambiente
for env_path in [raiz_projeto / "SCRIPTS" / "CONFIG" / ".env", raiz_projeto / "DASHBOARD" / ".env.local", raiz_projeto / ".env"]:
    if env_path.is_file():
        load_dotenv(env_path)

supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")

if not supabase_url or not supabase_key:
    raise ValueError("❌ Credenciais do Supabase não encontradas no arquivo .env!")

supabase = create_client(supabase_url, supabase_key)

# 1. Buscar mapeamento existente de idfazenda no Supabase para não violar a NOT NULL constraint
print("🔍 Buscando mapeamento de 'idfazenda' no Supabase...")
res_map = supabase.table("tab_consistencia_mensal").select("codigo_lr, idfazenda").not_.is_("idfazenda", "null").execute()
df_map = pd.DataFrame(res_map.data).dropna(subset=["codigo_lr", "idfazenda"]).drop_duplicates(subset=["codigo_lr"])
id_map = dict(zip(df_map["codigo_lr"].astype(str).str.strip(), df_map["idfazenda"]))
print(f"✅ Mapeamento carregado para {len(id_map)} produtores.")

# 2. Localizar o arquivo de indicadores mensais mais recente
pasta_input_temp = raiz_projeto / "DB" / "INPUT" / "TEMP"
arquivos = list(pasta_input_temp.glob("*indicadores_mensais.xlsx"))
if not arquivos:
    arquivos = list((raiz_projeto / "DB" / "INPUT").glob("*indicadores_mensais.xlsx"))

if not arquivos:
    raise FileNotFoundError("❌ Nenhum arquivo '*indicadores_mensais.xlsx' encontrado em DB/INPUT ou DB/INPUT/TEMP.")

arquivo_excel = max(arquivos, key=lambda f: f.stat().st_mtime)
print(f"\n📖 Lendo arquivo: {arquivo_excel.name}...")

df_excel = pd.read_excel(arquivo_excel)

col_codigo = next((c for c in df_excel.columns if "código" in c.lower() or "codigo" in c.lower()), None)
col_mes = next((c for c in df_excel.columns if "mês de referência" in c.lower() or "mes de referencia" in c.lower() or "referência" in c.lower()), None)
col_detalhe = next((c for c in df_excel.columns if "detalhamento" in c.lower()), None)
col_status = next((c for c in df_excel.columns if "status de consistência" in c.lower() or "status de consistencia" in c.lower()), None)

print(f"📌 Colunas mapeadas:")
print(f"   - Código LR: {col_codigo}")
print(f"   - Mês Referência: {col_mes}")
print(f"   - Status Consistência: {col_status}")
print(f"   - Detalhamento: {col_detalhe}")

if not col_codigo or not col_mes or not col_detalhe:
    raise ValueError("❌ Colunas obrigatórias não encontradas na planilha.")

cols_to_use = [col_codigo, col_mes, col_detalhe]
if col_status:
    cols_to_use.append(col_status)

df_carga = df_excel[cols_to_use].copy()
df_carga.rename(columns={
    col_codigo: "codigo_lr",
    col_mes: "mes_referencia",
    col_detalhe: "detalhamento_inconsistencia"
}, inplace=True)

if col_status and col_status in df_carga.columns:
    df_carga.rename(columns={col_status: "consistencia_mensal"}, inplace=True)

# Tratar datas e códigos
df_carga = df_carga[df_carga["codigo_lr"].notna() & df_carga["mes_referencia"].notna()].copy()
df_carga["codigo_lr"] = df_carga["codigo_lr"].astype(str).str.strip()
df_carga["mes_referencia"] = pd.to_datetime(df_carga["mes_referencia"]).dt.strftime("%Y-%m-%d")

# Atribuir idfazenda
df_carga["idfazenda"] = df_carga["codigo_lr"].map(id_map)
df_carga = df_carga[df_carga["idfazenda"].notna()].copy()
df_carga["idfazenda"] = df_carga["idfazenda"].astype(int)

# Converter "Nenhum", "NaN", nulos para None ou string limpa
df_carga["detalhamento_inconsistencia"] = df_carga["detalhamento_inconsistencia"].apply(
    lambda x: None if pd.isna(x) or str(x).strip().lower() in ["nenhum", "nan", "", "none"] else str(x).strip()
)

# Tratar duplicatas por idfazenda e mês (chave primária da tabela) e também por codigo_lr e mês
df_carga.drop_duplicates(subset=["idfazenda", "mes_referencia"], keep="last", inplace=True)
df_carga.drop_duplicates(subset=["codigo_lr", "mes_referencia"], keep="last", inplace=True)
print(f"📊 Total de registros válidos para atualização (após deduplicação): {len(df_carga)}")

# Realizar o UPSERT em lotes de 1.000
records = df_carga.to_dict(orient="records")
chunk_size = 1000
sucessos = 0

print(f"\n🚀 Enviando atualizações para o Supabase (tab_consistencia_mensal)...")
for i in range(0, len(records), chunk_size):
    chunk = records[i:i + chunk_size]
    try:
        res = supabase.table("tab_consistencia_mensal").upsert(
            chunk,
            on_conflict="idfazenda,mes_referencia"
        ).execute()
        sucessos += len(chunk)
        print(f"   ✅ Lote {i//chunk_size + 1}: {len(chunk)} registros atualizados com sucesso.")
    except Exception as e:
        print(f"   ❌ Erro no lote {i//chunk_size + 1}: {e}")

print(f"\n✨ Processo finalizado! {sucessos} registros processados em 'tab_consistencia_mensal'.")
print("👉 Agora você pode rodar o notebook 'ETL_BI_LR.ipynb' para propagar os dados para 'f_consistente_bi_lr'.")
