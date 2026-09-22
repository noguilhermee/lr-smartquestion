# -*- coding: utf-8 -*-
"""
Módulo: carregar_fato_economico.py
Responsável por consolidar, calcular indicadores econômicos e zootécnicos a partir
dos relatórios de indicadores mensais do Elabore, e executar a carga upsert na
tabela fato 'sq_fato_economico' do Supabase.

Estrutura da Tabela no Supabase:
- Nome: sq_fato_economico
- Chave Primária: id_composto (codigo_lr + '_' + mes_referencia)
- Campos: id_composto, codigo_lr, idfazenda, nome_produtor, nome_consultor,
  projeto, agroindustria, regiao, mes_referencia, volume_leite_mes,
  volume_diario_litros, vacas_lactacao, vacas_totais, produtividade_l_vl_dia,
  receita_leite_total, preco_medio_litro, coe_total_reais, coe_por_litro,
  margem_bruta_total, margem_bruta_por_litro, flag_mb_positiva,
  coe_concentrado, coe_volumoso, coe_mao_de_obra, coe_sanidade, coe_outros,
  data_associacao, data_processamento
"""
from __future__ import annotations

import os
import sys
import math
import shutil
import tempfile
import calendar
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
import yaml
from dotenv import load_dotenv
from supabase import create_client, Client

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass


def detectar_raiz(caminho_base: Path | None = None) -> Path:
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
    if not config_file.is_file():
        raise FileNotFoundError(f"❌ Arquivo de configuração não encontrado: {config_file}")
    with open(config_file, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def obter_cliente_supabase(raiz: Path) -> Client:
    for env_path in [
        raiz / "scripts" / "config" / ".env",
        raiz / "dashboard" / ".env.local",
        raiz / "SCRIPTS" / "CONFIG" / ".env",
        raiz / "DASHBOARD" / ".env.local",
        raiz / ".env",
    ]:
        if env_path.is_file():
            load_dotenv(env_path)

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")

    if not supabase_url or not supabase_key:
        raise ValueError("❌ Credenciais do Supabase não encontradas no arquivo .env!")

    return create_client(supabase_url, supabase_key)


def ler_excel_seguro(caminho_arquivo: Path) -> pd.DataFrame:
    """Lê um arquivo Excel criando uma cópia temporária para evitar locks no Windows."""
    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    tmp.close()
    try:
        shutil.copy2(caminho_arquivo, tmp.name)
        df = pd.read_excel(tmp.name)
        return df
    finally:
        try:
            os.remove(tmp.name)
        except Exception:
            pass


def localizar_arquivo_recente(diretorio_principal: Path, fallback_dirs: list[Path], padrao_glob: str) -> Path:
    """Busca o arquivo mais recente que casa com o padrão glob."""
    pastas_busca = [diretorio_principal] + fallback_dirs
    for pasta in pastas_busca:
        if pasta.is_dir():
            arquivos = list(pasta.glob(padrao_glob))
            if arquivos:
                recente = max(arquivos, key=lambda f: f.stat().st_mtime)
                print(f"📖 Arquivo de indicadores localizado ({recente.parent.name}): {recente.name}")
                return recente

    raise FileNotFoundError(f"❌ Nenhum arquivo '{padrao_glob}' encontrado nas pastas: {[str(p) for p in pastas_busca]}")


def buscar_todos_registros(supabase: Client, tabela: str, select_cols: str = "*") -> list:
    todos = []
    chunk_size = 1000
    offset = 0

    while True:
        try:
            res = supabase.table(tabela).select(select_cols).range(offset, offset + chunk_size - 1).execute()
            if not res.data:
                break
            todos.extend(res.data)
            if len(res.data) < chunk_size:
                break
            offset += chunk_size
        except Exception as e:
            print(f"⚠️ Aviso ao ler tabela '{tabela}': {e}")
            break

    return todos


def converter_numero_br_float(val: Any) -> float:
    """Converte valores em formato BR ("1.500,00", "R$ 3,25") ou float comum para float puro."""
    if val is None or pd.isna(val):
        return 0.0
    if isinstance(val, (int, float, np.integer, np.floating)):
        v = float(val)
        return 0.0 if math.isnan(v) or math.isinf(v) else v
    s = str(val).strip().replace("R$", "").replace("r$", "").replace(" ", "")
    if not s or s.lower() in ["nan", "none", "null", "nat", "<na>"]:
        return 0.0
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        v = float(s)
        return 0.0 if math.isnan(v) or math.isinf(v) else v
    except Exception:
        return 0.0


def sanitize_json_records(records: list[dict]) -> list[dict]:
    """Garante compatibilidade total com JSON e PostgreSQL (sanitiza NaN/Inf para 0.0/None)."""
    int_cols = {"idfazenda", "vacas_lactacao", "vacas_totais", "flag_mb_positiva"}
    str_limits = {
        "codigo_lr": 50,
        "projeto": 100,
        "agroindustria": 100,
        "regiao": 100,
        "id_composto": 255,
        "nome_produtor": 255,
        "nome_consultor": 255,
    }

    clean = []
    for record in records:
        clean_row = {}
        for k, v in record.items():
            if v is None or pd.isna(v):
                clean_row[k] = None if k in int_cols or k in str_limits or k == "data_associacao" else 0.0
                continue

            if k in int_cols:
                try:
                    v_flt = float(v)
                    if math.isnan(v_flt) or math.isinf(v_flt):
                        clean_row[k] = None
                    else:
                        clean_row[k] = int(v_flt)
                except Exception:
                    clean_row[k] = None
            elif k in str_limits:
                limit = str_limits[k]
                s_val = str(v).strip()
                clean_row[k] = s_val[:limit] if s_val else None
            elif isinstance(v, (float, np.floating, int, np.integer)):
                v_flt = float(v)
                if math.isnan(v_flt) or math.isinf(v_flt):
                    clean_row[k] = 0.0
                else:
                    clean_row[k] = round(v_flt, 4)
            else:
                clean_row[k] = v
        clean.append(clean_row)
    return clean


def encontrar_nome_coluna(columns: list[str], padroes: list[str]) -> str | None:
    cols_map = {c.strip().lower(): c for c in columns}
    for padrao in padroes:
        p_low = padrao.strip().lower()
        if p_low in cols_map:
            return cols_map[p_low]
        for c_low, c_orig in cols_map.items():
            if p_low in c_low:
                return c_orig
    return None


def somar_colunas_linha(row: pd.Series, columns: list[str], padroes: list[str]) -> float:
    total = 0.0
    cols_usadas = set()
    excluir_termos = ["litro", "por_litro", "%", "percentual", "share", "unitario", "unitário", "medio", "médio"]
    for col in columns:
        col_low = col.strip().lower()
        if any(term in col_low for term in excluir_termos):
            continue
        for p in padroes:
            if p.lower() in col_low and col not in cols_usadas:
                cols_usadas.add(col)
                val = converter_numero_br_float(row[col])
                if val != 0.0:
                    total += val
    return total


def processar_e_carregar_fato_economico(raiz: Path | None = None) -> int:
    if raiz is None:
        raiz = raiz_projeto

    config = carregar_configuracao(raiz)
    supabase = obter_cliente_supabase(raiz)

    print("\n" + "=" * 70)
    print("🚀 PROCESSANDO TABELA FATO: sq_fato_economico")
    print("=" * 70)

    # 1. Carregar cadastro de produtores / vínculos para fallback de metadados
    raw_vinculos = buscar_todos_registros(supabase, "sq_raw_vinculos", "*")
    mapa_vinculos = {}
    if raw_vinculos:
        for v in raw_vinculos:
            cod = str(v.get("codigo_lr", "")).strip().upper()
            if cod and cod not in mapa_vinculos:
                mapa_vinculos[cod] = v

    # 2. Localizar e ler o relatório de indicadores mensais e anuais do Elabore
    dir_elabore_mensal = Path(config.get("caminhos", {}).get("elabore_mensal", ""))
    dir_elabore_anual = Path(config.get("caminhos", {}).get("elabore_anual", ""))
    fallbacks = [
        raiz / "db" / "input",
        raiz / "DB" / "INPUT",
        raiz / "db" / "input" / "temp",
        raiz / "DB" / "INPUT" / "TEMP",
    ]

    try:
        arquivo_excel = localizar_arquivo_recente(dir_elabore_mensal, fallbacks, "*indicadores_mensais.xlsx")
        df_excel = ler_excel_seguro(arquivo_excel)
        print(f"📊 Planilha mensal carregada com sucesso ({len(df_excel)} linhas e {len(df_excel.columns)} colunas).")
    except Exception as e:
        print(f"⚠️ Erro ao localizar/ler planilha de indicadores mensais: {e}")
        df_excel = pd.DataFrame()

    # Tentar também carregar indicadores anuais do Elabore como complemento de métricas econômicas
    df_anual = pd.DataFrame()
    try:
        arquivo_anual = localizar_arquivo_recente(dir_elabore_anual, fallbacks, "*indicadores_anuais.xlsx")
        df_anual = ler_excel_seguro(arquivo_anual)
        print(f"📊 Planilha anual de indicadores carregada ({len(df_anual)} linhas e {len(df_anual.columns)} colunas).")
    except Exception as e_anual:
        print(f"ℹ️ Planilha de indicadores anuais não encontrada ou não lida: {e_anual}")

    if df_excel.empty and df_anual.empty:
        print("⚠️ Nenhum relatório de indicadores do Elabore (mensal ou anual) pôde ser lido.")
        return 0


    cols = list(df_excel.columns)

    # Identificar colunas essenciais
    col_codigo = encontrar_nome_coluna(cols, ["código lr", "codigo lr", "labor_rural_code", "codigo_lr", "código", "codigo"])
    col_mes = encontrar_nome_coluna(cols, ["mês de referência", "mes de referencia", "reference_month", "referência", "referencia", "mes_referencia"])

    if not col_codigo or not col_mes:
        print("❌ Colunas obrigatórias ('Código LR', 'Mês de Referência') não foram encontradas na planilha.")
        return 0

    # Colunas descritivas
    col_produtor = encontrar_nome_coluna(cols, ["fazenda - produtor", "property_entrepreneur_label", "nome produtor", "produtor", "fazenda"])
    col_consultor = encontrar_nome_coluna(cols, ["consultor", "grupo de atendimento", "consultor_campo", "consultor de campo"])
    col_projeto = encontrar_nome_coluna(cols, ["agroindústria", "agroindustria", "projeto"])
    col_regiao = encontrar_nome_coluna(cols, ["região", "regiao", "unidade", "estado"])
    col_idfaz = encontrar_nome_coluna(cols, ["idfazenda", "id_property", "código fazenda", "codigo fazenda"])

    # Colunas Zootécnicas e Operacionais (Busca Ampla com Rótulos Técnicos Elabore)
    col_vol_mes = encontrar_nome_coluna(cols, [
        "volume_leite_vendido", "milk_volume_sold", "volume de leite vendido (litros)", "produção total de leite (litros)",
        "volume_produzido", "milk_produced", "volume vendido", "volume de leite", "volume (litros)", "volume (l)", "volume"
    ])
    col_vol_diario = encontrar_nome_coluna(cols, [
        "produção diária de leite (litros/dia)", "milk_daily", "produção diária", "volume diário", "volume_diario"
    ])
    col_vl = encontrar_nome_coluna(cols, [
        "vacas_em_lactacao", "lactating_cows", "vacas em lactação (cabeças)", "vacas em lactação", "vacas_lactacao", "vl (cab)", "vl"
    ])
    col_vt = encontrar_nome_coluna(cols, [
        "total_de_vacas", "total_cows", "total de vacas (cabeças)", "total de vacas", "vacas totais", "vacas_totais", "vt (cab)", "vt"
    ])
    col_produtividade = encontrar_nome_coluna(cols, [
        "milk_lactating_cow_day", "produção por vaca em lactação (litros/vaca/dia)", "produtividade", "l/vl/dia", "produtividade_l_vl_dia"
    ])

    # Colunas Financeiras (Busca Ampla com Rótulos Técnicos Elabore)
    col_receita = encontrar_nome_coluna(cols, [
        "total_activity_revenue", "receita_bruta_atividade", "total_milk_revenue", "receita bruta da atividade (r$)",
        "receita total do leite (r$)", "receita com venda de leite (r$)", "receita_leite_total", "receita leite", "receita total", "faturamento"
    ])
    col_preco = encontrar_nome_coluna(cols, [
        "milk_unit_price", "milk_revenue_liter", "preço unitário do leite (r$/litro)", "preço médio recebido (r$/l)",
        "preco_medio_litro", "preço médio", "preço do leite", "preço", "preco"
    ])
    col_coe_total = encontrar_nome_coluna(cols, [
        "coe_activity_annual", "coe_somaMovel", "coe_total", "coe total (r$)", "custo operacional efetivo (r$)", "coe (r$)", "coe_total_reais"
    ])
    col_mb_total = encontrar_nome_coluna(cols, [
        "gross_margin_annual", "margemBrutaAnual", "margem_bruta_anual", "margem bruta (r$)", "margem bruta total (r$)", "margem_bruta_total", "margem_bruta"
    ])

    agora_iso = datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat()
    registros_dict = {}

    for idx, row in df_excel.iterrows():
        raw_cod = row.get(col_codigo)
        if pd.isna(raw_cod) or str(raw_cod).strip() == "":
            continue
        cod_lr = str(raw_cod).strip().upper()

        raw_mes = row.get(col_mes)
        if pd.isna(raw_mes):
            continue

        try:
            dt_mes = pd.to_datetime(raw_mes)
            mes_str = dt_mes.strftime("%Y-%m-01")
        except Exception:
            continue

        id_comp = f"{cod_lr}_{mes_str}T00:00:00+00:00"

        # Fallback para metadados via sq_raw_vinculos
        meta_vinculo = mapa_vinculos.get(cod_lr, {})

        nome_prod = row.get(col_produtor) if col_produtor and pd.notna(row.get(col_produtor)) else meta_vinculo.get("nome_produtor")
        nome_cons = row.get(col_consultor) if col_consultor and pd.notna(row.get(col_consultor)) else (
            meta_vinculo.get("consultor_grupo_atendimento") or meta_vinculo.get("grupo_atendimento") or meta_vinculo.get("consultor_campo")
        )
        proj = row.get(col_projeto) if col_projeto and pd.notna(row.get(col_projeto)) else meta_vinculo.get("projeto")
        agro = proj or meta_vinculo.get("codigo_agroindustria") or meta_vinculo.get("agroindustria")
        reg = row.get(col_regiao) if col_regiao and pd.notna(row.get(col_regiao)) else (
            meta_vinculo.get("unidade_atendimento") or meta_vinculo.get("regiao") or meta_vinculo.get("estado_produtor")
        )

        raw_idfaz = row.get(col_idfaz) if col_idfaz and pd.notna(row.get(col_idfaz)) else meta_vinculo.get("codigo_fazenda") or meta_vinculo.get("idfazenda")
        try:
            id_faz = int(float(str(raw_idfaz).strip())) if pd.notna(raw_idfaz) and str(raw_idfaz).strip() != "" else None
        except Exception:
            id_faz = None

        dt_assoc = meta_vinculo.get("data_associacao")
        dt_assoc_str = str(dt_assoc)[:10] if pd.notna(dt_assoc) and str(dt_assoc).strip() else None

        # Extração/Cálculo Zootécnico com conversão resiliente de string BR
        vol_mes = converter_numero_br_float(row.get(col_vol_mes)) if col_vol_mes else 0.0

        if col_vol_diario and pd.notna(row.get(col_vol_diario)):
            vol_diario = converter_numero_br_float(row.get(col_vol_diario))
        else:
            dias_no_mes = calendar.monthrange(dt_mes.year, dt_mes.month)[1]
            vol_diario = round(vol_mes / dias_no_mes, 2) if dias_no_mes > 0 else 0.0

        vl = int(converter_numero_br_float(row.get(col_vl))) if col_vl else 0
        vt = int(converter_numero_br_float(row.get(col_vt))) if col_vt else 0

        produtividade = converter_numero_br_float(row.get(col_produtividade)) if col_produtividade else 0.0
        if (produtividade == 0.0) and vl > 0 and vol_mes > 0:
            dias_no_mes = calendar.monthrange(dt_mes.year, dt_mes.month)[1]
            produtividade = round(vol_mes / (vl * dias_no_mes), 2) if dias_no_mes > 0 else 0.0

        # Extração/Cálculo Financeiro
        receita_total = converter_numero_br_float(row.get(col_receita)) if col_receita else 0.0
        preco_litro = converter_numero_br_float(row.get(col_preco)) if col_preco else 0.0

        if preco_litro == 0.0 and vol_mes > 0 and receita_total > 0:
            preco_litro = round(receita_total / vol_mes, 4)
        if receita_total == 0.0 and vol_mes > 0 and preco_litro > 0:
            receita_total = round(vol_mes * preco_litro, 2)

        # Decomposição de COE
        coe_conc = somar_colunas_linha(row, cols, ["concentrado", "mineral"])
        coe_vol = somar_colunas_linha(row, cols, ["volumoso", "forrageira"])
        coe_mo = somar_colunas_linha(row, cols, ["mão de obra", "mao de obra", "labor", "familiar", "contratada"])
        coe_san = somar_colunas_linha(row, cols, ["medicamento", "vacina", "hormônio", "hormonio", "reprodução", "reproducao", "sanidade"])
        coe_out = somar_colunas_linha(row, cols, ["energia", "combustível", "combustivel", "ordenha", "imposto", "taxa", "administrativa", "reparo", "conserto", "acessório", "acessorio", "gerais"])

        coe_total = converter_numero_br_float(row.get(col_coe_total)) if col_coe_total else 0.0
        if coe_total == 0.0:
            coe_total = coe_conc + coe_vol + coe_mo + coe_san + coe_out

        coe_litro = round(coe_total / vol_mes, 4) if vol_mes > 0 else 0.0

        mb_total = converter_numero_br_float(row.get(col_mb_total)) if col_mb_total else 0.0
        if mb_total == 0.0 and (receita_total > 0 or coe_total > 0):
            mb_total = receita_total - coe_total

        mb_litro = round(mb_total / vol_mes, 4) if vol_mes > 0 else 0.0
        flag_mb_pos = 1 if mb_total > 0 else 0

        registros_dict[id_comp] = {
            "id_composto": id_comp,
            "codigo_lr": cod_lr,
            "idfazenda": id_faz,
            "nome_produtor": str(nome_prod).strip() if pd.notna(nome_prod) else None,
            "nome_consultor": str(nome_cons).strip() if pd.notna(nome_cons) else None,
            "projeto": str(proj).strip() if pd.notna(proj) else None,
            "agroindustria": str(agro).strip() if pd.notna(agro) else None,
            "regiao": str(reg).strip() if pd.notna(reg) else None,
            "mes_referencia": mes_str,
            "volume_leite_mes": vol_mes,
            "volume_diario_litros": vol_diario,
            "vacas_lactacao": vl,
            "vacas_totais": vt,
            "produtividade_l_vl_dia": produtividade,
            "receita_leite_total": receita_total,
            "preco_medio_litro": preco_litro,
            "coe_total_reais": coe_total,
            "coe_por_litro": coe_litro,
            "margem_bruta_total": mb_total,
            "margem_bruta_por_litro": mb_litro,
            "flag_mb_positiva": flag_mb_pos,
            "coe_concentrado": coe_conc,
            "coe_volumoso": coe_vol,
            "coe_mao_de_obra": coe_mo,
            "coe_sanidade": coe_san,
            "coe_outros": coe_out,
            "data_associacao": dt_assoc_str,
            "data_processamento": agora_iso
        }

    if not registros_dict:
        print("⚠️ Nenhum registro fato econômico foi extraído.")
        return 0

    records = list(registros_dict.values())
    print(f"📊 Total de registros econômicos extraídos da planilha Elabore: {len(records)}")

    records = sanitize_json_records(records)
    chunk_size = config.get("execucao", {}).get("chunk_size_upsert", 1000)
    sucessos = 0

    print("🚀 Enviando registros para o Supabase (sq_fato_economico)...")
    for i in range(0, len(records), chunk_size):
        chunk = records[i : i + chunk_size]
        try:
            supabase.table("sq_fato_economico").upsert(
                chunk, on_conflict="id_composto"
            ).execute()
            sucessos += len(chunk)
            print(f"   ✅ Lote {i // chunk_size + 1}: {len(chunk)} registros inseridos/atualizados.")
        except Exception as e:
            print(f"   ⚠️ Aviso no lote {i // chunk_size + 1}: {e}")

    print(f"✨ Concluído! {sucessos} registros processados para 'sq_fato_economico'.")
    return sucessos


if __name__ == "__main__":
    processar_e_carregar_fato_economico()
