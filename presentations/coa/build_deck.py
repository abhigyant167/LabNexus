# -*- coding: utf-8 -*-
"""
Build "Binary Storage and Registers" — a COA theory presentation deck.

Output: presentations/coa/Binary_Storage_and_Registers_COA.pptx
Every slide has speaker notes. Geometry is checked by a fit/overlap pass
so the deck stays clean even though it is generated (not hand-placed).
"""

import os
import math

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.oxml.ns import qn
from lxml import etree

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(OUT_DIR, "Binary_Storage_and_Registers_COA.pptx")

# ---------------------------------------------------------------- palette
INK      = RGBColor(0x11, 0x21, 0x2E)
INK_SOFT = RGBColor(0x4A, 0x5A, 0x69)
MUTED    = RGBColor(0x78, 0x88, 0x97)
ACCENT   = RGBColor(0x0E, 0x7C, 0x86)   # teal
ACCENT_D = RGBColor(0x0A, 0x5A, 0x62)
AMBER    = RGBColor(0xD9, 0x84, 0x00)
PANEL    = RGBColor(0xF1, 0xF6, 0xF8)
PANEL_2  = RGBColor(0xE7, 0xF0, 0xF2)
LINE     = RGBColor(0xD3, 0xDF, 0xE4)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
DARK_BG  = RGBColor(0x0C, 0x1B, 0x26)
DARK_PNL = RGBColor(0x14, 0x2B, 0x38)
CODE_BG  = RGBColor(0x0F, 0x24, 0x30)
CODE_FG  = RGBColor(0xD6, 0xF0, 0xEE)

BODY = "Segoe UI"
MONO = "Consolas"
HEAD = "Segoe UI Semibold"

SW, SH = 13.333, 7.5
prs = Presentation()
prs.slide_width = Inches(SW)
prs.slide_height = Inches(SH)
BLANK = prs.slide_layouts[6]

FIT_REPORT = []


# ---------------------------------------------------------------- helpers
def I(v):
    return Inches(v)


def slide():
    s = prs.slides.add_slide(BLANK)
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = WHITE
    return s


def rect(s, x, y, w, h, fill=None, line=None, lw=1.0, shape=MSO_SHAPE.RECTANGLE,
         radius=None, shadow=False):
    sh = s.shapes.add_shape(shape, I(x), I(y), I(w), I(h))
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line
        sh.line.width = Pt(lw)
    if radius is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        sh.adjustments[0] = radius
    sh.shadow.inherit = False
    if not shadow:
        _no_shadow(sh)
    sh.text_frame.word_wrap = True
    return sh


def _no_shadow(sh):
    spPr = sh._element.spPr
    for tag in ("a:effectLst",):
        existing = spPr.find(qn(tag))
        if existing is not None:
            spPr.remove(existing)
    spPr.append(etree.SubElement(spPr, qn("a:effectLst")))


_MEAS_CACHE = {}


def _meas_font(size_pt, bold=False, mono=False):
    from PIL import ImageFont
    key = (round(size_pt, 1), bold, mono)
    if key not in _MEAS_CACHE:
        path = ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf" if (mono and bold)
                else "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf" if mono
                else "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
                else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
        _MEAS_CACHE[key] = ImageFont.truetype(path, int(round(size_pt * 20)))
    return _MEAS_CACHE[key]


def _text_w(txt, size, bold=False, mono=False):
    """Width in inches. DejaVu is wider than Segoe UI, so scale down a little."""
    f = _meas_font(size, bold, mono)
    from PIL import ImageDraw, Image
    d = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    return d.textlength(txt, font=f) / 20.0 / 72.0 * 0.93


def _paragraph_lines(p, w):
    """Return (n_lines, widest_line_in, max_size) for one paragraph dict."""
    tokens = []
    maxsz = p.get("size", 18)
    for txt, ov in p["runs"]:
        sz = ov.get("size", p.get("size", 18))
        bold = ov.get("bold", p.get("bold", False))
        mono = ov.get("font", p.get("font", BODY)) == MONO
        maxsz = max(maxsz, sz)
        for li, chunk in enumerate(txt.split("\n")):
            if li:
                tokens.append(("\n", sz, bold, mono))
            for word in chunk.split(" "):
                tokens.append((word, sz, bold, mono))
    if not tokens:
        return 1, 0.0, maxsz
    lines, cur = 1, 0.0
    widest = 0.0
    for word, sz, bold, mono in tokens:
        if word == "\n":
            widest = max(widest, cur)
            lines += 1
            cur = 0.0
            continue
        ww = _text_w(word + " ", sz, bold, mono)
        if word == "":
            cur += ww
            continue
        if cur + ww > w and cur > 0:
            widest = max(widest, cur)
            lines += 1
            cur = ww
        else:
            cur += ww
    widest = max(widest, cur)
    return lines, widest, maxsz


def _measure(paras, w):
    total = 0.0
    need_w = 0.0
    for p in paras:
        ls = p.get("line_spacing", 1.0)
        n, widest, maxsz = _paragraph_lines(p, w)
        need_w = max(need_w, widest)
        total += n * maxsz * (ls if isinstance(ls, float) else 1.0) * 1.19 / 72.0
        total += (p.get("space_before", 0) + p.get("space_after", 0)) / 72.0
    return total, need_w


def text(s, x, y, w, h, runs, size=18, color=INK, font=BODY, bold=False,
         align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, line_spacing=None,
         space_after=0, italic=False, check=True, shrink=True, tag=""):
    """runs: str, or list of (text, dict-overrides) tuples, or list of paragraphs
    where a paragraph is a str / list-of-runs / dict with 'runs' + para opts."""
    if isinstance(runs, str):
        paras = [{"runs": [(runs, {})]}]
    elif isinstance(runs, list) and runs and isinstance(runs[0], tuple):
        paras = [{"runs": runs}]
    elif isinstance(runs, list) and all(isinstance(r, str) for r in runs):
        paras = [{"runs": [(r, {})]} for r in runs]
    else:
        paras = []
        for p in runs:
            if isinstance(p, str):
                paras.append({"runs": [(p, {})]})
            elif isinstance(p, list):
                paras.append({"runs": p})
            else:
                paras.append(dict(p))

    for p in paras:
        p.setdefault("size", size)
        if "space_after" not in p and space_after:
            p["space_after"] = space_after
        if line_spacing and "line_spacing" not in p:
            p["line_spacing"] = line_spacing

    if shrink:
        scale = 1.0
        need, _ = _measure(paras, w)
        while need > h + 0.02 and scale > 0.62:
            scale -= 0.04
            trial = []
            for p in paras:
                q = dict(p)
                q["size"] = p["size"] * scale
                q["runs"] = [(t, dict(ov, size=ov.get("size", p["size"]) * scale))
                             for t, ov in p["runs"]]
                trial.append(q)
            need, _ = _measure(trial, w)
        if scale < 0.999:
            paras = trial
            if check and scale < 0.97:
                FIT_REPORT.append(f"SHRUNK to {scale:.0%} :: {_flat(paras)[:60]}")

    tb = s.shapes.add_textbox(I(x), I(y), I(w), I(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = 0
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor

    for i, p in enumerate(paras):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.alignment = p.get("align", align)
        para.space_before = Pt(p.get("space_before", 0))
        para.space_after = Pt(p.get("space_after", 0))
        ls = p.get("line_spacing")
        if ls:
            para.line_spacing = ls
        for txt, ov in p["runs"]:
            r = para.add_run()
            r.text = txt
            f = r.font
            f.name = ov.get("font", p.get("font", font))
            f.size = Pt(ov.get("size", p["size"]))
            f.bold = ov.get("bold", p.get("bold", bold))
            f.italic = ov.get("italic", p.get("italic", italic))
            f.color.rgb = ov.get("color", p.get("color", color))

    if check:
        need, widest = _measure(paras, w)
        if need > h + 0.06:
            FIT_REPORT.append(f"OVERFLOW h={h:.2f} need={need:.2f} :: {_flat(paras)[:60]}")
        if x + w > SW + 0.01 or y + h > SH + 0.01 or x < -0.01 or y < -0.01:
            FIT_REPORT.append(f"OUT OF SLIDE :: {_flat(paras)[:60]}")
    return tb


def _flat(paras):
    return " | ".join("".join(t for t, _ in p["runs"]) for p in paras)


def bullets(s, x, y, w, items, size=17, gap=0.46, color=INK, marker_color=ACCENT,
            marker="\u2022", width_pad=0.30, line_spacing=1.05):
    """Simple bullet list: each item is str or (bold-lead, rest)."""
    cy = y
    tw = w - width_pad
    for it in items:
        text(s, x, cy, 0.24, 0.3, [[(marker, {"color": marker_color, "bold": True,
                                                "size": size})]], size=size)
        if isinstance(it, tuple):
            lead, rest = it
            paras = [{"runs": [(lead, {"bold": True}), (rest, {})], "size": size,
                      "line_spacing": line_spacing}]
        else:
            paras = [{"runs": [(it, {})], "size": size, "line_spacing": line_spacing}]
        need, _ = _measure(paras, tw)
        text(s, x + width_pad, cy, tw, need + 0.04, paras, size=size, color=color,
             line_spacing=line_spacing, shrink=False)
        cy += max(gap, need * 1.05 + 0.26)
    return cy


def header(s, title, kicker=None, subtitle=None):
    rect(s, 0, 0, SW, 0.10, fill=ACCENT)
    if kicker:
        text(s, 0.75, 0.42, 9.0, 0.26, kicker.upper(), size=11, bold=True,
             color=ACCENT, font=HEAD)
        ty = 0.70
    else:
        ty = 0.52
    text(s, 0.75, ty, 11.4, 0.66, title, size=31, bold=True, color=INK, font=HEAD)
    title_h = _measure([{"runs": [(title, {})], "size": 31}], 11.4)[0]
    if subtitle:
        sy = ty + title_h + 0.10
        text(s, 0.75, sy, 11.4, 0.34, subtitle, size=14, color=INK_SOFT)
        return sy + 0.50
    return ty + title_h + 0.16


def footer(s, n, label="Binary Storage and Registers"):
    rect(s, 0.75, 6.92, SW - 1.5, 0.012, fill=LINE)
    text(s, 0.75, 7.02, 7.0, 0.24, label, size=9.5, color=MUTED)
    text(s, SW - 1.45, 7.02, 0.7, 0.24, f"{n:02d}", size=9.5, color=MUTED,
         align=PP_ALIGN.RIGHT, bold=True)


def notes(s, txt):
    s.notes_slide.notes_text_frame.text = txt.strip()


def arrow(s, x1, y1, x2, y2, color=ACCENT_D, w=1.5, dash=None, head="triangle"):
    c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, I(x1), I(y1), I(x2), I(y2))
    c.line.color.rgb = color
    c.line.width = Pt(w)
    ln = c.line._get_or_add_ln()
    if dash:
        d = etree.SubElement(ln, qn("a:prstDash"))
        d.set("val", dash)
    if head:
        he = etree.SubElement(ln, qn("a:tailEnd"))
        he.set("type", head)
        he.set("w", "med")
        he.set("len", "med")
    return c


def wire(s, x1, y1, x2, y2, color=ACCENT_D, w=1.25):
    c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, I(x1), I(y1), I(x2), I(y2))
    c.line.color.rgb = color
    c.line.width = Pt(w)
    return c


def dot(s, x, y, d=0.09, color=ACCENT_D):
    o = s.shapes.add_shape(MSO_SHAPE.OVAL, I(x - d / 2), I(y - d / 2), I(d), I(d))
    o.fill.solid()
    o.fill.fore_color.rgb = color
    o.line.fill.background()
    _no_shadow(o)
    return o


def chip(s, x, y, w, h, label, sub=None, fill=PANEL, line=LINE, color=INK,
         size=13, sub_size=10, bold=True, radius=0.12):
    sh = rect(s, x, y, w, h, fill=fill, line=line, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
              radius=radius)
    tf = sh.text_frame
    tf.margin_left = tf.margin_right = Inches(0.04)
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    r.font.name = MONO if all(ord(ch) < 128 for ch in label) and _monoish(label) else BODY
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.color.rgb = color
    if sub:
        p2 = tf.add_paragraph()
        p2.alignment = PP_ALIGN.CENTER
        r2 = p2.add_run()
        r2.text = sub
        r2.font.name = BODY
        r2.font.size = Pt(sub_size)
        r2.font.color.rgb = MUTED
    return sh


def _monoish(t):
    return any(c.isdigit() for c in t) or any(c in t for c in "<>=/_-")


def card(s, x, y, w, h, title, body, accent=ACCENT, size=15, body_size=13,
         title_size=15.5):
    rect(s, x, y, w, h, fill=PANEL, line=LINE, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
         radius=0.05)
    rect(s, x, y + 0.14, 0.055, h - 0.28, fill=accent)
    text(s, x + 0.30, y + 0.20, w - 0.55, 0.30, title, size=title_size, bold=True,
         color=INK, font=HEAD)
    text(s, x + 0.30, y + 0.58, w - 0.55, h - 0.72, body, size=body_size,
         color=INK_SOFT, line_spacing=1.08)


def table(s, x, y, w, rows, col_w, header_row=True, size=12.5, row_h=0.34,
          header_fill=ACCENT, zebra=True, align=None, mono_cols=()):
    """rows[0] is the header when header_row=True."""
    nr, nc = len(rows), len(rows[0])
    tbl_shape = s.shapes.add_table(nr, nc, I(x), I(y), I(w), I(row_h * nr))
    tbl = tbl_shape.table
    # kill banding style, we do it ourselves
    tblPr = tbl._tbl.tblPr
    tblPr.set("bandRow", "0")
    tblPr.set("firstRow", "1" if header_row else "0")
    for j, cw in enumerate(col_w):
        tbl.columns[j].width = I(cw)
    for i in range(nr):
        tbl.rows[i].height = I(row_h if i else row_h)
        for j in range(nc):
            cell = tbl.cell(i, j)
            cell.margin_left = I(0.11)
            cell.margin_right = I(0.07)
            cell.margin_top = I(0.03)
            cell.margin_bottom = I(0.03)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.fill.solid()
            if i == 0 and header_row:
                cell.fill.fore_color.rgb = header_fill
            elif zebra and i % 2 == 0:
                cell.fill.fore_color.rgb = PANEL
            else:
                cell.fill.fore_color.rgb = WHITE
            tf = cell.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            a = (align[j] if align else PP_ALIGN.LEFT)
            if i == 0 and header_row:
                a = (align[j] if align else PP_ALIGN.LEFT)
            p.alignment = a
            r = p.add_run()
            val = rows[i][j]
            r.text = str(val)
            r.font.size = Pt(size)
            r.font.name = MONO if (j in mono_cols and i > 0) else BODY
            if i == 0 and header_row:
                r.font.bold = True
                r.font.color.rgb = WHITE
                r.font.name = BODY
            else:
                r.font.color.rgb = INK if j == 0 else INK_SOFT
                if j == 0:
                    r.font.bold = True
                    r.font.name = BODY
    return tbl_shape


def code_block(s, x, y, w, h, lines, size=14, title=None, shrink=True):
    rect(s, x, y, w, h, fill=CODE_BG, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
    inner_w = w - 0.56
    top = y + (0.50 if title else 0.16)
    avail = h - (top - y) - 0.14
    def _paras(sz):
        return [{"runs": [(ln, {"font": MONO})], "size": sz, "line_spacing": 1.28}
                for ln in lines]
    if shrink:
        while size > 7 and _measure(_paras(size), inner_w)[0] > avail:
            size -= 0.5
    if title:
        text(s, x + 0.28, y + 0.16, w - 0.5, 0.24, title.upper(), size=9.5, bold=True,
             color=RGBColor(0x6F, 0xC8, 0xC0), font=HEAD, shrink=False)
    text(s, x + 0.28, top, inner_w, avail, _paras(size), size=size, color=CODE_FG,
         line_spacing=1.28, shrink=False)
    return top + avail


def bit_strip(s, x, y, cell=0.44, h=0.44, bits="10110100", labels=None,
              fill=ACCENT, label_color=WHITE, size=15):
    n = len(bits)
    for i, b in enumerate(bits):
        rect(s, x + i * cell, y, cell, h, fill=fill if b == "1" else WHITE,
             line=ACCENT_D if b == "1" else LINE, lw=1.0)
        text(s, x + i * cell, y + 0.09, cell, 0.28, b, size=size, bold=True,
             align=PP_ALIGN.CENTER, color=label_color if b == "1" else INK_SOFT,
             font=MONO)
    if labels:
        for i, lb in enumerate(labels):
            text(s, x + i * cell, y + h + 0.05, cell, 0.22, lb, size=9,
                 color=MUTED, align=PP_ALIGN.CENTER)


def section_tag(s, x, y, txt, color=ACCENT):
    w = max(1.0, 0.105 * len(txt) + 0.34)
    rect(s, x, y, w, 0.32, fill=color, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.25)
    text(s, x, y + 0.075, w, 0.22, txt.upper(), size=9.5, bold=True, color=WHITE,
         align=PP_ALIGN.CENTER, font=HEAD)
    return w


# ================================================================ 1 TITLE
s = slide()
rect(s, 0, 0, SW, SH, fill=DARK_BG)
# decorative bit grid, very subtle
grid_bits = ["1", "0", "1", "1", "0", "0", "1", "0", "1", "1", "0", "1"]
for i, b in enumerate(grid_bits):
    text(s, SW - 4.55 + (i % 4) * 0.95, 1.05 + (i // 4) * 0.95, 0.7, 0.7, b,
         size=46, bold=True, color=RGBColor(0x18, 0x33, 0x40),
         font=MONO, align=PP_ALIGN.CENTER)
rect(s, 0.9, 2.05, 0.62, 0.075, fill=ACCENT)
text(s, 0.9, 2.30, 8.6, 0.30, "COMPUTER ORGANIZATION AND ARCHITECTURE", size=13,
     bold=True, color=RGBColor(0x71, 0xC8, 0xC1), font=HEAD)
text(s, 0.9, 2.72, 9.0, 1.85, ["Binary Storage", "and Registers"], size=54,
     bold=True, color=WHITE, font=HEAD, line_spacing=0.98)
text(s, 0.9, 4.60, 8.2, 0.62,
     "How a computer holds a 1, a 0, and a whole number inside the CPU.",
     size=17, color=RGBColor(0xB6, 0xC7, 0xCF))
rect(s, 0.9, 5.42, 4.9, 0.02, fill=RGBColor(0x2A, 0x45, 0x54))
text(s, 0.9, 5.58, 5.2, 1.10,
     [[("Presented by  ", {"color": RGBColor(0x7E, 0x93, 0x9E)}),
       ("<Your Name>", {"color": WHITE, "bold": True})],
      [("Roll no. / Section  ", {"color": RGBColor(0x7E, 0x93, 0x9E)}),
       ("<Roll No>", {"color": WHITE, "bold": True})]],
     size=13.5, line_spacing=1.5)
text(s, 0.9, 6.72, 6.0, 0.3, "Theory Presentation  \u00b7  15 minutes", size=11,
     color=RGBColor(0x6E, 0x86, 0x92))
notes(s, """
Good morning. My topic is Binary Storage and Registers.
Two questions drive this whole presentation: first, how does a machine that only
understands ON and OFF actually keep a value? Second, where does it keep the value
while it is working on it? The answer to the first is the binary storage cell, and
the answer to the second is the register. Everything else in the CPU - the ALU, the
control unit, the buses - is built on top of these two ideas.
""")

# ================================================================ 2 AGENDA
s = slide()
y = header(s, "What we will cover", kicker="Agenda")
items = [
    ("01", "Representing data in binary", "bits, bases, and how many values fit in n bits"),
    ("02", "Binary storage elements", "flip-flops, latches, and the DRAM capacitor cell"),
    ("03", "What a register really is", "n flip-flops side by side with a common clock"),
    ("04", "Register transfer and control", "R1 \u2190 R2 notation, load enable, tri-state bus"),
    ("05", "Register file and memory hierarchy", "where registers sit, and why they are fastest"),
    ("06", "Worked example and summary", "one 8-bit register, shifted, rotated and loaded"),
]
cy = y + 0.10
for num, ttl, sub in items:
    text(s, 0.78, cy, 0.62, 0.4, num, size=22, bold=True, color=RGBColor(0xC2, 0xD4, 0xDA),
         font=HEAD)
    text(s, 1.48, cy + 0.02, 5.3, 0.3, ttl, size=17.5, bold=True, color=INK)
    text(s, 6.95, cy + 0.06, 5.6, 0.3, sub, size=13.5, color=INK_SOFT)
    if num != "06":
        rect(s, 0.78, cy + 0.62, 11.8, 0.008, fill=RGBColor(0xE9, 0xEF, 0xF2))
    cy += 0.83
footer(s, 2)
notes(s, """
Here is the route. We start from how values are written in binary, then look at the
physical element that stores one bit, then scale that up to n bits to get a register.
After that we look at how registers talk to each other - register transfer notation,
the load signal, and the shared tri-state bus. Finally we place registers in the
memory hierarchy and finish with a small worked example.
""")

# ================================================================ 3 WHY BINARY
s = slide()
y = header(s, "Why binary? What can one bit hold?",
           kicker="01 \u00b7 Representation",
           subtitle="Digital hardware is cheapest and most reliable when it only has to distinguish two states.")
card(s, 0.75, y + 0.12, 3.75, 1.75, "Two stable states",
     "A transistor is reliably fully OFF or fully ON. Adding a third or fourth "
     "level means reading a tiny voltage difference \u2014 noise eats it.")
card(s, 4.78, y + 0.12, 3.75, 1.75, "Noise immunity",
     "A 0 or 1 is a range, not an exact voltage. Anything below ~0.8 V reads 0, "
     "anything above ~2.0 V reads 1, so small disturbances are harmless.", accent=AMBER)
card(s, 8.81, y + 0.12, 3.75, 1.75, "Boolean algebra",
     "Two-valued logic has a complete, simple algebra (AND, OR, NOT), so circuits "
     "can be designed and minimised mathematically.", accent=ACCENT_D)

text(s, 0.75, y + 2.06, 5.6, 0.30, "One bit, two values", size=15, bold=True,
     color=INK, font=HEAD)
rect(s, 0.75, y + 2.44, 2.15, 1.00, fill=PANEL, line=LINE)
text(s, 0.75, y + 2.56, 2.15, 0.48, "0", size=30, bold=True, color=ACCENT_D,
     align=PP_ALIGN.CENTER, font=MONO, shrink=False)
text(s, 0.75, y + 3.12, 2.15, 0.24, "LOW / OFF / FALSE", size=9.5, color=MUTED,
     align=PP_ALIGN.CENTER, shrink=False)
rect(s, 3.15, y + 2.44, 2.15, 1.00, fill=ACCENT, line=ACCENT)
text(s, 3.15, y + 2.56, 2.15, 0.48, "1", size=30, bold=True, color=WHITE,
     align=PP_ALIGN.CENTER, font=MONO, shrink=False)
text(s, 3.15, y + 3.12, 2.15, 0.24, "HIGH / ON / TRUE", size=9.5,
     color=RGBColor(0xCF, 0xE9, 0xE7), align=PP_ALIGN.CENTER, shrink=False)
rect(s, 0.75, y + 3.62, 4.55, 0.62, fill=PANEL_2)
text(s, 0.95, y + 3.74, 4.20, 0.40,
     [[("Two states -> ", {"bold": True, "color": ACCENT_D}),
       ("one bit can answer exactly one yes/no question.", {"color": INK_SOFT})]],
     size=11, shrink=False)

text(s, 6.15, y + 2.06, 6.4, 0.30, "So how much can n bits hold?", size=15, bold=True,
     color=INK, font=HEAD)
table(s, 6.15, y + 2.44, 6.35,
      [["Bits (n)", "Distinct patterns", "Unsigned range", "Typical use"],
       ["1", "2", "0 \u2013 1", "flag"],
       ["4", "16", "0 \u2013 15", "one hex digit"],
       ["8", "256", "0 \u2013 255", "byte / ASCII char"],
       ["16", "65,536", "0 \u2013 65,535", "half-word"],
       ["32", "4.29 \u00d7 10\u2079", "0 \u2013 2\u00b3\u00b2\u22121", "word / IPv4"],
       ["64", "1.84 \u00d7 10\u00b9\u2079", "0 \u2013 2\u2076\u2074\u22121", "long / address"]],
      [0.85, 1.85, 1.95, 1.70], size=11.5, row_h=0.315, mono_cols=(0, 1, 2))
text(s, 6.15, y + 4.74, 6.35, 0.30, "In general: n bits \u2192 2\u207f distinct patterns.",
     size=13, bold=True, color=ACCENT_D, shrink=False)
footer(s, 3)
notes(s, """
Why binary at all? Because a transistor that only has to be fully off or fully on is
cheap, fast and immune to small noise. If we tried to store four voltage levels in
one cell, a little noise would corrupt the value.
A single bit gives us exactly two values. With n bits we get two to the power n
patterns. Eight bits is 256 - enough for a character in ASCII. Thirty-two bits gives
about 4.3 billion patterns, which is why IPv4 ran out of addresses. This table is
worth remembering; it explains why word sizes are 8, 16, 32 and 64.
""")

# ================================================================ 4 BASES
s = slide()
y = header(s, "Writing the same value in different bases",
           kicker="01 \u00b7 Representation",
           subtitle="Binary is what the hardware stores; octal and hex are just compact ways for humans to write it.")
text(s, 0.75, y + 0.10, 5.9, 0.3, "One byte = 8 bits = 2 hex digits", size=15,
     bold=True, color=INK, font=HEAD)
bit_strip(s, 0.75, y + 0.55, cell=0.50, h=0.50, bits="10110100", size=16,
          labels=["b7", "b6", "b5", "b4", "b3", "b2", "b1", "b0"])
text(s, 0.75, y + 1.24, 4.2, 0.26, "MSB \u2190 position weights \u2192 LSB", size=9.5,
     color=MUTED)
table(s, 0.75, y + 1.62, 5.95,
      [["Base", "Name", "Digits used", "Same value"],
       ["2", "Binary", "0, 1", "10110100\u2082"],
       ["8", "Octal", "0 \u2013 7", "264\u2088"],
       ["10", "Decimal", "0 \u2013 9", "180"],
       ["16", "Hexadecimal", "0 \u2013 9, A \u2013 F", "B4\u2081\u2086"]],
      [0.80, 1.55, 1.85, 1.75], size=12.5, row_h=0.36, mono_cols=(0, 3))

text(s, 7.05, y + 0.10, 5.5, 0.30, "Why hex is everywhere", size=15, bold=True,
     color=INK, font=HEAD, shrink=False)
bullets(s, 7.05, y + 0.56, 5.45, [
    ("4 bits = 1 hex digit. ", "Grouping is mechanical \u2014 no mental arithmetic."),
    ("Shorter to read. ", "0xB4 beats 10110100 in a memory dump."),
    ("Used for ", "addresses, machine code, colour codes (#0E7C86)."),
], size=13.5, gap=0.72)

rect(s, 7.05, y + 2.86, 5.45, 1.55, fill=PANEL, line=LINE)
text(s, 7.28, y + 3.02, 5.00, 0.24, "CONVERT 10110100\u2082 BY HAND", size=9.5,
     bold=True, color=ACCENT, font=HEAD, shrink=False)
text(s, 7.28, y + 3.34, 5.00, 0.95,
     [[("weights:  ", {"color": MUTED}),
       ("128 + 32 + 16 + 4 = 180", {"bold": True, "font": MONO})],
      [("hex:      ", {"color": MUTED}),
       ("1011 0100  \u2192  B 4  \u2192  0xB4", {"bold": True, "font": MONO})]],
     size=12, line_spacing=1.5, shrink=False)

# left column: notation cheat-sheet fills the lower space
rect(s, 0.75, y + 3.66, 5.95, 0.98, fill=PANEL_2)
text(s, 0.96, y + 3.78, 5.55, 0.24, "NOTATION YOU MAY SEE IN TEXTBOOKS", size=9,
     bold=True, color=ACCENT, font=HEAD, shrink=False)
text(s, 0.96, y + 4.04, 5.55, 0.26,
     [[("1011 0100\u2082", {"font": MONO, "bold": True, "color": ACCENT_D}),
       ("  =  ", {"color": MUTED}),
       ("0b1011_0100", {"font": MONO, "bold": True, "color": ACCENT_D}),
       ("  =  ", {"color": MUTED}),
       ("0xB4", {"font": MONO, "bold": True, "color": ACCENT_D})]],
     size=10.5, shrink=False)
text(s, 0.96, y + 4.32, 5.55, 0.26, "three ways to write the same byte",
     size=9.5, italic=True, color=MUTED, shrink=False)
footer(s, 4)
notes(s, """
The same eight bits can be written four ways. Binary is what the register physically
holds. Octal groups three bits, which is why old machines used it. Hexadecimal groups
four bits, so one byte is exactly two hex digits - that is the reason hex is used in
debuggers and memory dumps.
To convert by hand, add the weights of the 1 bits: 128 plus 32 plus 16 plus 4 gives
180. For hex, split the byte into two nibbles: 1011 is B, 0100 is 4, so 0xB4.
""")

# ================================================================ 5 STORAGE UNITS
s = slide()
y = header(s, "From a bit to a terabyte", kicker="01 \u00b7 Representation",
           subtitle="Storage is counted in powers of two, because addressing is binary.")
units = [
    ("1 bit", "a single 0 or 1", "smallest unit", 0.95),
    ("1 nibble", "4 bits", "1 hex digit", 1.25),
    ("1 byte", "8 bits", "1 character", 1.55),
    ("1 word", "16 / 32 / 64 bits", "one CPU operation", 1.85),
]
cx = 0.75
for name, sub, note, w in units:
    rect(s, cx, y + 0.08, w, 1.42, fill=PANEL, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.07)
    text(s, cx, y + 0.24, w, 0.34, name, size=15, bold=True, color=ACCENT_D,
         align=PP_ALIGN.CENTER)
    text(s, cx + 0.08, y + 0.64, w - 0.16, 0.3, sub, size=11.5, color=INK,
         align=PP_ALIGN.CENTER)
    text(s, cx + 0.06, y + 0.98, w - 0.12, 0.34, note, size=10, color=MUTED,
         align=PP_ALIGN.CENTER)
    if name != "1 word":
        arrow(s, cx + w + 0.10, y + 0.79, cx + w + 0.34, y + 0.79, color=MUTED, w=1.2)
    cx += w + 0.44

table(s, 0.75, y + 1.80, 6.55,
      [["Size", "Value in bytes", "Power of two"],
       ["1 KB", "1,024", "2\u00b9\u2070"],
       ["1 MB", "1,048,576", "2\u00b2\u2070"],
       ["1 GB", "1,073,741,824", "2\u00b3\u2070"],
       ["1 TB", "1.0995 \u00d7 10\u00b9\u00b2", "2\u2074\u2070"]],
      [1.35, 2.85, 2.35], size=12.5, row_h=0.365, mono_cols=(1, 2))

card(s, 7.70, y + 1.80, 4.85, 1.28, "Why 1024 and not 1000?",
     "An address of k bits can select exactly 2\u1d4f locations, so memory sizes come "
     "out as powers of two. 1 KB = 2\u00b9\u2070 bytes.", accent=AMBER, body_size=12.5)
card(s, 7.70, y + 3.22, 4.85, 1.28, "Word length matters",
     "It is the number of bits the CPU moves and processes at once. Wider word \u2192 "
     "more data per cycle, larger registers, but more hardware.", accent=ACCENT_D,
     body_size=12.5)
footer(s, 5)
notes(s, """
Now the units. A nibble is four bits, a byte is eight, and a word is the natural
chunk the processor works on - 16, 32 or 64 bits depending on the architecture.
Note that 1 KB is 1024 bytes, not 1000. That is not an accident: with k address
bits you can select exactly 2 to the k locations, so capacities naturally land on
powers of two. Disk manufacturers use 1000, which is why a 500 GB drive shows as
about 465 GiB in your file manager.
""")

# ================================================================ 6 STORAGE ELEMENTS
s = slide()
y = header(s, "Where does one bit physically live?",
           kicker="02 \u00b7 Storage elements",
           subtitle="Any circuit that can hold a state stably is a bit cell. Three common ones:")

# (a) SR latch  ---------------------------------------------------------
bxx, byy = 0.75, y + 0.10
rect(s, bxx, byy, 3.85, 3.95, fill=PANEL, line=LINE, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
     radius=0.04)
section_tag(s, bxx + 0.28, byy + 0.26, "a. SR latch")
text(s, bxx + 0.28, byy + 0.70, 3.30, 0.72,
     "Two cross-coupled NOR gates. The feedback loop keeps the value alive as long as "
     "power is on.", size=11.5, color=INK_SOFT, line_spacing=1.1)

# top NOR gate
rect(s, bxx + 0.62, byy + 1.62, 1.25, 0.58, fill=WHITE, line=ACCENT_D, lw=1.25)
text(s, bxx + 0.62, byy + 1.76, 1.25, 0.30, "NOR", size=11, bold=True, color=ACCENT_D,
     align=PP_ALIGN.CENTER, font=MONO, shrink=False)
# bottom NOR gate
rect(s, bxx + 1.97, byy + 2.72, 1.25, 0.58, fill=WHITE, line=ACCENT_D, lw=1.25)
text(s, bxx + 1.97, byy + 2.86, 1.25, 0.30, "NOR", size=11, bold=True, color=ACCENT_D,
     align=PP_ALIGN.CENTER, font=MONO, shrink=False)

# R input (top gate, upper input)
arrow(s, bxx + 0.14, byy + 1.78, bxx + 0.60, byy + 1.78, color=INK_SOFT, w=1.2)
text(s, bxx + 0.16, byy + 1.52, 0.30, 0.22, "R", size=10.5, bold=True, color=INK,
     font=MONO, shrink=False)
# S input (bottom gate, lower input, from the right)
arrow(s, bxx + 3.52, byy + 3.16, bxx + 3.24, byy + 3.16, color=INK_SOFT, w=1.2)
text(s, bxx + 3.60, byy + 3.00, 0.24, 0.22, "S", size=10.5, bold=True, color=INK,
     font=MONO, shrink=False)

# Q : output of top gate -> down into bottom gate's upper input
wire(s, bxx + 1.87, byy + 1.78, bxx + 1.90, byy + 1.78)
wire(s, bxx + 1.90, byy + 1.78, bxx + 1.90, byy + 2.88)
arrow(s, bxx + 1.90, byy + 2.88, bxx + 1.95, byy + 2.88, color=ACCENT_D, w=1.2)
dot(s, bxx + 1.90, byy + 1.78)
text(s, bxx + 1.94, byy + 1.50, 0.45, 0.22, "Q", size=10.5, bold=True,
     color=ACCENT_D, font=MONO, shrink=False)

# Q-bar : output of bottom gate -> around the left -> top gate's lower input
wire(s, bxx + 1.95, byy + 3.16, bxx + 0.34, byy + 3.16, color=ACCENT_D, w=1.2)
wire(s, bxx + 0.34, byy + 3.16, bxx + 0.34, byy + 2.02, color=ACCENT_D, w=1.2)
arrow(s, bxx + 0.34, byy + 2.02, bxx + 0.60, byy + 2.02, color=ACCENT_D, w=1.2)
text(s, bxx + 0.40, byy + 2.88, 0.55, 0.22, "Q\u0305", size=10.5, bold=True,
     color=MUTED, font=MONO, shrink=False)

text(s, bxx + 0.28, byy + 3.62, 3.30, 0.30,
     "No clock: it simply stays put. Level-sensitive.", size=9.5, color=MUTED,
     shrink=False)

# (b) D flip-flop -------------------------------------------------------
bxx = 4.90
rect(s, bxx, byy, 3.85, 3.95, fill=PANEL, line=LINE, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
     radius=0.04)
section_tag(s, bxx + 0.28, byy + 0.26, "b. D flip-flop")
text(s, bxx + 0.28, byy + 0.70, 3.30, 0.72,
     "The industry standard 1-bit cell. Captures D only at a clock edge, so timing is "
     "predictable.", size=11.5, color=INK_SOFT, line_spacing=1.1)

rect(s, bxx + 1.10, byy + 1.62, 1.70, 1.30, fill=WHITE, line=ACCENT_D, lw=1.5)
text(s, bxx + 1.10, byy + 2.06, 1.70, 0.32, "D  FF", size=13.5, bold=True,
     color=ACCENT_D, align=PP_ALIGN.CENTER, font=MONO, shrink=False)
# D input
wire(s, bxx + 0.45, byy + 1.86, bxx + 1.10, byy + 1.86)
text(s, bxx + 0.14, byy + 1.64, 0.34, 0.22, "D", size=10.5, bold=True, color=INK,
     font=MONO, shrink=False)
# clock input with edge triangle
wire(s, bxx + 0.45, byy + 2.58, bxx + 1.10, byy + 2.58)
tri = s.shapes.add_shape(MSO_SHAPE.ISOSCELES_TRIANGLE, I(bxx + 1.06), I(byy + 2.50),
                         I(0.15), I(0.15))
tri.rotation = 270
tri.fill.solid()
tri.fill.fore_color.rgb = ACCENT_D
tri.line.fill.background()
_no_shadow(tri)
text(s, bxx + 0.02, byy + 2.46, 0.42, 0.22, "CLK", size=10, bold=True, color=INK,
     font=MONO, shrink=False)
# outputs
wire(s, bxx + 2.80, byy + 1.86, bxx + 3.32, byy + 1.86, color=ACCENT_D)
text(s, bxx + 3.30, byy + 1.64, 0.40, 0.22, "Q", size=10.5, bold=True,
     color=ACCENT_D, font=MONO, shrink=False)
wire(s, bxx + 2.80, byy + 2.50, bxx + 3.20, byy + 2.50, color=ACCENT_D)
text(s, bxx + 3.16, byy + 2.56, 0.50, 0.22, "Q\u0305", size=10.5, bold=True,
     color=MUTED, font=MONO, shrink=False)

text(s, bxx + 0.28, byy + 3.08, 3.30, 0.80,
     [[("Q(next) = D", {"bold": True, "font": MONO, "size": 11})],
      [("Edge-triggered: changes only on CLK 0 \u2192 1. This is what a register "
        "is built from.", {"size": 9.5})]],
     size=9.5, color=MUTED, line_spacing=1.15, shrink=False)

# (c) DRAM cell ---------------------------------------------------------
bxx = 9.05
rect(s, bxx, byy, 3.55, 3.95, fill=PANEL, line=LINE, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
     radius=0.04)
section_tag(s, bxx + 0.28, byy + 0.26, "c. DRAM cell", color=AMBER)
text(s, bxx + 0.28, byy + 0.70, 3.00, 0.34,
     "One transistor and one capacitor hold the bit.", size=11.5, color=INK_SOFT,
     line_spacing=1.1)

# bit line (horizontal) with the transistor sitting on it
wire(s, bxx + 0.40, byy + 1.86, bxx + 2.40, byy + 1.86)
text(s, bxx + 2.44, byy + 1.74, 0.95, 0.22, "bit line", size=9, color=MUTED,
     shrink=False)
rect(s, bxx + 1.22, byy + 1.70, 0.36, 0.32, fill=ACCENT_D)
# word line (vertical) to the transistor gate
wire(s, bxx + 1.40, byy + 1.70, bxx + 1.40, byy + 1.30, color=AMBER, w=1.3)
wire(s, bxx + 1.40, byy + 1.30, bxx + 2.55, byy + 1.30, color=AMBER, w=1.3)
text(s, bxx + 1.40, byy + 1.06, 1.20, 0.22, "word line", size=9, color=AMBER,
     shrink=False)
# capacitor below
wire(s, bxx + 1.40, byy + 2.02, bxx + 1.40, byy + 2.32, color=ACCENT_D, w=1.2)
wire(s, bxx + 1.12, byy + 2.32, bxx + 1.68, byy + 2.32, color=ACCENT_D, w=2.2)
wire(s, bxx + 1.12, byy + 2.52, bxx + 1.68, byy + 2.52, color=ACCENT_D, w=2.2)
wire(s, bxx + 1.40, byy + 2.52, bxx + 1.40, byy + 2.74, color=ACCENT_D, w=1.2)
wire(s, bxx + 0.95, byy + 2.74, bxx + 1.85, byy + 2.74, color=MUTED, w=1.4)
text(s, bxx + 1.78, byy + 2.28, 0.42, 0.22, "Cs", size=10, bold=True, color=INK,
     font=MONO, shrink=False)

text(s, bxx + 0.28, byy + 3.02, 3.00, 0.85,
     [[("Needs refreshing ~every 64 ms", {"bold": True, "size": 10.5})],
      [("The capacitor leaks, so the value must be read and rewritten. Dense and "
        "cheap, but volatile.", {"size": 9.5})]],
     size=9.5, color=MUTED, line_spacing=1.15, shrink=False)

# comparison strip
rect(s, 0.75, 6.26, 11.85, 0.56, fill=PANEL_2)
text(s, 0.95, 6.38, 11.5, 0.34,
     [[("Key idea:  ", {"bold": True, "color": ACCENT_D}),
       ("storage = a circuit that can sit stably in one of two states; the flip-flop is the "
        "building block, the capacitor is the cheap alternative.", {"color": INK_SOFT})]],
     size=11.5)
footer(s, 6)
notes(s, """
This slide answers the physical question: what actually remembers a bit?
(a) The SR latch: two NOR gates feeding each other. Because each gate drives the
other, the loop keeps its state indefinitely - it is literally a circuit that argues
with itself into a stable answer. Cheap, but level-sensitive.
(b) The D flip-flop: the workhorse. It only samples D on the rising edge of the
clock, so the whole design has a predictable rhythm. When we say a register is n
flip-flops, this is the box we mean.
(c) The DRAM cell: one transistor and one capacitor. Charge means 1. It is tiny, so
you get gigabits per chip, but the charge leaks and must be refreshed every few tens
of milliseconds. That is the trade-off between registers and main memory.
""")

# ================================================================ 7 REGISTER DEFINITION
s = slide()
y = header(s, "A register is n flip-flops sharing one clock",
           kicker="03 \u00b7 The register",
           subtitle="Definition: a group of flip-flops that stores one binary word and is read or written as a unit.")

# 4-bit register drawing
rx, ry = 2.45, y + 0.55
bit_labels = ["D\u2083", "D\u2082", "D\u2081", "D\u2080"]
q_labels = ["Q\u2083", "Q\u2082", "Q\u2081", "Q\u2080"]
cw = 1.15
GAP = 0.42
for i in range(4):
    bx = rx + i * (cw + GAP)
    rect(s, bx, ry + 0.55, cw, 1.35, fill=WHITE, line=ACCENT_D, lw=1.5,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.06)
    text(s, bx, ry + 0.88, cw, 0.5, "FF", size=17, bold=True, color=ACCENT_D,
         align=PP_ALIGN.CENTER, font=MONO)
    text(s, bx, ry + 1.48, cw, 0.22, f"bit {3-i}", size=9, color=MUTED,
         align=PP_ALIGN.CENTER)
    # D input arrow
    arrow(s, bx + cw / 2, ry + 0.12, bx + cw / 2, ry + 0.52, color=INK_SOFT, w=1.2)
    text(s, bx + cw / 2 - 0.30, ry - 0.22, 0.6, 0.24, bit_labels[i], size=12,
         bold=True, color=INK, align=PP_ALIGN.CENTER, font=MONO)
    # Q output
    wire(s, bx + cw / 2, ry + 1.92, bx + cw / 2, ry + 2.34, color=ACCENT_D)
    arrow(s, bx + cw / 2, ry + 2.24, bx + cw / 2, ry + 2.38, color=ACCENT_D, w=1.2)
    text(s, bx + cw / 2 - 0.30, ry + 2.42, 0.6, 0.24, q_labels[i], size=12, bold=True,
         color=ACCENT_D, align=PP_ALIGN.CENTER, font=MONO)

# clock line
clock_y = ry + 2.12
wire(s, rx - 0.55, clock_y, rx + 3 * (cw + GAP) + cw + 0.25, clock_y,
     color=AMBER, w=1.6)
for i in range(4):
    bx = rx + i * (cw + GAP)
    wire(s, bx + cw / 2, clock_y, bx + cw / 2, ry + 1.90, color=AMBER, w=1.2)
    dot(s, bx + cw / 2, clock_y, d=0.09, color=AMBER)
text(s, rx - 1.95, clock_y - 0.13, 0.38, 0.26, "CLK", size=12, bold=True,
     color=AMBER, font=MONO, align=PP_ALIGN.RIGHT, shrink=False)
text(s, rx - 1.95, clock_y + 0.20, 1.30, 0.60, "all flip-flops\nsample together", size=9,
     color=MUTED, line_spacing=1.1, align=PP_ALIGN.RIGHT, shrink=False)

# bracket
br_y = ry + 2.72
wire(s, rx, br_y, rx, br_y + 0.16, color=MUTED, w=1.1)
wire(s, rx + 3 * (cw + GAP) + cw, br_y, rx + 3 * (cw + GAP) + cw, br_y + 0.16,
     color=MUTED, w=1.1)
wire(s, rx, br_y + 0.16, rx + 3 * (cw + GAP) + cw, br_y + 0.16, color=MUTED, w=1.1)
text(s, rx, br_y + 0.24, 6.1, 0.3, "one 4-bit register  \u2014  value stored = Q\u2083Q\u2082Q\u2081Q\u2080",
     size=11.5, bold=True, color=INK, align=PP_ALIGN.CENTER)

text(s, 8.35, y + 0.62, 4.30, 0.3, "What this gives you", size=15, bold=True,
     color=INK, font=HEAD)
bullets(s, 8.35, y + 1.04, 4.30, [
    ("One clock, one update. ", "All bits change simultaneously, so the word is never seen half-written."),
    ("Width = number of flip-flops. ", "8-bit register = 8 FFs, 64-bit = 64 FFs."),
    ("No address needed. ", "It is selected by name, not by a memory address, so access is a single cycle."),
], size=12.5, gap=0.80)
code_block(s, 8.35, y + 3.78, 4.30, 0.66,
           ["R1 : 4-bit register,   R1 = 1011"], size=11)
footer(s, 7)
notes(s, """
Now we scale a bit up. A register is just n flip-flops wired side by side, sharing
one clock line. Because they all sample the clock edge at the same instant, the word
is written atomically - you never read a register and find half of the new value and
half of the old.
The width is not magic: an 8-bit register is eight flip-flops, a 64-bit register is
sixty-four. And crucially, a register has no address. You select it by name in the
instruction, which is why it takes a single cycle rather than a memory round trip.
""")

# ================================================================ 8 REGISTER TRANSFER
s = slide()
y = header(s, "Register transfer notation: R1 \u2190 R2",
           kicker="03 \u00b7 The register",
           subtitle="The notation that describes what happens between registers, independent of the hardware that does it.")
code_block(s, 0.75, y + 0.12, 5.55, 1.60, [
    "R2 \u2190 R1        transfer (copy)",
    "R3 \u2190 R1 + R2     add",
    "R4 \u2190 R3 \u2212 1      decrement",
    "R1 \u2190 0          clear",
], size=15, title="syntax")

text(s, 0.75, y + 1.88, 5.55, 0.86,
     [[("Read it right to left: ", {"bold": True}),
       ("the source is read and copied, the destination is overwritten. The source keeps "
        "its value \u2014 a transfer is a copy, never a move.", {})]],
     size=12.5, color=INK_SOFT, line_spacing=1.15)

text(s, 0.75, y + 2.86, 5.55, 0.30, "Every transfer happens under a control function",
     size=13.5, bold=True, color=INK, font=HEAD, shrink=False)
text(s, 0.75, y + 3.22, 5.55, 0.58,
     "A statement only executes when its enable signal is 1. In hardware this becomes a "
     "set of gate signals, not a line of code.", size=12, color=INK_SOFT,
     line_spacing=1.12)
code_block(s, 0.75, y + 3.92, 5.55, 0.66,
           ["if (T3 = 1)  then  R2 \u2190 R1"], size=14)

# right: hardware for one transfer
text(s, 6.95, y + 0.12, 5.55, 0.3, "The hardware behind one arrow", size=15,
     bold=True, color=INK, font=HEAD)

# source register
chip(s, 6.95, y + 0.60, 1.75, 0.86, "R1", "source", fill=WHITE, line=ACCENT_D,
     size=15, sub_size=9)
# destination
chip(s, 10.90, y + 0.60, 1.60, 0.86, "R2", "destination", fill=WHITE, line=ACCENT,
     size=15, sub_size=9)
# tri-state buffer
tri_x, tri_y = 9.05, y + 0.72
tri = s.shapes.add_shape(MSO_SHAPE.ISOSCELES_TRIANGLE, I(tri_x), I(tri_y), I(0.55),
                         I(0.62))
tri.rotation = 90
tri.fill.solid()
tri.fill.fore_color.rgb = RGBColor(0xE3, 0xF1, 0xEF)
tri.line.color.rgb = ACCENT_D
tri.line.width = Pt(1.2)
_no_shadow(tri)
text(s, tri_x - 0.10, tri_y + 0.66, 0.95, 0.3, "tri-state", size=8.5, color=MUTED,
     align=PP_ALIGN.CENTER)
text(s, tri_x - 0.10, tri_y + 0.90, 0.95, 0.26, "EN = T3", size=9, bold=True,
     color=ACCENT_D, align=PP_ALIGN.CENTER, font=MONO)
# wires
arrow(s, 8.70, y + 1.03, 9.03, y + 1.03, color=ACCENT_D, w=1.4)
arrow(s, 9.62, y + 1.03, 10.88, y + 1.03, color=ACCENT_D, w=1.4)
text(s, 9.66, y + 0.70, 1.25, 0.24, "bus", size=9.5, color=MUTED,
     align=PP_ALIGN.CENTER)
# load arrow down into R2
arrow(s, 11.70, y + 1.52, 11.70, y + 1.98, color=AMBER, w=1.4)
text(s, 10.95, y + 1.60, 0.70, 0.24, "LOAD", size=9, bold=True, color=AMBER,
     font=MONO, align=PP_ALIGN.CENTER)
chip(s, 10.20, y + 2.02, 3.00, 0.62, "T3 : R2in", "control signal", fill=PANEL_2,
     line=LINE, size=12, sub_size=8.5)
text(s, 6.95, y + 2.62, 5.55, 0.9,
     "Gate R1 onto the bus (its output enable), then pulse R2's load line. Nothing "
     "moves unless both control signals are asserted on the same cycle.",
     size=12, color=INK_SOFT, line_spacing=1.15)

table(s, 6.95, y + 3.40, 5.55,
      [["R1out", "R2in", "What happens"],
       ["0", "0", "bus idle, R2 unchanged"],
       ["1", "0", "R1 drives bus, nobody loads"],
       ["0", "1", "R2 loads whatever is on the bus"],
       ["1", "1", "R2 \u2190 R1  (the transfer)"]],
      [1.15, 1.15, 3.25], size=11, row_h=0.355, mono_cols=(0, 1))
footer(s, 8)
notes(s, """
Register transfer notation is the language we use to describe data movement. R1 arrow
R2 means copy R1 into R2. Read it right to left: the destination is overwritten and
the source is untouched.
Notice the condition - if T3 is 1, then the transfer happens. Real hardware has no
"if"; the T3 line simply enables the gates.
On the right is the actual circuit: R1's output passes through a tri-state buffer
whose enable is R1out, so R1 drives the shared bus. R2's load enable R2in then
captures the bus on the next clock edge. Only when both are 1 does the transfer
complete - that is the last row of the table.
""")

# ================================================================ 9 REGISTER TYPES
s = slide()
y = header(s, "Registers you will meet inside a CPU",
           kicker="03 \u00b7 The register",
           subtitle="Small in number, but each one has a specific job in the fetch\u2013decode\u2013execute cycle.")
rows = [
    ["Register", "Full name", "What it holds", "Why it exists"],
    ["PC", "Program Counter", "address of the next instruction", "keeps the program moving"],
    ["IR", "Instruction Register", "the instruction being decoded", "decouple fetch from execute"],
    ["MAR", "Memory Address Register", "address sent to memory", "drives the address bus"],
    ["MDR", "Memory Data Register", "data read / to be written", "buffers the data bus"],
    ["ACC", "Accumulator", "intermediate ALU result", "classic 1-operand machines"],
    ["SP", "Stack Pointer", "top of the stack", "calls, returns, locals"],
    ["PSW", "Status / Flags", "zero, carry, sign, overflow", "conditional branches"],
    ["GPR", "General Purpose", "operands and addresses", "compiler's scratch space"],
]
table(s, 0.75, y + 0.10, 8.55, rows, [0.92, 2.18, 2.75, 2.70], size=10.5,
      row_h=0.38, mono_cols=(0,))

text(s, 9.62, y + 0.10, 2.95, 0.3, "Three that matter most", size=14, bold=True,
     color=INK, font=HEAD)
for i, (nm, desc, col) in enumerate([
        ("PC", "Tells memory which instruction to fetch next.", ACCENT),
        ("IR", "Holds what was fetched while it is decoded.", AMBER),
        ("MAR / MDR", "The only route to memory: address out, data in.", ACCENT_D)]):
    by = y + 0.52 + i * 1.22
    rect(s, 9.62, by, 2.98, 1.05, fill=PANEL, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08)
    rect(s, 9.62, by + 0.12, 0.05, 0.81, fill=col)
    text(s, 9.80, by + 0.12, 2.60, 0.28, nm, size=12.5, bold=True, color=col, font=MONO)
    text(s, 9.80, by + 0.42, 2.62, 0.55, desc, size=10.5, color=INK_SOFT,
         line_spacing=1.1)

rect(s, 9.62, y + 4.06, 2.98, 0.68, fill=PANEL_2)
text(s, 9.78, y + 4.16, 2.70, 0.5,
     "Typical count: 16\u201332 registers per core, versus billions of memory cells.",
     size=10, color=INK_SOFT, line_spacing=1.1)
rect(s, 0.75, y + 3.72, 8.55, 0.80, fill=PANEL_2)
text(s, 0.96, y + 3.84, 8.15, 0.58,
     [[("Register file:  ", {"bold": True, "color": ACCENT_D}),
       ("all the general-purpose registers together, with two read ports and one write "
        "port, selected by register number inside the instruction.", {"color": INK_SOFT})]],
     size=10.5, shrink=False)
text(s, 0.75, y + 4.66, 8.55, 0.30,
     "All of these are the same hardware: n flip-flops with a load enable. Only the "
     "wiring around them differs.", size=11, italic=True, color=MUTED)
footer(s, 9)
notes(s, """
You do not build a CPU out of general logic alone - you give it a handful of named
registers, each with a job.
The PC holds the address of the next instruction; that is what makes a program a
sequence. The IR holds the instruction currently being decoded, which lets the fetch
unit run ahead of the execute unit. MAR and MDR are the interface to memory: MAR
drives the address bus, MDR buffers the data bus. The accumulator is the classic
one-operand design. The stack pointer makes function calls possible. The status
register makes conditional branches possible.
The important point at the bottom: all of these are the same circuit - n flip-flops
with a load enable. What differs is who is allowed to read and write them.
""")

# ================================================================ 10 PARALLEL LOAD
s = slide()
y = header(s, "Controlling a register: the load enable",
           kicker="04 \u00b7 Control",
           subtitle="A register must know when to accept new data. One extra input, Load, solves it.")

# diagram: D inputs -> mux -> FF -> Q
dx = 0.95
lab_y = y + 0.42
text(s, dx + 0.15, lab_y, 1.4, 0.26, "D inputs", size=10, bold=True, color=INK,
     font=HEAD)
text(s, dx + 3.42, lab_y, 1.6, 0.26, "2:1 MUX", size=10, bold=True, color=INK,
     font=HEAD, align=PP_ALIGN.CENTER)
text(s, dx + 6.30, lab_y, 1.6, 0.26, "flip-flop", size=10, bold=True, color=INK,
     font=HEAD, align=PP_ALIGN.CENTER)

for i in range(4):
    ry2 = y + 0.78 + i * 0.72
    text(s, dx, ry2 + 0.08, 0.34, 0.24, f"D{i}", size=10, bold=True, color=INK,
         font=MONO)
    arrow(s, dx + 0.38, ry2 + 0.20, dx + 2.62, ry2 + 0.20, color=INK_SOFT, w=1.1)
    # mux shape (trapezoid)
    m = s.shapes.add_shape(MSO_SHAPE.TRAPEZOID, I(dx + 3.30), I(ry2 - 0.04),
                           I(0.70), I(0.48))
    m.rotation = 270
    m.fill.solid()
    m.fill.fore_color.rgb = WHITE
    m.line.color.rgb = ACCENT_D
    m.line.width = Pt(1.1)
    _no_shadow(m)
    text(s, dx + 3.70, ry2 + 0.04, 0.62, 0.24, f"0/1", size=8, color=MUTED,
         align=PP_ALIGN.CENTER, font=MONO)
    arrow(s, dx + 4.12, ry2 + 0.20, dx + 5.28, ry2 + 0.20, color=ACCENT_D, w=1.1)
    rect(s, dx + 5.30, ry2 - 0.02, 0.62, 0.44, fill=WHITE, line=ACCENT_D, lw=1.1,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.10)
    text(s, dx + 5.30, ry2 + 0.09, 0.62, 0.24, "FF", size=10, bold=True,
         color=ACCENT_D, align=PP_ALIGN.CENTER, font=MONO)
    arrow(s, dx + 5.94, ry2 + 0.20, dx + 6.30, ry2 + 0.20, color=ACCENT_D, w=1.1)
    text(s, dx + 6.34, ry2 + 0.08, 0.5, 0.24, f"Q{i}", size=10, bold=True,
         color=ACCENT_D, font=MONO)

# feedback loop for hold
wire(s, dx + 6.30, y + 1.14, dx + 6.62, y + 1.14, color=MUTED, w=1.0)
wire(s, dx + 6.62, y + 1.14, dx + 6.62, y + 3.72, color=MUTED, w=1.0)
wire(s, dx + 6.62, y + 3.72, dx + 7.05, y + 3.72, color=MUTED, w=1.0)
text(s, dx + 6.70, y + 2.30, 1.1, 0.5, "hold\npath", size=8.5, color=MUTED,
     line_spacing=1.05)

# Load signal
wire(s, dx + 2.95, y + 3.86, dx + 2.95, y + 3.20, color=AMBER, w=1.6)
wire(s, dx + 2.95, y + 3.20, dx + 3.65, y + 3.20, color=AMBER, w=1.6)
text(s, dx + 1.62, y + 3.92, 1.30, 0.26, "LOAD", size=11, bold=True, color=AMBER,
     font=MONO, align=PP_ALIGN.RIGHT)
dot(s, dx + 3.65, y + 3.20, d=0.09, color=AMBER)

text(s, dx, y + 3.74, 11.4, 0.30,
     "Load = 1: the MUX passes the D inputs \u2192 register takes the new word.      "
     "Load = 0: the MUX feeds Q back into the flip-flop \u2192 value is held.",
     size=11.5, color=INK_SOFT)

table(s, 7.60, y + 1.02, 4.85,
      [["LOAD", "CLK", "Next state of register"],
       ["0", "rising", "unchanged (hold)"],
       ["1", "rising", "D\u2083D\u2082D\u2081D\u2080 (load)"],
       ["x", "no edge", "unchanged"]],
      [0.85, 0.95, 3.05], size=10.5, row_h=0.40, mono_cols=(0, 1))

rect(s, 7.60, y + 2.55, 4.85, 1.10, fill=PANEL, line=LINE,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.06)
text(s, 7.82, y + 2.68, 4.45, 0.24, "SYNCHRONOUS, NOT MAGIC", size=9, bold=True,
     color=ACCENT, font=HEAD)
text(s, 7.82, y + 2.94, 4.45, 0.60,
     "Changing D alone does nothing. The value is captured only on a clock edge while "
     "Load is high.", size=10.5, color=INK_SOFT, line_spacing=1.1)
footer(s, 10)
notes(s, """
A register with no control input is useless - it would overwrite itself on every
clock. So we add one signal, Load.
The trick is a two-to-one multiplexer in front of each flip-flop. When Load is 1 the
mux passes the external D input, so new data is captured. When Load is 0 the mux
feeds the flip-flop's own output back into its input - the register reloads its
current value, which means it holds.
Two consequences worth stressing. First, changing the data inputs alone does not
change the register; only the clock edge matters. Second, this is why write-enable
signals exist in every real processor.
""")

# ================================================================ 11 SHIFT REGISTERS
s = slide()
y = header(s, "Shift registers: moving bits, not copying them",
           kicker="04 \u00b7 Control",
           subtitle="Connect each flip-flop's output to the next one's input and bits travel one position per clock.")
# 4-stage shift register
sx, sy = 1.55, y + 0.62
PITCH, BW = 1.18, 0.94
stages = ["FF3", "FF2", "FF1", "FF0"]
for i in range(4):
    bx = sx + i * PITCH
    rect(s, bx, sy, BW, 0.92, fill=WHITE, line=ACCENT_D, lw=1.4,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.07)
    text(s, bx, sy + 0.30, BW, 0.30, stages[i], size=12, bold=True, color=ACCENT_D,
         align=PP_ALIGN.CENTER, font=MONO, shrink=False)
    if i < 3:
        arrow(s, bx + BW + 0.02, sy + 0.46, bx + PITCH - 0.04, sy + 0.46,
              color=ACCENT_D, w=1.3)
# serial in
arrow(s, sx - 0.62, sy + 0.46, sx - 0.04, sy + 0.46, color=AMBER, w=1.5)
text(s, sx - 1.35, sy + 0.02, 1.30, 0.24, "serial in", size=9, color=AMBER,
     align=PP_ALIGN.RIGHT, bold=True, shrink=False)
# serial out
wire(s, sx + 3 * PITCH + BW, sy + 0.46, sx + 3 * PITCH + BW + 0.34, sy + 0.46,
     color=ACCENT_D)
arrow(s, sx + 3 * PITCH + BW + 0.22, sy + 0.46, sx + 3 * PITCH + BW + 0.36, sy + 0.46,
      color=ACCENT_D, w=1.4)
text(s, sx + 3 * PITCH + BW + 0.42, sy + 0.30, 1.0, 0.24, "serial out", size=9,
     color=MUTED, shrink=False)

# clock rail
clock_y2 = sy + 1.26
wire(s, sx, clock_y2, sx + 3 * PITCH + BW, clock_y2, color=AMBER, w=1.5)
for i in range(4):
    bx = sx + i * PITCH + BW / 2
    wire(s, bx, clock_y2, bx, sy + 0.95, color=AMBER, w=1.1)
    dot(s, bx, clock_y2, d=0.08, color=AMBER)
text(s, sx - 1.35, clock_y2 - 0.12, 1.30, 0.24, "CLK", size=11, bold=True,
     color=AMBER, font=MONO, align=PP_ALIGN.RIGHT, shrink=False)

# timing table
text(s, 0.95, y + 2.34, 6.1, 0.30, "One clock per position \u2014 initial value 1011",
     size=12.5, bold=True, color=INK, font=HEAD, shrink=False)
table(s, 0.95, y + 2.70, 5.45,
      [["Clock", "FF3", "FF2", "FF1", "FF0", "out"],
       ["start", "1", "0", "1", "1", "\u2013"],
       ["1", "0", "1", "0", "1", "1"],
       ["2", "0", "0", "1", "0", "1"],
       ["3", "0", "0", "0", "1", "0"]],
      [1.05, 0.95, 0.95, 0.95, 0.95, 0.60], size=11, row_h=0.35,
      align=[PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.CENTER, PP_ALIGN.CENTER,
             PP_ALIGN.CENTER, PP_ALIGN.CENTER],
      mono_cols=(0, 1, 2, 3, 4, 5))
text(s, 0.95, y + 4.62, 5.45, 0.30,
     "Each column keeps its value for one clock, then passes it on.",
     size=9.5, italic=True, color=MUTED, shrink=False)

# right column: four wirings
text(s, 6.90, y + 0.02, 5.60, 0.30, "Four ways to wire the ends", size=14, bold=True,
     color=INK, font=HEAD, shrink=False)
modes = [
    ("SISO", "Serial in, serial out", "one bit at a time; delay line"),
    ("SIPO", "Serial in, parallel out", "serial link \u2192 byte"),
    ("PISO", "Parallel in, serial out", "byte \u2192 serial link"),
    ("PIPO", "Parallel in/out", "plain buffer register"),
]
my = y + 0.42
for nm, full, use in modes:
    rect(s, 6.90, my, 5.60, 0.72, fill=PANEL, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.10)
    text(s, 7.07, my + 0.22, 0.78, 0.24, nm, size=11.5, bold=True, color=ACCENT_D,
         font=MONO, shrink=False)
    text(s, 7.94, my + 0.09, 4.40, 0.26, full, size=10.5, color=INK, shrink=False)
    text(s, 7.94, my + 0.38, 4.40, 0.26, use, size=9.5, color=MUTED, shrink=False)
    my += 0.78

rect(s, 6.90, my + 0.04, 5.60, 0.66, fill=PANEL_2)
text(s, 7.09, my + 0.16, 5.20, 0.24, "SHIFT = \u00d7 2 OR \u00f7 2", size=9, bold=True,
     color=AMBER, font=HEAD, shrink=False)
text(s, 7.09, my + 0.38, 5.20, 0.26,
     "Left shift doubles; right shift halves (the bit shifted out is lost).",
     size=10, color=INK_SOFT, shrink=False)
footer(s, 11)
notes(s, """
A shift register is the same flip-flops, but each Q output is wired to the next
flip-flop's D input instead of to the outside world. One clock moves every bit one
position.
Follow the table: we start with 1011, which is 11. After one clock, FF3 receives a
0 from the serial input and the old value moves right, giving 0101 - the 1 that fell
off the end appears at the output. That is eleven divided by two.
The four configurations are just choices about which ends are parallel and which are
serial: SISO for a delay line, SIPO to receive a serial line into a byte, PISO to
transmit. And the shift itself is a cheap multiply or divide by two, which is why
compilers love powers of two.
""")

# ================================================================ 12 BUS / TRI-STATE
s = slide()
y = header(s, "Many registers, one bus: tri-state buffers",
           kicker="04 \u00b7 Control",
           subtitle="Connecting every register to every other register needs n\u00b2 wires. A shared bus needs n.")
text(s, 0.75, y + 0.10, 5.85, 0.95,
     "A tri-state buffer has three output states: 0, 1, and high-impedance (Z). "
     "High-Z means electrically disconnected, so many outputs can share one wire \u2014 "
     "provided only one of them is enabled at a time.",
     size=12, color=INK_SOFT, line_spacing=1.15)

# bus diagram
regs = [("R1", y + 0.92), ("R2", y + 1.92), ("R3", y + 2.92)]
bus_x = 4.05
for nm, ry3 in regs:
    chip(s, 0.95, ry3, 1.30, 0.62, nm, fill=WHITE, line=ACCENT_D, size=13)
    arrow(s, 2.28, ry3 + 0.31, 2.62, ry3 + 0.31, color=ACCENT_D, w=1.2)
    # buffer triangle
    t = s.shapes.add_shape(MSO_SHAPE.ISOSCELES_TRIANGLE, I(2.64), I(ry3 + 0.12),
                           I(0.34), I(0.38))
    t.rotation = 90
    t.fill.solid()
    t.fill.fore_color.rgb = RGBColor(0xE3, 0xF1, 0xEF)
    t.line.color.rgb = ACCENT_D
    t.line.width = Pt(1.0)
    _no_shadow(t)
    text(s, 2.60, ry3 + 0.52, 0.55, 0.20, nm + "out", size=7.5, color=MUTED,
         align=PP_ALIGN.CENTER)
    arrow(s, 3.00, ry3 + 0.31, bus_x - 0.06, ry3 + 0.31, color=ACCENT_D, w=1.1)

# the bus
wire(s, bus_x, y + 0.98, bus_x, y + 3.40, color=ACCENT_D, w=3.0)
for nm, ry3 in regs:
    dot(s, bus_x, ry3 + 0.31, d=0.10, color=ACCENT_D)
text(s, bus_x + 0.06, y + 3.42, 2.5, 0.26, "common bus (one word wide)", size=9.5,
     color=MUTED)

# destination register
rect(s, 5.15, y + 1.55, 1.55, 0.95, fill=WHITE, line=ACCENT, lw=1.5,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.07)
text(s, 5.15, y + 1.78, 1.55, 0.30, "R4", size=14, bold=True, color=ACCENT,
     align=PP_ALIGN.CENTER, font=MONO)
text(s, 5.15, y + 2.08, 1.55, 0.22, "destination", size=8.5, color=MUTED,
     align=PP_ALIGN.CENTER)
arrow(s, bus_x, y + 2.02, 5.13, y + 2.02, color=ACCENT, w=1.4)

# rules
text(s, 7.20, y + 0.10, 5.40, 0.30, "The one rule that must never break",
     size=13.5, bold=True, color=INK, font=HEAD)
text(s, 7.20, y + 0.44, 5.40, 0.55,
     "Exactly one output enabled at a time. Two drivers on one wire = bus contention: "
     "a short circuit, not just a wrong value.", size=11.5, color=INK_SOFT,
     line_spacing=1.12)
table(s, 7.20, y + 1.14, 5.40,
      [["R1out", "R2out", "R3out", "Bus state"],
       ["1", "0", "0", "carries R1  \u2713"],
       ["0", "1", "0", "carries R2  \u2713"],
       ["0", "0", "0", "floating (Z)"],
       ["1", "1", "0", "contention  \u2717"]],
      [1.10, 1.10, 1.10, 2.10], size=10.5, row_h=0.36, mono_cols=(0, 1, 2),
      align=[PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.LEFT])

rect(s, 7.20, y + 3.02, 5.40, 0.78, fill=PANEL_2)
text(s, 7.38, y + 3.14, 5.05, 0.55,
     [[("Cost of a bus: ", {"bold": True, "color": ACCENT_D}),
       ("one transfer per cycle, but only one word wide \u2014 so wide buses and "
        "multiple buses are how CPUs get more done per clock.", {"color": INK_SOFT})]],
     size=10.5, line_spacing=1.12)
footer(s, 12)
notes(s, """
If every register had a dedicated path to every other register, the wire count grows
as n squared. Instead, all registers share a single common bus.
The enabling element is the tri-state buffer. Besides outputting 0 and 1 it has a
third state, high impedance - it looks like an open circuit. So several outputs can
sit on one wire, as long as only one is enabled.
The truth table on the right shows why exactly one enable must be high. Two drivers
at once is bus contention: one gate tries to pull the line to 5 volts while another
pulls it to 0, and the current can damage the chip.
""")

# ================================================================ 13 FILE & HIERARCHY
s = slide()
y = header(s, "Where registers sit: the memory hierarchy",
           kicker="05 \u00b7 Placement",
           subtitle="Same bit, very different cost. Registers trade capacity for speed.")

# pyramid-ish bars
bars = [
    ("Registers", "16\u201332 per core \u00b7 < 1 ns \u00b7 flip-flop", 2.55, ACCENT_D),
    ("Cache (L1/L2/L3)", "KB\u2013MB \u00b7 1\u201310 ns \u00b7 SRAM", 3.6, ACCENT),
    ("Main memory (RAM)", "GB \u00b7 50\u2013100 ns \u00b7 DRAM + refresh", 5.2, AMBER),
    ("SSD / HDD", "TB \u00b7 \u00b5s\u2013ms \u00b7 block device", 6.6, MUTED),
]
by = y + 0.16
maxw = 6.9
for name, meta, w, col in bars:
    h = 0.92
    rect(s, 0.75, by, w, h, fill=col, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.07)
    text(s, 0.98, by + 0.15, w - 0.4, 0.30, name, size=13.5, bold=True, color=WHITE)
    text(s, 0.98, by + 0.48, w - 0.4, 0.26, meta, size=9,
         color=RGBColor(0xE6, 0xF2, 0xF1))
    by += 1.06
text(s, 0.75, by + 0.02, 6.9, 0.28, "\u2190 faster, smaller, costlier per bit          "
     "slower, larger, cheaper \u2192", size=9.5, color=MUTED)

# comparison table
text(s, 7.85, y + 0.10, 4.75, 0.3, "Register vs. main memory", size=14.5, bold=True,
     color=INK, font=HEAD)
table(s, 7.85, y + 0.50, 4.75,
      [["", "Register", "RAM cell"],
       ["Element", "flip-flop", "cap. + FET"],
       ["Select", "by name", "by address"],
       ["Access", "< 1 cycle", "many cycles"],
       ["Capacity", "bytes", "gigabytes"],
       ["Volatile", "yes", "yes (refresh)"]],
      [1.15, 1.75, 1.85], size=10, row_h=0.44)

card(s, 7.85, y + 3.30, 4.75, 1.18, "Why not make all memory flip-flops?",
     "A flip-flop is ~6 transistors per bit; a DRAM cell is 1 transistor + 1 "
     "capacitor. Same bit, ~6\u00d7 the area and far more heat.", accent=AMBER,
     body_size=10.5, title_size=11.5)
text(s, 7.85, y + 4.62, 4.75, 0.30,
     "Registers exist because the CPU cannot wait 100 ns for every operand.",
     size=10.5, italic=True, color=MUTED)
footer(s, 13)
notes(s, """
Now the placement question. The bit stored in a register and the bit stored in RAM
are logically identical, but physically very different.
A register is built from flip-flops sitting inside the CPU; it is selected by name
and read in a fraction of a cycle. Cache is SRAM, a few nanoseconds. Main memory is
DRAM, tens of nanoseconds. Disk is microseconds to milliseconds.
Why not make everything registers? Because a flip-flop costs about six transistors
per bit while a DRAM cell costs one transistor and one capacitor. You could not fit
gigabytes on a chip that way, and the wiring would dominate.
""")

# ================================================================ 14 WORKED EXAMPLE
s = slide()
y = header(s, "Worked example: one 8-bit register",
           kicker="06 \u00b7 Example",
           subtitle="R1 = 0000 1101 (decimal 13). What do the control signals make it do?")
ops = [
    ("LOAD R1 \u2190 11010110", "1101 0110", "214",
     "Load = 1: the whole word is captured on the clock edge."),
    ("SHL  R1, 1", "0001 1010", "26",
     "Left shift: bits move left, 0 enters at LSB \u2192 \u00d72."),
    ("SHR  R1, 1", "0000 0110", "6",
     "Right shift: bits move right, MSB filled with 0 \u2192 \u00f72."),
    ("ROL  R1, 1", "1000 0110", "134",
     "Rotate: the bit leaving MSB re-enters at LSB \u2014 nothing lost."),
]
oy = y + 0.14
for title_, bits, dec, expl in ops:
    rect(s, 0.75, oy, 7.10, 1.02, fill=PANEL, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.06)
    text(s, 0.98, oy + 0.15, 2.30, 0.26, title_, size=10.5, bold=True,
         color=ACCENT_D, font=MONO, shrink=False)
    text(s, 0.98, oy + 0.45, 2.20, 0.44, expl, size=9, color=INK_SOFT,
         line_spacing=1.05)
    bit_strip(s, 3.42, oy + 0.24, cell=0.315, h=0.40, bits=bits, size=11)
    text(s, 6.28, oy + 0.22, 1.40, 0.26, f"= {dec}", size=13, bold=True, color=INK,
         font=MONO, shrink=False)
    text(s, 6.28, oy + 0.52, 1.40, 0.22, "decimal", size=8.5, color=MUTED,
         shrink=False)
    oy += 1.10

rect(s, 8.15, y + 0.14, 4.45, 4.28, fill=WHITE, line=LINE,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.04)
text(s, 8.38, y + 0.30, 4.00, 0.26, "READING THE RESULT", size=9.5, bold=True,
     color=ACCENT, font=HEAD, shrink=False)
text(s, 8.38, y + 0.62, 3.98, 3.50,
     [[("13 in binary: ", {"bold": True}),
       ("13 = 8 + 4 + 1, so bits 3, 2 and 0 are set \u2192 0000 1101.",
        {"color": INK_SOFT})],
      [("Shift left doubles: ", {"bold": True}),
       ("0000 1101 \u2192 0001 1010 = 26. Every bit weight doubled.",
        {"color": INK_SOFT})],
      [("Shift right halves: ", {"bold": True}),
       ("the 1 shifted out past bit 0 is lost, so 13 / 2 = 6, not 6.5.",
        {"color": INK_SOFT})],
      [("Rotate preserves bits: ", {"bold": True}),
       ("the 1 leaving the left end returns on the right, so the number of 1s "
        "never changes.", {"color": INK_SOFT})]],
     size=10.5, line_spacing=1.16, space_after=7)
text(s, 8.38, y + 4.06, 4.00, 0.26, "Same hardware, different control signals.",
     size=9.5, italic=True, color=MUTED, shrink=False)
footer(s, 14)
notes(s, """
Let us put the pieces together on one register holding 0000 1101, which is 13.
A load with 11010110 overwrites the whole word - that is what the parallel load
enable buys us.
A left shift gives 0001 1010, which is 26 - exactly double. A right shift gives
0000 0110, which is 6; the half that did not fit is lost, so this is truncating
division.
A rotate is different: the bit pushed off the left end comes back in on the right,
giving 10000110 = 134. Nothing is lost.
The point of this slide is that all four operations used the same eight flip-flops.
Only the control signals and the wiring around them changed.
""")

# ================================================================ 15 SUMMARY
s = slide()
y = header(s, "Summary", kicker="Recap",
           subtitle="Five sentences that carry the whole topic.")
pts = [
    ("01", "Binary is a hardware decision.",
     "Two stable states are cheap, fast and noise-tolerant; n bits give 2\u207f patterns."),
    ("02", "A bit is held by a bistable circuit.",
     "Flip-flops for speed inside the CPU, capacitors for density in DRAM."),
    ("03", "A register is n flip-flops with one clock.",
     "All bits update together, so a word is never read half-written."),
    ("04", "Control signals decide what happens.",
     "Load enable to write, tri-state enables to drive a shared bus, one driver at a time."),
    ("05", "Registers are the top of the hierarchy.",
     "Fast and tiny because they are built from flip-flops; memory is big and slow "
     "because it is built from capacitors."),
]
py = y + 0.10
for num, lead, rest in pts:
    rect(s, 0.75, py, 0.52, 0.52, fill=PANEL_2, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
         radius=0.20)
    text(s, 0.75, py + 0.12, 0.52, 0.28, num, size=12, bold=True, color=ACCENT_D,
         align=PP_ALIGN.CENTER, font=HEAD)
    text(s, 1.48, py + 0.02, 11.10, 0.32, lead, size=15, bold=True, color=INK)
    text(s, 1.48, py + 0.36, 11.10, 0.34, rest, size=12, color=INK_SOFT)
    py += 0.93
footer(s, 15)
notes(s, """
To consolidate. One: binary is not a convention, it is a hardware decision - two
states are reliable, and n bits give two to the n patterns.
Two: a bit survives because of a bistable circuit, a flip-flop or a capacitor.
Three: a register is that circuit repeated n times with a common clock, so updates
are atomic.
Four: what the register does is decided by control signals - load to write, tri-state
enables to talk on the bus.
Five: and that is exactly why the hierarchy looks the way it does - flip-flops are
fast and small in number, capacitors are slow and enormous in number.
""")

# ================================================================ 16 REFERENCES / Q&A
s = slide()
rect(s, 0, 0, SW, SH, fill=DARK_BG)
rect(s, 0.9, 1.10, 0.62, 0.07, fill=ACCENT)
text(s, 0.9, 1.26, 7.6, 0.62, "Thank you", size=40, bold=True, color=WHITE, font=HEAD)
text(s, 0.9, 1.92, 7.4, 0.36, "Questions are welcome.", size=16,
     color=RGBColor(0xB6, 0xC7, 0xCF))

text(s, 0.9, 2.72, 0.30, 0.26, "", size=10)
text(s, 0.9, 2.66, 6.9, 0.3, "SOURCES", size=10, bold=True,
     color=RGBColor(0x71, 0xC8, 0xC1), font=HEAD)
refs = [
    "M. Morris Mano, Computer System Architecture, 3rd ed. \u2014 Ch. 2 (registers, "
    "register transfer) and Ch. 4 (micro-operations).",
    "William Stallings, Computer Organization and Architecture, 10th ed. \u2014 "
    "Ch. 3 (top-level structure), Ch. 4 (cache).",
    "Patterson & Hennessy, Computer Organization and Design \u2014 Ch. 4 processor "
    "datapath and registers.",
    "NPTEL / IIT lectures on digital logic: flip-flops, registers, tri-state buses.",
]
ry = 3.02
for r in refs:
    text(s, 0.9, ry, 0.24, 0.26, "\u2022", size=11, bold=True, color=ACCENT)
    text(s, 1.20, ry, 6.55, 0.62, r, size=10.5, color=RGBColor(0xA8, 0xBC, 0xC6),
         line_spacing=1.15)
    ry += 0.68

# quick-answer panel for likely questions
text(s, 8.35, 2.66, 4.2, 0.3, "LIKELY QUESTIONS", size=10, bold=True,
     color=RGBColor(0x71, 0xC8, 0xC1), font=HEAD)
qa = [
    ("Why 2\u207f and not n\u00b2?", "Each bit doubles the patterns."),
    ("Register vs. cache?", "Register = by name, 1 cycle; cache = by address."),
    ("Why refresh DRAM?", "Capacitor charge leaks away."),
    ("Why only one bus driver?", "Two drivers short the wire."),
]
qy = 3.02
for q, a in qa:
    rect(s, 8.35, qy, 4.20, 0.72, fill=DARK_PNL, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
         radius=0.10)
    text(s, 8.55, qy + 0.09, 3.85, 0.26, q, size=10.5, bold=True, color=WHITE)
    text(s, 8.55, qy + 0.37, 3.85, 0.26, a, size=9.5,
         color=RGBColor(0x9F, 0xB6, 0xC0))
    qy += 0.82
notes(s, """
Thank you. Before questions, these are the four follow-ups I would expect, and short
answers to each.
Why two to the n? Because each additional bit doubles the number of distinct
patterns.
Register versus cache? A register is selected by name in the instruction and takes
about one cycle; cache is selected by address and takes a few cycles.
Why does DRAM need refresh? The capacitor leaks, so every cell must be read and
rewritten periodically.
And why only one bus driver? Because two enabled outputs would fight each other and
short the line.
""")

# ---------------------------------------------------------------- finish
prs.save(OUT)

print(f"saved: {OUT}")
print(f"slides: {len(prs.slides.__iter__.__self__._sldIdLst)}")
if FIT_REPORT:
    print("\nFIT WARNINGS:")
    for w in FIT_REPORT:
        print("  -", w)
else:
    print("\nno fit warnings")
