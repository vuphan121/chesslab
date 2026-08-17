import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from book_board_parser import Rectangle, detect_turn, parse_piece_placement


class PiecePlacementTests(unittest.TestCase):
    def test_accepts_a_complete_position(self):
        placement = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"
        self.assertEqual(parse_piece_placement(placement), placement)

    def test_rejects_invalid_rank_width(self):
        with self.assertRaisesRegex(ValueError, "not eight"):
            parse_piece_placement("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN")

    def test_rejects_missing_king(self):
        with self.assertRaisesRegex(ValueError, "king"):
            parse_piece_placement("rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")


class TurnMarkerTests(unittest.TestCase):
    def test_reads_upward_and_downward_triangles_at_the_marker_position(self):
        board = Rectangle(50, 200, 300, 300)
        cases = {
            "w": [(336, 140), (320, 175), (352, 175)],
            "b": [(320, 140), (352, 140), (336, 175)],
        }
        for expected, points in cases.items():
            with self.subTest(expected=expected):
                image = np.full((600, 600, 3), 255, dtype=np.uint8)
                cv2.polylines(image, [np.array(points, np.int32)], True, (0, 0, 0), 3)
                side, confidence, _ = detect_turn(image, board)
                self.assertEqual(expected, side)
                self.assertGreaterEqual(confidence, 0.4)


if __name__ == "__main__":
    unittest.main()
