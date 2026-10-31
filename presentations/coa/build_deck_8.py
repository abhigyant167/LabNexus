# -*- coding: utf-8 -*-
"""
Build the CONDENSED 8-slide version of "Binary Storage and Registers".

Same topic, same speaker notes, half the slides: related sections are merged so
each slide carries one clear idea. Uses deckkit for all drawing helpers.

Output: presentations/coa/Binary_Storage_and_Registers_8slides_COA.pptx
"""
import os

from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

from script_8 import SLIDES as SCRIPT
from deckkit import (  # noqa: F401
    prs, SW, SH, INK, INK_SOFT, MUTED, ACCENT, ACCENT_D, AMBER,
    PANEL, PANEL_2, LINE, WHITE, DARK_BG, DARK_PNL, CODE_BG, CODE_FG,
    BODY, MONO, HEAD, RGBColor, I, slide, text, bullets, header, footer,
    notes, arrow, wire, dot, chip, card, table, code_block, bit_strip,
    section_tag, rect, save, no_shadow, say_band,
)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "Binary_Storage_and_Registers_8slides_COA.pptx")

# ============================================================ 1 · TITLE
_slide_no = 0


def new_slide():
    global _slide_no
    _slide_no += 1
    sh = slide()
    sh._arena_slide_no = _slide_no
    return sh


s = new_slide()
rect(s, 0, 0, SW, SH, fill=DARK_BG)
grid_bits = ["1", "0", "1", "1", "0", "0", "1", "0", "1", "1", "0", "1"]
for i, b in enumerate(grid_bits):
    text(s, SW - 4.55 + (i % 4) * 0.95, 1.05 + (i // 4) * 0.95, 0.7, 0.7, b,
         size=46, bold=True, color=RGBColor(0x18, 0x33, 0x40), font=MONO,
         align=PP_ALIGN.CENTER)
rect(s, 0.9, 2.05, 0.62, 0.075, fill=ACCENT)
text(s, 0.9, 2.30, 8.6, 0.30, "COMPUTER ORGANIZATION AND ARCHITECTURE", size=13,
     bold=True, color=RGBColor(0x71, 0xC8, 0xC1), font=HEAD)
text(s, 0.9, 2.72, 9.0, 1.85, ["Binary Storage\nand Registers"], size=54,
     bold=True, color=WHITE, font=HEAD, line_spacing=0.98)
text(s, 0.9, 4.60, 8.2, 0.62,
     "How a computer holds a 1, a 0, and a whole number inside the CPU.",
     size=17, color=RGBColor(0xB6, 0xC7, 0xCF))
rect(s, 0.9, 5.42, 4.9, 0.02, fill=RGBColor(0x2A, 0x45, 0x54))
text(s, 0.9, 5.58, 5.2, 1.05,
     [[("Presented by  ", {"color": RGBColor(0x7E, 0x93, 0x9E)}),
       ("<Your Name>", {"color": WHITE, "bold": True})],
      [("Roll no. / Section  ", {"color": RGBColor(0x7E, 0x93, 0x9E)}),
       ("<Roll No>", {"color": WHITE, "bold": True})]],
     size=13.5, line_spacing=1.5)
text(s, 0.9, 6.72, 6.0, 0.30, "Theory Presentation  \u00b7  8 slides", size=11,
     color=RGBColor(0x6E, 0x86, 0x92))
notes(s, "\n".join([
    "== SAY THIS (one line) ==",
    SCRIPT[0]["plain"],
    "",
    "== FULL SCRIPT ==",
    *("- " + line for line in SCRIPT[0]["script"]),
    "",
    "== IF ASKED ==",
    SCRIPT[0]["if_asked"] or "No expected question on this slide.",
]))

# ============================================================ 2 · WHAT WE COVER
s = new_slide()
y = header(s, "What we will cover", kicker="Agenda",
           subtitle="Six ideas, in the order they build on each other.")
items = [
    ("01", "Binary representation", "bits, bases, powers at work: 2\u207f patterns, KB/MB/GB/TB", ACCENT),
    ("02", "Storage elements", "SR latch, D flip-flop, DRAM capacitor \u2014 where one bit lives", ACCENT),
    ("03", "The register itself", "n flip-flops on one clock, plus the CPU's named registers", ACCENT_D),
    ("04", "Control and transfer", "R1 \u2190 R2, load enable, shift registers, tri-state bus", ACCENT_D),
    ("05", "Placement and example", "memory hierarchy, then one 8-bit register worked out", AMBER),
    ("06", "Summary", "five sentences that carry the whole topic", AMBER),
]
cy = y + 0.16
for num, ttl, sub, col in items:
    rect(s, 0.78, cy + 0.06, 0.52, 0.52, fill=col,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.20)
    text(s, 0.78, cy + 0.18, 0.52, 0.28, num, size=12, bold=True, color=WHITE,
         align=PP_ALIGN.CENTER, font=HEAD, shrink=False)
    text(s, 1.52, cy + 0.08, 4.55, 0.32, ttl, size=16.5, bold=True, color=INK,
         shrink=False)
    text(s, 6.35, cy + 0.12, 6.20, 0.30, sub, size=12.5, color=INK_SOFT, shrink=False)
    if num != "06":
        rect(s, 0.78, cy + 0.68, 11.80, 0.008, fill=RGBColor(0xE9, 0xEF, 0xF2))
    cy += 0.74
say_band(s, 6.16)
footer(s, 2)
notes(s, "\n".join([
    "== SAY THIS (one line) ==",
    SCRIPT[1]["plain"],
    "",
    "== FULL SCRIPT ==",
    *("- " + line for line in SCRIPT[1]["script"]),
    "",
    "== IF ASKED ==",
    SCRIPT[1]["if_asked"] or "No expected question on this slide.",
]))

# ============================================================ 3 · BINARY
s = new_slide()
y = header(s, "Binary: two states, and 2\u207f patterns",
           kicker="01 \u00b7 Representation",
           subtitle="Hardware is cheapest when it only has to tell two states apart \u2014 and n bits then give exactly 2\u207f values.")

text(s, 0.75, y + 0.10, 5.75, 0.30, "One byte = 8 bits = 2 hex digits",
     size=14, bold=True, color=INK, font=HEAD, shrink=False)
bit_strip(s, 0.75, y + 0.48, cell=0.44, h=0.44, bits="10110100", size=14,
          labels=["b7", "b6", "b5", "b4", "b3", "b2", "b1", "b0"])
text(s, 0.75, y + 1.04, 4.4, 0.24, "MSB \u2190 position weights \u2192 LSB", size=9.5,
     color=MUTED, shrink=False)

text(s, 0.75, y + 1.54, 5.75, 0.26, "WEIGHTS 128 \u00b7 64 \u00b7 32 \u00b7 16 \u00b7 8 \u00b7 4 \u00b7 2 \u00b7 1",
     size=9, bold=True, color=ACCENT, font=HEAD, shrink=False)
text(s, 0.75, y + 1.82, 5.75, 0.40,
     [[("128 + 32 + 16 + 4 = 180", {"color": INK_SOFT}),
       ("     1011 0100 \u2192 ", {"color": MUTED}),
       ("0xB4", {"bold": True, "font": MONO, "color": ACCENT_D})]],
     size=11.5, shrink=False)
text(s, 0.75, y + 2.24, 5.75, 0.44,
     "A 0 or 1 is a voltage range, not an exact level, so small electrical noise "
     "cannot change it.", size=10, color=MUTED, line_spacing=1.1)

table(s, 0.75, y + 2.76, 5.75,
      [["Base", "Name", "Digits", "10110100\u2082 is"],
       ["2", "Binary", "0, 1", "10110100"],
       ["8", "Octal", "0 \u2013 7", "264"],
       ["10", "Decimal", "0 \u2013 9", "180"],
       ["16", "Hex", "0 \u2013 9, A \u2013 F", "0xB4"]],
      [0.72, 1.42, 1.85, 1.76], size=11.5, row_h=0.31, mono_cols=(0, 3))

# right: 2^n table + units
text(s, 6.95, y + 0.10, 5.60, 0.30, "How many values fit in n bits?", size=14,
     bold=True, color=INK, font=HEAD, shrink=False)
table(s, 6.95, y + 0.50, 5.60,
      [["n", "Patterns", "Unsigned range", "Typical use"],
       ["1", "2", "0 \u2013 1", "flag"],
       ["8", "256", "0 \u2013 255", "byte / ASCII"],
       ["16", "65,536", "0 \u2013 65,535", "half-word"],
       ["32", "4.29 \u00d7 10\u2079", "0 \u2013 2\u00b3\u00b2\u22121", "word / IPv4"],
       ["64", "1.84 \u00d7 10\u00b9\u2079", "0 \u2013 2\u2076\u2074\u22121", "long / address"]],
      [0.62, 1.40, 1.85, 1.73], size=11, row_h=0.31, mono_cols=(0, 1, 2))

text(s, 6.95, y + 2.40, 5.60, 0.28, "Storage units are powers of two", size=14,
     bold=True, color=INK, font=HEAD, shrink=False)
units = [("1 KB", "2\u00b9\u2070", "1,024 B"), ("1 MB", "2\u00b2\u2070", "1,048,576 B"),
         ("1 GB", "2\u00b3\u2070", "1.07 \u00d7 10\u2079 B"), ("1 TB", "2\u2074\u2070", "1.10 \u00d7 10\u00b9\u00b2 B")]
ux = 6.95
for name, power, val in units:
    rect(s, ux, y + 2.78, 1.31, 0.90, fill=PANEL, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.09)
    text(s, ux, y + 2.88, 1.31, 0.26, name, size=11.5, bold=True, color=ACCENT_D,
         align=PP_ALIGN.CENTER, shrink=False)
    text(s, ux, y + 3.14, 1.31, 0.24, power, size=10.5, bold=True, color=INK,
         align=PP_ALIGN.CENTER, font=MONO, shrink=False)
    text(s, ux + 0.05, y + 3.38, 1.21, 0.24, val, size=8, color=MUTED,
         align=PP_ALIGN.CENTER, shrink=False)
    ux += 1.43
text(s, 6.95, y + 3.80, 5.60, 0.44,
     [[("Why 1024 and not 1000?  ", {"bold": True, "color": ACCENT_D}),
       ("k address bits select 2\u1d4f locations, so capacity lands on powers of two.",
        {"color": INK_SOFT})]],
     size=10.5, line_spacing=1.12, shrink=False)
say_band(s, 6.16)
footer(s, 3)
notes(s, "\n".join([
    "== SAY THIS (one line) ==",
    SCRIPT[2]["plain"],
    "",
    "== FULL SCRIPT ==",
    *("- " + line for line in SCRIPT[2]["script"]),
    "",
    "== IF ASKED ==",
    SCRIPT[2]["if_asked"] or "No expected question on this slide.",
]))

# ============================================================ 4 · STORAGE ELEMENTS
s = new_slide()
y = header(s, "A bit needs a circuit that can hold a state",
           kicker="02 \u00b7 Storage elements",
           subtitle="Any stable two-state circuit is a bit cell. Three you should know:")

bxx, byy = 0.75, y + 0.10
CW = 3.85
# (a) SR latch ---------------------------------------------------------
rect(s, bxx, byy, CW, 2.94, fill=PANEL, line=LINE,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
section_tag(s, bxx + 0.26, byy + 0.22, "a. SR latch")
text(s, bxx + 0.26, byy + 0.64, 3.32, 0.52,
     "Two cross-coupled NOR gates. The feedback loop keeps the value alive while "
     "power is on.", size=11, color=INK_SOFT, line_spacing=1.1, shrink=False)
rect(s, bxx + 0.60, byy + 1.34, 1.22, 0.54, fill=WHITE, line=ACCENT_D, lw=1.25)
text(s, bxx + 0.60, byy + 1.64, 1.22, 0.28, "NOR", size=10.5, bold=True,
     color=ACCENT_D, align=PP_ALIGN.CENTER, font=MONO, shrink=False)
rect(s, bxx + 1.95, byy + 2.28, 1.22, 0.54, fill=WHITE, line=ACCENT_D, lw=1.25)
text(s, bxx + 1.95, byy + 2.40, 1.22, 0.28, "NOR", size=10.5, bold=True,
     color=ACCENT_D, align=PP_ALIGN.CENTER, font=MONO, shrink=False)
arrow(s, bxx + 0.14, byy + 1.48, bxx + 0.58, byy + 1.48, color=INK_SOFT, w=1.2)
text(s, bxx + 0.00, byy + 1.24, 0.26, 0.22, "R", size=10, bold=True, color=INK,
     font=MONO, shrink=False)
arrow(s, bxx + 3.52, byy + 2.66, bxx + 3.20, byy + 2.66, color=INK_SOFT, w=1.2)
text(s, bxx + 3.58, byy + 2.52, 0.24, 0.22, "S", size=10, bold=True, color=INK,
     font=MONO, shrink=False)
wire(s, bxx + 1.82, byy + 1.48, bxx + 1.86, byy + 1.48)
wire(s, bxx + 1.86, byy + 1.48, bxx + 1.86, byy + 2.42)
dot(s, bxx + 1.86, byy + 1.48)
text(s, bxx + 1.90, byy + 1.22, 0.40, 0.22, "Q", size=10, bold=True, color=ACCENT_D,
     font=MONO, shrink=False)
wire(s, bxx + 1.95, byy + 2.66, bxx + 0.34, byy + 2.66, color=ACCENT_D, w=1.2)
wire(s, bxx + 0.34, byy + 2.66, bxx + 0.34, byy + 1.70, color=ACCENT_D, w=1.2)
arrow(s, bxx + 0.34, byy + 1.70, bxx + 0.58, byy + 1.70, color=ACCENT_D, w=1.2)
text(s, bxx + 0.40, byy + 2.34, 0.50, 0.22, "Q\u0305", size=10, bold=True,
     color=MUTED, font=MONO, shrink=False)

# (b) D flip-flop ------------------------------------------------------
bxx2 = bxx + CW + 0.30
rect(s, bxx2, byy, CW, 2.94, fill=PANEL, line=LINE,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
section_tag(s, bxx2 + 0.26, byy + 0.22, "b. D flip-flop")
text(s, bxx2 + 0.26, byy + 0.64, 3.32, 0.52,
     "The standard 1-bit cell. Samples D only at a clock edge, so timing is "
     "predictable.", size=11, color=INK_SOFT, line_spacing=1.1, shrink=False)
rect(s, bxx2 + 1.05, byy + 1.30, 1.62, 1.22, fill=WHITE, line=ACCENT_D, lw=1.5)
text(s, bxx2 + 1.05, byy + 1.72, 1.62, 0.30, "D  FF", size=12.5, bold=True,
     color=ACCENT_D, align=PP_ALIGN.CENTER, font=MONO, shrink=False)
wire(s, bxx2 + 0.42, byy + 1.52, bxx2 + 1.05, byy + 1.52)
text(s, bxx2 + 0.12, byy + 1.30, 0.32, 0.22, "D", size=10, bold=True, color=INK,
     font=MONO, shrink=False)
wire(s, bxx2 + 0.42, byy + 2.20, bxx2 + 1.05, byy + 2.20)
tri = s.shapes.add_shape(MSO_SHAPE.ISOSCELES_TRIANGLE, I(bxx2 + 1.01),
                         I(byy + 2.13), I(0.14), I(0.14))
tri.rotation = 270
tri.fill.solid()
tri.fill.fore_color.rgb = ACCENT_D
tri.line.fill.background()
no_shadow(tri)
text(s, bxx2 + 0.02, byy + 2.08, 0.40, 0.22, "CLK", size=9.5, bold=True, color=INK,
     font=MONO, shrink=False)
wire(s, bxx2 + 2.67, byy + 1.52, bxx2 + 3.20, byy + 1.52, color=ACCENT_D)
text(s, bxx2 + 3.16, byy + 1.30, 0.40, 0.22, "Q", size=10, bold=True,
     color=ACCENT_D, font=MONO, shrink=False)
wire(s, bxx2 + 2.67, byy + 2.20, bxx2 + 3.08, byy + 2.20, color=ACCENT_D)
text(s, bxx2 + 3.04, byy + 2.26, 0.50, 0.22, "Q\u0305", size=10, bold=True,
     color=MUTED, font=MONO, shrink=False)
text(s, bxx2 + 0.26, byy + 2.62, 3.32, 0.24, "Q(next) = D on every rising clock edge",
     size=9.5, bold=True, color=ACCENT_D, font=MONO, shrink=False)

# (c) DRAM cell --------------------------------------------------------
bxx3 = bxx2 + CW + 0.30
rect(s, bxx3, byy, CW, 2.94, fill=PANEL, line=LINE,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
section_tag(s, bxx3 + 0.26, byy + 0.22, "c. DRAM cell", color=AMBER)
text(s, bxx3 + 0.26, byy + 0.64, 3.32, 0.52,
     "One transistor and one capacitor: charge = 1, no charge = 0.",
     size=11, color=INK_SOFT, line_spacing=1.1, shrink=False)
wire(s, bxx3 + 0.45, byy + 1.80, bxx3 + 2.30, byy + 1.80)
text(s, bxx3 + 2.34, byy + 1.62, 0.90, 0.22, "bit line", size=8.5, color=MUTED,
     shrink=False)
rect(s, bxx3 + 1.18, byy + 1.64, 0.34, 0.30, fill=ACCENT_D)
wire(s, bxx3 + 1.35, byy + 1.64, bxx3 + 1.35, byy + 1.28, color=AMBER, w=1.3)
wire(s, bxx3 + 1.35, byy + 1.28, bxx3 + 2.55, byy + 1.28, color=AMBER, w=1.3)
text(s, bxx3 + 1.35, byy + 1.04, 1.20, 0.22, "word line", size=8.5, color=AMBER,
     shrink=False)
wire(s, bxx3 + 1.35, byy + 1.94, bxx3 + 1.35, byy + 2.36, color=ACCENT_D, w=1.2)
wire(s, bxx3 + 1.08, byy + 2.36, bxx3 + 1.62, byy + 2.36, color=ACCENT_D, w=2.2)
wire(s, bxx3 + 1.08, byy + 2.36, bxx3 + 1.62, byy + 2.36, color=ACCENT_D, w=2.2)
wire(s, bxx3 + 1.35, byy + 2.36, bxx3 + 1.35, byy + 2.56, color=ACCENT_D, w=1.2)
wire(s, bxx3 + 0.95, byy + 2.56, bxx3 + 1.78, byy + 2.56, color=MUTED, w=1.4)
text(s, bxx3 + 1.70, byy + 2.16, 0.40, 0.22, "Cs", size=9.5, bold=True, color=INK,
     font=MONO, shrink=False)
text(s, bxx3 + 0.26, byy + 2.62, 3.32, 0.24, "Needs refreshing every ~64 ms",
     size=9.5, bold=True, color=AMBER, font=MONO, shrink=False)

# comparison strip
rect(s, 0.75, byy + 3.06, 11.85, 1.10, fill=PANEL_2)
text(s, 0.98, byy + 3.14, 11.40, 0.24, "THE TRADE-OFF", size=9, bold=True,
     color=ACCENT, font=HEAD, shrink=False)
text(s, 0.98, byy + 3.40, 11.40, 0.26,
     [[("Flip-flop:  ", {"bold": True, "color": ACCENT_D}),
       ("~6 transistors per bit, no refresh, fast \u2014 the right choice inside the CPU.",
        {"color": INK_SOFT})]],
     size=10.5, shrink=False)
text(s, 0.98, byy + 3.72, 11.40, 0.26,
     [[("DRAM cell:  ", {"bold": True, "color": AMBER}),
       ("1 transistor + 1 capacitor, needs refresh \u2014 the right choice for gigabytes.",
        {"color": INK_SOFT})]],
     size=10.5, shrink=False)
say_band(s, 6.16)
footer(s, 4)
notes(s, "\n".join([
    "== SAY THIS (one line) ==",
    SCRIPT[3]["plain"],
    "",
    "== FULL SCRIPT ==",
    *("- " + line for line in SCRIPT[3]["script"]),
    "",
    "== IF ASKED ==",
    SCRIPT[3]["if_asked"] or "No expected question on this slide.",
]))

# ============================================================ 5 · REGISTER
s = new_slide()
y = header(s, "A register is n flip-flops sharing one clock",
           kicker="03 \u00b7 The register",
           subtitle="It stores one binary word and is read or written as a unit \u2014 selected by name, not by address.")

rx, ry = 1.50, y + 0.42
cw, GAP = 0.95, 0.30
bit_labels = ["D\u2083", "D\u2082", "D\u2081", "D\u2080"]
q_labels = ["Q\u2083", "Q\u2082", "Q\u2081", "Q\u2080"]
for i in range(4):
    bx = rx + i * (cw + GAP)
    rect(s, bx, ry + 0.52, cw, 1.14, fill=WHITE, line=ACCENT_D, lw=1.5,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.07)
    text(s, bx, ry + 0.82, cw, 0.42, "FF", size=13.5, bold=True, color=ACCENT_D,
         align=PP_ALIGN.CENTER, font=MONO, shrink=False)
    text(s, bx, ry + 1.32, cw, 0.22, f"bit {3 - i}", size=8.5, color=MUTED,
         align=PP_ALIGN.CENTER, shrink=False)
    arrow(s, bx + cw / 2, ry + 0.12, bx + cw / 2, ry + 0.50, color=INK_SOFT, w=1.2)
    text(s, bx + cw / 2 - 0.30, ry - 0.18, 0.60, 0.24, bit_labels[i], size=11,
         bold=True, color=INK, align=PP_ALIGN.CENTER, font=MONO, shrink=False)
    wire(s, bx + cw / 2, ry + 1.68, bx + cw / 2, ry + 2.04, color=ACCENT_D)
    arrow(s, bx + cw / 2, ry + 1.94, bx + cw / 2, ry + 2.06, color=ACCENT_D, w=1.2)
    text(s, bx + cw / 2 - 0.30, ry + 2.10, 0.60, 0.24, q_labels[i], size=11,
         bold=True, color=ACCENT_D, align=PP_ALIGN.CENTER, font=MONO, shrink=False)

clock_y = ry + 1.86
wire(s, rx - 0.50, clock_y, rx + 3 * (cw + GAP) + cw + 0.25, clock_y, color=AMBER,
     w=1.6)
for i in range(4):
    bx = rx + i * (cw + GAP)
    wire(s, bx + cw / 2, clock_y, bx + cw / 2, ry + 1.66, color=AMBER, w=1.2)
    dot(s, bx + cw / 2, clock_y, d=0.09, color=AMBER)
text(s, rx - 0.78, clock_y - 0.34, 0.70, 0.24, "CLK", size=10.5, bold=True,
     color=AMBER, font=MONO, align=PP_ALIGN.CENTER, shrink=False)

br_y = ry + 2.42
wire(s, rx, br_y, rx, br_y + 0.14, color=MUTED, w=1.1)
wire(s, rx + 3 * (cw + GAP) + cw, br_y, rx + 3 * (cw + GAP) + cw, br_y + 0.14,
     color=MUTED, w=1.1)
wire(s, rx, br_y + 0.14, rx + 3 * (cw + GAP) + cw, br_y + 0.14, color=MUTED, w=1.1)
text(s, rx - 0.40, br_y + 0.18, 5.55, 0.24,
     "one 4-bit register \u2014 value stored = Q\u2083Q\u2082Q\u2081Q\u2080", size=10,
     bold=True, color=INK, align=PP_ALIGN.CENTER, shrink=False)

bullets(s, 1.05, ry + 2.92, 4.85, [
    ("One clock, one update. ", "All bits change together, so a word is never half-written."),
    ("Width = flip-flop count. ", "An 8-bit register is 8 flip-flops."),
], size=11, gap=0.46)

# right: CPU registers
text(s, 6.55, y + 0.10, 6.00, 0.30, "Registers you will meet inside a CPU", size=14,
     bold=True, color=INK, font=HEAD, shrink=False)
table(s, 6.55, y + 0.50, 6.00,
      [["Reg", "Full name", "Holds"],
       ["PC", "Program Counter", "address of the next instruction"],
       ["IR", "Instruction Register", "the instruction being decoded"],
       ["MAR", "Memory Address Register", "address sent to memory"],
       ["MDR", "Memory Data Register", "data read / to be written"],
       ["ACC", "Accumulator", "intermediate ALU result"],
       ["SP", "Stack Pointer", "top of the stack"],
       ["PSW", "Status / Flags", "zero, carry, sign, overflow"]],
      [0.66, 2.28, 3.06], size=10.5, row_h=0.325, mono_cols=(0,))

text(s, 6.55, y + 3.18, 6.00, 0.26, "Register transfer notation", size=13.5,
     bold=True, color=INK, font=HEAD, shrink=False)
code_block(s, 6.55, y + 3.50, 6.00, 0.56, ["R2 \u2190 R1    copy     R3 \u2190 R1 + R2    add"],
           size=11.5, shrink=False)
text(s, 6.55, y + 4.16, 6.00, 0.40,
     [[("Read right to left: ", {"bold": True}),
       ("the source is copied, the destination overwritten.", {"color": INK_SOFT})]],
     size=10, shrink=False)
say_band(s, 6.16)
footer(s, 5)
notes(s, "\n".join([
    "== SAY THIS (one line) ==",
    SCRIPT[4]["plain"],
    "",
    "== FULL SCRIPT ==",
    *("- " + line for line in SCRIPT[4]["script"]),
    "",
    "== IF ASKED ==",
    SCRIPT[4]["if_asked"] or "No expected question on this slide.",
]))

# ============================================================ 6 · CONTROL
s = new_slide()
y = header(s, "Control: load, shift, and the shared bus",
           kicker="04 \u00b7 Control",
           subtitle="A register only does something when a control signal says so \u2014 and only one output may drive the bus at a time.")

# --- load enable panel
text(s, 0.75, y + 0.06, 5.95, 0.28, "(a) Parallel load", size=13, bold=True,
     color=INK, font=HEAD, shrink=False)
text(s, 0.75, y + 0.38, 5.95, 0.28,
     "A 2:1 mux in front of each flip-flop decides: new data, or hold.", size=10.5,
     color=INK_SOFT, shrink=False)
for i in range(4):
    ry2 = y + 0.76 + i * 0.52
    text(s, 0.75, ry2 + 0.06, 0.36, 0.22, f"D{i}", size=9.5, bold=True, color=INK,
         font=MONO, shrink=False)
    arrow(s, 1.14, ry2 + 0.16, 2.98, ry2 + 0.16, color=INK_SOFT, w=1.0)
    m = s.shapes.add_shape(MSO_SHAPE.TRAPEZOID, I(3.00), I(ry2 - 0.03),
                           I(0.56), I(0.38))
    m.rotation = 270
    m.fill.solid()
    m.fill.fore_color.rgb = WHITE
    m.line.color.rgb = ACCENT_D
    m.line.width = Pt(1.0)
    no_shadow(m)
    text(s, 3.30, ry2 + 0.02, 0.50, 0.20, "0/1", size=7.5, color=MUTED,
         align=PP_ALIGN.CENTER, font=MONO, shrink=False)
    arrow(s, 3.58, ry2 + 0.16, 4.42, ry2 + 0.16, color=ACCENT_D, w=1.0)
    rect(s, 4.44, ry2 - 0.01, 0.56, 0.34, fill=WHITE, line=ACCENT_D, lw=1.0,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.10)
    text(s, 4.44, ry2 + 0.06, 0.56, 0.22, "FF", size=9.5, bold=True, color=ACCENT_D,
         align=PP_ALIGN.CENTER, font=MONO, shrink=False)
    arrow(s, 5.02, ry2 + 0.16, 5.42, ry2 + 0.16, color=ACCENT_D, w=1.0)
    text(s, 5.44, ry2 + 0.06, 0.42, 0.22, f"Q{i}", size=9.5, bold=True,
         color=ACCENT_D, font=MONO, shrink=False)
wire(s, 3.28, y + 2.90, 3.28, y + 2.62, color=AMBER, w=1.5)
dot(s, 3.28, y + 2.62, d=0.09, color=AMBER)
text(s, 2.42, y + 2.96, 0.74, 0.22, "LOAD", size=9.5, bold=True, color=AMBER,
     font=MONO, align=PP_ALIGN.RIGHT, shrink=False)
text(s, 0.75, y + 3.18, 5.95, 0.44,
     "Load = 1 \u2192 mux passes D, register takes the word.   Load = 0 \u2192 mux feeds Q "
     "back, value is held.", size=9.5, color=MUTED, line_spacing=1.1, shrink=False)

# --- shift / bus panel
text(s, 6.95, y + 0.06, 5.60, 0.28, "(b) Shift and rotate", size=13, bold=True,
     color=INK, font=HEAD, shrink=False)
sx, sy = 7.55, y + 0.46
PITCH, BW = 1.14, 0.86
for i, nm in enumerate(["FF3", "FF2", "FF1", "FF0"]):
    bx = sx + i * PITCH
    rect(s, bx, sy, BW, 0.56, fill=WHITE, line=ACCENT_D, lw=1.2,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08)
    text(s, bx, sy + 0.16, BW, 0.26, nm, size=9.5, bold=True, color=ACCENT_D,
         align=PP_ALIGN.CENTER, font=MONO, shrink=False)
    if i < 3:
        arrow(s, bx + BW + 0.01, sy + 0.28, bx + PITCH - 0.03, sy + 0.28,
              color=ACCENT_D, w=1.1)
arrow(s, sx - 0.50, sy + 0.28, sx - 0.03, sy + 0.28, color=AMBER, w=1.3)
text(s, sx - 1.10, sy + 0.36, 1.02, 0.22, "serial in", size=8, color=AMBER,
     bold=True, align=PP_ALIGN.RIGHT, shrink=False)
wire(s, sx + 3 * PITCH + BW, sy + 0.28, sx + 3 * PITCH + BW + 0.28, sy + 0.28,
     color=ACCENT_D)
text(s, sx + 3 * PITCH + BW + 0.32, sy + 0.16, 0.70, 0.22, "out", size=8,
     color=MUTED, shrink=False)
text(s, 6.95, y + 1.20, 5.60, 0.46,
     "Wire each Q to the next D and every bit moves one place per clock: left shift "
     "\u00d72, right shift \u00f72, rotate keeps every bit.", size=10, color=INK_SOFT,
     line_spacing=1.1, shrink=False)
table(s, 6.95, y + 1.74, 3.05,
      [["Clock", "Bits (init 1011)"],
       ["start", "1011"],
       ["1", "0101 (out 1)"],
       ["2", "0010 (out 1)"]],
      [0.85, 2.20], size=9.5, row_h=0.30, mono_cols=(0, 1))

text(s, 6.95, y + 3.06, 5.60, 0.28, "(c) One bus, one driver", size=13, bold=True,
     color=INK, font=HEAD, shrink=False)
text(s, 6.95, y + 3.34, 5.60, 0.44,
     "Tri-state buffers have a third output state, high-Z, so many registers can share "
     "one bus \u2014 but only one enable may be active.", size=10, color=INK_SOFT,
     line_spacing=1.1, shrink=False)
rect(s, 6.95, y + 3.92, 5.60, 0.62, fill=PANEL_2)
text(s, 7.16, y + 4.02, 5.20, 0.44,
     [[("Two registers enabled at once \u2192 contention, ", {"color": INK_SOFT}),
       ("a short circuit, not just a wrong value.", {"bold": True, "color": AMBER})]],
     size=10, line_spacing=1.1, shrink=False)
say_band(s, 6.16)
footer(s, 6)
notes(s, "\n".join([
    "== SAY THIS (one line) ==",
    SCRIPT[5]["plain"],
    "",
    "== FULL SCRIPT ==",
    *("- " + line for line in SCRIPT[5]["script"]),
    "",
    "== IF ASKED ==",
    SCRIPT[5]["if_asked"] or "No expected question on this slide.",
]))

# ============================================================ 7 · HIERARCHY + EXAMPLE
s = new_slide()
y = header(s, "Where registers sit, and one worked example",
           kicker="05 \u00b7 Placement and example",
           subtitle="Registers are the fastest, smallest storage in the machine \u2014 here is why, and what that buys us.")

bars = [
    ("Registers", "16\u201332 per core \u00b7 < 1 ns \u00b7 flip-flop", 2.55, ACCENT_D),
    ("Cache L1/L2/L3", "KB\u2013MB \u00b7 1\u201310 ns \u00b7 SRAM", 3.70, ACCENT),
    ("Main memory", "GB \u00b7 50\u2013100 ns \u00b7 DRAM + refresh", 4.85, AMBER),
    ("SSD / HDD", "TB \u00b7 \u00b5s\u2013ms \u00b7 blocks", 5.75, MUTED),
]
by = y + 0.12
for name, meta, w, col in bars:
    rect(s, 0.75, by, w, 0.68, fill=col, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
         radius=0.10)
    text(s, 0.96, by + 0.08, w - 0.30, 0.28, name, size=11.5, bold=True, color=WHITE,
         shrink=False)
    text(s, 0.96, by + 0.36, w - 0.30, 0.24, meta, size=8.5,
         color=RGBColor(0xE6, 0xF2, 0xF1), shrink=False)
    by += 0.76
text(s, 0.75, by + 0.02, 5.90, 0.26, "\u2190 faster + costlier       larger + cheaper \u2192",
     size=8.5, color=MUTED, shrink=False)
rect(s, 0.75, by + 0.30, 5.90, 0.82, fill=PANEL_2)
text(s, 0.96, by + 0.40, 5.50, 0.24, "WHY NOT ALL REGISTERS?", size=8.5, bold=True,
     color=ACCENT, font=HEAD, shrink=False)
text(s, 0.96, by + 0.64, 5.50, 0.44,
     "A flip-flop is ~6 transistors per bit; a DRAM cell is 1 + 1 capacitor, so "
     "registers would be ~6\u00d7 the area.", size=9.5, color=INK_SOFT,
     line_spacing=1.08, shrink=False)

# example, right
ops = [
    ("LOAD 11010110", "1101 0110", "214"),
    ("SHL 1", "0001 1010", "26"),
    ("SHR 1", "0000 0110", "6"),
    ("ROL 1", "1000 0110", "134"),
]
text(s, 7.05, y + 0.12, 5.50, 0.28, "One 8-bit register, R1 = 0000 1101 (13)",
     size=12.5, bold=True, color=INK, font=HEAD, shrink=False)
oy = y + 0.52
for label, bits, dec in ops:
    rect(s, 7.05, oy, 5.55, 0.64, fill=PANEL, line=LINE,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.09)
    text(s, 7.22, oy + 0.22, 1.48, 0.24, label, size=9, bold=True, color=ACCENT_D,
         font=MONO, shrink=False)
    bit_strip(s, 8.74, oy + 0.15, cell=0.28, h=0.34, bits=bits, size=9.5)
    text(s, 11.32, oy + 0.20, 0.90, 0.26, f"= {dec}", size=10.5, bold=True,
         color=INK, font=MONO, shrink=False)
    oy += 0.68

text(s, 7.05, y + 3.30, 5.55, 0.30, "What each operation did", size=12, bold=True,
     color=INK, font=HEAD, shrink=False)
text(s, 7.05, y + 3.62, 5.55, 1.00,
     [[("Load ", {"bold": True, "color": ACCENT_D}),
       ("overwrites all eight bits at once.", {"color": INK_SOFT})],
      [("Shift ", {"bold": True, "color": ACCENT_D}),
       ("moves every bit one place: left \u00d72, right \u00f72.", {"color": INK_SOFT})],
      [("Rotate ", {"bold": True, "color": ACCENT_D}),
       ("returns the escaping bit, so no 1 is ever lost.", {"color": INK_SOFT})]],
     size=10, line_spacing=1.15, space_after=6)
say_band(s, 6.16)
footer(s, 7)
notes(s, "\n".join([
    "== SAY THIS (one line) ==",
    SCRIPT[6]["plain"],
    "",
    "== FULL SCRIPT ==",
    *("- " + line for line in SCRIPT[6]["script"]),
    "",
    "== IF ASKED ==",
    SCRIPT[6]["if_asked"] or "No expected question on this slide.",
]))

# ============================================================ 8 · SUMMARY / Q&A
s = new_slide()
rect(s, 0, 0, SW, SH, fill=DARK_BG)
rect(s, 0.9, 0.86, 0.62, 0.07, fill=ACCENT)
text(s, 0.9, 0.98, 7.4, 0.58, "Summary and questions", size=34, bold=True,
     color=WHITE, font=HEAD, shrink=False)
text(s, 0.9, 1.62, 5.30, 0.30, "Five sentences that carry the topic.", size=13,
     color=RGBColor(0xB6, 0xC7, 0xCF), shrink=False)
rect(s, 0.9, 1.96, 6.15, 0.50, fill=DARK_PNL, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
     radius=0.16)
text(s, 1.06, 2.07, 5.85, 0.28,
     [[("SAY THIS:  ", {"bold": True, "color": RGBColor(0x71, 0xC8, 0xC1), "size": 9.5}),
       ("binary, the bit cell, the register, the switches.", {"size": 11})]],
     size=11, color=WHITE, shrink=False)

pts = [
    ("01", "Binary is a hardware decision.",
     "Two stable states are cheap, fast and noise-tolerant; n bits give 2\u207f patterns."),
    ("02", "A bit is held by a bistable circuit.",
     "Flip-flops for speed in the CPU, capacitors for density in DRAM."),
    ("03", "A register is n flip-flops on one clock.",
     "All bits update together, so a word is never read half-written."),
    ("04", "Control signals decide what happens.",
     "Load to write, shift to move, tri-state enables to share one bus."),
    ("05", "Registers top the hierarchy.",
     "Fast and small because they are flip-flops; memory is big and slow by design."),
]
py = 2.66
for num, lead, rest in pts:
    text(s, 0.90, py, 0.52, 0.26, num, size=11, bold=True,
         color=RGBColor(0x71, 0xC8, 0xC1), font=HEAD, shrink=False)
    text(s, 1.52, py - 0.04, 5.60, 0.28, lead, size=12.5, bold=True, color=WHITE,
         shrink=False)
    text(s, 1.52, py + 0.26, 5.60, 0.42, rest, size=10,
         color=RGBColor(0x9F, 0xB6, 0xC0), line_spacing=1.1, shrink=False)
    py += 0.80

text(s, 7.55, 2.02, 4.90, 0.26, "LIKELY QUESTIONS", size=9.5, bold=True,
     color=RGBColor(0x71, 0xC8, 0xC1), font=HEAD, shrink=False)
qa = [
    ("Why 2\u207f and not n\u00b2?", "Each extra bit doubles the patterns."),
    ("Register vs. cache?", "Register: by name, ~1 cycle. Cache: by address."),
    ("Why refresh DRAM?", "The capacitor charge leaks away."),
    ("Why only one bus driver?", "Two enabled outputs short the line."),
]
qy = 2.36
for q, a in qa:
    rect(s, 7.55, qy, 4.90, 0.66, fill=DARK_PNL, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
         radius=0.12)
    text(s, 7.74, qy + 0.08, 4.55, 0.24, q, size=10, bold=True, color=WHITE,
         shrink=False)
    text(s, 7.74, qy + 0.34, 4.55, 0.24, a, size=9,
         color=RGBColor(0x9F, 0xB6, 0xC0), shrink=False)
    qy += 0.74

text(s, 7.55, qy + 0.10, 4.90, 0.26, "SOURCES", size=9.5, bold=True,
     color=RGBColor(0x71, 0xC8, 0xC1), font=HEAD, shrink=False)
text(s, 7.55, qy + 0.40, 4.90, 1.00,
     [[("Mano, Computer System Architecture, 3rd ed. \u2014 Ch. 2, 4.",
        {"color": RGBColor(0x9F, 0xB6, 0xC0)})],
      [("Stallings, Computer Organization and Architecture, 10th ed. \u2014 Ch. 3, 4.",
        {"color": RGBColor(0x9F, 0xB6, 0xC0)})],
      [("Patterson & Hennessy, Computer Organization and Design \u2014 Ch. 4.",
        {"color": RGBColor(0x9F, 0xB6, 0xC0)})]],
     size=8.5, color=WHITE, line_spacing=1.12, space_after=4, shrink=False)
text(s, 0.90, 6.90, 6.6, 0.30, "Thank you \u2014 questions are welcome.", size=12,
     bold=True, color=RGBColor(0x71, 0xC8, 0xC1), shrink=False)
notes(s, "\n".join([
    "== SAY THIS (one line) ==",
    SCRIPT[7]["plain"],
    "",
    "== FULL SCRIPT ==",
    *("- " + line for line in SCRIPT[7]["script"]),
    "",
    "== IF ASKED ==",
    SCRIPT[7]["if_asked"] or "No expected question on this slide.",
]))

save(OUT)
