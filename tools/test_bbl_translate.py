"""Integration checks for language-independent, lossless translation batches."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("bbl_translate.py")


class TranslationWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "01.es.bbl"
        self.target = self.root / "01.fr.bbl"
        self.state = self.root / "state.json"
        self.batch = self.root / "batch.json"
        # Keep BOM, CRLF, irregular spaces, nested language, escaped quotes and newlines.
        self.original = ('\ufeff{ "pages": [{"bubbles":[{"text":"Hola \\"amigo\\"\\n¡Ven!",'
                         '"lang":"es","shape":{"vs":[{"x":3,"y":7}]}}]}],\r\n'
                         '"lang" : "es" }').encode("utf-8")
        self.source.write_bytes(self.original)
        self.batch.write_text(json.dumps({self.source.name: ['Bonjour "ami"\nViens !']}), encoding="utf-8")

    def run_tool(self, action, *extra, succeeds=True):
        result = subprocess.run([sys.executable, str(SCRIPT), action, str(self.root),
                                 "--source", "es", "--target", "fr", "--state", str(self.state),
                                 *map(str, extra)], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode == 0, succeeds, result.stdout + result.stderr)
        return result.stdout

    def translate(self):
        self.run_tool("init")
        self.run_tool("insert", "--batch", self.batch)

    def test_non_dutch_source_and_lossless_output(self):
        self.run_tool("init")
        extracted = self.run_tool("extract")
        self.assertIn('"index": ["pages", 0, "bubbles", 0]', extracted)
        self.run_tool("insert", "--batch", self.batch)
        self.run_tool("validate")
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertTrue(self.target.read_bytes().startswith(b"\xef\xbb\xbf"))
        self.assertIn(b"\r\n", self.target.read_bytes())
        translated = json.loads(self.target.read_text(encoding="utf-8-sig"))
        self.assertEqual(translated["pages"][0]["bubbles"][0]["text"], 'Bonjour "ami"\nViens !')
        before = self.target.read_bytes()
        self.run_tool("insert", "--batch", self.batch, succeeds=False)
        self.assertEqual(self.target.read_bytes(), before)

    def test_typography_and_album_metadata_preserved(self):
        data = {"lang": "es", "font": {"family": ["Test", "serif"], "size": 32},
                "fontFaces": [{"family": "Test", "src": "fonts/test.ttf", "weight": 700}],
                "pages": [{"filename": "pages/01.jpg", "font": {"style": "italic"},
                           "bubbles": [{"text": "Hola", "font": {"weight": 400},
                                        "shape": {"type": "box", "vs": [{"x": 1, "y": 2}]}}]}]}
        self.source.write_text(json.dumps(data), encoding="utf-8")
        self.batch.write_text(json.dumps({self.source.name: ["Bonjour"]}), encoding="utf-8")
        self.translate()
        self.run_tool("validate")
        result = json.loads(self.target.read_text(encoding="utf-8"))
        self.assertEqual(result["font"], data["font"])
        self.assertEqual(result["fontFaces"], data["fontFaces"])
        self.assertEqual(result["pages"][0]["filename"], "pages/01.jpg")
        self.assertEqual(result["pages"][0]["font"], {"style": "italic"})
        self.assertEqual(result["pages"][0]["bubbles"][0]["font"], {"weight": 400})

    def test_incomplete_batch_writes_nothing(self):
        self.run_tool("init")
        self.batch.write_text(json.dumps({self.source.name: []}), encoding="utf-8")
        self.run_tool("insert", "--batch", self.batch, succeeds=False)
        self.assertFalse(self.target.exists())

    def test_validation_detects_geometry_and_original_changes(self):
        self.translate()
        before = self.target.read_bytes()
        self.target.write_bytes(before.replace(b'"x":3', b'"x":4'))
        self.run_tool("validate", succeeds=False)
        self.target.write_bytes(before)
        self.source.write_bytes(self.original + b" ")
        self.run_tool("validate", succeeds=False)

    def test_existing_translation_preserved(self):
        self.target.write_text('{"pages": [], "lang": "fr"}', encoding="utf-8")
        before = self.target.read_bytes()
        self.run_tool("init")
        self.run_tool("validate")
        self.assertEqual(self.target.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
