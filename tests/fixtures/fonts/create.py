"""Generate the project's original, deliberately simple test font (requires fontTools).
The generated font and this source are dedicated to the public domain (CC0).
Only the .ttf is used by tests; no fontTools runtime dependency is required.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

font = FontBuilder(1000, isTTF=True)
names = ['.notdef', 'space', 'A', 'B']
font.setupGlyphOrder(names)
font.setupCharacterMap({32: 'space', 65: 'A', 66: 'B'})
glyphs = {}
for name in names:
    pen = TTGlyphPen(None)
    if name != 'space':
        pen.moveTo((60, 0))
        pen.lineTo((300, 700))
        pen.lineTo((540, 0))
        pen.closePath()
    glyphs[name] = pen.glyph()
font.setupGlyf(glyphs)
font.setupHorizontalMetrics({name: (600, 0) for name in names})
font.setupHorizontalHeader(ascent=800, descent=-200)
font.setupNameTable({'familyName': 'BBL Test', 'styleName': 'Regular',
                    'uniqueFontIdentifier': 'BBLTest-Regular', 'fullName': 'BBL Test Regular',
                    'psName': 'BBLTest-Regular', 'version': 'Version 1.0',
                    'copyright': 'Original Comix Sense test fixture. CC0 public domain dedication.'})
font.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
font.setupPost()
font.setupMaxp()
font.font.recalcTimestamp = False
font.font['head'].created = font.font['head'].modified = 3406620153
font.save(Path(__file__).with_name('bbl-test.ttf'))
