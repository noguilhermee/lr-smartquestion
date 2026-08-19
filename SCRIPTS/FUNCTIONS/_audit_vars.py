import json
import re
from pathlib import Path

def run_audit():
    root = Path(__file__).resolve().parents[2]
    
    print("==================================================")
    print("🔍 AUDITORIA COMPLETA DE VARIÁVEIS E DATAS FIXAS")
    print("==================================================")

    # 1. Notebook ETL_BI_LR.ipynb
    nb_file = root / "SCRIPTS" / "ETL_BI_LR.ipynb"
    if nb_file.exists():
        print(f"\n📓 Verificando Notebook: {nb_file.name}")
        with open(nb_file, "r", encoding="utf-8") as f:
            nb = json.load(f)
        for idx, cell in enumerate(nb.get("cells", [])):
            if cell.get("cell_type") == "code":
                src = "".join(cell.get("source", []))
                for l_idx, line in enumerate(src.split("\n"), 1):
                    s = line.strip()
                    if not s or s.startswith("#"):
                        continue
                    if re.search(r"['\"]202[0-9]-[0-9]{2}", s) or "data_inicial" in s or "data_corte" in s or "mes_ref" in s:
                        # Filtrar leituras legítimas do config_yaml
                        if "config_yaml" in s or "carregar_config" in s or "DATA_INICIAL_" in s or "datetime.now" in s:
                            continue
                        print(f"  - Célula {idx:02d} [L{l_idx:02d}]: {s}")

    # 2. Arquivos Python em SCRIPTS/
    print("\n🐍 Verificando arquivos .py em SCRIPTS/")
    for py_file in (root / "SCRIPTS").rglob("*.py"):
        if py_file.name == "_audit_vars.py":
            continue
        rel = py_file.relative_to(root)
        with open(py_file, "r", encoding="utf-8") as f:
            lines = f.readlines()
        for l_idx, line in enumerate(lines, 1):
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if re.search(r"['\"]202[0-9]-[0-9]{2}", s):
                print(f"  - [{rel}:L{l_idx:02d}]: {s}")

    # 3. Backend DASHBOARD/api
    print("\n🌐 Verificando Backend DASHBOARD/api/")
    for js_file in (root / "DASHBOARD" / "api").glob("*.js"):
        rel = js_file.relative_to(root)
        with open(js_file, "r", encoding="utf-8") as f:
            lines = f.readlines()
        for l_idx, line in enumerate(lines, 1):
            s = line.strip()
            if not s or s.startswith("//"):
                continue
            if re.search(r"['\"]202[0-9]-[0-9]{2}", s):
                print(f"  - [{rel}:L{l_idx:02d}]: {s}")

if __name__ == "__main__":
    run_audit()
