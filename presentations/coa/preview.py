# -*- coding: utf-8 -*-
"""
Rasterise a .pptx to PNGs with Pillow so layout can be eyeballed without
PowerPoint / LibreOffice. Approximate by design: shapes, fills, lines, arrows,
tables and wrapped text are drawn close enough to spot overflow and overlap.
"""
import io
import os
import sys

from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from pptx.util import Emu
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

DPI = 150
SCALE = DPI / 914400.0  # EMU -> px

SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

_fcache = {}


def font(size_pt, bold=False, mono=False):
    key = (round(size_pt, 1), bold, mono)
    if key in _fcache:
        return _fcache[key]
    path = (MONO_B if bold else MONO) if mono else (SANS_B if bold else SANS)
    f = ImageFont.truetype(path, int(round(size_pt * DPI / 72.0)))
    _fcache[key] = f
    return f


def emu(v):
    return int(round(v * SCALE))


def rgb(color):
    try:
        c = color.rgb
        return (c[0], c[1], c[2])
    except Exception:
        return None


def shape_fill(sh):
    try:
        f = sh.fill
        if f.type is not None and f.type == 1:  # solid
            return rgb(f.fore_color)
    except Exception:
        pass
    return None


def shape_line(sh):
    try:
        ln = sh.line
        c = rgb(ln.color)
        w = ln.width.pt if ln.width else 1.0
        if c is None:
            return None
        return c, max(1, int(round(w * DPI / 72.0)))
    except Exception:
        return None


def accent_bar(sh):
    pass


def draw_text_frame(d, sh, px, py, pw, ph):
    tf = sh.text_frame
    ml = emu(tf.margin_left or 0)
    mr = emu(tf.margin_right or 0)
    mt = emu(tf.margin_top or 0)
    mb = emu(tf.margin_bottom or 0)
    x, y = px + ml, py + mt
    w = pw - ml - mr
    h = ph - mt - mb

    lines = []  # (runs[(txt,font,color)], align, line_h)
    for p in tf.paragraphs:
        runs = []
        maxsize = 10
        for r in p.runs:
            sz = r.font.size.pt if r.font.size else 18
            maxsize = max(maxsize, sz)
            mono = (r.font.name or "").startswith(("Consolas", "Courier"))
            runs.append((r.text, font(sz, bool(r.font.bold), mono),
                         rgb(r.font.color) or (0, 0, 0), sz))
        ls = p.line_spacing if isinstance(p.line_spacing, float) else 1.0
        align = p.alignment if p.alignment is not None else PP_ALIGN.LEFT
        # wrap
        if not runs:
            lines.append(([], align, maxsize * 1.22 * ls * DPI / 72.0))
            continue
        cur, curw = [], 0.0
        tokens = []
        for txt, f, col, sz in runs:
            for piece in _split_keep(txt):
                tokens.append((piece, f, col, sz))
        space_w = lambda f: d.textlength(" ", font=f)
        for piece, f, col, sz in tokens:
            if piece == "\n":
                lines.append((cur, align, maxsize * 1.22 * ls * DPI / 72.0))
                cur, curw = [], 0.0
                continue
            pw_ = d.textlength(piece, font=f)
            if piece.isspace() and not cur:
                continue
            if curw + pw_ > w and cur:
                lines.append((cur, align, maxsize * 1.22 * ls * DPI / 72.0))
                cur, curw = [], 0.0
                if piece.isspace():
                    continue
            cur.append((piece, f, col))
            curw += pw_
        lines.append((cur, align, maxsize * 1.22 * ls * DPI / 72.0))

    total = sum(l[2] for l in lines)
    anchor = tf.vertical_anchor
    if anchor == MSO_ANCHOR.MIDDLE:
        cy = y + max(0, (h - total) / 2)
    elif anchor == MSO_ANCHOR.BOTTOM:
        cy = y + max(0, h - total)
    else:
        cy = y
    for runs, align, lh in lines:
        lw = sum(d.textlength(t, font=f) for t, f, c in runs)
        if align == PP_ALIGN.CENTER:
            cx = x + (w - lw) / 2
        elif align == PP_ALIGN.RIGHT:
            cx = x + w - lw
        else:
            cx = x
        for t, f, c in runs:
            d.text((cx, cy + (lh - f.size * 1.0) / 2 - 1), t, font=f, fill=c)
            cx += d.textlength(t, font=f)
        cy += lh
    return total, h


def _split_keep(txt):
    """Split a run's text into word chunks, keeping spaces; '\n' becomes its own
    token BETWEEN segments only (never at the end, which would add a phantom line)."""
    out = []
    for i, seg in enumerate(txt.split("\n")):
        if i:
            out.append("\n")
        buf = ""
        for ch in seg:
            buf += ch
            if ch == " ":
                out.append(buf)
                buf = ""
        if buf:
            out.append(buf)
    return out


def render(path, outdir, only=None):
    prs = Presentation(path)
    os.makedirs(outdir, exist_ok=True)
    W = emu(prs.slide_width)
    H = emu(prs.slide_height)
    files = []
    for idx, s in enumerate(prs.slides, 1):
        if only and idx not in only:
            continue
        img = Image.new("RGB", (W, H), (255, 255, 255))
        d = ImageDraw.Draw(img)
        # background
        try:
            bg = rgb(s.background.fill.fore_color)
            if bg:
                d.rectangle([0, 0, W, H], fill=bg)
        except Exception:
            pass
        overflows = []
        for sh in s.shapes:
            pad = 0
            x, y = emu(sh.left), emu(sh.top)
            w, h = emu(sh.width), emu(sh.height)
            st = str(sh.shape_type)
            if "TABLE" in st:
                draw_table(img, d, sh, x, y, w, h)
                continue
            if "CONNECTOR" in st or sh.shape_type == 3:
                draw_connector(d, sh, x, y, w, h)
                continue
            if "PICTURE" in st:
                continue
            fill = shape_fill(sh)
            line = shape_line(sh)
            prst = None
            try:
                prst = sh._element.spPr.find(
                    "{http://schemas.openxmlformats.org/drawingml/2006/main}prstGeom")
                prst = prst.get("prst") if prst is not None else None
            except Exception:
                pass
            rot = 0
            try:
                rot = sh.rotation
            except Exception:
                pass
            if fill or line:
                draw_shape(d, prst, x, y, w, h, fill, line, rot)
            if sh.has_text_frame and sh.text_frame.text.strip():
                total, avail = draw_text_frame(d, sh, x, y, w, h)
                if total > avail + 4 and sh.width < prs.slide_width - 100:
                    overflows.append(
                        (idx, sh.text_frame.text.replace("\n", " / ")[:55],
                         round(total / DPI * 72, 1), round(avail / DPI * 72, 1)))
        out = os.path.join(outdir, f"slide-{idx:02d}.png")
        img.save(out)
        files.append(out)
        for o in overflows:
            print(f"  ! slide {o[0]} text needs {o[2]}pt, box {o[3]}pt :: {o[1]}")
    print(f"rendered {len(files)} slides -> {outdir}")
    return files


def draw_shape(d, prst, x, y, w, h, fill, line, rot=0):
    lw = line[1] if line else 0
    lc = line[0] if line else None
    if prst in ("ellipse",):
        d.ellipse([x, y, x + w, y + h], fill=fill, outline=lc, width=max(1, lw))
    elif prst in ("roundRect",):
        d.rounded_rectangle([x, y, x + w, y + h], radius=min(w, h) * 0.16,
                            fill=fill, outline=lc, width=max(1, lw))
    elif prst in ("triangle", "rtTriangle"):
        d.polygon([(x + w / 2, y), (x + w, y + h), (x, y + h)], fill=fill,
                  outline=lc)
    elif prst in ("trapezoid",):
        d.polygon([(x + w * 0.22, y), (x + w * 0.78, y), (x + w, y + h),
                   (x, y + h)], fill=fill, outline=lc)
    else:
        if fill:
            d.rectangle([x, y, x + w, y + h], fill=fill)
        if lc:
            d.rectangle([x, y, x + w, y + h], outline=lc, width=max(1, lw))


def draw_connector(d, sh, x, y, w, h):
    ln = sh.line
    c = rgb(ln.color) or (0, 0, 0)
    lw = max(1, int(round((ln.width.pt if ln.width else 1) * DPI / 72)))
    flipH = flipV = False
    try:
        xfrm = sh._element.spPr.xfrm
        flipH = xfrm.get("flipH") == "1"
        flipV = xfrm.get("flipV") == "1"
    except Exception:
        pass
    x1, y1, x2, y2 = x, y, x + w, y + h
    if flipH:
        x1, x2 = x2, x1
    if flipV:
        y1, y2 = y2, y1
    d.line([x1, y1, x2, y2], fill=c, width=lw)
    # arrow head
    try:
        tail = sh.line._get_or_add_ln().find(
            "{http://schemas.openxmlformats.org/drawingml/2006/main}tailEnd")
        has_head = tail is not None
    except Exception:
        has_head = False
    if has_head:
        import math
        ang = math.atan2(y2 - y1, x2 - x1)
        L = max(6, lw * 4)
        for sgn in (1, -1):
            d.line([x2, y2,
                    x2 - L * math.cos(ang - sgn * 0.42),
                    y2 - L * math.sin(ang - sgn * 0.42)], fill=c, width=lw)


def draw_table(img, d, sh, x, y, w, h):
    tbl = sh.table
    cy = y
    for i, row in enumerate(tbl.rows):
        rh = emu(row.height)
        cx = x
        for j, cell in enumerate(row.cells):
            cw = emu(tbl.columns[j].width)
            fillc = None
            try:
                fillc = rgb(cell.fill.fore_color)
            except Exception:
                pass
            if fillc:
                d.rectangle([cx, cy, cx + cw, cy + rh], fill=fillc)
            d.rectangle([cx, cy, cx + cw, cy + rh], outline=(210, 224, 230))
            # text
            ml, mr = emu(cell.margin_left or 0), emu(cell.margin_right or 0)
            tf = cell.text_frame
            for p in tf.paragraphs:
                runs = []
                for r in p.runs:
                    sz = r.font.size.pt if r.font.size else 12
                    mono = (r.font.name or "").startswith(("Consolas", "Courier"))
                    runs.append((r.text, font(sz, bool(r.font.bold), mono),
                                 rgb(r.font.color) or (0, 0, 0), sz))
                if not runs:
                    continue
                tw = sum(d.textlength(t, font=f) for t, f, c, s in runs)
                avail = cw - ml - mr
                if tw > avail:
                    print(f"  ! table cell overflow {tw:.0f}px > {avail:.0f}px :: "
                          f"{''.join(t for t, *_ in runs)[:40]}")
                align = p.alignment
                if align == PP_ALIGN.CENTER:
                    tx = cx + ml + (avail - tw) / 2
                elif align == PP_ALIGN.RIGHT:
                    tx = cx + cw - mr - tw
                else:
                    tx = cx + ml
                ty = cy + (rh - runs[0][3] * 1.05 * DPI / 72) / 2
                for t, f, c, s in runs:
                    d.text((tx, ty), t, font=f, fill=c)
                    tx += d.textlength(t, font=f)
            cx += cw
        cy += rh


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else \
        "Binary_Storage_and_Registers_COA.pptx"
    outdir = sys.argv[2] if len(sys.argv) > 2 else "preview"
    only = [int(a) for a in sys.argv[3:]] or None
    render(src, outdir, only)
