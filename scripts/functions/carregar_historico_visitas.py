# -*- coding: utf-8 -*-
"""
Script: carregar_historico_visitas.py
Objetivo: Ingerir a base estática congelada de visitas (2023 até 2026/1 - data <= 2026-06-30)
          a partir dos arquivos particionados em BD_SMARTQUESTION/BACKUPS/VISITAS/
          nas tabelas sq_raw_visitas e sq_fato_visitas do Supabase.

Prioridade de Deduplicação e UPSERT:
  1º Lugar: id_atendimento (ID oficial do atendimento no SmartQuestion)
  2º Lugar: id_composto (Hash SHA-256 fallback para registros sem id_atendimento)

Uso:
  python scripts/functions/carregar_historico_visitas.py
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path
import pandas as pd
import yaml
from dotenv import load_dotenv
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def detectar_raiz(caminho_base: Path | None = None) -> Path:
    """Localiza a raiz do projeto de forma robusta."""
    caminho_atual = (caminho_base or Path(__file__).resolve()).parent
    for candidato in [caminho_atual, *caminho_atual.parents]:
        if (candidato / "scripts").is_dir() and ((candidato / "db").is_dir() or (candidato / "dashboard").is_dir()):
            return candidato
        if (candidato / "SCRIPTS").is_dir() and (candidato / "DB").is_dir():
            return candidato
    return caminho_atual


raiz_projeto = detectar_raiz()
for p in [
    raiz_projeto,
    raiz_projeto / "scripts",
    raiz_projeto / "scripts" / "functions",
    raiz_projeto / "SCRIPTS",
    raiz_projeto / "SCRIPTS" / "FUNCTIONS",
]:
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))


def carregar_configuracao(raiz: Path) -> dict:
    config_file = raiz / "scripts" / "config" / "config.yaml"
    if not config_file.is_file():
        config_file = raiz / "SCRIPTS" / "CONFIG" / "config.yaml"
    with open(config_file, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def obter_cliente_supabase(raiz: Path):
    for env_path in [
        raiz / "scripts" / "config" / ".env",
        raiz / "dashboard" / ".env.local",
        raiz / ".env",
    ]:
        if env_path.is_file():
            load_dotenv(env_path)

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")

    if not supabase_url or not supabase_key:
        raise ValueError("❌ Credenciais do Supabase não encontradas!")

    return create_client(supabase_url, supabase_key)


def normalizar_texto(texto: str | None) -> str:
    if not texto or pd.isna(texto):
        return ""
    nfkd = unicodedata.normalize("NFKD", str(texto))
    return "".join([c for c in nfkd if not unicodedata.combining(c)]).strip().upper()


def extrair_codigo_lr(ponto_atendimento: str | None) -> str | None:
    if not ponto_atendimento or pd.isna(ponto_atendimento):
        return None
    match = re.search(r"(LR\d{4,6})", str(ponto_atendimento), re.IGNORECASE)
    return match.group(1).upper() if match else None


def limpar_id_atendimento(val: any) -> str | None:
    if pd.isna(val) or val is None:
        return None
    s = str(val).strip().replace("\xa0", "")
    if s.endswith(".0"):
        s = s[:-2]
    return s if s and s != "nan" and s != "None" else None


def gerar_id_composto(codigo_lr: str | None, consultor: str | None, data_visita_str: str | None, id_atend: str | None) -> str:
    c_lr = (codigo_lr or "").strip().upper()
    c_cons = normalizar_texto(consultor)
    c_dt = (data_visita_str or "").strip()
    c_atend = (id_atend or "").strip()
    
    # Se id_atendimento estiver presente, ele compõe prioritariamente o hash
    raw_key = f"{c_atend}|{c_lr}|{c_cons}|{c_dt}"
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def sanitizar_records(df: pd.DataFrame, colunas_permitidas: list[str]) -> list[dict]:
    cols_existentes = [c for c in colunas_permitidas if c in df.columns]
    df_sub = df[cols_existentes].copy()
    records = df_sub.to_dict(orient="records")
    cleaned_records = []
    for row in records:
        clean_row = {}
        for k, v in row.items():
            if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))) or pd.isna(v):
                clean_row[k] = None
            elif k == "id_atendimento":
                try:
                    clean_row[k] = int(float(v))
                except (ValueError, TypeError):
                    clean_row[k] = None
            elif k in ["valor_pago_produtor", "valor_pago_agroindustria"]:
                try:
                    clean_row[k] = float(v)
                except (ValueError, TypeError):
                    clean_row[k] = None
            elif isinstance(v, pd.Timestamp):
                clean_row[k] = v.isoformat(timespec="milliseconds") + "Z"
            else:
                clean_row[k] = str(v).strip() if isinstance(v, str) else v
        cleaned_records.append(clean_row)
    return cleaned_records


def executar_carga_historico_visitas():
    print("=" * 70)
    print("🚀 CARGA HISTÓRICA E ESTÁTICA DE VISITAS (ATÉ 2026/1 - ATÉ 30/06/2026)")
    print("=" * 70)

    config = carregar_configuracao(raiz_projeto)
    pasta_backups = config.get("caminhos", {}).get("bd_smartquestion", "")
    if pasta_backups:
        caminho_backups = Path(pasta_backups) / "BACKUPS" / "VISITAS"
    else:
        caminho_backups = raiz_projeto.parent / "BD_SMARTQUESTION" / "BACKUPS" / "VISITAS"

    if not caminho_backups.exists():
        caminho_backups = Path(r"C:\Users\Guilherme\LABOR RURAL\Analytics - Departamento Analytics\POWER_BI\PROJETOS\BI_LABOR_RURAL\BD_SMARTQUESTION\BACKUPS\VISITAS")

    arquivos_historicos = config.get("smartquestion", {}).get("visitas_historico_arquivos", [
        "LISTA_GERAL_VISITAS_2023.xlsx",
        "LISTA_GERAL_VISITAS_2024.xlsx",
        "LISTA_GERAL_VISITAS_2025_1.xlsx",
        "LISTA_GERAL_VISITAS_2025_2.xlsx",
        "LISTA_GERAL_VISITAS_2026_1.xlsx"
    ])

    data_corte_estatica = config.get("referencia", {}).get("data_corte_estatica_visitas", "2026-06-30")
    print(f"📁 Pasta de arquivos históricos: {caminho_backups}")
    print(f"📅 Data limite de corte estático: {data_corte_estatica}")

    dfs = []
    for nome_arq in arquivos_historicos:
        arq_path = caminho_backups / nome_arq
        if not arq_path.exists():
            print(f"⚠️ Arquivo não encontrado (pulando): {nome_arq}")
            continue

        print(f"📖 Lendo arquivo de backup: {nome_arq} ...")
        df_part = pd.read_excel(arq_path, sheet_name=0)
        print(f"   -> {len(df_part)} registros lidos.")
        dfs.append(df_part)

    if not dfs:
        print("❌ Nenhum arquivo histórico foi lido. Carga cancelada.")
        return

    df_full = pd.concat(dfs, ignore_index=True)
    print(f"\n📊 Total bruto consolidado dos arquivos históricos: {len(df_full)} registros.")

    # Mapear e padronizar colunas da LISTA_GERAL_VISITAS
    col_map = {
        "Código do atendimento": "id_atendimento",
        "Código do(a) produtor(a)": "codigo_lr",
        "Produtor(a)": "nome_produtor",
        "Consultor(a)": "nome_consultor",
        "Data da visita": "data_visita",
        "Tipo de visita": "tipo_visita",
        "Ponto de atendimento": "ponto_atendimento",
        "Projeto": "projeto",
    }
    for orig, dest in col_map.items():
        if orig in df_full.columns and dest not in df_full.columns:
            df_full.rename(columns={orig: dest}, inplace=True)

    # Tratamento de Código LR
    if "ponto_atendimento" in df_full.columns:
        df_full["codigo_lr_ext"] = df_full["ponto_atendimento"].apply(extrair_codigo_lr)
        df_full["codigo_lr"] = df_full["codigo_lr"].fillna(df_full["codigo_lr_ext"])

    df_full["codigo_lr"] = df_full["codigo_lr"].astype(str).str.strip().str.upper()
    df_full["codigo_lr"] = df_full["codigo_lr"].replace({"NAN": None, "NONE": None, "": None})

    # Tratamento de Datas
    df_full["data_visita"] = pd.to_datetime(df_full["data_visita"], errors="coerce")
    df_full = df_full[df_full["data_visita"].notna()].copy()
    
    # Aplicar corte estático (somente registros até 2026/1: <= 2026-06-30)
    dt_corte_dt = pd.to_datetime(data_corte_estatica)
    df_full = df_full[df_full["data_visita"] <= dt_corte_dt].copy()
    print(f"   -> Registros mantidos até a data limite ({data_corte_estatica}): {len(df_full)}")

    df_full["mes_referencia"] = df_full["data_visita"].dt.to_period("M").dt.to_timestamp()
    df_full["data_processamento"] = datetime.now()

    # Tratamento de ID Atendimento
    df_full["id_atendimento_clean"] = df_full["id_atendimento"].apply(limpar_id_atendimento)

    # Geração de id_composto priorizando id_atendimento
    df_full["data_visita_str"] = df_full["data_visita"].dt.strftime("%Y-%m-%d")
    df_full["id_composto"] = df_full.apply(
        lambda r: gerar_id_composto(r.get("codigo_lr"), r.get("nome_consultor"), r.get("data_visita_str"), r.get("id_atendimento_clean")),
        axis=1
    )

    # 📌 DEDUPLICAÇÃO PRIORIZANDO id_atendimento EM PRIMEIRA INSTÂNCIA
    print("\n🔑 Aplicando regra oficial de deduplicação (1º Lugar: id_atendimento | 2º Lugar: id_composto)...")
    m_com_id = df_full["id_atendimento_clean"].notna()
    df_com_id = df_full[m_com_id].drop_duplicates(subset=["id_atendimento_clean"], keep="first")
    df_sem_id = df_full[~m_com_id].drop_duplicates(subset=["id_composto"], keep="first")
    
    df_dedup = pd.concat([df_com_id, df_sem_id], ignore_index=True)
    print(f"   -> Total de registros únicos após deduplicação: {len(df_dedup)} (Com id_atendimento: {len(df_com_id)}, Sem id_atendimento: {len(df_sem_id)})")

    # Supabase Client
    supabase = obter_cliente_supabase(raiz_projeto)

    # 1. Ingestão em sq_raw_visitas
    colunas_raw = [
        "id_atendimento", "codigo_lr", "nome_produtor", "nome_consultor",
        "data_visita", "mes_referencia", "tipo_visita", "projeto",
        "data_processamento", "id_composto"
    ]
    records_raw = sanitizar_records(df_dedup, colunas_raw)

    print(f"\n⬆️ Enviando {len(records_raw)} registros estáticos para sq_raw_visitas...")
    chunk_size = 1000
    for i in range(0, len(records_raw), chunk_size):
        chunk = records_raw[i : i + chunk_size]
        try:
            supabase.table("sq_raw_visitas").upsert(
                chunk,
                on_conflict="id_composto"
            ).execute()
            print(f"   ✅ sq_raw_visitas - Lote {i // chunk_size + 1}/{(len(records_raw) + chunk_size - 1) // chunk_size}: {len(chunk)} registros.")
        except Exception as e_raw:
            print(f"   ❌ Erro ao enviar sq_raw_visitas lote {i // chunk_size + 1}: {e_raw}")

    # 2. Ingestão em sq_fato_visitas (requer codigo_lr não nulo)
    df_fato = df_dedup[df_dedup["codigo_lr"].notna() & (df_dedup["codigo_lr"].astype(str).str.strip() != "")].copy()
    colunas_fato = [
        "id_atendimento", "codigo_lr", "nome_consultor", "mes_referencia",
        "nome_produtor", "projeto", "data_visita", "data_processamento",
        "id_composto", "tipo_visita"
    ]
    records_fato = sanitizar_records(df_fato, colunas_fato)

    print(f"\n⬆️ Enviando {len(records_fato)} registros estáticos para sq_fato_visitas...")
    for i in range(0, len(records_fato), chunk_size):
        chunk = records_fato[i : i + chunk_size]
        try:
            supabase.table("sq_fato_visitas").upsert(
                chunk,
                on_conflict="id_composto"
            ).execute()
            print(f"   ✅ sq_fato_visitas - Lote {i // chunk_size + 1}/{(len(records_fato) + chunk_size - 1) // chunk_size}: {len(chunk)} registros.")
        except Exception as e_fato:
            print(f"   ❌ Erro ao enviar sq_fato_visitas lote {i // chunk_size + 1}: {e_fato}")

    print("\n" + "=" * 70)
    print("✨ CARGA HISTÓRICA E ESTÁTICA DE VISITAS CONCLUÍDA COM SUCESSO!")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    executar_carga_historico_visitas()
