import unittest

import cv2
import numpy as np

from textbook_parser.vision import detect_turn


class TurnDetectionTest(unittest.TestCase):
    def test_detects_bright_triangle_on_gray_paper(self) -> None:
        image = np.full((300, 300, 3), 160, dtype=np.uint8)
        cv2.fillConvexPoly(image, np.array([[145, 55], [125, 95], [165, 95]]), (255, 255, 255))
        result = detect_turn(image, (50, 100, 250, 300))
        self.assertEqual(result.side_to_move, "w")

    def test_detects_downward_triangle_as_black_to_move(self) -> None:
        image = np.full((300, 300, 3), 160, dtype=np.uint8)
        cv2.fillConvexPoly(image, np.array([[125, 55], [165, 55], [145, 95]]), (0, 0, 0))
        result = detect_turn(image, (50, 100, 250, 300))
        self.assertEqual(result.side_to_move, "b")
