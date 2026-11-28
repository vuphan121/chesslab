#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

import pypdfium2 as pdfium

from parse_aagaard import BOOKS

book = BOOKS[sys.argv[1]]
output = Path("tmp") / sys.argv[1] / "pdf"
output.mkdir(parents=True, exist_ok=True)
document = pdfium.PdfDocument(book["pdf"])
for number, (name, first, last) in book["chapters"].items():
    part = pdfium.PdfDocument.new()
    part.import_pages(document, list(range(first - 1, last)))
    path = output / f"chapter-{number}.pdf"
    part.save(path)
    print(path, name, last - first + 1, "pages", path.stat().st_size // 1024, "KB")
