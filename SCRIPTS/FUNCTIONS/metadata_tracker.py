from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List
import pandas as pd
import yaml


def categorizar_arquivo(nome_arquivo: str) -> Dict[str, str]:
    nome = nome_arquivo.upper()
    if "VINCULOS" in nome or "GRUPO" in nome or "RESGATE" in nome:
        return {
            "categoria": "Vínculos e Grupos",
            "icone": "link",
            "descricao": "Relação de fazendas, grupos de atendimento e vínculos técnicos",
        }
    if "INATIVACAO" in nome or "INATIVACOES" in nome:
        return {
            "categoria": "Inativações",
            "icone": "person_remove",
            "descricao": "Solicitações e histórico de inativação de produtores",
        }
    if "CADASTRO" in nome:
        return {
            "categoria": "Novos Cadastros",
            "icone": "person_add",
            "descricao": "Solicitações de novos cadastros e troca de titularidade",
        }
    if "STATUS_USUARIO" in nome or "CONSULTOR" in nome:
        return {
            "categoria": "Equipe e Usuários",
            "icone": "badge",
            "descricao": "Status cadastral e histórico de atividade dos consultores",
        }
    if "VISITA" in nome or "VISITAS" in nome:
        return {
            "categoria": "Visitas Técnicas",
            "icone": "calendar_month",
            "descricao": "Relatórios de atendimentos em campo e apontamentos",
        }
    return {
        "categoria": "Outros Relatórios",
        "icone": "description",
        "descricao": "Planilha auxiliar do SmartQuestion",
    }


def formatar_tamanho_bytes(tamanho_bytes: int) -> str:
    if tamanho_bytes < 1024:
        return f"{tamanho_bytes} B"
    elif tamanho_bytes < 1024 * 1024:
        return f"{tamanho_bytes / 1024:.1f} KB"
    else:
        return f"{tamanho_bytes / (1024 * 1024):.1f} MB"


def obter_metadados_planilhas(raiz_projeto: Path | str | None = None) -> Dict[str, Any]:
    raiz = Path(raiz_projeto or Path.cwd()).resolve()
    config_path = raiz / "SCRIPTS" / "CONFIG" / "config.yaml"
    
    if not config_path.exists():
        raise FileNotFoundError(f"Arquivo config.yaml não encontrado em {config_path}")
        
    with open(config_path, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
        
    bd_path = Path(cfg.get("caminhos", {}).get("bd_smartquestion", ""))
    
    arquivos_info: List[Dict[str, Any]] = []
    
    if bd_path.exists():
        for arquivo in sorted(bd_path.glob("*.xlsx")):
            stat = arquivo.stat()
            mtime = datetime.fromtimestamp(stat.st_mtime)
            cat_info = categorizar_arquivo(arquivo.name)
            
            # Tentar ler linhas de forma segura sem travar
            qtd_linhas = None
            try:
                # Leitura rápida de nomes de abas e dimensões básicas
                xl = pd.ExcelFile(arquivo)
                primeira_aba = xl.sheet_names[0]
                df_sample = xl.parse(primeira_aba)
                qtd_linhas = len(df_sample)
            except Exception:
                qtd_linhas = None
                
            arquivos_info.append({
                "nome": arquivo.name,
                "categoria": cat_info["categoria"],
                "icone": cat_info["icone"],
                "descricao": cat_info["descricao"],
                "data_modificacao": mtime.strftime("%Y-%m-%d %H:%M:%S"),
                "data_modificacao_formatada": mtime.strftime("%d/%m/%Y às %H:%M"),
                "tamanho_bytes": stat.st_size,
                "tamanho_formatado": formatar_tamanho_bytes(stat.st_size),
                "total_registros": qtd_linhas,
                "caminho": str(arquivo),
            })
            
    payload = {
        "timestamp_inspecao": datetime.now().isoformat(),
        "total_arquivos": len(arquivos_info),
        "diretorio_origem": str(bd_path),
        "arquivos": arquivos_info,
    }
    
    # Salvar cópia em DB/OUTPUT/PROCESSED/fontes_metadados.json
    pasta_saida = raiz / "DB" / "OUTPUT" / "PROCESSED"
    pasta_saida.mkdir(parents=True, exist_ok=True)
    caminho_json = pasta_saida / "fontes_metadados.json"
    
    with open(caminho_json, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        
    # Também salvar cópia no DASHBOARD para fallback estático se necessário
    dashboard_data_dir = raiz / "DASHBOARD" / "public" / "data"
    dashboard_data_dir.mkdir(parents=True, exist_ok=True)
    with open(dashboard_data_dir / "fontes_metadados.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        
    return payload


if __name__ == "__main__":
    resultado = obter_metadados_planilhas()
    print(f"Metadados gerados com sucesso para {resultado['total_arquivos']} planilhas.")
