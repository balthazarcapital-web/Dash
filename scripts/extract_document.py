import json
import sys
from pathlib import Path

import pdfplumber


def extract_pdf(path: Path):
    pages = []
    all_text = []
    all_tables = []
    with pdfplumber.open(path) as pdf:
        for index, page in enumerate(pdf.pages, 1):
            text = page.extract_text(x_tolerance=2, y_tolerance=2) or ""
            tables = page.extract_tables() or []
            pages.append({"page": index, "text": text, "tables": tables})
            all_text.append(text)
            all_tables.extend(tables)
    return {
        "text": "\n".join(all_text),
        "tables": all_tables,
        "pages": pages,
        "method": "pdf-text",
        "confidence": 0.96 if sum(map(len, all_text)) > 80 else 0.25,
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    path = Path(sys.argv[1]).resolve()
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        result = extract_pdf(path)
    elif suffix in {".txt", ".csv", ".tsv"}:
        result = {
            "text": path.read_text(encoding="utf-8-sig", errors="replace"),
            "tables": [],
            "pages": [],
            "method": "text",
            "confidence": 1,
        }
    else:
        raise ValueError(f"Formato não tratado pelo extrator: {suffix}")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)

