#!/usr/bin/env python3
"""Split positional_play.pdf into the per-chapter PDFs the reader streams."""

import sys
from pathlib import Path

import pypdfium2 as pdfium

from parse_positional_play import CHAPTERS

source, output = Path(sys.argv[1]), Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
document = pdfium.PdfDocument(source)
for chapter, (name, first, last) in CHAPTERS.items():
    part = pdfium.PdfDocument.new()
    part.import_pages(document, list(range(first - 1, last)))
    path = output / f"chapter-{chapter + 1}.pdf"
    part.save(path)
    print(path, name, last - first + 1, "pages")
