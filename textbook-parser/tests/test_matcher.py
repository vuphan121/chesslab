import unittest

from textbook_parser.matcher import match_positions
from textbook_parser.models import Box, Position, TextBlock
from textbook_parser.labels import label_from_text
from textbook_parser.san import extract_candidates


def block(identifier: str, page: int, text: str, x: int, section: str | None = None, y: int = 100) -> TextBlock:
    return TextBlock(page, text, Box(x, y, x + 100, y + 25), section, identifier)


class MatchPositionsTest(unittest.TestCase):
    def test_board_coordinate_is_not_a_numbered_label(self) -> None:
        self.assertIsNone(label_from_text("8"))
        self.assertIsNone(label_from_text("1. Qh7+"))
        self.assertEqual(label_from_text("12. White to move"), "12")

    def test_study_prefers_matching_label_in_same_column(self) -> None:
        position = Position("diagram-7", 4, Box(300, 250, 500, 450), "7")
        links = match_positions([position], [
            block("left", 4, "Diagram 6 White wins", 20),
            block("right", 4, "Diagram 7 White to move: 1. Re8+", 320),
        ])
        self.assertEqual(links[0].status, "linked")
        self.assertEqual(links[0].text_block_id, "right")

    def test_exercise_uses_later_solution_with_same_number(self) -> None:
        position = Position("exercise-12", 10, Box(80, 100, 280, 300), "12", "exercise")
        links = match_positions([position], [
            block("study", 10, "12. White to move", 20, "exercise"),
            block("wrong", 11, "Solution 11: 1. ...", 20, "solution"),
            block("answer", 11, "Solution 12: 1. Qh7+", 20, "solution"),
        ])
        self.assertEqual(links[0].status, "linked")
        self.assertEqual(links[0].text_block_id, "answer")

    def test_unlabelled_side_by_side_position_stays_ambiguous(self) -> None:
        position = Position("unknown", 4, Box(300, 250, 500, 450))
        links = match_positions([position], [
            block("left", 4, "White attacks the king.", 120),
            block("right", 4, "Black must now defend.", 340),
        ])
        self.assertEqual(links[0].status, "ambiguous")

    def test_label_is_inferred_from_caption_above_board(self) -> None:
        position = Position("exercise-12", 10, Box(80, 200, 280, 400), kind="exercise")
        links = match_positions([position], [
            block("caption", 10, "Exercise 12", 90, "exercise"),
            block("answer", 11, "Solution 12: 1. Qh7+", 90, "solution"),
        ])
        self.assertEqual(links[0].status, "linked")
        self.assertIn("inferred label", links[0].reasons[0])

    def test_hierarchical_study_label_collects_its_commentary(self) -> None:
        position = Position("diagram-1-6", 4, Box(300, 250, 500, 450), "1-6")
        links = match_positions([position], [
            block("caption", 4, "Diagram 1-6", 620, y=100),
            block("move", 4, "1. Qh7+ Kxh7", 620, y=140),
            block("note", 4, "The queen sacrifice forces mate.", 620, y=180),
            block("next", 4, "Diagram 1-7", 620, y=220),
        ])
        self.assertEqual(links[0].text_block_id, "caption")
        self.assertEqual(links[0].text_block_ids, ["caption", "move", "note"])

    def test_figurine_san_candidates_are_normalised(self) -> None:
        self.assertEqual(extract_candidates("1. ♕h7+ Kxh7 2. O-O"), ["Qh7+", "Kxh7", "O-O"])
