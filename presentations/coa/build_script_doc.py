# -*- coding: utf-8 -*-
"""
Build the printable presenter script from script_8.py, so the paper you hold and
the deck can never drift apart.

Output: Presenter_Script_8slides.docx
"""
import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor, Inches
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

from script_8 import SLIDES

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "Presenter_Script_8slides.docx")

INK = RGBColor(0x11, 0x21, 0x2E)
SOFT = RGBColor(0x4A, 0x5A, 0x69)
MUTED = RGBColor(0x78, 0x88, 0x97)
TEAL = RGBColor(0x0A, 0x5A, 0x62)
AMBER = RGBColor(0xB0, 0x6A, 0x00)

FONT = "Calibri"


def shade(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


def para(doc, text="", size=11, bold=False, italic=False, color=INK, space=4,
         align=None, font=FONT, space_before=0):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space)
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.line_spacing = 1.12
    if align is not None:
        p.alignment = align
    if text:
        r = p.add_run(text)
        r.font.name = font
        r.font.size = Pt(size)
        r.bold = bold
        r.italic = italic
        r.font.color.rgb = color
    return p


def rule(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(6)
    pPr = p._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "C9D6DC")
    bdr.append(bottom)
    pPr.append(bdr)


doc = Document()
sec = doc.sections[0]
sec.top_margin = Inches(0.75)
sec.bottom_margin = Inches(0.7)
sec.left_margin = Inches(0.85)
sec.right_margin = Inches(0.85)

style = doc.styles["Normal"]
style.font.name = FONT
style.font.size = Pt(11)

# ------------------------------------------------------------------ cover block
para(doc, "BINARY STORAGE AND REGISTERS", size=10, bold=True, color=TEAL,
     space=2)
para(doc, "Presenter script \u2014 8 slides, about 8 minutes", size=22, bold=True,
     space=4)
para(doc, "Read this once the night before, once in the morning. You do not need to "
          "memorise it: every slide also shows a green \u201cSAY THIS\u201d band with the "
          "one sentence you must not forget.",
     size=10.5, italic=True, color=SOFT, space=10)

# how-to box
tbl = doc.add_table(rows=1, cols=1)
tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
cell = tbl.cell(0, 0)
shade(cell, "EEF6F5")
cell.width = Inches(6.8)
how = cell.paragraphs[0]
how.paragraph_format.space_after = Pt(2)
r = how.add_run("HOW TO USE THIS SCRIPT")
r.font.name = FONT
r.font.size = Pt(9)
r.bold = True
r.font.color.rgb = TEAL

for line in [
    "1.  Each slide below gives you a plain summary, one analogy, and word-for-word "
    "lines.",
    "2.  The lines in \u201cSAY IT LIKE THIS\u201d are exactly what you can say out loud. "
    "Read them calmly; nobody expects perfect words.",
    "3.  The same lines are in the PowerPoint speaker notes, so you can present from "
    "Presenter View instead of paper.",
    "4.  If your mind goes blank: read the green SAY THIS band on the slide, then move "
    "on. That one sentence is the whole point of the slide.",
    "5.  \u201cIf asked\u201d is your safety net for the question you fear most on that "
    "slide.",
]:
    p = cell.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.05
    rr = p.add_run(line)
    rr.font.name = FONT
    rr.font.size = Pt(9.5)
    rr.font.color.rgb = INK

para(doc, "", space=6)

# opener
para(doc, "BEFORE YOU START", size=12, bold=True, color=INK, space=3,
     space_before=6)
para(doc, "Stand up, breathe out, and say: \u201cGood morning. My topic is Binary "
          "Storage and Registers.\u201d Then look at the slide, not at your notes.",
     size=10.5, color=SOFT, space=6)
para(doc, "The whole talk is one ladder: bits \u2192 the circuit that holds a bit \u2192 "
          "many of those in a row (a register) \u2192 the signals that control them \u2192 "
          "where they sit in the machine. If you keep saying \u201cand the next step "
          "builds on this\u201d, the talk holds itself together.",
     size=10.5, color=SOFT, space=10)

# ------------------------------------------------------------------ per slide
for s in SLIDES:
    doc.add_page_break()
    para(doc, f"SLIDE {s['n']}  \u00b7  {s['title'].upper()}", size=13, bold=True,
         color=TEAL, space=2)

    # plain summary
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run("IN PLAIN WORDS:  ")
    r.bold = True
    r.font.size = Pt(9.5)
    r.font.color.rgb = TEAL
    r.font.name = FONT
    r2 = p.add_run(s["plain"])
    r2.font.size = Pt(11)
    r2.font.name = FONT
    r2.font.color.rgb = INK

    if s["analogy"]:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(6)
        r = p.add_run("ANALOGY:  ")
        r.bold = True
        r.font.size = Pt(9.5)
        r.font.color.rgb = AMBER
        r.font.name = FONT
        r2 = p.add_run(s["analogy"])
        r2.italic = True
        r2.font.size = Pt(10.5)
        r2.font.name = FONT
        r2.font.color.rgb = SOFT

    para(doc, "SAY IT LIKE THIS", size=9.5, bold=True, color=MUTED, space=2,
         space_before=4)
    for line in s["script"]:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.15
        r = p.add_run(line)
        r.font.name = FONT
        r.font.size = Pt(11)

    if s["if_asked"]:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(4)
        r = p.add_run("IF ASKED:  ")
        r.bold = True
        r.font.size = Pt(9.5)
        r.font.color.rgb = AMBER
        r.font.name = FONT
        r2 = p.add_run(s["if_asked"])
        r2.font.size = Pt(10)
        r2.font.name = FONT
        r2.font.color.rgb = SOFT

    if s["transition"]:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(8)
        r = p.add_run("NEXT:  ")
        r.bold = True
        r.font.size = Pt(9.5)
        r.font.color.rgb = TEAL
        r.font.name = FONT
        r2 = p.add_run(s["transition"])
        r2.italic = True
        r2.font.size = Pt(10.5)
        r2.font.name = FONT
        r2.font.color.rgb = SOFT

# ------------------------------------------------------------------ cheat sheet
doc.add_page_break()
para(doc, "ONE-PAGE CHEAT SHEET", size=15, bold=True, color=INK, space=2)
para(doc, "The facts an examiner may ask for, in the order you meet them.",
     size=10, italic=True, color=SOFT, space=8)

facts = [
    ("Bit", "one binary digit: 0 or 1"),
    ("n bits", "give 2\u207f different values (8 bits = 256)"),
    ("1 KB / MB / GB", "2\u00b9\u2070 / 2\u00b2\u2070 / 2\u00b3\u2070 bytes"),
    ("Byte", "8 bits = 2 hex digits, e.g. 1011 0100 = 0xB4 = 180"),
    ("Flip-flop", "holds 1 bit, ~6 transistors, updates on a clock edge, no refresh"),
    ("DRAM cell", "1 transistor + 1 capacitor, needs refresh (~64 ms), very dense"),
    ("Register", "n flip-flops on one common clock, selected by name, no address"),
    ("Load enable", "1 = take new data, 0 = hold the old value"),
    ("Shift left / right", "multiply by 2 / divide by 2 (remainder lost)"),
    ("Rotate", "like a shift, but the bit that falls off one end returns at the other"),
    ("Tri-state buffer", "outputs 0, 1, or high-Z (disconnected)"),
    ("Bus rule", "exactly one driver at a time; two = contention / short circuit"),
    ("Hierarchy", "registers < cache < RAM < disk in speed, and the reverse in size"),
    ("Register transfer", "R2 \u2190 R1 copies R1 into R2; R1 keeps its value"),
]
tbl = doc.add_table(rows=len(facts), cols=2)
tbl.style = "Table Grid"
for i, (k, v) in enumerate(facts):
    c0, c1 = tbl.rows[i].cells
    c0.width = Inches(1.75)
    c1.width = Inches(5.0)
    p0 = c0.paragraphs[0]
    p0.paragraph_format.space_after = Pt(2)
    r0 = p0.add_run(k)
    r0.bold = True
    r0.font.size = Pt(10)
    r0.font.name = FONT
    p1 = c1.paragraphs[0]
    p1.paragraph_format.space_after = Pt(2)
    r1 = p1.add_run(v)
    r1.font.size = Pt(10)
    r1.font.name = FONT
    if i == 0:
        shade(c0, "EEF6F5")
        shade(c1, "EEF6F5")

para(doc, "", space=8)
para(doc, "IF YOU FORGET EVERYTHING ELSE", size=11, bold=True, color=TEAL,
     space=2, space_before=6)
para(doc, "\u201cA bit is a switch. A flip-flop is a circuit that remembers the switch. "
          "A register is many flip-flops in a row. Control signals decide when they "
          "change and who gets to use the shared wire.\u201d",
     size=11, italic=True, color=INK, space=8)

para(doc, "TIMING", size=11, bold=True, color=TEAL, space=2, space_before=4)
para(doc, "Title 15 s \u00b7 agenda 20 s \u00b7 binary 90 s \u00b7 storage elements 110 s "
          "\u00b7 register 90 s \u00b7 control 100 s \u00b7 hierarchy + example 100 s "
          "\u00b7 summary 40 s \u2248 8 minutes, leaving time for questions.",
     size=10, color=SOFT, space=4)

doc.save(OUT)
print("saved:", OUT)
