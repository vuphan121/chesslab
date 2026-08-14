import unittest

from textbook_parser.ocr_text import parse_tesseract_tsv


class TesseractTextTest(unittest.TestCase):
    def test_groups_words_into_visual_lines_without_interpreting_them(self) -> None:
        tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t2\t1\t1\t1\t10\t20\t30\t10\t90\t1.\n5\t1\t2\t1\t1\t2\t45\t20\t35\t10\t80\t♘f3\n5\t1\t2\t1\t2\t1\t10\t40\t20\t10\t75\tText\n"
        blocks = parse_tesseract_tsv(tsv, 7)
        self.assertEqual(len(blocks), 2)
        self.assertEqual(blocks[0]["text"], "1. ♘f3")
        self.assertEqual(blocks[0]["bbox"], [10, 20, 80, 30])
        self.assertEqual(blocks[0]["source"], "tesseract")
