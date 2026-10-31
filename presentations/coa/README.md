# Binary Storage and Registers — COA theory presentation

Two lengths of the same talk, both 16:9, plus a printable presenter script.

| File | What it is |
|------|------------|
| **`Binary_Storage_and_Registers_8slides_COA.pptx`** | **8 slides — the main deliverable** |
| **`Presenter_Script_8slides.docx`** | **word-for-word script + cheat sheet to hold while presenting** |
| `Binary_Storage_and_Registers_COA.pptx` | longer 16-slide version if you get more time |

## Presenting it even if you know nothing

Three layers of help are built in:

1. **A green "SAY THIS" band on every slide.** One plain sentence, printed on the slide
   itself, in the least technical words possible. If your mind goes blank, read that
   sentence and move on — it is the whole point of the slide.
2. **Full script in the speaker notes.** In PowerPoint use *Slide Show → Presenter View* and
   the notes appear on your screen only. Each notes page has: the one-liner, the word-for-word
   lines, and an "if asked" answer.
3. **`Presenter_Script_8slides.docx`.** The same script on paper: plain summary, one analogy,
   the lines to say, the likely question, what to say next — plus a one-page cheat sheet of
   every number and a timing plan.

## The 8 slides

| # | Slide | What you are really saying |
|---|-------|----------------------------|
| 1 | Title | Two questions: how is a bit kept, and where |
| 2 | What we will cover | One ladder: bits → bit-holder → register → control → placement |
| 3 | Binary: two states, and 2ⁿ patterns | A bit is ON/OFF; each extra bit doubles the values |
| 4 | A bit needs a circuit that can hold a state | A flip-flop remembers by feeding its output back in |
| 5 | A register is n flip-flops sharing one clock | Many flip-flops, updated together, named directly |
| 6 | Control: load, shift, and the shared bus | A signal decides when to change; one driver at a time |
| 7 | Where registers sit, and one worked example | Registers are fastest and smallest; then load/shift/rotate |
| 8 | Summary and questions | Five sentences + four likely questions with answers |

Timing: ≈8 minutes of talking, leaving room for questions.

## Editing / regenerating

```bash
pip install python-pptx python-docx pillow
python3 build_deck_8.py        # 8-slide deck   (+ reads script_8.py for the SAY THIS bands)
python3 build_script_doc.py    # presenter script .docx
python3 build_deck.py          # 16-slide deck
python3 preview.py             # optional PNG check renders into preview/
```

* `script_8.py` — **the words**. Edit the `plain`, `analogy`, `script` and `if_asked`
  fields here and re-run both builders; the slide band, the speaker notes and the paper
  script all update together.
* `deckkit.py` — shared drawing helpers (colours, measured text with auto-shrink, cards,
  tables, wiring, the SAY THIS band).
* `preview.py` — Pillow rasteriser used while authoring (no PowerPoint/LibreOffice in the
  build environment). Checking tool only.

Numbers follow Mano / Stallings: 2ⁿ patterns, 1 KB = 2¹⁰ B, DRAM refresh ≈ 64 ms,
flip-flop ≈ 6 transistors vs. a 1T1C DRAM cell.
