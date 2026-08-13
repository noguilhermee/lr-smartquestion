# 📊 BI Labor Rural - Pipeline de ETL

Este repositório contém o pipeline de **ETL (Extração, Transformação e Carga)** do projeto **BI Labor Rural**. 

O objetivo do pipeline é extrair dados brutos de planilhas operacionais e relatórios de campo (SmartQuestion e projetos de consultoria como Regenera, Alvoar, Semear, CCPR e LPA), tratá-los via Python (Pandas/NumPy) e realizar a carga incremental (upsert/insert) em um banco de dados **Supabase (PostgreSQL)**, fornecendo dados estruturados e atualizados para os painéis no **Power BI**.

---

## 📂 Estrutura do Projeto

```text
PY_SCRIPT/
├── APP/
│   ├── ETL_BI_LR.ipynb           # Notebook principal contendo todo o fluxo de ETL
│   ├── MIGRACAO_ELABORE.ipynb    # Script auxiliar de migração de dados antigos
│   └── BACKUP/                   # Versões anteriores e backups de segurança dos notebooks
├── DATA/                         # Arquivos locais de exportação, validação e métricas
│   ├── IMAGES/                   # Imagens e ativos visuais
│   ├── f_visitas.xlsx            # Exportação de validação da Fato Visitas
│   └── ...
├── .env                          # Variáveis de ambiente e credenciais (Supabase / SharePoint)
└── README.md                     # Documentação do repositório
```

---

## ⚙️ Arquitetura do Pipeline (`ETL_BI_LR.ipynb`)

O notebook [ETL_BI_LR.ipynb](file:///c:/Users/Guilherme/LABOR%20RURAL/Analytics%20-%20Departamento%20Analytics/POWER_BI/PROJETOS/BI_LABOR_RURAL/PY_SCRIPT/APP/ETL_BI_LR.ipynb) está dividido em 7 módulos principais:

### 1. 🛑 Inativação de Produtores (`etl_inativacao`)
* **Fonte de Dados**: Planilhas `*_LISTA_INATIVACAO.xlsx` (diretório `BD_SMARTQUESTION`).
* **Tabela Supabase**: `tab_inativacoes_sq`
* **Descrição**: Identifica novos registros de inativação de produtores por atendimento, formata datas para ISO 8601, converte flags ativas/inativas para valores booleanos e realiza `upsert` ordenado em lotes de 100 registros.

### 2. 👨‍🌾 Inativação de Consultores (`etl_inativacao_consultor`)
* **Fonte de Dados**: Planilha de histórico de usuários `*BD_STATUS_USUARIO_SQ.xlsx`.
* **Tabela Supabase**: `tab_inativacao_consultor_sq`
* **Descrição**: Rastreia a mudança de status dos consultores (transição de `Sim` para `Não`), gerando um MD5 único (`id_inativacao_consultor`) por consultor e data para evitar duplicidade no banco.

### 3. 🔗 Vínculos de Produtores e Consultores (`etl_vinculos`)
* **Fonte de Dados**: `BD_BI_VINCULOS_COMPLETO.xlsx` e planilhas de resgate.
* **Tabela Supabase**: `tab_vinculos_sq`
* **Descrição**: Normaliza nomenclaturas de consultores, aplica a remoção de espaços em branco (trimming), extrai códigos de projeto e insere/atualiza solicitações de novos vínculos de atendimento.

### 4. 🚜 Relatórios de Visitas de Campo (`etl_visitas`)
* **Fonte de Dados**: Relatórios individuais dos projetos: **Regenera**, **Alvoar**, **Semear**, **CCPR** e **LPA**.
* **Tabela Supabase**: `tab_visitas_sq`
* **Descrição**: Padroniza os cabeçalhos e esquemas de dados de 5 projetos com formatos distintos em uma única estrutura coesa de visitas realizadas.

### 5. 📈 Tabela Fato: Visitas (`f_Visitas`)
* **Função Principal**: `run_etl_and_upsert_f_visitas(data_inicial, data_final)`
* **Tabela Supabase**: `f_visitas_bi_lr`
* **Descrição**: Cruza as visitas realizadas (`tab_visitas_sq`) com a base de produtores ativos mensais (`tab_produtores_ativos_mensal`), gerando KPIs de cobertura, frequência e classificação de status de visitação por consultor.

### 6. 🏆 Tabela Fato: Consistência (`f_Consistencia`)
* **Tabela Supabase**: `f_consistente_bi_lr`
* **Descrição**: Mede a assiduidade de atendimento ao produtor rural ao longo dos últimos 12 meses. Realiza o cruzamento com cadastros de fazendas (`tab_fazenda`), consultores (`tab_consultor`) e listas de exceção.
* **Funções de Manutenção**:
  * `resetar_meses_sequenciais()`: Zera o contador de sequência para recálculo geral.
  * `catchup_meses_sequenciais()`: Atualiza a contagem contínua de meses com atendimento prestado.

### 7. 🔄 Tabela Fato: Movimentação de Produtores (`f_mov_produtores`)
* **Tabela Supabase**: `f_movimentacao_produtores_bi_lr`
* **Descrição**: Consolida a dinâmica de entrantes (novos vínculos) e saindo (inativações) por período, fornecendo a taxa de turnover/evasão de produtores nos projetos da Labor Rural.

---

## 🛠️ Tecnologias e Dependências

* **Linguagem**: Python 3.10+
* **Bibliotecas Principais**:
  * `pandas`: Manipulação e transformação de dados.
  * `numpy`: Tratamento de nulos (`np.nan` -> `None`) e conversões numéricas.
  * `supabase`: Cliente oficial para conexão e operações de banco de dados no Supabase.
  * `python-dotenv`: Gerenciamento de variáveis de ambiente.
  * `openpyxl`: Leitura de planilhas em formato Excel `.xlsx`.
  * `hashlib` & `glob`: Processamento criptográfico de IDs e varredura de arquivos locais.

---

## 🗝️ Configuração do Ambiente (.env)

Para executar o pipeline, certifique-se de que o arquivo `.env` esteja presente no diretório raiz do projeto (`PY_SCRIPT/.env`) contendo as credenciais de acesso:

```env
# Supabase API Credentials
SUPABASE_URL="https://seu-projeto.supabase.co"
SUPABASE_SERVICE_KEY="sua-chave-de-servico-supabase"

# Supabase Postgres Direct Connection (Opcional)
SUPABASE_HOST="db.seu-projeto.supabase.co"
SUPABASE_DBNAME="postgres"
SUPABASE_USER="postgres"
SUPABASE_PASSWORD="sua-senha-do-banco"
SUPABASE_PORT="5432"

# Diretórios Locais e Integrações (SharePoint / Outlook)
VISITAS_DIRETORIO="C:/caminho/para/BD_SMARTQUESTION"
POLLING_INTERVAL_SECONDS=60
```

---

## 🚀 Como Executar

1. **Instalação das Dependências**:
   ```bash
   pip install pandas numpy supabase python-dotenv openpyxl
   ```

2. **Execução pelo Jupyter Notebook**:
   * Abra o Jupyter Notebook ou VS Code / Jupyter Lab na pasta `APP/`.
   * Execute o arquivo [ETL_BI_LR.ipynb](file:///c:/Users/Guilherme/LABOR%20RURAL/Analytics%20-%20Departamento%20Analytics/POWER_BI/PROJETOS/BI_LABOR_RURAL/PY_SCRIPT/APP/ETL_BI_LR.ipynb).
   * As células podem ser executadas sequencialmente para atualizar todos os dados ou individualmente para um módulo específico (ex: `etl_inativacao()`).

3. **Estratégia de Inserção (Upsert Lote a Lote)**:
   * Para evitar erros de timeout ou limites de carga na API do Supabase, os dados são enviados em lotes de 100 registros (`chunk_size = 100`) com um delay de segurança (`time.sleep(0.5)`).

---

## 🔒 Boas Práticas e Segurança

> [!CAUTION]
> ### 🚨 REGRA DE SEGURANÇA OBRIGATÓRIA DO PROJETO
> **NENHUMA** alteração no banco de dados do Supabase (operações de `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, criação ou modificação de tabelas/estruturas) deve ser executada sem a autorização prévia e a permissão explícita do usuário.

* **Nunca comite o arquivo `.env`** contendo senhas reais ou chaves `SUPABASE_SERVICE_KEY` em repositórios públicos.
* O script utiliza a chave primária composta `id_composto` ou `id_atendimento` em todas as tabelas para garantir **idempotência**: rodar o script múltiplas vezes não gerará registros duplicados.

