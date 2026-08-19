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

caminho_atual = Path(__file__).resolve()
for candidato in [caminho_atual, *caminho_atual.parents]:
    if (candidato / "SCRIPTS").is_dir() and ((candidato / "DB").is_dir() or (candidato / "DASHBOARD").is_dir()):
        raiz_projeto = candidato
        break
else:
    raiz_projeto = caminho_atual.parents[2]

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
    
    # Verificar se há inativações recentes na pasta para sincronizar no Supabase
    try:
        arquivos_inat = list(bd_path.glob("*_LISTA_INATIVACAO.xlsx")) + list((bd_path / "BACKUPS").glob("*_LISTA_INATIVACAO.xlsx"))
        if arquivos_inat:
            for arq_inat in arquivos_inat:
                if arq_inat.exists():
                    df_raw_i = pd.read_excel(arq_inat, header=None)
                    h_i = 0
                    for r in range(min(5, len(df_raw_i))):
                        vals = [str(x).strip().lower() for x in df_raw_i.iloc[r].dropna().tolist()]
                        if any("atendimento" in v for v in vals):
                            h_i = r
                            break
                    df_i = pd.read_excel(arq_inat, header=h_i).dropna(how="all", axis=1).dropna(how="all", axis=0)
                    col_id_i = [c for c in df_i.columns if "atendimento" in str(c).lower()]
                    if col_id_i:
                        df_i["id_atendimento"] = pd.to_numeric(df_i[col_id_i[0]], errors="coerce")
                        df_i = df_i.dropna(subset=["id_atendimento"])
                        df_i["id_atendimento"] = df_i["id_atendimento"].astype(int)
                        
                        mapa_cols = {
                            "Consultor(a):": "nome_consultor",
                            "Projeto": "projeto",
                            "Código do(a) produtor(a):": "codigo_lr",
                            "Produtor(a):": "nome_produtor",
                            "Propriedade:": "nome_propriedade",
                            "Grupo Ponto Atendimento": "grupo_ponto_atendimento",
                            "Data da solicitação:": "data_solicitacao",
                            "Data da inativação:": "data_inativacao",
                            "Motivo da inativação:": "motivo_inativacao",
                            "Se outro, qual motivo?": "outro_motivo",
                            "Status": "produtor_ativo",
                        }
                        df_prep_i = df_i.rename(columns={k: v for k, v in mapa_cols.items() if k in df_i.columns})
                        df_prep_i["data_processamento"] = datetime.now().isoformat()
                        
                        # Converter datas
                        if "data_solicitacao" in df_prep_i.columns:
                            df_prep_i["data_solicitacao"] = pd.to_datetime(df_prep_i["data_solicitacao"], errors="coerce").dt.strftime("%Y-%m-%d %H:%M:%S")
                        if "data_inativacao" in df_prep_i.columns:
                            df_prep_i["data_inativacao"] = pd.to_datetime(df_prep_i["data_inativacao"], errors="coerce").dt.strftime("%Y-%m-%d")
                            
                        cols_finais = ["id_atendimento", "nome_consultor", "projeto", "codigo_lr", "nome_produtor", "nome_propriedade", "grupo_ponto_atendimento", "data_solicitacao", "data_inativacao", "motivo_inativacao", "outro_motivo", "produtor_ativo", "data_processamento"]
                        cols_presentes = [c for c in cols_finais if c in df_prep_i.columns]
                        registros_i = df_prep_i[cols_presentes].replace({np.nan: None}).to_dict(orient="records")
                        if registros_i:
                            supabase.table("tab_inativacoes_sq").upsert(registros_i, on_conflict="id_atendimento").execute()
    except Exception as e_inat:
        print(f"   ⚠️ Aviso ao sincronizar inativações recentes: {e_inat}")

    # Buscar inativações já consolidadas no Supabase
    res_inats = supabase.table("tab_inativacoes_sq").select("*").execute()
    df_inats_existentes = pd.DataFrame(res_inats.data) if res_inats.data else pd.DataFrame()
    print(f"   -> Total de inativações existentes no banco: {len(df_inats_existentes)}")

    # 4. Construir Movimentações Consolidadas (tab_movimentacao_produtor)
    print("\n🔄 4. Consolidando tabela fato de movimentação (tab_movimentacao_produtor)...")
    
    PROJETOS_OFICIAIS = ['ALVOAR ASSIST', 'ALVOAR ECO', 'ATEG_CCPR', 'LPA', 'REGENERA', 'SEMEAR']

    # 4.1 Entradas (a partir de tab_vinculos_sq filtrado para projetos oficiais)
    res_vinc = supabase.table("tab_vinculos_sq").select(
        "codigo_lr, consultor_grupo_atendimento, grupo_atendimento, data_associacao, projeto, nome_produtor, nome_propriedade, vinculo_ativo, unidade_atendimento, cidade_produtor, estado_produtor, codigo_agroindustria, codigo_fazenda"
    ).in_("projeto", PROJETOS_OFICIAIS).execute()
    df_vinc_db = pd.DataFrame(res_vinc.data) if res_vinc.data else pd.DataFrame()
    
    movimentacoes_lista = []
    
    if not df_vinc_db.empty:
        for _, row in df_vinc_db.iterrows():
            cod = str(row.get("codigo_lr") or "").strip()
            if not cod or cod.lower() == "nan":
                continue
            cons = extrair_consultor_individual(row.get("consultor_grupo_atendimento"), row.get("grupo_atendimento"))
            proj = str(row.get("projeto") or "").strip().upper()
            if proj not in PROJETOS_OFICIAIS:
                continue
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

    # 4.2 Saídas (a partir de tab_inativacoes_sq vinculadas aos projetos oficiais)
    # REGRA: De 2026 em diante, a data oficial é data_solicitacao. Dados antes disso mantêm o histórico.
    codigos_oficiais_set = set(df_vinc_db["codigo_lr"].dropna().unique()) if not df_vinc_db.empty else set()
    novos_ids_saida_2026 = set()
    
    if not df_inats_existentes.empty:
        for _, row in df_inats_existentes.iterrows():
            cod = str(row.get("codigo_lr") or "").strip()
            if not cod or cod.lower() == "nan" or (codigos_oficiais_set and cod not in codigos_oficiais_set):
                continue
            cons = extrair_consultor_individual(row.get("nome_consultor"), row.get("grupo_ponto_atendimento"))
            
            dt_solic = row.get("data_solicitacao")
            dt_inat = row.get("data_inativacao")
            
            dt_solic_p = pd.to_datetime(dt_solic, errors="coerce")
            if pd.notna(dt_solic_p) and dt_solic_p >= pd.Timestamp("2026-01-01"):
                dt_mov = dt_solic_p.strftime("%Y-%m-01")
            else:
                dt_legado = pd.to_datetime(dt_inat or dt_solic, errors="coerce")
                if pd.notna(dt_legado):
                    dt_mov = dt_legado.strftime("%Y-%m-01")
                else:
                    dt_mov = "2026-08-01"
                
            motivo = row.get("motivo_inativacao")
            outro = row.get("outro_motivo")
            id_comp = f"{cod}_{cons}_{dt_mov}_Saída"
            
            if dt_mov >= "2026-01-01":
                novos_ids_saida_2026.add(id_comp)
            
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
    print(f"   -> Total de movimentações consolidadas (Leite): {len(df_mov_final)} (Entradas: {len(df_mov_final[df_mov_final['movimentacao'] == 'Entrada'])}, Saídas: {len(df_mov_final[df_mov_final['movimentacao'] == 'Saída'])})")
    
    # 4.3 Limpar registros órfãos de saídas de 2026 no Supabase antes de gravar
    try:
        res_saidas_2026_db = supabase.table("tab_movimentacao_produtor").select("id_composto").eq("movimentacao", "Saída").gte("data_movimentacao", "2026-01-01").execute()
        ids_saidas_2026_atuais = set([r["id_composto"] for r in (res_saidas_2026_db.data or [])])
        ids_a_remover = ids_saidas_2026_atuais - novos_ids_saida_2026
        if ids_a_remover:
            print(f"   🧹 Removendo {len(ids_a_remover)} saídas obsoletas/órfãs de 2026...")
            for id_rem in ids_a_remover:
                supabase.table("tab_movimentacao_produtor").delete().eq("id_composto", id_rem).execute()
    except Exception as e_clean:
        print(f"   ⚠️ Aviso ao limpar saídas obsoletas de 2026: {e_clean}")

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

    # 6. Reconciliar tab_produtores_ativos_mensal (Restrito aos Projetos Oficiais de Leite)
    print("\n🌱 6. Reconciliando base ativa mensal em tab_produtores_ativos_mensal (Leite)...")
    
    # Identificar todas as inativações com data e código
    # REGRA: De 2026 em diante, usa data_solicitacao; antes disso mantém data_inativacao
    inativacoes_por_codigo: Dict[str, str] = {}
    if not df_inats_existentes.empty:
        for _, row in df_inats_existentes.iterrows():
            c = str(row.get("codigo_lr") or "").strip()
            dt_solic = row.get("data_solicitacao")
            dt_inat = row.get("data_inativacao")
            
            dt_solic_p = pd.to_datetime(dt_solic, errors="coerce")
            if pd.notna(dt_solic_p) and dt_solic_p >= pd.Timestamp("2026-01-01"):
                dt_str = dt_solic_p.strftime("%Y-%m-01")
            else:
                dt_legado = pd.to_datetime(dt_inat or dt_solic, errors="coerce")
                dt_str = dt_legado.strftime("%Y-%m-01") if pd.notna(dt_legado) else None
                
            if c and dt_str:
                if c not in inativacoes_por_codigo or dt_str < inativacoes_por_codigo[c]:
                    inativacoes_por_codigo[c] = dt_str

    print(f"   -> Mapeados {len(inativacoes_por_codigo)} produtores com inativação confirmada.")

    # Base ativa consolidada a partir de tab_vinculos_sq (Apenas Projetos Oficiais)
    df_vinculos_ativos = df_vinc_db[df_vinc_db["vinculo_ativo"] == True].copy() if "vinculo_ativo" in df_vinc_db.columns else df_vinc_db.copy()
    df_vinculos_ativos = df_vinculos_ativos[df_vinculos_ativos["projeto"].isin(PROJETOS_OFICIAIS)]
    if "unidade_atendimento" in df_vinculos_ativos.columns:
        df_vinculos_ativos = df_vinculos_ativos[df_vinculos_ativos["unidade_atendimento"] != "UNIDADE GENERICA"]

    UF_MAP = {
        'MINAS GERAIS': 'MG', 'BAHIA': 'BA', 'GOIAS': 'GO', 'GOIÁS': 'GO',
        'SAO PAULO': 'SP', 'SÃO PAULO': 'SP', 'ESPIRITO SANTO': 'ES', 'ESPÍRITO SANTO': 'ES',
        'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS', 'PARANA': 'PR', 'PARANÁ': 'PR',
        'RIO DE JANEIRO': 'RJ', 'RONDÔNIA': 'RO', 'RONDONIA': 'RO', 'TOCANTINS': 'TO'
    }

    def limpar_uf(val):
        if not val or pd.isna(val):
            return None
        s = str(val).strip().upper()
        if len(s) == 2:
            return s
        return UF_MAP.get(s, s[:2] if s else None)

    for ref_m in ["2026-08-01", "2026-09-01"]:
        novos_ativos_m = []
        for _, r in df_vinculos_ativos.iterrows():
            c = str(r.get("codigo_lr") or "").strip()
            if not c or (c in inativacoes_por_codigo and inativacoes_por_codigo[c] <= ref_m):
                continue
            
            nome_p = str(r.get("nome_produtor") or "PRODUTOR").strip()[:250]
            nome_prop = str(r.get("nome_propriedade") or "FAZENDA").strip()[:250]
            nome_c = str(r.get("consultor_grupo_atendimento") or r.get("grupo_atendimento") or "CONSULTOR").strip()[:250]
            proj = str(r.get("projeto") or "NÃO INFORMADO").strip()[:100]
            unid = str(r.get("unidade_atendimento") or "LABOR RURAL").strip()[:100]
            cid = str(r.get("cidade_produtor") or "").strip()[:100] if r.get("cidade_produtor") else None
            uf = limpar_uf(r.get("estado_produtor"))
            cod_agro = str(r.get("codigo_agroindustria") or "").strip()[:50] if r.get("codigo_agroindustria") else None
            cod_faz = str(r.get("codigo_fazenda") or "").strip()[:50] if r.get("codigo_fazenda") else None

            novos_ativos_m.append({
                "codigo_lr": c[:50],
                "nome_produtor": nome_p,
                "nome_propriedade": nome_prop,
                "nome_consultor": nome_c,
                "projeto": proj,
                "unidade_atendimento": unid,
                "cidade_produtor": cid,
                "estado_produtor": uf,
                "data_referencia": ref_m,
                "codigo_agroindustria": cod_agro,
                "codigo_fazenda": cod_faz
            })

        df_novos_ativos = pd.DataFrame(novos_ativos_m).drop_duplicates(subset=["codigo_lr", "data_referencia"])
        print(f"\n   Mês {ref_m}:")
        print(f"   - Total de produtores ativos consolidados para envio: {len(df_novos_ativos)} ({df_novos_ativos['projeto'].nunique()} projetos)")

        registros_ativos = df_novos_ativos.to_dict(orient="records")
        sucesso_ativos = 0
        for i in range(0, len(registros_ativos), LOTE):
            lote_at = registros_ativos[i : i + LOTE]
            try:
                supabase.table("tab_produtores_ativos_mensal").upsert(lote_at, on_conflict="codigo_lr,data_referencia").execute()
                sucesso_ativos += len(lote_at)
            except Exception as e:
                try:
                    supabase.table("tab_produtores_ativos_mensal").upsert(lote_at).execute()
                    sucesso_ativos += len(lote_at)
                except Exception as e2:
                    print(f"     ❌ Erro ao enviar lote de ativos {i // LOTE + 1}: {e2}")
            time.sleep(0.1)

        print(f"   ✅ {sucesso_ativos} produtores ativos atualizados para {ref_m}.")

    print("\n=================================================================")
    print("   RECONCILIAÇÃO CONCLUÍDA COM SUCESSO!                          ")
    print("=================================================================")


if __name__ == "__main__":
    executar_reconciliacao()
