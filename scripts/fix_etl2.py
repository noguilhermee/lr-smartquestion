import json
import re

with open('ETL_BI_LR.ipynb', 'r', encoding='utf-8') as f:
    d = json.load(f)

for cell in d['cells']:
    if cell['cell_type'] == 'code':
        src = ''.join(cell['source'])
        if 'resultado_tab_visitas = etl_visitas(df_visitas_consolidado)' in src:
            new_src = src.replace(
                'resultado_tab_visitas = etl_visitas(df_visitas_consolidado)',
                'df_visitas_consolidado[\"nome_consultor\"] = df_visitas_consolidado[\"nome_consultor\"].astype(str).str.strip().str.upper().replace({\"MARIO BARBOSA FILHO\": \"MARIO BARBOSA ROSA FILHO\", \"MARIO BARBOSA\": \"MARIO BARBOSA ROSA FILHO\"})\n    resultado_tab_visitas = etl_visitas(df_visitas_consolidado)'
            )
            cell['source'] = [line for line in new_src.splitlines(True)]

with open('ETL_BI_LR.ipynb', 'w', encoding='utf-8') as f:
    json.dump(d, f, indent=1)
