#!/usr/bin/env python3
"""Split positional_play.pdf into the per-chapter PDFs the reader streams.

Exercises and Solutions are one app chapter (chapter-5.pdf, master pages
152-309): an exercise's page and its solution page are in the same file.
"""

import sys
from pathlib import Path

import pypdfium2 as pdfium

from parse_positional_play import CHAPTERS

source, output = Path(sys.argv[1]), Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
document = pdfium.PdfDocument(source)
parts = {number + 1: (name, first, last) for number, (name, first, last) in CHAPTERS.items() if number != 5}
parts[5] = ("Exercises and Solutions", CHAPTERS[4][1], CHAPTERS[5][2])
for number, (name, first, last) in parts.items():
    part = pdfium.PdfDocument.new()
    part.import_pages(document, list(range(first - 1, last)))
    path = output / f"chapter-{number}.pdf"
    part.save(path)
    print(path, name, last - first + 1, "pages")
