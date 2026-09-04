# 🤖 Regras Oficiais do Repositório (`AGENTS.md`)

Este arquivo define o conjunto de diretrizes, regras de negócio e convenções arquiteturais que devem ser **rigorosamente seguidas por qualquer assistente de IA ou desenvolvedor** ao trabalhar ou modificar este repositório.

---

## 📁 1. Estrutura de Pastas e Nomenclatura
- **Regra**: Todas as pastas e subpastas do projeto devem obrigatoriamente usar nomes em **MINÚSCULAS** (lowercase).
- **Estrutura Oficial**:
  - `db/input/` (Bases brutas de entrada)
  - `db/output/` (Arquivos processados, logs, figuras e relatórios compilados)
    - `db/output/processed/`
    - `db/output/figures/`
    - `db/output/html/`
    - `db/output/logs/`
  - `scripts/` (Notebooks Jupyter `.ipynb`, `executar_pipeline.py`)
    - `scripts/assets/` (Logos, favicons, arquivos CSS/JS)
    - `scripts/config/` (Arquivos de configuração e ambiente: `config.yaml`, `.env.example`)
    - `scripts/functions/` (Módulos auxiliares Python: `function.py`, `__init__.py`)
  - `dashboard/` (Aplicação Web, API serverless e interface gerencial)
    - `dashboard/api/`
    - `dashboard/public/`

---

## 🐍 2. Importações Padronizadas nos Notebooks (`scripts/*.ipynb`)
- **Regra**: Todo notebook em `scripts/` deve incluir o bloco de setup padronizado na sua **primeira célula de código**, importando todas as funções utilitárias do módulo `functions.function`.

- **Bloco de Setup Padrão**:
```python
from __future__ import annotations
import sys
import warnings
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
from IPython.display import HTML, Markdown, display

caminho_atual = Path.cwd().resolve()
for candidato in [caminho_atual, *caminho_atual.parents]:
    if (candidato / "scripts").is_dir() and ((candidato / "db").is_dir() or (candidato / "dashboard").is_dir()):
        raiz_projeto = candidato
        break
    if (candidato / "SCRIPTS").is_dir() and (candidato / "DB").is_dir():
        raiz_projeto = candidato
        break
else:
    raise FileNotFoundError("Não foi possível localizar a raiz do projeto.")

for p in [
    raiz_projeto,
    raiz_projeto / "scripts",
    raiz_projeto / "scripts" / "functions",
    raiz_projeto / "SCRIPTS",
    raiz_projeto / "SCRIPTS" / "FUNCTIONS",
]:
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

try:
    from functions.function import (
        aplicar_estilo_listrado_xlsx,
        aplicar_formatacao_excel,
        buscar_arquivo_mais_recente,
        carregar_config_referencia,
        carregar_env,
        consultar_tabela_supabase,
        converter_data_excel,
        converter_numero_br,
        detectar_raiz_projeto,
        dividir_seguro,
        exportar_varias_abas_xlsx,
        exportar_xlsx_formatado,
        extrair_data_nome_arquivo,
        garantir_colunas,
        ler_aba_excel_flex,
        normalizar_texto,
        obter_cliente_supabase,
        renomear_colunas_existentes,
    )
except ImportError:
    from FUNCTIONS.function import (
        aplicar_estilo_listrado_xlsx,
        aplicar_formatacao_excel,
        buscar_arquivo_mais_recente,
        carregar_config_referencia,
        carregar_env,
        consultar_tabela_supabase,
        converter_data_excel,
        converter_numero_br,
        detectar_raiz_projeto,
        dividir_seguro,
        exportar_varias_abas_xlsx,
        exportar_xlsx_formatado,
        extrair_data_nome_arquivo,
        garantir_colunas,
        ler_aba_excel_flex,
        normalizar_texto,
        obter_cliente_supabase,
        renomear_colunas_existentes,
    )

config_ref = carregar_config_referencia(raiz_projeto)
print(f"Raiz do projeto: {raiz_projeto}")
print(f"Configuracao carregada: {config_ref}")
```

---

## ⏱️ 3. Padrão de Nomenclatura e Timestamp de Exportação
- **Regra**: Todo arquivo gerado/exportado (planilhas Excel, relatórios HTML, figuras, Parquet) deve usar obrigatoriamente a data e hora exata da exportação (`%Y_%m_%d_%H%M%S`).
- **Template**:
```python
DATA_EXPORTACAO = datetime.now().strftime("%Y_%m_%d_%H%M%S")
CAMINHO_ARQUIVO = PASTA_SAIDA / f"{DATA_EXPORTACAO}_nome_do_arquivo.ext"
```

---

## 📚 4. Preservação do Histórico de Saída (`db/output/`)
- **Regra**: Nunca apagar ou sobrescrever arquivos históricos anteriores na pasta `db/output/`.

---

## 🚫 5. Execução sem Arquivos Duplicados
- **Regra**: O script `scripts/executar_pipeline.py` deve salvar as alterações diretamente nos arquivos `.ipynb` originais da pasta `scripts/`. **Nunca criar nem manter arquivos duplicados com o sufixo `_executado.ipynb`**.

---

## 🔄 6. Regra Oficial de Versionamento Git (Sincronização Dupla de Perfil)
- **Regra Absoluta**: O assistente de IA **NUNCA deve executar comandos de `git commit` ou `git push` diretamente**.
- **Sincronização Dupla**: Os projetos devem estar obrigatoriamente configurados para salvar e sincronizar o código simultaneamente nos dois perfis no GitHub:
  - Perfil Pessoal: `noguilhermee`
  - Perfil Organizacional: `LaborRural`
- **Configuração de Push**: O remote `origin` deve conter múltiplos `pushurl` cadastrados para que o comando `git push origin main` envie as alterações para os dois perfis simultaneamente.
- **Obrigação**: Ao concluir etapas significativas, refatorações ou correção de bugs, o assistente deve **obrigatoriamente sugerir e exibir os comandos Git e Vercel exatos** (`git add .`, `git commit -m "..."`, `git push origin main` e `npx vercel --prod`) formatados em bloco de código para que o próprio usuário revise e execute no terminal.


---

## 📋 7. Sugestão de Tarefa no Microsoft Planner
- **Regra**: Ao concluir etapas significativas, o assistente deve **sugerir obrigatoriamente** o nome da tarefa para registro no Microsoft Planner, seguindo o padrão oficial:
```text
[NOME-PROJETO] SCRIPT - <Verbo no infinitivo> + <descrição objetiva>
```

---

## 🗓️ 8. Centralização de Datas e Mês de Referência (`config.yaml`)
- **Regra**: O mês de referência e parâmetros de filtro temporal **nunca devem ser hardcoded** nos notebooks ou scripts.
- **Fonte Única da Verdade**: Lidos exclusivamente de `scripts/config/config.yaml` através de `carregar_config_referencia(raiz_projeto)`.

---

## 🔒 9. Acesso ao Supabase (Leitura Estrita para IA / Escrita Controlada via Pipeline ETL)
- **Escopo do Assistente de IA**: O acesso do assistente de IA ao Supabase é **exclusivamente para CONSULTA / LEITURA (`SELECT` / Read-Only)**. Operações de gravação ou alteração direta via SQL/client pelo assistente são estritamente proibidas.
- **Escopo do Pipeline ETL**: Os scripts oficiais de pipeline (`reconciliar_movimentacao_e_ativos.py`, `ETL_BI_LR.ipynb`, etc.) possuem autorização para executar operações controladas de gravação/upsert exclusivamente nas tabelas gerenciadas pelo projeto (`sq_*`).

---

## ⚡ 10. Respostas de Análise de Logs (`análise:`)
- **Regra**: Quando a mensagem do usuário for iniciada por ou contiver `análise:` acompanhada de um log de execução, o assistente deve fornecer **exclusivamente a análise técnica direta do log** (status, volume de registros, métricas de tempo e eventuais erros).
- **Exceção de Mensagens**: Nestas respostas de análise direta, **não sugerir nomes de tarefas para o Microsoft Planner** nem **recomendar passos de versionamento Git**, mantendo a resposta estritamente focada na avaliação técnica.

---

## 🏛️ 11. Padrão Oficial de Nomenclatura de Tabelas no Supabase (`lr-analytics-db`)
- **Regra**: No banco de dados central `lr-analytics-db` (Workspace `LaborRural Interno`), todas as tabelas devem obrigatoriamente seguir a taxonomia de prefixos por projeto e camadas analíticas:
  - **Estrutura**: `<prefixo_projeto>_<camada>_<entidade>`
  - **Prefixos de Projetos**: `sq_` (SmartQuestion), `elabore_` (Elabore), `meta_` (Metas), etc.
  - **Camadas Oficiais**:
    - `*_fato_*`: Tabelas fato analíticas agregadas (ex: `sq_fato_visitas`, `sq_fato_consistencia`, `sq_fato_movimentacao`).
    - `*_base_*`: Snapshots periódicos e bases congeladas mês a mês (ex: `sq_base_fazendas_ativas`, `sq_base_metas_mensal`).
    - `*_raw_*`: Ingestão bruta de relatórios e planilhas operacionais (ex: `sq_raw_visitas`, `sq_raw_vinculos`, `sq_raw_consistencia_mensal`).
  - **Colunas**: Sempre em `snake_case` minúsculo com timestamps `data_processamento` e chaves `id_composto`.

---

## 🛑 12. Execução de Scripts do Projeto (Solicitação Obrigatória ao Usuário)
- **Regra Absoluta**: O assistente de IA **NUNCA deve executar scripts do projeto de forma autônoma no terminal** (sejam rotinas de pipeline, scripts de carga, reconciliação, migração ou execução de notebooks).
- **Procedimento Obrigatório**:
  1. Preparar e editar os códigos necessários no repositório.
  2. Apresentar o comando exato de execução em bloco de código formatado para o usuário (ex: `python scripts/...` ou `python scripts/executar_pipeline.py`).
  3. Descrever claramente o objetivo do script e os impactos esperados.
  4. **Pedir formalmente que o próprio usuário execute o comando em seu terminal**, aguardando o retorno ou logs fornecidos por ele.


