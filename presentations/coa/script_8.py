# -*- coding: utf-8 -*-
"""
The spoken script for the 8-slide deck, in plain words.

Each entry feeds two things at once:
  * the "SAY THIS" band printed on the slide (so the slide itself carries the
    one sentence you must not forget), and
  * the full word-for-word speaker notes (so you can present even if you have
    never studied the topic).

`sentences` is the casual, no-jargon version used in the printable script.
"""

SLIDES = [
    # ------------------------------------------------------------------ 1
    dict(
        n=1,
        title="Title",
        plain="My topic is how a computer stores 1s and 0s, and where it keeps them.",
        analogy="",
        script=[
            "Good morning. My topic is Binary Storage and Registers.",
            "My aim is simple: to answer two questions.",
            "First, how does a machine that only understands ON and OFF keep a "
            "number?",
            "Second, where does it keep that number while it is calculating?",
            "By the end you will see that the answer to the first is a tiny circuit "
            "called a flip-flop, and the answer to the second is a register.",
        ],
        if_asked="Nothing yet - just set up the two questions.",
        transition="Let me show you the plan.",
    ),
    # ------------------------------------------------------------------ 2
    dict(
        n=2,
        title="What we will cover",
        plain="Six short steps, and each one uses the step before it.",
        analogy="It is one ladder: bits, then a bit-holder, then many bit-holders in a row.",
        script=[
            "Here is the route I will follow, and it is a ladder.",
            "Step one: bits - what binary is and how many values fit in a few bits.",
            "Step two: the small circuit that can hold one bit.",
            "Step three: a register - just many of those circuits in a row.",
            "Step four: how we control a register, move values between registers, and "
            "share one wire between them.",
            "Step five: where registers sit in the computer, plus one worked example.",
            "Step six: a short summary, and then your questions.",
        ],
        if_asked="No numbers to remember here, just the order.",
        transition="Start with the smallest piece: a single bit.",
    ),
    # ------------------------------------------------------------------ 3
    dict(
        n=3,
        title="Binary: two states, and 2ⁿ patterns",
        plain="A bit is just ON or OFF. Each extra bit doubles the values you can store.",
        analogy="Think of light switches: one switch = 2 states, two switches = 4 states, "
                "three switches = 8. Each new switch doubles the list.",
        script=[
            "Everything inside a computer is either ON or OFF. We write ON as 1 and "
            "OFF as 0, and one such digit is called a bit.",
            "Why only two states? Because a transistor that is fully off or fully on is "
            "cheap, fast, and does not get confused by small electrical noise.",
            "Here is eight bits in a row, and above each one its weight: 128, 64, 32, "
            "16, 8, 4, 2, 1. To read the number, add the weights where there is a 1.",
            "In this example 128 plus 32 plus 16 plus 4 gives 180. The same eight bits "
            "can be written as 180 in decimal, or as B4 in hexadecimal - it is the same "
            "value, just a shorter way of writing it.",
            "Now the pattern to remember: with n bits you can make two to the power n "
            "different values. One bit gives 2, four bits give 16, eight bits give 256, "
            "and thirty-two bits give about 4.3 billion - which is why there are that "
            "many internet addresses in IPv4.",
            "And because memory is addressed with bits, sizes also come in powers of "
            "two: one kilobyte is 1024 bytes, not 1000.",
        ],
        if_asked="If someone asks why 1024: k address bits give 2^k locations, so "
                 "capacities naturally land on powers of two.",
        transition="We know how to write a bit. Now, what actually stores it?",
    ),
    # ------------------------------------------------------------------ 4
    dict(
        n=4,
        title="A bit needs a circuit that can hold a state",
        plain="A flip-flop remembers one bit by feeding its own output back into itself.",
        analogy="Think of two people each repeating what the other says - the sentence "
                "keeps going by itself. That loop is the memory.",
        script=[
            "A bit has to survive after we stop sending it, so we need a circuit that "
            "can hold a state. There are three you should know.",
            "First, the SR latch: two NOR gates whose outputs feed each other's inputs. "
            "Because each gate keeps the other going, the value stays put with no clock "
            "at all. It is simple, but it reacts to its inputs at any time, which makes "
            "large designs messy.",
            "Second, the D flip-flop. It only looks at its input at the moment the clock "
            "ticks - the rising edge. So the whole circuit moves in step, and we get "
            "predictable timing. This is the standard one-bit memory, and it is what a "
            "register is built from.",
            "Third, the DRAM cell used in main memory: one transistor and one capacitor. "
            "Charge on the capacitor means 1, no charge means 0. It is tiny, so you get "
            "gigabytes, but the charge leaks away, so it must be refreshed about every "
            "64 milliseconds.",
            "That is the trade-off to remember: a flip-flop uses about six transistors "
            "per bit and never needs refreshing - fast, and used inside the processor. A "
            "DRAM cell uses one transistor plus a capacitor and needs refresh - cheap and "
            "dense, and used for main memory.",
        ],
        if_asked="If asked why DRAM needs refreshing: the capacitor leaks, so every cell "
                 "is read and written back periodically.",
        transition="Now put several flip-flops side by side.",
    ),
    # ------------------------------------------------------------------ 5
    dict(
        n=5,
        title="A register is n flip-flops sharing one clock",
        plain="A register is a row of flip-flops that all take a new value at the same "
              "instant.",
        analogy="It is a row of switches you flip together, so the number is never seen "
                "half-changed.",
        script=[
            "A register is nothing new. It is a group of flip-flops, one per bit, sharing "
            "one clock line.",
            "Because all of them hear the same clock edge, all bits change together. You "
            "never read a register and find half the new value and half the old one.",
            "The width is just the count: an eight-bit register is eight flip-flops, a "
            "sixty-four-bit register is sixty-four. And a register has no address - the "
            "instruction names it directly, which is why using it costs one cycle instead "
            "of a trip to memory.",
            "The table shows the registers you meet inside a processor. The program "
            "counter holds the address of the next instruction, which is what makes a "
            "program a sequence. The instruction register holds the instruction being "
            "decoded. The memory address and memory data registers are the only way to "
            "talk to memory. The accumulator keeps an intermediate result, the stack "
            "pointer makes function calls possible, and the status register holds the "
            "flags used by conditional branches.",
            "Finally, the notation. R2 arrow R1 means copy R1 into R2. Read it right to "
            "left: the source is copied, the destination is overwritten. It only happens "
            "when the control signal for that transfer is 1.",
        ],
        if_asked="If asked 'does R1 lose its value?' - no, a transfer is a copy.",
        transition="So what decides when a register updates? That is the control slide.",
    ),
    # ------------------------------------------------------------------ 6
    dict(
        n=6,
        title="Control: load, shift, and the shared bus",
        plain="A register changes only when a control signal tells it to - and only one "
              "register may drive the shared wire.",
        analogy="A bus is a single-lane road: many cars are parked beside it, but only one "
                "may drive on it at a time.",
        script=[
            "Three small ideas control everything.",
            "One: parallel load. In front of every flip-flop there is a two-to-one "
            "selector. If the Load signal is 1, the selector passes the new data in. If "
            "Load is 0, it feeds the flip-flop's own output back, so the value is held. "
            "That is why processors have write-enable signals.",
            "Two: shifting. Connect each flip-flop's output to the next one's input, and "
            "with each clock every bit moves one place. Shifting left multiplies by two, "
            "shifting right divides by two, and a rotate sends the bit that falls off one "
            "end back in at the other end so nothing is lost. The little table shows 1011 "
            "moving right, one position per clock.",
            "Three: the bus. If every register had its own private path to every other "
            "register, the wiring would grow with the square of the number of registers. "
            "Instead they all share one bus, through tri-state buffers which can be 0, 1, "
            "or disconnected - that third state is called high impedance.",
            "But here is the rule: exactly one register may be enabled at a time. If two "
            "drive the wire together, one tries to pull it high while the other pulls it "
            "low, and that is a short circuit, not just a wrong value.",
        ],
        if_asked="If asked what the third state is: high impedance, electrically "
                 "disconnected, so the wire is left alone.",
        transition="Two slides left: where registers sit, and a worked example.",
    ),
    # ------------------------------------------------------------------ 7
    dict(
        n=7,
        title="Where registers sit, and one worked example",
        plain="Registers are the fastest and smallest storage, because they are built from "
              "flip-flops.",
        analogy="A desk drawer, a shelf, and a warehouse: the drawer is fastest but holds "
                "almost nothing.",
        script=[
            "The bit in a register and the bit in main memory are logically the same, but "
            "physically very different.",
            "Registers sit inside the processor: a few dozen of them, read in under a "
            "nanosecond. Cache is next, kilobytes to megabytes at a few nanoseconds. Main "
            "memory is gigabytes but takes tens of nanoseconds, and a disk takes "
            "microseconds to milliseconds.",
            "Why not make everything registers? Because a flip-flop costs about six "
            "transistors per bit while a DRAM cell costs one transistor and a capacitor. "
            "You could never fit gigabytes that way.",
            "Now one worked example, all on the same eight flip-flops. R1 holds 0000 1101, "
            "which is 13.",
            "A load with 11010110 overwrites the whole word at once - that is the load "
            "enable doing its job. A left shift gives 0001 1010, which is 26: doubled. A "
            "right shift gives 0000 0110, which is 6: the half that did not fit is lost. A "
            "rotate gives 1000 0110, which is 134, and nothing was lost because the bit "
            "that left one end came back at the other.",
            "Same hardware every time. Only the control signals changed.",
        ],
        if_asked="If asked why 13/2 is 6 and not 6.5: shifting drops the remainder - it is "
                 "integer division.",
        transition="Let me bring it together.",
    ),
    # ------------------------------------------------------------------ 8
    dict(
        n=8,
        title="Summary and questions",
        plain="Five sentences: binary, the bit cell, the register, the control signals, "
              "and the hierarchy.",
        analogy="",
        script=[
            "To finish, five sentences.",
            "One: binary is a hardware decision. Two states are cheap and reliable, and n "
            "bits give two to the power n values.",
            "Two: a bit is held by a circuit that can sit stably in one of two states - a "
            "flip-flop for speed, a capacitor for density.",
            "Three: a register is a row of those flip-flops on one clock, so a word is "
            "never read half-written.",
            "Four: control signals decide what happens - load to write, shift to move, "
            "tri-state enables to share one bus, one driver at a time.",
            "Five: that is exactly why the hierarchy looks the way it does - fast and tiny "
            "at the top, slow and huge at the bottom.",
            "On the right are the four questions I would expect, with short answers. "
            "Thank you - I am happy to take questions.",
        ],
        if_asked="",
        transition="",
    ),
]
