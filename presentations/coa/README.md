# Binary Storage and Registers — COA theory presentation

Two lengths of the same talk, both 16:9 with speaker notes on every slide:

| File | Slides | Use |
|------|--------|-----|
| **`Binary_Storage_and_Registers_8slides_COA.pptx`** | **8** | **the short version — main deliverable** |
| `Binary_Storage_and_Registers_COA.pptx` | 16 | longer version, same content, more room per idea |

Fill in `<Your Name>` / `<Roll No>` on the title slide and you are ready to present.

## The 8-slide version

| # | Slide | Covers |
|---|-------|--------|
| 1 | Title | — |
| 2 | What we will cover | agenda: six ideas |
| 3 | Binary: two states, and 2ⁿ patterns | bit strip + weights, one byte in four bases, n-bit table, KB/MB/GB/TB |
| 4 | A bit needs a circuit that can hold a state | SR latch, D flip-flop, DRAM cell, flip-flop vs DRAM trade-off |
| 5 | A register is n flip-flops sharing one clock | 4-bit register diagram, CPU registers table, transfer notation |
| 6 | Control: load, shift, and the shared bus | 2:1 mux load enable, shift register + timing table, tri-state bus |
| 7 | Where registers sit, and one worked example | memory hierarchy bars + load/SHL/SHR/ROL on R1 = 0000 1101 |
| 8 | Summary and questions | five takeaway points, four likely questions, sources |

The 16-slide deck spreads the same material over: title, agenda, why binary, number bases,
storage units, storage elements, register, transfer notation, CPU registers, load enable,
shift registers, bus, memory hierarchy, worked example, summary, thank-you/sources.

## Editing

Both decks are generated. Edit the `.pptx` directly in PowerPoint, or change the builder and
regenerate:

```bash
pip install python-pptx pillow
python3 build_deck_8.py     # 8-slide deck
python3 build_deck.py       # 16-slide deck
python3 preview.py          # optional: PNG renders in preview/ for a visual check
```

* `deckkit.py` — shared layout helpers (colours, measured text with auto-shrink, cards,
  chips, tables, code blocks, wiring/arrows). Both builders import it.
* `preview.py` — Pillow rasteriser used during authoring because there is no
  PowerPoint/LibreOffice in the build environment. Checking tool only, not needed to present.

## Content notes

* Numbers follow Mano / Stallings: 2ⁿ patterns, 1 KB = 2¹⁰ B, DRAM refresh ≈ 64 ms,
  flip-flop ≈ 6 transistors vs. a 1T1C DRAM cell.
* The shift-register timing table starts from 1011 and shifts one position per clock, so the
  table and the drawing agree.
* The worked example uses R1 = 0000 1101 (= 13) and applies load, shift-left, shift-right and
  rotate to the same eight flip-flops.
* The last slide doubles as Q&A backup: four short answers to the questions an examiner is
  most likely to ask.
