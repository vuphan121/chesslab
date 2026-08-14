import unittest

from textbook_parser.board_detector import Rectangle, keep_complete_boards, merge_board_fragments


class BoardFragmentMergingTest(unittest.TestCase):
    def test_merges_three_partial_grid_contours_into_one_board(self) -> None:
        # Real page 9 style: right-half, bottom-middle, and upper-left grid
        # contours from one board whose outer border is broken by the scan.
        rectangles = [
            Rectangle(733, 1694, 526, 510),
            Rectangle(540, 2155, 493, 499),
            Rectangle(301, 1702, 399, 382),
        ]
        merged = merge_board_fragments(rectangles)
        self.assertEqual(merged, [Rectangle(301, 1694, 958, 960)])

    def test_keeps_separate_boards_separate(self) -> None:
        rectangles = [Rectangle(100, 100, 900, 900), Rectangle(100, 1200, 900, 900)]
        self.assertEqual(merge_board_fragments(rectangles), rectangles)

    def test_rejects_unstitched_small_square_fragment(self) -> None:
        candidates = [Rectangle(100, 100, 960, 960), Rectangle(1200, 100, 395, 413)]
        self.assertEqual(keep_complete_boards(candidates, 700), [Rectangle(100, 100, 960, 960)])
