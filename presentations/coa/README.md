# Binary Storage and Registers — COA theory presentation

**Deliverable:** `Binary_Storage_and_Registers_COA.pptx` (16 slides, 16:9, speaker notes on every slide).

Open it in PowerPoint, fill in `<Your Name>` / `<Roll No>` on slide 1, and you are ready to present.

## Slide map (≈14–15 minutes)

| # | Slide | Section |
|---|-------|---------|
| 1 | Title | — |
| 2 | What we will cover | Agenda |
| 3 | Why binary? What can one bit hold? | 01 Representation |
| 4 | Writing the same value in different bases | 01 Representation |
| 5 | From a bit to a terabyte | 01 Representation |
| 6 | Where does one bit physically live? (SR latch / D flip-flop / DRAM cell) | 02 Storage elements |
| 7 | A register is n flip-flops sharing one clock | 03 The register |
| 8 | Register transfer notation: R1 ← R2 | 03 The register |
| 9 | Registers you will meet inside a CPU | 03 The register |
| 10 | Controlling a register: the load enable | 04 Control |
| 11 | Shift registers: moving bits, not copying them | 04 Control |
| 12 | Many registers, one bus: tri-state buffers | 04 Control |
| 13 | Where registers sit: the memory hierarchy | 05 Placement |
| 14 | Worked example: one 8-bit register | 06 Example |
| 15 | Summary | Recap |
| 16 | Thank you — sources + likely questions | — |

## Editing

The deck is generated, so you can either edit the `.pptx` directly in PowerPoint, or change
`build_deck.py` and regenerate:

```bash
pip install python-pptx pillow
python3 build_deck.py            # writes the .pptx
python3 preview.py               # optional: renders preview/slide-NN.png for a visual check
```

`preview.py` is a small Pillow rasteriser used during authoring because there is no
PowerPoint/LibreOffice in the build environment. It is only a checking tool — not needed to
present.

## Content notes

* Numbers used throughout are the standard ones from Mano / Stallings: 2ⁿ patterns, 1 KB =
  2¹⁰ bytes, DRAM refresh ≈ 64 ms, flip-flop ≈ 6 transistors vs. 1T1C DRAM cell.
* Slide 11's timing table starts from 1011 and shifts right one position per clock, so the
  table and the text agree.
* Slide 14 uses R1 = 0000 1101 (= 13) and then shows load / shift-left / shift-right / rotate
  on the same eight flip-flops.
* Slide 16 doubles as your Q&A backup — four short answers to the questions an examiner is
  most likely to ask.
