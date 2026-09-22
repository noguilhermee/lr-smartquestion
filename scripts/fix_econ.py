import re

with open('c:/Users/Guilherme/LABOR RURAL/Analytics - Departamento Analytics/POWER_BI/PROJETOS/BI_LABOR_RURAL/bi-gerencial/scripts/functions/carregar_fato_economico.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix id_comp
content = content.replace(
    'id_comp = f"{cod_lr}_{mes_str}"',
    'id_comp = f"{cod_lr}_{mes_str}T00:00:00+00:00"'
)

with open('c:/Users/Guilherme/LABOR RURAL/Analytics - Departamento Analytics/POWER_BI/PROJETOS/BI_LABOR_RURAL/bi-gerencial/scripts/functions/carregar_fato_economico.py', 'w', encoding='utf-8') as f:
    f.write(content)
