"""
DEPRECATED: superseded por scripts/functions/camada_consumo.py, que já
deduplica por id_atendimento/id_composto e remove chaves obsoletas
(sincronizar_tabela) a cada publicação. Mantido apenas como referência
histórica (AGENTS.md regra 4); executar_pipeline.py não o chama mais.

Script de Limpeza de Duplicatas e Recálculo de Hash (id_composto) em sq_fato_visitas e sq_raw_visitas.

Este script:
1. Lê todos os registros de sq_fato_visitas e sq_raw_visitas no Supabase.
2. Identifica duplicatas por id_atendimento (registros com o mesmo id_atendimento mas id_composto diferente).
3. Para cada id_atendimento duplicado, recalcula o id_composto oficial (hash padronizado) e escolhe o registro mais completo / mais recente.
4. Remove do Supabase todos os registros obsoletos com id_composto antigo.
5. Atualiza / Re-upserta os registros com o id_composto oficial.
"""

from __future__ import annotations

import os
import sys
import hashlib
import pandas as pd
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

caminho_atual = Path.cwd().resolve()
for candidato in [caminho_atual, *caminho_atual.parents]:
    if (candidato / "scripts").is_dir() and ((candidato / "db").is_dir() or (candidato / "dashboard").is_dir()):
        raiz_projeto = candidato
        break
else:
    raiz_projeto = caminho_atual

for p in [raiz_projeto, raiz_projeto / "scripts", raiz_projeto / "scripts" / "functions"]:
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from functions.function import obter_cliente_supabase

def recalcular_hash_oficial(row: dict) -> str:
    id_atend = row.get("id_atendimento")
    if pd.notna(id_atend) and id_atend is not None:
        try:
            s_at = str(int(float(id_atend))).strip()
            if s_at and s_at != "0" and s_at.lower() != "nan":
                return hashlib.sha256(f"ATEND_{s_at}".encode("utf-8")).hexdigest()
        except (ValueError, TypeError):
            pass

    c_lr = str(row.get("codigo_lr") or "").strip().upper() or "NULL_VAL"
    c_cons = str(row.get("nome_consultor") or "").strip() or "NULL_VAL"

    mes_ref = row.get("mes_referencia") or row.get("data_visita")
    if pd.notna(mes_ref) and mes_ref:
        dt = pd.to_datetime(mes_ref, errors="coerce")
        c_mes = dt.isoformat(timespec="milliseconds") + "Z" if pd.notna(dt) else "NULL_VAL"
    else:
        c_mes = "NULL_VAL"

    raw_key = f"{c_lr}{c_cons}{c_mes}"
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def buscar_todos_registros(supabase, tabela: str, select_cols: str = "*") -> pd.DataFrame:
    print(f"📖 Lendo todos os registros de {tabela} no Supabase...")
    all_rows = []
    offset = 0
    batch_size = 1000
    while True:
        resp = supabase.table(tabela).select(select_cols).range(offset, offset + batch_size - 1).execute()
        if not resp.data:
            break
        all_rows.extend(resp.data)
        if len(resp.data) < batch_size:
            break
        offset += batch_size
        if offset % 10000 == 0:
            print(f"   ... {len(all_rows)} registros lidos até agora.")
    print(f"   -> Total lido de {tabela}: {len(all_rows)} registros.")
    return pd.DataFrame(all_rows)


import math


COLS_INTEIRAS = {
    "id_atendimento", "vacas_lactacao", "vacas_secas", "bezerras_aleitamento",
    "bezerros_aleitamento", "novilhas", "reprodutores", "receptoras", "rebanho_total"
}

def sanitizar_registro_para_supabase(r: dict) -> dict:
    clean_r = {}
    for k, v in r.items():
        if pd.isna(v) or v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            clean_r[k] = None
        elif str(v).strip().lower() in ["nan", "none", "null", ""]:
            clean_r[k] = None
        elif k in COLS_INTEIRAS:
            try:
                clean_r[k] = int(float(v))
            except (ValueError, TypeError):
                clean_r[k] = None
        elif isinstance(v, pd.Timestamp):
            clean_r[k] = v.isoformat()
        else:
            clean_r[k] = str(v).strip() if isinstance(v, str) else v
    return clean_r


def limpar_duplicatas_tabela(supabase, tabela: str):
    print(f"\n======================================================================")
    print(f"🧹 INICIANDO LIMPEZA DE DUPLICATAS NA TABELA: {tabela}")
    print(f"======================================================================")
    
    df = buscar_todos_registros(supabase, tabela)
    if df.empty:
        print(f"⚠️ Tabela {tabela} está vazia.")
        return

    print(f"📊 Analisando {len(df)} registros...")
    
    # 1. Identificar registros com id_atendimento válido
    m_valid_id = df["id_atendimento"].notna() & (df["id_atendimento"] > 0)
    df_com_id = df[m_valid_id].copy()
    df_com_id["id_atendimento_clean"] = df_com_id["id_atendimento"].apply(lambda x: str(int(float(x))))

    hashes_para_deletar = []
    registros_para_upsert = []
    print("⚡ Processando deduplicação e fusão inteligente em memória...")

    for id_at, grupo in df_com_id.groupby("id_atendimento_clean"):
        hashes_grupo = grupo["id_composto"].dropna().unique().tolist()
        primeira_linha = grupo.iloc[0].to_dict()
        hash_oficial = recalcular_hash_oficial(primeira_linha)

        # Se houver mais de um registro OU se o registro existente tiver hash diferente do oficial
        precisa_limpar = len(grupo) > 1 or any(h != hash_oficial for h in hashes_grupo)

        if not precisa_limpar:
            continue

        # Coletar todos os hashes atuais para exclusão
        for h in hashes_grupo:
            if h and h not in hashes_para_deletar:
                hashes_para_deletar.append(h)

        # Mesclar o grupo em uma única linha canônica (preservando campos ricos)
        linha_mesclada = {}
        for col in df.columns:
            if col in ["id_atendimento_clean", "hash_oficial"]:
                continue
            valores_validos = grupo[col].dropna()
            val_escolhido = None
            if not valores_validos.empty:
                for v in valores_validos:
                    if v is not None and str(v).strip() != "" and str(v).lower() not in ["nan", "none", "null"]:
                        val_escolhido = v
                        break
                if val_escolhido is None:
                    val_escolhido = valores_validos.iloc[0]
            linha_mesclada[col] = val_escolhido

        linha_mesclada["id_composto"] = hash_oficial
        linha_mesclada["data_processamento"] = datetime.now().isoformat()
        registros_para_upsert.append(sanitizar_registro_para_supabase(linha_mesclada))

    # 2. Deletar hashes obsoletos/duplicados do Supabase
    print(f"🗑️ Total de hashes obsoletos/duplicados identificados para remoção: {len(hashes_para_deletar)}")

    if hashes_para_deletar:
        print(f"🚀 Removendo {len(hashes_para_deletar)} registros obsoletos do Supabase em lotes de 200...")
        lote_size = 200
        total_deletado = 0
        for i in range(0, len(hashes_para_deletar), lote_size):
            lote = hashes_para_deletar[i:i + lote_size]
            try:
                supabase.table(tabela).delete().in_("id_composto", lote).execute()
                total_deletado += len(lote)
            except Exception as e:
                print(f"❌ Erro ao deletar lote {i}: {e}")

        print(f"✅ Remoção concluída: {total_deletado} registros excluídos de {tabela}.")
    else:
        print(f"✅ Nenhum registro obsoleto para remover em {tabela}.")

    # 3. Upsert dos registros canônicos mesclados
    if registros_para_upsert:
        print(f"⬆️ Re-enviando {len(registros_para_upsert)} registros canônicos mesclados para {tabela}...")
        lote_size = 500
        total_upsert = 0
        for i in range(0, len(registros_para_upsert), lote_size):
            lote = registros_para_upsert[i:i + lote_size]
            try:
                supabase.table(tabela).upsert(lote, on_conflict="id_composto").execute()
                total_upsert += len(lote)
            except Exception as e_up:
                print(f"❌ Erro ao fazer upsert no lote {i} em {tabela}: {e_up}")
        print(f"✅ Upsert concluído: {total_upsert} registros canônicos atualizados em {tabela}.")


def main():
    raiz = caminho_atual
    supabase = obter_cliente_supabase(raiz)
    
    limpar_duplicatas_tabela(supabase, "sq_fato_visitas")
    limpar_duplicatas_tabela(supabase, "sq_raw_visitas")


if __name__ == "__main__":
    main()


