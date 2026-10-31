# -*- coding: utf-8 -*-
"""
deckkit — shared drawing helpers for the COA presentation builders.

Everything here is layout plumbing: colours, text with measured wrapping and
auto-shrink, cards, chips, tables, code blocks, wiring, arrows. Builders
import this, create slides and lay content out; nothing here is slide-specific.
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
        no_shadow(sh)
    sh.text_frame.word_wrap = True
    return sh


def no_shadow(sh):
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
    no_shadow(o)
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




def say_band(s, y, w=11.85, x=0.75, h=0.52):
    """Light band with the one plain-words sentence to say on this slide."""
    from script_8 import SLIDES  # local import: script is content, not layout
    info = next(e for e in SLIDES if e["n"] == s._arena_slide_no)
    rect(s, x, y, w, h, fill=RGBColor(0xE8, 0xF3, 0xF1))
    rect(s, x, y, 0.055, h, fill=ACCENT)
    text(s, x + 0.22, y + (h - 0.34) / 2, w - 0.42, 0.34,
         [[("SAY THIS:  ", {"bold": True, "color": ACCENT_D, "size": 10.5}),
           (info["plain"], {"color": INK, "size": 12.5})]],
         size=12.5, line_spacing=1.06, shrink=False)


def save(path):
    prs.save(path)
    print(f"saved: {path}")
    print(f"slides: {len(prs.slides._sldIdLst)}")
    if FIT_REPORT:
        print("\nFIT WARNINGS:")
        for w in FIT_REPORT:
            print("  -", w)
    else:
        print("\nno fit warnings")
    return path
