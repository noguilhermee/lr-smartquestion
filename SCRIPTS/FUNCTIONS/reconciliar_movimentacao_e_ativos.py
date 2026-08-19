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


def extrair_consultor_individual(consultor_str: str, grupo_str: str = "") -> str:
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

    movimentacoes_lista = []

    # 4.1 Entradas Pré-2026 (a partir de tab_vinculos_sq para histórico anterior a 2026)
    res_vinc = supabase.table("tab_vinculos_sq").select(
        "codigo_lr, consultor_grupo_atendimento, grupo_atendimento, data_associacao, projeto, nome_produtor, nome_propriedade, vinculo_ativo, unidade_atendimento, cidade_produtor, estado_produtor, codigo_agroindustria, codigo_fazenda"
    ).in_("projeto", PROJETOS_OFICIAIS).execute()
    df_vinc_db = pd.DataFrame(res_vinc.data) if res_vinc.data else pd.DataFrame()
    
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
                
            # Somente incluir se for ANTES de 2026 (2026 em diante vem da lista de cadastro oficial)
            if dt_mov < "2026-01-01":
                nome_prod_vinc = str(row.get("nome_produtor") or "").strip()
                id_comp = f"{cod}_{cons}_{dt_mov}_Entrada"
                movimentacoes_lista.append({
                    "id_composto": id_comp,
                    "codigo_lr": cod,
                    "nome_consultor": cons,
                    "nome_produtor": nome_prod_vinc if (nome_prod_vinc and nome_prod_vinc.lower() != "nan") else None,
                    "numero_atendimento": None,
                    "data_movimentacao": dt_mov,
                    "movimentacao": "Entrada",
                    "motivo_inativacao": None,
                    "outro_motivo": None,
                    "data_processamento": datetime.now().isoformat(),
                })

    # Mapeamento dimensional para validação da cadeia produtiva (Leite vs Cacau, Café, Grãos)
    res_all_vinc = supabase.table("tab_vinculos_sq").select("codigo_lr, projeto, tipo_ponto_atendimento, nome_produtor").execute()
    mapa_lr_tipo: Dict[str, str] = {}
    mapa_lr_proj: Dict[str, str] = {}
    mapa_lr_nome: Dict[str, str] = {}
    for v in (res_all_vinc.data or []):
        c_lr = str(v.get("codigo_lr") or "").strip()
        if c_lr:
            mapa_lr_tipo[c_lr] = str(v.get("tipo_ponto_atendimento") or "").strip().upper()
            mapa_lr_proj[c_lr] = str(v.get("projeto") or "").strip().upper()
            if v.get("nome_produtor"):
                mapa_lr_nome[c_lr] = str(v.get("nome_produtor")).strip()

    def eh_cadeia_leite(projeto_str: str, codigo_lr: str = "") -> bool:
        proj_upper = (projeto_str or "").strip().upper()
        # 1. Se o projeto contém termos de outras cadeias (Cacau, Grãos, Café)
        for p_out in ['MAIS GRÃOS', 'MAIS GRAOS', 'MIMC', 'M&E', 'CAFE&GESTAO', 'CAFE & GESTAO', 'CARGILL', 'NCP', 'OFI', 'PV CARGILL']:
            if p_out in proj_upper:
                return False
        # 2. Se o projeto é reconhecido de Leite
        for p_lei in ['REGENERA', 'ALVOAR', 'SEMEAR', 'CCPR', 'ATEG_CCPR', 'LPA', 'CFT', 'CAMPILEITE', 'COPRIL', 'EDUCAMPO', 'QUILLAYES', 'NESTLE']:
            if p_lei in proj_upper:
                return True
        # 3. Cruzamento com código LR em tab_vinculos_sq
        if codigo_lr in mapa_lr_tipo:
            t = mapa_lr_tipo[codigo_lr]
            if "CACAU" in t or "CAFE" in t or "GRAOS" in t:
                return False
            if "LEITE" in t:
                return True
        if codigo_lr in mapa_lr_proj:
            p = mapa_lr_proj[codigo_lr]
            if any(p_out in p for p_out in ['MIMC', 'M&E', 'GRAOS', 'CAFE', 'CARGILL', 'NCP', 'OFI']):
                return False
            if any(p_lei in p for p_lei in ['REGENERA', 'ALVOAR', 'SEMEAR', 'CCPR', 'LPA', 'CFT', 'CAMPILEITE', 'COPRIL', 'EDUCAMPO', 'QUILLAYES', 'NESTLE']):
                return True
        return False

    # 4.2 Entradas de 2026 em diante (a partir de *_LISTA_CADASTRO.xlsx - Filtrado apenas LEITE)
    arquivos_cad = list(bd_path.glob("*_LISTA_CADASTRO.xlsx")) + list((bd_path / "BACKUPS").glob("*_LISTA_CADASTRO.xlsx"))
    if arquivos_cad:
        for arq_cad in arquivos_cad:
            if not arq_cad.exists():
                continue
            try:
                df_raw_c = pd.read_excel(arq_cad, header=None)
                h_c = 0
                for r in range(min(5, len(df_raw_c))):
                    vals = [str(x).strip().lower() for x in df_raw_c.iloc[r].dropna().tolist()]
                    if any("atendimento" in v for v in vals):
                        h_c = r
                        break
                df_c = pd.read_excel(arq_cad, header=h_c).dropna(how="all", axis=1).dropna(how="all", axis=0)
                col_id_c = [c for c in df_c.columns if "atendimento" in str(c).lower()][0]
                col_cons_c = [c for c in df_c.columns if "consultor" in str(c).lower()][0]
                col_dt_c = [c for c in df_c.columns if "solicita" in str(c).lower()][0]
                col_cod_c = [c for c in df_c.columns if "código" in str(c).lower() or "codigo" in str(c).lower()][0]
                col_tipo_c = [c for c in df_c.columns if "tipo de cadastro" in str(c).lower()]
                col_cadeia_c = [c for c in df_c.columns if "cadeia" in str(c).lower()]
                col_proj_c = [c for c in df_c.columns if "projeto" in str(c).lower()]
                col_prod_c = [c for c in df_c.columns if ("produtor" in str(c).lower() and "novo" not in str(c).lower() and "código" not in str(c).lower() and "consultor" not in str(c).lower())]
                col_novo_prod_c = [c for c in df_c.columns if "novo(a) produtor(a)" in str(c).lower() and "nome" in str(c).lower()]
                
                for _, row in df_c.iterrows():
                    id_atend = str(row[col_id_c]).strip().replace(".0", "")
                    if not id_atend or id_atend.lower() == "nan":
                        continue
                    dt_solic = pd.to_datetime(row[col_dt_c], errors="coerce")
                    if pd.isna(dt_solic):
                        continue
                    dt_mov = dt_solic.strftime("%Y-%m-01")
                    if dt_mov < "2026-01-01":
                        continue
                        
                    # Filtro exclusivo de LEITE
                    if col_cadeia_c:
                        cadeia_val = str(row.get(col_cadeia_c[0]) or "").strip().lower()
                        if cadeia_val and not ("leite" in cadeia_val):
                            continue
                    elif col_proj_c:
                        if not eh_cadeia_leite(str(row.get(col_proj_c[0]) or ""), str(row.get(col_cod_c) or "")):
                            continue

                    cod_raw = str(row.get(col_cod_c) or "").strip().replace(".0", "")
                    cod = cod_raw if (cod_raw and cod_raw.lower() != "nan") else f"CAD_{id_atend}"
                    cons = extrair_consultor_individual(str(row[col_cons_c]))
                    tipo_cad = str(row[col_tipo_c[0]]) if col_tipo_c and pd.notna(row.get(col_tipo_c[0])) else "Inclusão de propriedade"
                    
                    # Nome do produtor direto do Excel (ou titular novo em caso de troca)
                    nome_prod_cad = ""
                    if col_novo_prod_c and pd.notna(row.get(col_novo_prod_c[0])) and str(row.get(col_novo_prod_c[0])).strip():
                        nome_prod_cad = str(row.get(col_novo_prod_c[0])).strip()
                    elif col_prod_c and pd.notna(row.get(col_prod_c[0])):
                        nome_prod_cad = str(row.get(col_prod_c[0])).strip()
                    if not nome_prod_cad and cod in mapa_lr_nome:
                        nome_prod_cad = mapa_lr_nome[cod]

                    id_atend_num = int(id_atend) if str(id_atend).isdigit() else id_atend
                    id_comp = f"CAD_{id_atend}_{dt_mov}_Entrada"
                    movimentacoes_lista.append({
                        "id_composto": id_comp,
                        "codigo_lr": cod,
                        "nome_consultor": cons,
                        "nome_produtor": nome_prod_cad if (nome_prod_cad and nome_prod_cad.lower() != "nan") else None,
                        "numero_atendimento": id_atend_num,
                        "data_movimentacao": dt_mov,
                        "movimentacao": "Entrada",
                        "motivo_inativacao": None,
                        "outro_motivo": tipo_cad,
                        "data_processamento": datetime.now().isoformat(),
                    })
            except Exception as e_cad:
                print(f"   ⚠️ Aviso ao processar {arq_cad.name}: {e_cad}")

    # 4.3 Saídas (Histórico Pré-2026 preservado + 2026 em diante por Data da Solicitação - Filtrado LEITE)
    codigos_oficiais_set = set(df_vinc_db["codigo_lr"].dropna().unique()) if not df_vinc_db.empty else set()
    
    if not df_inats_existentes.empty:
        for _, row in df_inats_existentes.iterrows():
            id_atend = str(row.get("id_atendimento") or "").strip().replace(".0", "")
            cod_raw = str(row.get("codigo_lr") or "").strip()
            cod = cod_raw if (cod_raw and cod_raw.lower() != "nan") else f"INAT_{id_atend}"
            cons = extrair_consultor_individual(row.get("nome_consultor"), row.get("grupo_ponto_atendimento"))
            proj_inat = str(row.get("projeto") or "").strip()
            nome_prod_inat = str(row.get("nome_produtor") or "").strip()
            if not nome_prod_inat and cod in mapa_lr_nome:
                nome_prod_inat = mapa_lr_nome[cod]
            
            dt_solic = row.get("data_solicitacao")
            dt_inat = row.get("data_inativacao")
            
            dt_solic_p = pd.to_datetime(dt_solic, errors="coerce")
            if pd.notna(dt_solic_p) and dt_solic_p >= pd.Timestamp("2026-01-01"):
                # Filtro de LEITE para 2026 em diante
                if not eh_cadeia_leite(proj_inat, cod_raw):
                    continue
                dt_mov = dt_solic_p.strftime("%Y-%m-01")
                id_comp = f"INAT_{id_atend}_{dt_mov}_Saída" if id_atend else f"{cod}_{cons}_{dt_mov}_Saída"
            else:
                dt_legado = pd.to_datetime(dt_inat or dt_solic, errors="coerce")
                if pd.notna(dt_legado):
                    dt_mov = dt_legado.strftime("%Y-%m-01")
                else:
                    dt_mov = "2026-08-01"
                id_comp = f"{cod}_{cons}_{dt_mov}_Saída"
                
            motivo = row.get("motivo_inativacao")
            outro = row.get("outro_motivo")
            id_atend_num = int(id_atend) if str(id_atend).isdigit() else (id_atend if id_atend else None)
            
            movimentacoes_lista.append({
                "id_composto": id_comp,
                "codigo_lr": cod,
                "nome_consultor": cons,
                "nome_produtor": nome_prod_inat if (nome_prod_inat and nome_prod_inat.lower() != "nan") else None,
                "numero_atendimento": id_atend_num,
                "data_movimentacao": dt_mov,
                "movimentacao": "Saída",
                "motivo_inativacao": motivo,
                "outro_motivo": outro,
                "data_processamento": datetime.now().isoformat(),
            })
            
    df_mov_final = pd.DataFrame(movimentacoes_lista).drop_duplicates(subset=["id_composto"], keep="last")
    print(f"   -> Total de movimentações consolidadas: {len(df_mov_final)} (Entradas: {len(df_mov_final[df_mov_final['movimentacao'] == 'Entrada'])}, Saídas: {len(df_mov_final[df_mov_final['movimentacao'] == 'Saída'])})")
    
    # 4.4 Limpar rigorosamente registros de 2026 em diante no Supabase antes de reinserir
    try:
        res_2026_db = supabase.table("tab_movimentacao_produtor").select("id_composto").gte("data_movimentacao", "2026-01-01").execute()
        ids_2026_db = [r["id_composto"] for r in (res_2026_db.data or [])]
        if ids_2026_db:
            print(f"   🧹 Limpando {len(ids_2026_db)} registros antigos de 2026 em diante no Supabase...")
            LOTE_DEL = 100
            for d_idx in range(0, len(ids_2026_db), LOTE_DEL):
                lote_ids = ids_2026_db[d_idx : d_idx + LOTE_DEL]
                supabase.table("tab_movimentacao_produtor").delete().in_("id_composto", lote_ids).execute()
    except Exception as e_clean:
        print(f"   ⚠️ Aviso ao limpar registros de 2026: {e_clean}")

    # Upsert em lotes em tab_movimentacao_produtor
    print("\n💾 5. Gravando movimentações consolidadas em tab_movimentacao_produtor no Supabase...")
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
    cfg_ref = carregar_config_referencia(raiz_projeto)
    mes_ref_dt = cfg_ref.mes_referencia
    mes_ref_str = mes_ref_dt.strftime("%Y-%m-01")
    proximo_mes_str = (mes_ref_dt + pd.DateOffset(months=1)).strftime("%Y-%m-01")
    meses_reconciliacao = [mes_ref_str, proximo_mes_str]

    for ref_m in meses_reconciliacao:
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
