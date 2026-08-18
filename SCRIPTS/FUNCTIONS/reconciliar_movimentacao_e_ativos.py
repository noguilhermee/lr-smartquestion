import os
import re
import sys
import time
from datetime import datetime, date
from pathlib import Path
from typing import Any, Dict, List, Set
import numpy as np
import pandas as pd
import yaml

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

raiz_projeto = Path(__file__).resolve().parents[1]
if str(raiz_projeto) not in sys.path:
    sys.path.insert(0, str(raiz_projeto))
if str(raiz_projeto / "SCRIPTS") not in sys.path:
    sys.path.insert(0, str(raiz_projeto / "SCRIPTS"))
if str(raiz_projeto / "SCRIPTS" / "FUNCTIONS") not in sys.path:
    sys.path.insert(0, str(raiz_projeto / "SCRIPTS" / "FUNCTIONS"))

from FUNCTIONS.function import (
    carregar_config_referencia,
    carregar_env,
    obter_cliente_supabase,
)
from FUNCTIONS.metadata_tracker import obter_metadados_planilhas


def extrair_consultor_individual(consultor_str: str, grupo_str: str) -> str:
    """Extrai o consultor individual responsável a partir do grupo ou do campo de consultor."""
    texto = grupo_str if (isinstance(grupo_str, str) and grupo_str.strip()) else consultor_str
    if not isinstance(texto, str) or not texto.strip():
        return "NÃO ATRIBUÍDO"
        
    texto_upper = texto.upper().strip()
    if "CELIO ROBERTO OLIVEIRA" in texto_upper or "SUELY DE JESUS OLIVEIRA" in texto_upper:
        return "LAC CONSULTORIA"
        
    limpo = re.sub(r"\(.*?\)", "", texto).strip()
    if limpo:
        partes = [p.strip().upper() for p in limpo.split("/") if p.strip()]
        if partes:
            return partes[0]
        return limpo.upper()
    return "NÃO ATRIBUÍDO"


def executar_reconciliacao():
    print("=================================================================")
    print("   INICIANDO RECONCILIAÇÃO DE VÍNCULOS, INATIVAÇÕES E ATIVOS     ")
    print("=================================================================")

    config = carregar_config_referencia(raiz_projeto)
    supabase = obter_cliente_supabase(raiz_projeto)
    
    with open(raiz_projeto / "SCRIPTS" / "CONFIG" / "config.yaml", "r", encoding="utf-8") as f:
        cfg_raw = yaml.safe_load(f)
        
    bd_path = Path(cfg_raw.get("caminhos", {}).get("bd_smartquestion", ""))
    
    # 1. Atualizar Metadados de Proveniência
    print("\n📦 1. Atualizando metadados de proveniência das planilhas...")
    metadados = obter_metadados_planilhas(raiz_projeto)
    print(f"   -> {metadados['total_arquivos']} arquivos rastreados com sucesso.")

    # 2. Consultar Status Atual dos Consultores (Desduplicando por ultimaAtualizacao)
    print("\n👤 2. Verificando status dos consultores (BD_STATUS_USUARIO_SQ.xlsx)...")
    arquivo_status_consultores = bd_path / "BD_STATUS_USUARIO_SQ.xlsx"
    consultores_inativos: Set[str] = set()
    
    if arquivo_status_consultores.exists():
        try:
            df_status = pd.read_excel(arquivo_status_consultores)
            if "ultimaAtualizacao" in df_status.columns and "Nome" in df_status.columns:
                df_status_sorted = df_status.sort_values(
                    by="ultimaAtualizacao", ascending=False
                ).drop_duplicates(subset=["Nome"], keep="first")
                
                consultores_inativos = set(
                    df_status_sorted[df_status_sorted["Ativo"] == "Não"]["Nome"]
                    .astype(str)
                    .str.strip()
                    .str.upper()
                )
                print(f"   -> {len(df_status_sorted)} consultores únicos avaliados.")
                print(f"   -> {len(consultores_inativos)} consultores inativos identificados.")
                
                # Checar Amanda Roriz
                amanda_status = df_status_sorted[
                    df_status_sorted["Nome"].str.contains("AMANDA RORIZ", case=False, na=False)
                ]
                if not amanda_status.empty:
                    print(f"   -> Amanda Roriz status confirmado: {amanda_status['Ativo'].values[0]} (Data: {amanda_status['ultimaAtualizacao'].values[0]})")
        except Exception as e:
            print(f"   ⚠️ Aviso ao ler BD_STATUS_USUARIO_SQ.xlsx: {e}")

    # 3. Processar Inativações Recentes para tab_inativacoes_sq
    print("\n🚫 3. Processando solicitações de inativação (tab_inativacoes_sq)...")
    # Buscar inativações já no Supabase
    res_inats = supabase.table("tab_inativacoes_sq").select("*").execute()
    df_inats_existentes = pd.DataFrame(res_inats.data) if res_inats.data else pd.DataFrame()
    print(f"   -> Total de inativações existentes no banco: {len(df_inats_existentes)}")

    # 4. Construir Movimentações Consolidadas (tab_movimentacao_produtor)
    print("\n🔄 4. Consolidando tabela fato de movimentação (tab_movimentacao_produtor)...")
    
    # 4.1 Entradas (a partir de tab_vinculos_sq)
    res_vinc = supabase.table("tab_vinculos_sq").select(
        "codigo_lr, consultor_grupo_atendimento, grupo_atendimento, data_associacao, projeto, nome_produtor, nome_propriedade"
    ).execute()
    df_vinc_db = pd.DataFrame(res_vinc.data) if res_vinc.data else pd.DataFrame()
    
    movimentacoes_lista = []
    
    if not df_vinc_db.empty:
        for _, row in df_vinc_db.iterrows():
            cod = str(row.get("codigo_lr") or "").strip()
            if not cod or cod.lower() == "nan":
                continue
            cons = extrair_consultor_individual(row.get("consultor_grupo_atendimento"), row.get("grupo_atendimento"))
            proj = str(row.get("projeto") or "").strip().upper()
            if proj in ("A", "NAN", "NONE", ""):
                proj = None
            if "MATEUS CARNIELLI" in cons and proj and "ALVOAR ECO" in proj:
                continue
            dt_assoc = row.get("data_associacao")
            if dt_assoc:
                try:
                    dt_mov = pd.to_datetime(dt_assoc).strftime("%Y-%m-01")
                except Exception:
                    dt_mov = "2024-01-01"
            else:
                dt_mov = "2024-01-01"
                
            id_comp = f"{cod}_{cons}_{dt_mov}_Entrada"
            movimentacoes_lista.append({
                "id_composto": id_comp,
                "codigo_lr": cod,
                "nome_consultor": cons,
                "data_movimentacao": dt_mov,
                "movimentacao": "Entrada",
                "motivo_inativacao": None,
                "outro_motivo": None,
                "data_processamento": datetime.now().isoformat(),
            })

    # 4.2 Saídas (a partir de tab_inativacoes_sq)
    if not df_inats_existentes.empty:
        for _, row in df_inats_existentes.iterrows():
            cod = str(row.get("codigo_lr") or "").strip()
            if not cod or cod.lower() == "nan":
                continue
            cons = extrair_consultor_individual(row.get("nome_consultor"), row.get("grupo_ponto_atendimento"))
            dt_inat = row.get("data_inativacao") or row.get("data_solicitacao")
            if dt_inat:
                try:
                    dt_mov = pd.to_datetime(dt_inat).strftime("%Y-%m-01")
                except Exception:
                    dt_mov = "2026-08-01"
            else:
                dt_mov = "2026-08-01"
                
            motivo = row.get("motivo_inativacao")
            outro = row.get("outro_motivo")
            id_comp = f"{cod}_{cons}_{dt_mov}_Saída"
            
            movimentacoes_lista.append({
                "id_composto": id_comp,
                "codigo_lr": cod,
                "nome_consultor": cons,
                "data_movimentacao": dt_mov,
                "movimentacao": "Saída",
                "motivo_inativacao": motivo,
                "outro_motivo": outro,
                "data_processamento": datetime.now().isoformat(),
            })
            
    df_mov_final = pd.DataFrame(movimentacoes_lista).drop_duplicates(subset=["id_composto"], keep="last")
    print(f"   -> Total de movimentações consolidadas: {len(df_mov_final)} (Entradas: {len(df_mov_final[df_mov_final['movimentacao'] == 'Entrada'])}, Saídas: {len(df_mov_final[df_mov_final['movimentacao'] == 'Saída'])})")
    
    # Checar se Thales Noronha LR02481 está na lista
    thales_mov = df_mov_final[df_mov_final["codigo_lr"] == "LR02481"]
    print(f"   -> Movimentações para LR02481 (Thales Noronha): {len(thales_mov)} registros.")
    for _, r in thales_mov.iterrows():
        print(f"      * {r['id_composto']} -> {r['movimentacao']} em {r['data_movimentacao']} ({r['motivo_inativacao']})")

    # Upsert em lotes em tab_movimentacao_produtor
    print("\n💾 5. Gravando movimentações em tab_movimentacao_produtor no Supabase...")
    registros_mov = df_mov_final.replace({np.nan: None}).to_dict(orient="records")
    LOTE = 500
    sucesso_mov = 0
    for i in range(0, len(registros_mov), LOTE):
        lote = registros_mov[i : i + LOTE]
        try:
            supabase.table("tab_movimentacao_produtor").upsert(lote, on_conflict="id_composto").execute()
            sucesso_mov += len(lote)
        except Exception as e:
            print(f"   ❌ Erro ao enviar lote {i // LOTE + 1}: {e}")
        time.sleep(0.2)
    print(f"   ✅ {sucesso_mov} registros de movimentação atualizados no Supabase.")

    # 6. Reconciliar tab_produtores_ativos_mensal (Expurgando Inativações)
    print("\n🌱 6. Reconciliando base ativa mensal em tab_produtores_ativos_mensal...")
    
    # Identificar todas as inativações com data e código
    inativacoes_por_codigo: Dict[str, str] = {}
    if not df_inats_existentes.empty:
        for _, row in df_inats_existentes.iterrows():
            c = str(row.get("codigo_lr") or "").strip()
            dt = row.get("data_inativacao") or row.get("data_solicitacao")
            if c and dt:
                try:
                    dt_str = pd.to_datetime(dt).strftime("%Y-%m-01")
                    # Se tiver múltiplas inativações, pegar a mais antiga ou válida
                    if c not in inativacoes_por_codigo or dt_str < inativacoes_por_codigo[c]:
                        inativacoes_por_codigo[c] = dt_str
                except Exception:
                    pass

    print(f"   -> Mapeados {len(inativacoes_por_codigo)} produtores com inativação confirmada.")

    # Buscar dados de tab_produtores_ativos_mensal para os meses 2026-08-01 e 2026-09-01
    for ref_m in ["2026-08-01", "2026-09-01"]:
        res_ativos = supabase.table("tab_produtores_ativos_mensal").select("*").eq("data_referencia", ref_m).execute()
        if res_ativos.data:
            df_ativos_m = pd.DataFrame(res_ativos.data)
            total_antes = len(df_ativos_m)
            
            # Identificar quais estão inativados em ou antes de ref_m
            inativos_a_remover = []
            for _, r in df_ativos_m.iterrows():
                c = str(r.get("codigo_lr") or "").strip()
                if c in inativacoes_por_codigo:
                    dt_inat = inativacoes_por_codigo[c]
                    if dt_inat <= ref_m:
                        inativos_a_remover.append(c)
                        
            print(f"\n   Mês {ref_m}:")
            print(f"   - Total antes do expurgo: {total_antes} registros ({df_ativos_m['codigo_lr'].nunique()} únicos)")
            print(f"   - Inativados identificados para remoção: {len(inativos_a_remover)} ({len(set(inativos_a_remover))} únicos)")
            
            if inativos_a_remover:
                # Remover do banco para ref_m
                for c in set(inativos_a_remover):
                    try:
                        supabase.table("tab_produtores_ativos_mensal").delete().eq("data_referencia", ref_m).eq("codigo_lr", c).execute()
                    except Exception as e:
                        print(f"     ❌ Erro ao remover {c}: {e}")
                print(f"   ✅ Expurgo concluído para {ref_m}. Total líquido ajustado: {total_antes - len(inativos_a_remover)}")
                
    print("\n=================================================================")
    print("   RECONCILIAÇÃO CONCLUÍDA COM SUCESSO!                          ")
    print("=================================================================")


if __name__ == "__main__":
    executar_reconciliacao()
