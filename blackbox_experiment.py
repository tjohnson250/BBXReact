#!/usr/bin/env python3
"""
Black Box Experiment Runner (Non-Anthropic Models)
===================================================
Runs Black Box experiments against OpenAI, Google Gemini, and DeepSeek models.
Outputs results in the same JSON format as the React app for cross-model comparison.

Usage:
    python blackbox_experiment.py                        # uses experiment_config.yaml
    python blackbox_experiment.py --config my_config.yaml
    python blackbox_experiment.py --config my_config.yaml --dry-run

Requirements:
    pip install openai google-genai pyyaml
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml

# ---------------------------------------------------------------------------
# Game Constants & Configurations (mirrored from blackbox.jsx)
# ---------------------------------------------------------------------------

GRID_SIZE = 8
NUM_ATOMS = 4

EXPERIMENT_CONFIGS = [
    [[2, 3], [3, 6], [6, 2], [7, 7]],   # Config 1: Spread
    [[1, 1], [1, 3], [2, 2], [5, 6]],   # Config 2: Cluster in corner
    [[2, 2], [4, 4], [6, 6], [8, 8]],   # Config 3: Diagonal
    [[1, 4], [4, 8], [8, 5], [5, 1]],   # Config 4: Edge-heavy
    [[3, 4], [4, 3], [4, 5], [5, 4]],   # Config 5: Central cluster
    [[2, 2], [2, 3], [2, 4], [4, 2]],   # Config 6: L-shape
    [[1, 1], [1, 8], [8, 1], [8, 8]],   # Config 7: Corners
    [[2, 7], [3, 2], [6, 5], [7, 3]],   # Config 8: Asymmetric
    [[4, 2], [4, 4], [4, 6], [4, 8]],   # Config 9: Row cluster
    [[1, 5], [3, 3], [5, 7], [8, 2]],   # Config 10: Mixed
]

# ---------------------------------------------------------------------------
# Prompts (identical to blackbox.jsx)
# ---------------------------------------------------------------------------

BASELINE_PLAY_PROMPT = r"""You are playing Black Box, a game of hide and seek played on an 8 by 8 grid (the Black Box).

Your opponent has hidden 4 atoms within this box. By shooting rays into the box and observing where they emerge, it is possible to deduce the positions of the hidden atoms.

GRID: 8x8, rows 1-8 (top to bottom), columns 1-8 (left to right).
RAYS: Fire from edge positions - NORTH/SOUTH use columns 1-8, EAST/WEST use rows 1-8.

There are three possible outcomes for each ray you send into the box:

DETOUR: The ray is deflected and emerges somewhere other than where you sent it in. Detours are denoted by matching pairs of numbers -- one where the ray went in, and the other where it came out.

REFLECTION (R): The ray is reflected and emerges in the same place it was sent in.

HIT (H): The ray strikes an atom directly and is absorbed. It does not emerge from the box.

The rules for how atoms deflect rays are simple and are best shown by example.

As a ray approaches an atom it is deflected ninety degrees. Rays can be deflected multiple times. In the diagrams below, the dashes represent empty box locations and the letter O represents an atom. The entrance and exit points of each ray are marked with numbers. Note that the entrance and exit points are always interchangeable. * denotes the path taken by the ray.

Note carefully the relative positions of the atom and the ninety degree deflection it causes.

    1                                            
  - * - - - - - -         - - - - - - - -         - - - - - - - -       
  - * - - - - - -         - - - - - - - -         - - - - - - - -       
1 * * - - - - - -         - - - - - - - -         - O - - - - O -       
  - - O - - - - -         - - O - - - - -         - - * * * * - -
  - - - - - - - -         - - - * * * * * 2     3 * * * - - * - -
  - - - - - - - -         - - - * - - - -         - - - O - * - -      
  - - - - - - - -         - - - * - - - -         - - - - * * - -       
  - - - - - - - -         - - - * - - - -         - - - - * - O -       
                                2                         3

A reflection occurs when a ray emerges from the same point it was sent in. This can happen in several ways:

                                                                           
  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - O - - -         - - O - O - - -          - - - - - - - -
R * * * * - - - -         - - - * - - - -          O - - - - - - -
  - - - - O - - -         - - - * - - - -        R - - - - - - - -
  - - - - - - - -         - - - * - - - -          - - - - - - - -
  - - - - - - - -         - - - * - - - -          - - - - - - - -
  - - - - - - - -       R * * * * - - - -          - - - - - - - -
  - - - - - - - -         - - - - O - - -          - - - - - - - -

In the first example, the ray is deflected downwards by the upper atom, then left by the lower atom, and finally retraces its path to its point of origin. The second example is similar. The third example is a bit anomalous but can be rationalized by realizing the ray never gets a chance to get into the box. Alternatively, the ray can be thought of as being deflected downwards and immediately emerging from the box.

A hit occurs when a ray runs straight into an atom:

  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - O - - -
  - - - - - - - -         - - - - O - - -        H * * * * - - - -
  - - - - - - - -       H * * * * O - - -          - - - * - - - -
  - - - - - - - -         - - - - O - - -          - - - O - - - -
H * * * O - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - - - - -

Be sure to compare the second example of a hit with the first example of a reflection.

Important: A hit takes priority over a reflection. If an atom is in the entry cell, the ray is absorbed even if there are also atoms diagonally adjacent that would otherwise cause a reflection:

  O - - - - - - -
H O - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -

In this example, even though there is an atom at row 1 that would normally cause an edge reflection, the atom at row 2 absorbs the ray first.

SCORING:
Your goal is to minimize your score. Lower is better.
- Each ray entry point costs 1 point
- Each ray exit point costs 1 point (detours cost 2 total, reflections cost 1, absorptions cost 1)
- Each missed atom costs 5 points

Strategy: Use as few rays as possible while still finding all 4 atoms.

RULES:
- You cannot fire from positions already used as entry or exit points.
- Maximum 20 rays.

Respond with JSON only:
{"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
{"action": "guess", "atoms": [[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}

When you think you know where all 4 atoms are, make your guess."""

BASELINE_PREDICT_PROMPT = r"""Predict where a ray will exit in Black Box.

GRID: 8x8, rows 1-8 (top to bottom), columns 1-8 (left to right).
EDGES: NORTH/SOUTH use columns 1-8, EAST/WEST use rows 1-8.

As a ray approaches an atom it is deflected ninety degrees. Rays can be deflected multiple times. In these diagrams, - is empty, O is an atom, * is the ray path.

DEFLECTION examples (note carefully the relative position of atom and deflection):

    1                                            
  - * - - - - - -         - - - - - - - -         - - - - - - - -       
  - * - - - - - -         - - - - - - - -         - - - - - - - -       
1 * * - - - - - -         - - - - - - - -         - O - - - - O -       
  - - O - - - - -         - - O - - - - -         - - * * * * - -
  - - - - - - - -         - - - * * * * * 2     3 * * * - - * - -
  - - - - - - - -         - - - * - - - -         - - - O - * - -      
  - - - - - - - -         - - - * - - - -         - - - - * * - -       
  - - - - - - - -         - - - * - - - -         - - - - * - O -       
                                2                         3

REFLECTION examples:
                                                                           
  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - O - - -         - - O - O - - -          - - - - - - - -
R * * * * - - - -         - - - * - - - -          O - - - - - - -
  - - - - O - - -         - - - * - - - -        R - - - - - - - -
  - - - - - - - -         - - - * - - - -          - - - - - - - -
  - - - - - - - -         - - - * - - - -          - - - - - - - -
  - - - - - - - -       R * * * * - - - -          - - - - - - - -
  - - - - - - - -         - - - - O - - -          - - - - - - - -

Edge reflection (right) occurs when an atom is adjacent to the entry point.

HIT examples:
  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - O - - -
  - - - - - - - -         - - - - O - - -        H * * * * - - - -
  - - - - - - - -       H * * * * O - - -          - - - * - - - -
  - - - - - - - -         - - - - O - - -          - - - O - - - -
H * * * O - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - - - - -

Important: A hit takes priority over a reflection.

Respond with JSON only:
{"exit_side": "north|south|east|west", "exit_position": 1-8, "reasoning": "step by step trace"}
OR: {"absorbed": true, "reasoning": "..."}
OR: {"reflected": true, "reasoning": "..."}"""

AUGMENTED_PLAY_PROMPT = r"""You are playing Black Box. Find exactly 4 hidden atoms in an 8x8 grid by firing rays.

GRID: 8x8, rows 1-8 (top to bottom), columns 1-8 (left to right).
RAYS: Fire from edge positions (north/south: columns 1-8, east/west: rows 1-8).

IMPORTANT: You cannot fire a ray from any position that has already been used as an entry or exit point.

=== RAY BEHAVIOR RULES ===

All directions use the fixed board frame: NORTH (up/row-decreasing), SOUTH (down/row-increasing), EAST (right/col-increasing), WEST (left/col-decreasing).

A ray starts OUTSIDE the grid at the edge position it was fired from. It then attempts to enter the grid cell by cell.

ENTRY CHECK (before entering the first cell):
- If there is an atom in the entry cell → ABSORBED (H)
- If there is an atom in either cell adjacent to the entry cell along the edge → REFLECTED (R) - ray never enters, exits at entry point
- Otherwise, enter the first cell

SUBSEQUENT CELLS (before entering each following cell), check in this order:

1. Is there an atom in the cell the ray is about to enter? → ABSORBED (H) - ray stops

2. Check the two cells perpendicular to the ray's path, adjacent to the cell the ray is about to enter:
   - Atoms on BOTH sides → REFLECT (reverse direction)
   - Atom on ONE side only → DEFLECT 90° away from the atom (the ray turns to travel in the direction opposite to where the atom is)
   
   DEFLECTION BY RAY DIRECTION (all directions are board compass directions):
   - Ray traveling SOUTH: atom to EAST of next cell → turn to travel WEST; atom to WEST → turn EAST
   - Ray traveling NORTH: atom to EAST of next cell → turn to travel WEST; atom to WEST → turn EAST
   - Ray traveling EAST: atom to NORTH of next cell → turn to travel SOUTH; atom to SOUTH → turn NORTH
   - Ray traveling WEST: atom to NORTH of next cell → turn to travel SOUTH; atom to SOUTH → turn NORTH
   
3. If none of the above, enter the next cell and continue.

4. If the ray exits the grid boundaries, report the exit position.

=== COMMON REASONING ERROR - AVOID THIS ===

WRONG: "NORTH-4 exits at EAST-7, so there MUST be an atom at (row 8, column 3)"

This is WRONG because:
- The exit position tells you where the ray LEFT the grid, nothing more
- The most parsimonious explanation (single atom) for NORTH-4 → EAST-7 is an atom at (row 8, column 3)
- The same pattern could also be caused by 3 atoms in a specific arrangement
- In most cases, you cannot deduce atom positions from a single deflected ray

=== CRITICAL DEDUCTION RULES ===

MOST OBSERVATIONS ARE AMBIGUOUS ALONE - you must triangulate with multiple rays.

ABSORBED (H) - AMBIGUOUS:
- The ray hit an atom somewhere, but may have deflected multiple times first
- In most cases, you CANNOT assume the atom is in the entry row/column
- Example: NORTH-3 absorbed does NOT mean atom is in column 3

STRAIGHT PASS-THROUGH (opposite entry/exit, same position) - AMBIGUOUS:
- Most likely means clear path with no nearby atoms
- BUT could result from symmetric deflections canceling out
- Don't over-rely on this observation

REFLECTION (R) - ALSO AMBIGUOUS:
- An "R" result means entry position equals exit position
- This could be immediate reflection (atom diagonally adjacent to entry cell)
- OR a complex path that happens to return to the entry point
- Only corner positions (1 and 8) are guaranteed to be immediate reflections
- Most single observations in this game are ambiguous

90° EXIT (different side, perpendicular) - VERY AMBIGUOUS:
- At least one deflection occurred, possibly many
- The ray may have zigzagged across the grid
- Use additional rays to triangulate

OFFSET EXIT (opposite side, different position) - AMBIGUOUS:
- Multiple deflections occurred
- Hard to interpret without additional rays

=== STRATEGY ===
1. Most single observations are ambiguous - nearly every deduction requires triangulation
2. Use multiple rays to constrain possibilities
3. Look for patterns across multiple observations
4. Cross-reference ALL observations - proposed atoms must explain every ray's behavior
5. Before guessing, mentally verify: would these 4 atoms produce all observed ray behaviors?
6. Accept uncertainty - this is a constraint satisfaction problem, not simple deduction

=== SCORING ===
Your goal is to MINIMIZE your score. Lower is better.
- Each ray entry point costs 1 point
- Each ray exit point costs 1 point (detours cost 2, reflections cost 1, absorptions cost 1)
- Each missed atom costs 5 points

Balance information gathering against point cost. Use as few rays as possible while still finding all 4 atoms accurately.

Respond with JSON only:
Fire ray: {"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
Final guess: {"action": "guess", "atoms": [[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}

Max 20 rays. Be strategic and cross-reference observations."""

AUGMENTED_PREDICT_PROMPT = r"""You are testing your understanding of Black Box ray tracing rules.

Given the atom positions and a ray entry point, predict exactly where the ray will exit (or if it will be absorbed/reflected).

=== RAY BEHAVIOR RULES ===

All directions use the fixed board frame: NORTH (up/row-decreasing), SOUTH (down/row-increasing), EAST (right/col-increasing), WEST (left/col-decreasing).

A ray starts OUTSIDE the grid at the edge position it was fired from. It then attempts to enter the grid cell by cell.

ENTRY CHECK (before entering the first cell):
- If there is an atom in the entry cell → ABSORBED (H)
- If there is an atom in either cell adjacent to the entry cell along the edge → REFLECTED (R) - ray never enters, exits at entry point
- Otherwise, enter the first cell
- Example: NORTH-4 targets entry cell (1,4). If there's an atom at (1,4), the ray is absorbed. If there's an atom at (1,3) or (1,5), the ray reflects immediately without entering (1,4). Otherwise it enters (1,4).

SUBSEQUENT CELLS (before entering each following cell), check in this order:

1. Is there an atom in the cell the ray is about to enter? → ABSORBED (H) - ray stops

2. Check the two cells perpendicular to the ray's path, adjacent to the cell the ray is about to enter:
   - Atoms on BOTH sides → REFLECT (reverse direction)
   - Atom on ONE side only → DEFLECT 90° away from the atom (the ray turns to travel in the direction opposite to where the atom is)
   
   DEFLECTION BY RAY DIRECTION (all directions are board compass directions):
   - Ray traveling SOUTH: atom to EAST of next cell → turn to travel WEST; atom to WEST → turn EAST
   - Ray traveling NORTH: atom to EAST of next cell → turn to travel WEST; atom to WEST → turn EAST
   - Ray traveling EAST: atom to NORTH of next cell → turn to travel SOUTH; atom to SOUTH → turn NORTH
   - Ray traveling WEST: atom to NORTH of next cell → turn to travel SOUTH; atom to SOUTH → turn NORTH
   
3. If none of the above, enter the next cell and continue.

4. If the ray exits the grid boundaries, it exits at that edge position.

GRID: 8x8, rows 1-8 (top to bottom), columns 1-8 (left to right).
Edges: NORTH/SOUTH use column numbers 1-8, EAST/WEST use row numbers 1-8.

Respond with JSON only:
{"exit_side": "north|south|east|west", "exit_position": 1-8, "reasoning": "step by step trace"}
OR for absorption:
{"absorbed": true, "reasoning": "step by step trace"}
OR for reflection (exits at entry):
{"reflected": true, "reasoning": "step by step trace"}

Trace the ray step by step in your reasoning."""

PROMPT_STYLES = {
    "baseline": {
        "name": "Baseline",
        "description": "Human-equivalent rules (Emacs style)",
        "playPrompt": BASELINE_PLAY_PROMPT,
        "predictPrompt": BASELINE_PREDICT_PROMPT,
    },
    "augmented": {
        "name": "Augmented",
        "description": "Detailed strategy guidance",
        "playPrompt": AUGMENTED_PLAY_PROMPT,
        "predictPrompt": AUGMENTED_PREDICT_PROMPT,
    },
}

VOT_PROMPTS = {
    "gridState": """
=== VISUALIZATION: GRID STATE TRACKING ===
Before each action, draw the current 8x8 grid state in your reasoning:
- Use '.' for unknown cells
- Use '?' for cells where you suspect an atom might be
- Use 'X' for cells you've ruled out
- Use '*' for cells a ray has passed through
- Mark edge results (H, R, or exit numbers) around the border

This helps you see patterns and constrain possibilities spatially.
""",
    "rayTrace": """
=== VISUALIZATION: RAY PATH DRAWING ===
When analyzing a ray result, draw its path through the grid:
- Show the ray's trajectory with arrows or path markers
- Mark the entry and exit points
- Identify which cells the ray must have passed through
- Note which cells could contain deflecting atoms

Example format:
    1 2 3 4 5 6 7 8
  1 . . . . . . . .
  2 . . . ← ← ← ← ←  (ray entered EAST-2)
  3 . . . ↓ . . . .
  4 . . . ↓ . . . .  (deflected south by atom to east)
  5 . . . → → → X .  (exited EAST-5)
""",
    "hypothesis": """
=== VISUALIZATION: HYPOTHESIS VERIFICATION ===
When forming hypotheses about atom locations, draw your proposed configuration and mentally trace ALL previous rays through it:

1. Draw the grid with your 4 hypothesized atom positions marked as 'O'
2. For EACH ray fired so far, trace its path through this configuration
3. Verify: does each ray produce the observed result (H, R, or correct exit)?
4. If ANY ray doesn't match, your hypothesis is WRONG - revise and try again

Example verification:
    1 2 3 4 5 6 7 8
  1 . . O . . . . .   Hypothesized atoms: (1,3), (4,6), (6,2), (8,5)
  2 . . . . . . . .
  3 . . . . . . . .   Check NORTH-3: Should hit atom at (1,3) → H ✓
  4 . . . . . O . .   Check WEST-4: ...trace path... → exits SOUTH-6 ✓
  5 . . . . . . . .   Check EAST-6: ...trace path... → expected R, got H ✗
  6 . O . . . . . .   HYPOTHESIS FAILED - need to revise!
  7 . . . . . . . .
  8 . . . . O . . .

ALWAYS verify before making your final guess.
""",
}


# ---------------------------------------------------------------------------
# Game Logic (ported from blackbox.jsx)
# ---------------------------------------------------------------------------

def config_to_atom_set(config: list[list[int]]) -> set[str]:
    return {f"{r},{c}" for r, c in config}


def get_key(row: int, col: int) -> str:
    return f"{row},{col}"


def get_diagonals_ahead(row: int, col: int, dr: int, dc: int):
    if dr == 1:
        return {"left": (row + 1, col + 1), "right": (row + 1, col - 1)}
    if dr == -1:
        return {"left": (row - 1, col - 1), "right": (row - 1, col + 1)}
    if dc == 1:
        return {"left": (row - 1, col + 1), "right": (row + 1, col + 1)}
    return {"left": (row + 1, col - 1), "right": (row - 1, col - 1)}


def trace_ray(atoms: set[str], entry_side: str, entry_pos: int) -> dict:
    """Trace a ray through the grid. Returns same structure as JS traceRay."""
    path = []

    if entry_side == "north":
        row, col, dr, dc = 0, entry_pos, 1, 0
    elif entry_side == "south":
        row, col, dr, dc = GRID_SIZE + 1, entry_pos, -1, 0
    elif entry_side == "west":
        row, col, dr, dc = entry_pos, 0, 0, 1
    else:  # east
        row, col, dr, dc = entry_pos, GRID_SIZE + 1, 0, -1

    entry = {"side": entry_side, "pos": entry_pos}

    entry_row = row + dr
    entry_col = col + dc

    # Check if entry cell has atom → ABSORBED
    if get_key(entry_row, entry_col) in atoms:
        return {"entry": entry, "exit": None, "path": [[entry_row, entry_col]], "absorbed": True}

    # Check diagonals for edge reflection
    init_diags = get_diagonals_ahead(row, col, dr, dc)
    if (get_key(*init_diags["left"]) in atoms or get_key(*init_diags["right"]) in atoms):
        return {"entry": entry, "exit": {"side": entry_side, "pos": entry_pos}, "path": [], "absorbed": False}

    for _ in range(100):
        row += dr
        col += dc

        if row < 1 or row > GRID_SIZE or col < 1 or col > GRID_SIZE:
            if row < 1:
                exit_side, exit_pos = "north", col
            elif row > GRID_SIZE:
                exit_side, exit_pos = "south", col
            elif col < 1:
                exit_side, exit_pos = "west", row
            else:
                exit_side, exit_pos = "east", row
            return {"entry": entry, "exit": {"side": exit_side, "pos": exit_pos}, "path": path, "absorbed": False}

        path.append([row, col])

        if get_key(row, col) in atoms:
            return {"entry": entry, "exit": None, "path": path, "absorbed": True}

        ahead = (row + dr, col + dc)
        if get_key(*ahead) not in atoms:
            diags = get_diagonals_ahead(row, col, dr, dc)
            left_atom = get_key(*diags["left"]) in atoms
            right_atom = get_key(*diags["right"]) in atoms

            if left_atom and right_atom:
                dr, dc = -dr, -dc
            elif left_atom:
                dr, dc = dc, -dr
            elif right_atom:
                dr, dc = -dc, dr

    return {"entry": entry, "exit": None, "path": path, "absorbed": False, "error": "max_steps"}


def format_ray_result(ray: dict) -> str:
    e = ray["entry"]
    if ray["absorbed"]:
        return f"Ray from {e['side'].upper()}-{e['pos']}: ABSORBED"
    ex = ray.get("exit")
    if ex and e["side"] == ex["side"] and e["pos"] == ex["pos"]:
        return f"Ray from {e['side'].upper()}-{e['pos']}: REFLECTED"
    if ex:
        return f"Ray from {e['side'].upper()}-{e['pos']}: Exited at {ex['side'].upper()}-{ex['pos']}"
    return f"Ray from {e['side'].upper()}-{e['pos']}: UNKNOWN"


def generate_text_board(rays: list, grid_size: int = 8, atom_set: set = None,
                        hypotheses: set = None) -> str:
    edge_markers = {"north": {}, "south": {}, "east": {}, "west": {}}

    for ray in rays:
        es = ray["entry"]["side"]
        ep = ray["entry"]["pos"]
        if ray["absorbed"]:
            edge_markers[es][ep] = "H"
        elif ray.get("exit") and ray["entry"]["side"] == ray["exit"]["side"] and ray["entry"]["pos"] == ray["exit"]["pos"]:
            edge_markers[es][ep] = "R"
        elif ray.get("exit"):
            edge_markers[es][ep] = ray.get("id", "?")
            edge_markers[ray["exit"]["side"]][ray["exit"]["pos"]] = ray.get("id", "?")

    board = "     "
    for c in range(1, grid_size + 1):
        board += f"{c} "
    board += "\n"

    board += "     "
    for c in range(1, grid_size + 1):
        m = edge_markers["north"].get(c, " ")
        board += f"{m} "
    board += "\n"

    for r in range(1, grid_size + 1):
        board += f" {r}"
        wm = edge_markers["west"].get(r)
        board += (f"{str(wm):>2} " if wm is not None else "   ")
        for c in range(1, grid_size + 1):
            ck = f"{r},{c}"
            if atom_set and ck in atom_set:
                board += "O "
            elif hypotheses and ck in hypotheses:
                board += "X "
            else:
                board += "- "
        em = edge_markers["east"].get(r)
        board += str(em) if em is not None else " "
        board += "\n"

    board += "     "
    for c in range(1, grid_size + 1):
        m = edge_markers["south"].get(c, " ")
        board += f"{m} "
    board += "\n"

    board += "\nColumns 1-8 (top/bottom), Rows 1-8 (left)\n"
    if atom_set:
        board += "O=atom, H=hit/absorbed, R=reflected, numbers=entry/exit pairs\n"
    elif hypotheses and len(hypotheses) > 0:
        board += "X=hypothesized atom, H=hit/absorbed, R=reflected, numbers=entry/exit pairs\n"
    else:
        board += "H=hit/absorbed, R=reflected, numbers=entry/exit pairs\n"

    return board


def get_all_ray_entries() -> list[dict]:
    entries = []
    for side in ["north", "south"]:
        for pos in range(1, 9):
            entries.append({"side": side, "pos": pos})
    for side in ["east", "west"]:
        for pos in range(1, 9):
            entries.append({"side": side, "pos": pos})
    return entries


def calculate_score(rays: list, atoms_correct: int, total_atoms: int = 4) -> dict:
    ray_points = 0
    for ray in rays:
        ray_points += 1
        if ray.get("exit") and not ray["absorbed"]:
            e, ex = ray["entry"], ray["exit"]
            if e["side"] != ex["side"] or e["pos"] != ex["pos"]:
                ray_points += 1
    atoms_missed = total_atoms - atoms_correct
    missed_penalty = atoms_missed * 5
    return {"rayPoints": ray_points, "missedPenalty": missed_penalty,
            "total": ray_points + missed_penalty, "atomsMissed": atoms_missed}


def build_prompt_with_vot(base_prompt: str, vot_config: dict) -> str:
    prompt = base_prompt
    if vot_config.get("gridState"):
        prompt += VOT_PROMPTS["gridState"]
    if vot_config.get("rayTrace"):
        prompt += VOT_PROMPTS["rayTrace"]
    if vot_config.get("hypothesis"):
        prompt += VOT_PROMPTS["hypothesis"]
    return prompt


# ---------------------------------------------------------------------------
# Result structure (mirrors createExperimentResult in JS)
# ---------------------------------------------------------------------------

def create_experiment_result() -> dict:
    return {
        "experimentId": f"exp_{int(time.time() * 1000)}",
        "startTime": datetime.now(timezone.utc).isoformat(),
        "endTime": None,
        "model": None,
        "modelName": None,
        "promptStyle": None,
        "includeVisualization": None,
        "allowHypotheses": None,
        "enableThinking": None,
        "thinkingBudget": None,
        "votGridState": None,
        "votRayTrace": None,
        "votHypothesis": None,
        "promptCondition": None,
        "mode": None,
        "configIndex": None,
        "atomConfig": None,
        "systemPrompt": None,
        "sampleUserPrompt": None,
        # Predict mode
        "predictions": [],
        # Play mode
        "raysUsed": 0,
        "raySequence": [],
        "invalidMoves": 0,
        "finalGuess": None,
        "atomsCorrect": 0,
        "atomsMissed": 0,
        "score": 0,
        "hypothesisActions": 0,
        # Timing
        "totalApiCalls": 0,
        "totalInputTokens": 0,
        "totalOutputTokens": 0,
        "totalResponseTimeMs": 0,
    }


# ---------------------------------------------------------------------------
# LLM Provider Abstraction
# ---------------------------------------------------------------------------

class LLMProvider:
    """Base class for LLM API providers."""

    def call(self, messages: list[dict], system_prompt: str,
             enable_thinking: bool = False, thinking_budget: int = 10000) -> dict:
        """Returns {"thinking": list[str], "text": str, "usage": {"input_tokens": int, "output_tokens": int}}"""
        raise NotImplementedError


class OpenAIProvider(LLMProvider):
    def __init__(self, model_id: str, api_key: str):
        from openai import OpenAI
        self.client = OpenAI(api_key=api_key)
        self.model_id = model_id
        # o-series models use reasoning_effort instead of system messages
        self.is_reasoning = model_id.startswith("o")

    def call(self, messages, system_prompt, enable_thinking=False, thinking_budget=10000):
        try:
            kwargs = {"model": self.model_id, "max_completion_tokens": 16000}

            if self.is_reasoning:
                # o-series: system prompt goes as developer message, use reasoning_effort
                api_msgs = [{"role": "developer", "content": system_prompt}]
                api_msgs += messages
                if enable_thinking:
                    kwargs["reasoning_effort"] = "high"
            else:
                api_msgs = [{"role": "system", "content": system_prompt}]
                api_msgs += messages

            kwargs["messages"] = api_msgs
            resp = self.client.chat.completions.create(**kwargs)

            text = resp.choices[0].message.content or ""
            # Extract reasoning summary if available
            thinking = []
            if hasattr(resp.choices[0].message, "reasoning") and resp.choices[0].message.reasoning:
                thinking = [resp.choices[0].message.reasoning]

            usage = {
                "input_tokens": resp.usage.prompt_tokens if resp.usage else 0,
                "output_tokens": resp.usage.completion_tokens if resp.usage else 0,
            }
            return {"thinking": thinking, "text": text, "usage": usage}
        except Exception as e:
            return {"thinking": [], "text": f"Error: {e}", "usage": {"input_tokens": 0, "output_tokens": 0}}


class GoogleProvider(LLMProvider):
    def __init__(self, model_id: str, api_key: str):
        from google import genai
        self.client = genai.Client(api_key=api_key)
        self.model_id = model_id

    def call(self, messages, system_prompt, enable_thinking=False, thinking_budget=10000):
        try:
            from google.genai import types

            config = types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=16000,
            )
            if enable_thinking:
                config.thinking_config = types.ThinkingConfig(
                    thinking_budget=thinking_budget
                )

            # Convert messages to Gemini format
            contents = []
            for msg in messages:
                role = "user" if msg["role"] == "user" else "model"
                contents.append(types.Content(
                    role=role,
                    parts=[types.Part(text=msg["content"])]
                ))

            resp = self.client.models.generate_content(
                model=self.model_id,
                contents=contents,
                config=config,
            )

            text = ""
            thinking = []
            if resp.candidates and resp.candidates[0].content:
                for part in resp.candidates[0].content.parts:
                    if hasattr(part, "thought") and part.thought:
                        thinking.append(part.text)
                    elif part.text:
                        text += part.text

            usage = {"input_tokens": 0, "output_tokens": 0}
            if resp.usage_metadata:
                usage["input_tokens"] = getattr(resp.usage_metadata, "prompt_token_count", 0) or 0
                usage["output_tokens"] = getattr(resp.usage_metadata, "candidates_token_count", 0) or 0

            return {"thinking": thinking, "text": text or "Error: No response content", "usage": usage}
        except Exception as e:
            return {"thinking": [], "text": f"Error: {e}", "usage": {"input_tokens": 0, "output_tokens": 0}}


class DeepSeekProvider(LLMProvider):
    def __init__(self, model_id: str, api_key: str):
        from openai import OpenAI
        self.client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
        self.model_id = model_id

    def call(self, messages, system_prompt, enable_thinking=False, thinking_budget=10000):
        try:
            api_msgs = [{"role": "system", "content": system_prompt}] + messages
            resp = self.client.chat.completions.create(
                model=self.model_id,
                messages=api_msgs,
                max_tokens=16000,
            )
            text = resp.choices[0].message.content or ""
            thinking = []
            # DeepSeek R1 includes reasoning in reasoning_content
            if hasattr(resp.choices[0].message, "reasoning_content") and resp.choices[0].message.reasoning_content:
                thinking = [resp.choices[0].message.reasoning_content]

            usage = {
                "input_tokens": resp.usage.prompt_tokens if resp.usage else 0,
                "output_tokens": resp.usage.completion_tokens if resp.usage else 0,
            }
            return {"thinking": thinking, "text": text, "usage": usage}
        except Exception as e:
            return {"thinking": [], "text": f"Error: {e}", "usage": {"input_tokens": 0, "output_tokens": 0}}


class AnthropicProvider(LLMProvider):
    def __init__(self, model_id: str, api_key: str):
        import anthropic
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model_id = model_id

    def call(self, messages, system_prompt, enable_thinking=False, thinking_budget=10000):
        try:
            kwargs = {
                "model": self.model_id,
                "max_tokens": 16000,
                "system": system_prompt,
                "messages": messages,
            }

            if enable_thinking:
                kwargs["thinking"] = {
                    "type": "enabled",
                    "budget_tokens": thinking_budget,
                }

            resp = self.client.messages.create(**kwargs)

            text = ""
            thinking = []
            for block in resp.content:
                if block.type == "thinking":
                    thinking.append(block.thinking)
                elif block.type == "text":
                    text += block.text

            usage = {
                "input_tokens": resp.usage.input_tokens if resp.usage else 0,
                "output_tokens": resp.usage.output_tokens if resp.usage else 0,
            }
            return {"thinking": thinking, "text": text or "Error: No response content", "usage": usage}
        except Exception as e:
            return {"thinking": [], "text": f"Error: {e}", "usage": {"input_tokens": 0, "output_tokens": 0}}


def create_provider(model_cfg: dict, api_keys: dict) -> LLMProvider:
    provider = model_cfg["provider"]
    model_id = model_cfg["id"]

    if provider == "openai":
        key = api_keys.get("openai") or os.environ.get("OPENAI_API_KEY")
        if not key:
            raise ValueError("OpenAI API key required (config or OPENAI_API_KEY env var)")
        return OpenAIProvider(model_id, key)
    elif provider == "google":
        key = api_keys.get("google") or os.environ.get("GOOGLE_API_KEY")
        if not key:
            raise ValueError("Google API key required (config or GOOGLE_API_KEY env var)")
        return GoogleProvider(model_id, key)
    elif provider == "deepseek":
        key = api_keys.get("deepseek") or os.environ.get("DEEPSEEK_API_KEY")
        if not key:
            raise ValueError("DeepSeek API key required (config or DEEPSEEK_API_KEY env var)")
        return DeepSeekProvider(model_id, key)
    elif provider == "anthropic":
        key = api_keys.get("anthropic") or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise ValueError("Anthropic API key required (config or ANTHROPIC_API_KEY env var)")
        return AnthropicProvider(model_id, key)
    else:
        raise ValueError(f"Unknown provider: {provider}")


# ---------------------------------------------------------------------------
# Response Parsing (mirrors parseResponse logic in JS)
# ---------------------------------------------------------------------------

def parse_response(text: str) -> Optional[dict]:
    """Parse JSON from LLM response text."""
    try:
        match = re.search(r'\{[\s\S]*?\}', text)
        if match:
            return json.loads(match.group(0))
    except json.JSONDecodeError:
        pass

    # Fallback: try extracting from text
    lower = text.lower()
    if "absorb" in lower or '"absorbed"' in lower:
        return {"absorbed": True, "reasoning": text}
    if "reflect" in lower and "deflect" not in lower:
        return {"reflected": True, "reasoning": text}

    # Try to find exit info
    side_match = re.search(r'(north|south|east|west)[^\d]*(\d)', lower)
    if side_match:
        return {"exit_side": side_match.group(1), "exit_position": int(side_match.group(2)), "reasoning": text}

    return None


def parse_play_response(text: str, allow_hypotheses: bool) -> Optional[dict]:
    """Parse a play-mode response."""
    parsed = parse_response(text)
    if parsed:
        return parsed

    lower = text.lower()
    if "check" in lower and allow_hypotheses:
        return {"action": "check", "reasoning": text}
    if "guess" in lower and not allow_hypotheses:
        coords = re.findall(r'\[?\s*(\d)\s*,\s*(\d)\s*\]?', text)
        if len(coords) >= 4:
            atoms = [[int(r), int(c)] for r, c in coords[:4]]
            return {"action": "guess", "atoms": atoms, "reasoning": text}
    if re.search(r'(north|south|east|west)', lower):
        side_match = re.search(r'(north|south|east|west)', lower)
        pos_match = re.search(r'position[^\d]*(\d)|"position"\s*:\s*(\d)', text)
        if side_match:
            pos = int(pos_match.group(1) or pos_match.group(2)) if pos_match else None
            if pos and 1 <= pos <= 8:
                return {"action": "fire", "side": side_match.group(1), "position": pos, "reasoning": text}

    return None


# ---------------------------------------------------------------------------
# Experiment Runners
# ---------------------------------------------------------------------------

log = logging.getLogger("blackbox")


def run_predict_experiment(config_index: int, provider: LLMProvider, model_cfg: dict,
                           exp_cfg: dict, rate_cfg: dict) -> dict:
    """Run a predict experiment for one config + model."""
    config = EXPERIMENT_CONFIGS[config_index]
    atom_set = config_to_atom_set(config)
    prompt_style = exp_cfg["prompt_style"]
    prompt_config = PROMPT_STYLES[prompt_style]

    vot_config = {
        "gridState": False,
        "rayTrace": exp_cfg.get("vot", {}).get("ray_trace", False),
        "hypothesis": False,
    }

    result = create_experiment_result()
    result["model"] = model_cfg["id"]
    result["modelName"] = model_cfg["name"]
    result["promptStyle"] = prompt_style
    result["includeVisualization"] = exp_cfg.get("include_visualization", False)
    result["enableThinking"] = exp_cfg.get("enable_thinking", False)
    result["thinkingBudget"] = exp_cfg.get("thinking_budget", 10000)
    result["votGridState"] = vot_config["gridState"]
    result["votRayTrace"] = vot_config["rayTrace"]
    result["votHypothesis"] = vot_config["hypothesis"]

    vot_suffix = "+votB" if vot_config["rayTrace"] else ""
    viz_suffix = "+viz" if result["includeVisualization"] else ""
    think_suffix = "+think" if result["enableThinking"] else ""
    result["promptCondition"] = f"{prompt_style}{viz_suffix}{think_suffix}{vot_suffix}"
    result["mode"] = "predict"
    result["configIndex"] = config_index
    result["atomConfig"] = config

    system_prompt = build_prompt_with_vot(prompt_config["predictPrompt"], vot_config)
    result["systemPrompt"] = system_prompt

    all_rays = get_all_ray_entries()
    tested_positions = set()

    log.info(f"Starting Predict: Config {config_index + 1}, {model_cfg['name']}, {prompt_style}{viz_suffix}{think_suffix}{vot_suffix}")

    rays_tested = 0
    rays_skipped = 0

    for ray_entry in all_rays:
        side, pos = ray_entry["side"], ray_entry["pos"]
        pos_key = f"{side}-{pos}"

        if pos_key in tested_positions:
            rays_skipped += 1
            log.debug(f"  Skipping {side.upper()}-{pos} (already tested)")
            continue

        tested_positions.add(pos_key)
        rays_tested += 1

        atom_list = ", ".join(f"({r},{c})" for r, c in config)
        prompt = f"Atoms are located at: {atom_list}\n\n"
        if result["includeVisualization"]:
            prompt += f"Board (O = atom positions):\n```\n{generate_text_board([], 8, atom_set)}```\n\n"
        prompt += f"A ray is fired from {side.upper()}-{pos}.\n\nTrace the ray step by step and predict where it will exit (or if it will be absorbed/reflected)."

        if rays_tested == 1:
            result["sampleUserPrompt"] = prompt

        start = time.time()
        log.info(f"  → {side.upper()}-{pos}: Calling API...")

        # Retry loop
        response_text = None
        thinking = []
        usage = {"input_tokens": 0, "output_tokens": 0}
        total_time_ms = 0

        for attempt in range(1, rate_cfg["max_retries"] + 1):
            attempt_start = time.time()
            api_result = provider.call(
                [{"role": "user", "content": prompt}],
                system_prompt,
                result["enableThinking"],
                result["thinkingBudget"],
            )
            attempt_ms = int((time.time() - attempt_start) * 1000)
            total_time_ms += attempt_ms
            result["totalApiCalls"] += 1

            thinking = api_result["thinking"]
            response_text = api_result["text"]
            usage = api_result["usage"]

            if response_text.startswith("Error:") and any(
                x in response_text for x in ["429", "rate_limit", "rate limit", "Too many"]
            ):
                wait = min(rate_cfg["backoff_base_ms"] * (2 ** (attempt - 1)), rate_cfg["backoff_max_ms"]) / 1000
                log.warning(f"  Rate limit hit, waiting {wait:.1f}s...")
                time.sleep(wait)
                continue

            if response_text.startswith("Error:") and any(
                x in response_text for x in ["500", "529", "overloaded"]
            ):
                if attempt < rate_cfg["max_retries"]:
                    wait = min(rate_cfg["backoff_base_ms"] * (2 ** (attempt - 1)), rate_cfg["backoff_max_ms"]) / 1000
                    log.warning(f"  Attempt {attempt}/{rate_cfg['max_retries']} failed, retrying in {wait:.1f}s...")
                    time.sleep(wait)
                    continue
            break

        elapsed = total_time_ms / 1000
        result["totalInputTokens"] += usage.get("input_tokens", 0)
        result["totalOutputTokens"] += usage.get("output_tokens", 0)
        result["totalResponseTimeMs"] += total_time_ms

        # Compute actual ray result
        actual = trace_ray(atom_set, side, pos)

        if response_text.startswith("Error:"):
            log.warning(f"  API Error: {response_text[:100]}")
            actual_outcome = _actual_outcome(actual)
            result["predictions"].append({
                "rayEntry": {"side": side, "pos": pos},
                "userPrompt": prompt,
                "rayResult": actual,
                "predicted": "error",
                "actual": actual_outcome,
                "correct": False,
                "reasoning": response_text,
                "thinking": "",
                "responseTimeMs": total_time_ms,
                "inputTokens": usage.get("input_tokens", 0),
                "outputTokens": usage.get("output_tokens", 0),
            })
            _mark_exit_tested(actual, tested_positions)
            time.sleep(rate_cfg["delay_between_calls_ms"] / 1000)
            continue

        # Parse prediction
        prediction = parse_response(response_text)
        if prediction is None:
            log.warning(f"  Could not parse response for {side.upper()}-{pos}")
            prediction = {"parse_error": True, "raw_response": response_text}

        # Evaluate correctness
        actual_outcome = _actual_outcome(actual)
        correct = False
        predicted_outcome = "unknown"

        if actual["absorbed"]:
            correct = prediction.get("absorbed") is True
        elif (actual.get("exit") and actual["entry"]["side"] == actual["exit"]["side"]
              and actual["entry"]["pos"] == actual["exit"]["pos"]):
            correct = prediction.get("reflected") is True
        elif actual.get("exit"):
            correct = (prediction.get("exit_side") == actual["exit"]["side"]
                       and prediction.get("exit_position") == actual["exit"]["pos"])

        if prediction.get("absorbed"):
            predicted_outcome = "absorbed"
        elif prediction.get("reflected"):
            predicted_outcome = "reflected"
        elif prediction.get("exit_side"):
            predicted_outcome = f"{prediction['exit_side']}-{prediction['exit_position']}"

        icon = "✓" if correct else "✗"
        log.info(f"  [{elapsed:.1f}s] {icon} Predicted: {predicted_outcome} | Actual: {actual_outcome} ({usage.get('input_tokens', 0)}+{usage.get('output_tokens', 0)} tokens)")

        result["predictions"].append({
            "rayEntry": {"side": side, "pos": pos},
            "userPrompt": prompt,
            "rayResult": actual,
            "predicted": predicted_outcome,
            "actual": actual_outcome,
            "correct": correct,
            "reasoning": prediction.get("reasoning", response_text),
            "thinking": "\n---\n".join(thinking),
            "responseTimeMs": total_time_ms,
            "inputTokens": usage.get("input_tokens", 0),
            "outputTokens": usage.get("output_tokens", 0),
        })

        _mark_exit_tested(actual, tested_positions)
        time.sleep(rate_cfg["delay_between_calls_ms"] / 1000)

    result["endTime"] = datetime.now(timezone.utc).isoformat()
    correct_count = sum(1 for p in result["predictions"] if p["correct"])
    total_tested = len(result["predictions"])
    pct = (correct_count / total_tested * 100) if total_tested > 0 else 0
    log.info(f"Completed: {correct_count}/{total_tested} correct ({pct:.1f}%) - {32 - total_tested} reverse rays skipped")
    log.info(f"Tokens: {result['totalInputTokens']} in + {result['totalOutputTokens']} out")
    log.info(f"Time: {result['totalResponseTimeMs'] / 1000:.1f}s total API time")

    return result


def run_play_experiment(config_index: int, provider: LLMProvider, model_cfg: dict,
                        exp_cfg: dict, rate_cfg: dict) -> dict:
    """Run a play experiment for one config + model."""
    config = EXPERIMENT_CONFIGS[config_index]
    atom_set = config_to_atom_set(config)
    prompt_style = exp_cfg["prompt_style"]
    prompt_config = PROMPT_STYLES[prompt_style]
    allow_hypotheses = exp_cfg.get("allow_hypotheses", False)
    include_viz = exp_cfg.get("include_visualization", False)

    vot_config = {
        "gridState": exp_cfg.get("vot", {}).get("grid_state", False),
        "rayTrace": exp_cfg.get("vot", {}).get("ray_trace", False),
        "hypothesis": exp_cfg.get("vot", {}).get("hypothesis", False),
    }

    result = create_experiment_result()
    result["model"] = model_cfg["id"]
    result["modelName"] = model_cfg["name"]
    result["promptStyle"] = prompt_style
    result["includeVisualization"] = include_viz
    result["allowHypotheses"] = allow_hypotheses
    result["enableThinking"] = exp_cfg.get("enable_thinking", False)
    result["thinkingBudget"] = exp_cfg.get("thinking_budget", 10000)
    result["votGridState"] = vot_config["gridState"]
    result["votRayTrace"] = vot_config["rayTrace"]
    result["votHypothesis"] = vot_config["hypothesis"]

    vot_suffix = ("" + ("+votA" if vot_config["gridState"] else "")
                  + ("+votB" if vot_config["rayTrace"] else "")
                  + ("+votC" if vot_config["hypothesis"] else ""))
    viz_suffix = "+viz" if include_viz else ""
    hyp_suffix = "+hyp" if allow_hypotheses else ""
    think_suffix = "+think" if result["enableThinking"] else ""
    result["promptCondition"] = f"{prompt_style}{viz_suffix}{hyp_suffix}{think_suffix}{vot_suffix}"
    result["mode"] = "play"
    result["configIndex"] = config_index
    result["atomConfig"] = config

    # Build system prompt
    system_prompt = prompt_config["playPrompt"]
    if allow_hypotheses:
        # Replace guess JSON instructions with mark/unmark/check
        old_json_aug = ('Respond with JSON only:\nFire ray: {"action": "fire", "side": "north|south|east|west", '
                        '"position": 1-8, "reasoning": "..."}\nFinal guess: {"action": "guess", "atoms": '
                        '[[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}\n\n'
                        'Max 20 rays. Be strategic and cross-reference observations.')
        new_json_aug = ('Respond with JSON only:\nFire ray: {"action": "fire", "side": "north|south|east|west", '
                        '"position": 1-8, "reasoning": "..."}\nMark atom: {"action": "mark", "row": 1-8, '
                        '"col": 1-8, "reasoning": "..."} - mark where you think an atom is\nUnmark: '
                        '{"action": "unmark", "row": 1-8, "col": 1-8, "reasoning": "..."} - remove a marked position\n'
                        'Check: {"action": "check", "reasoning": "..."} - submit your answer (requires exactly 4 marked positions)\n\n'
                        'You must mark exactly 4 positions where you think the atoms are located. Use mark/unmark to '
                        'refine your guesses. When you have exactly 4 positions marked and are confident, use check to submit. '
                        'Max 20 rays. Be strategic and cross-reference observations.')
        old_json_base = ('Respond with JSON only:\n{"action": "fire", "side": "north|south|east|west", '
                         '"position": 1-8, "reasoning": "..."}\n{"action": "guess", "atoms": '
                         '[[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}\n\n'
                         'When you think you know where all 4 atoms are, make your guess.')
        new_json_base = ('Respond with JSON only:\n{"action": "fire", "side": "north|south|east|west", '
                         '"position": 1-8, "reasoning": "..."}\n{"action": "mark", "row": 1-8, "col": 1-8, '
                         '"reasoning": "..."} - mark where you think an atom is\n{"action": "unmark", "row": 1-8, '
                         '"col": 1-8, "reasoning": "..."} - remove a marked position\n{"action": "check", '
                         '"reasoning": "..."} - submit your answer (requires exactly 4 marked positions)\n\n'
                         'You must mark exactly 4 positions where you think the atoms are located. Use mark/unmark '
                         'to adjust your guesses as you gather information. When you have exactly 4 positions marked '
                         'and are confident, use the check action to submit your answer.')
        system_prompt = system_prompt.replace(old_json_aug, new_json_aug)
        system_prompt = system_prompt.replace(old_json_base, new_json_base)

    system_prompt = build_prompt_with_vot(system_prompt, vot_config)
    result["systemPrompt"] = system_prompt

    log.info(f"Starting Play: Config {config_index + 1}, {model_cfg['name']}, {result['promptCondition']}")

    messages = []
    fired_rays = []
    used_pos = set()
    hypotheses = set()
    done = False
    ray_num = 0
    consecutive_failures = 0
    max_consecutive_failures = 5
    total_iterations = 0
    max_iterations = 100

    while not done and ray_num < 20 and consecutive_failures < max_consecutive_failures and total_iterations < max_iterations:
        total_iterations += 1

        # Build context
        ctx = "Current ray results:\n"
        if not fired_rays:
            ctx += "(No rays fired yet)\n"
        else:
            for r in fired_rays:
                ctx += format_ray_result(r) + "\n"
            if include_viz:
                ctx += f"\nBoard state:\n```\n{generate_text_board(fired_rays, 8, None, hypotheses if allow_hypotheses else None)}```\n"

        if allow_hypotheses:
            if hypotheses:
                hyp_list = ", ".join(f"({k})" for k in sorted(hypotheses))
                ctx += f"\nMarked atom positions ({len(hypotheses)}/4): {hyp_list}"
                ctx += " — Ready to check!\n" if len(hypotheses) == 4 else "\n"
            else:
                ctx += "\nMarked atom positions: (none marked yet)\n"

        if used_pos:
            ctx += f"\nUnavailable positions (already used as entry/exit): {', '.join(sorted(used_pos))}\n"
        ctx += f"\nRays fired: {len(fired_rays)}/20\n\nDecide your next action. JSON only."

        if total_iterations == 1:
            result["sampleUserPrompt"] = ctx

        msgs = messages + [{"role": "user", "content": ctx}]

        log.info(f"  Turn {ray_num + 1} (iter {total_iterations}): Calling API...")
        start = time.time()

        api_result = provider.call(msgs, system_prompt, result["enableThinking"], result["thinkingBudget"])
        response_time_ms = int((time.time() - start) * 1000)
        elapsed = response_time_ms / 1000
        result["totalApiCalls"] += 1
        result["totalInputTokens"] += api_result["usage"].get("input_tokens", 0)
        result["totalOutputTokens"] += api_result["usage"].get("output_tokens", 0)
        result["totalResponseTimeMs"] += response_time_ms

        thinking = api_result["thinking"]
        response = api_result["text"]
        usage = api_result["usage"]

        resp_preview = response[:120].replace("\n", " ")
        log.info(f"  [{elapsed:.1f}s] Response: \"{resp_preview}{'...' if len(response) > 120 else ''}\" ({usage.get('input_tokens', 0)}+{usage.get('output_tokens', 0)} tokens)")

        if response.startswith("Error:"):
            log.warning(f"  API Error: {response[:100]}")

            # Rate limit handling
            if any(x in response for x in ["429", "rate_limit", "rate limit", "Too many"]):
                wait = min(rate_cfg["backoff_base_ms"] * (2 ** (consecutive_failures)), rate_cfg["backoff_max_ms"]) / 1000
                log.warning(f"  Rate limit - waiting {wait:.1f}s before retry...")
                time.sleep(wait)
                continue

            consecutive_failures += 1
            ray_num += 1
            continue

        parsed = parse_play_response(response, allow_hypotheses)

        if not parsed:
            log.warning(f"  Parse error on turn {ray_num + 1}")
            # Request correction
            if allow_hypotheses:
                retry_prompt = ('Your response was not valid JSON. Please respond with ONLY a valid JSON object:\n'
                                '{"action": "fire", "side": "north", "position": 5, "reasoning": "..."}\n'
                                '{"action": "mark", "row": 3, "col": 5, "reasoning": "..."}\n'
                                '{"action": "unmark", "row": 3, "col": 5, "reasoning": "..."}\n'
                                '{"action": "check", "reasoning": "..."}\nJSON only:')
            else:
                retry_prompt = ('Your response was not valid JSON. Please respond with ONLY a valid JSON object:\n'
                                '{"action": "fire", "side": "north", "position": 5, "reasoning": "..."}\n'
                                '{"action": "guess", "atoms": [[r1,c1], [r2,c2], [r3,c3], [r4,c4]], "reasoning": "..."}\nJSON only:')

            retry_result = provider.call(
                msgs + [{"role": "assistant", "content": response}, {"role": "user", "content": retry_prompt}],
                system_prompt, result["enableThinking"], result["thinkingBudget"]
            )
            result["totalApiCalls"] += 1
            result["totalInputTokens"] += retry_result["usage"].get("input_tokens", 0)
            result["totalOutputTokens"] += retry_result["usage"].get("output_tokens", 0)
            result["totalResponseTimeMs"] += response_time_ms

            parsed = parse_play_response(retry_result["text"], allow_hypotheses)
            if not parsed:
                log.warning(f"  Still could not parse after retry")
                result["invalidMoves"] += 1
                consecutive_failures += 1
                result["raySequence"].append({
                    "action": "parse_error", "userPrompt": ctx,
                    "response": response + "\n---RETRY---\n" + retry_result["text"],
                    "thinking": "\n---\n".join(thinking),
                    "responseTimeMs": response_time_ms,
                    "inputTokens": usage.get("input_tokens", 0) + retry_result["usage"].get("input_tokens", 0),
                    "outputTokens": usage.get("output_tokens", 0) + retry_result["usage"].get("output_tokens", 0),
                })
                messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response},
                             {"role": "user", "content": "ERROR: Could not parse your response as JSON."}]
                ray_num += 1
                continue

        consecutive_failures = 0
        action = parsed.get("action", "")
        log.info(f"  ✓ Parsed: {action}" +
                 (f" {parsed.get('side', '').upper()}-{parsed.get('position', '')}" if action == "fire" else "") +
                 (f" ({parsed.get('row')},{parsed.get('col')})" if action in ("mark", "unmark") else ""))

        # Handle actions (mirrors JS logic)
        if action == "check" and allow_hypotheses:
            if len(hypotheses) != 4:
                result["invalidMoves"] += 1
                consecutive_failures += 1
                messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response},
                             {"role": "user", "content": f"ERROR: You have {len(hypotheses)} positions marked, need exactly 4."}]
                continue

            done = True
            guess_atoms = [list(map(int, k.split(","))) for k in hypotheses]
            result["finalGuess"] = guess_atoms
            result["raySequence"].append({
                "action": "check", "userPrompt": ctx, "guess": guess_atoms,
                "reasoning": parsed.get("reasoning", ""),
                "thinking": "\n---\n".join(thinking),
                "responseTimeMs": response_time_ms,
                "inputTokens": usage.get("input_tokens", 0),
                "outputTokens": usage.get("output_tokens", 0),
            })
            correct = sum(1 for r, c in config if f"{r},{c}" in hypotheses)
            result["atomsCorrect"] = correct
            messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response}]

        elif action == "guess" and not allow_hypotheses:
            done = True
            result["finalGuess"] = parsed["atoms"]
            result["raySequence"].append({
                "action": "guess", "userPrompt": ctx, "guess": parsed["atoms"],
                "reasoning": parsed.get("reasoning", ""),
                "thinking": "\n---\n".join(thinking),
                "responseTimeMs": response_time_ms,
                "inputTokens": usage.get("input_tokens", 0),
                "outputTokens": usage.get("output_tokens", 0),
            })
            guess_set = {f"{r},{c}" for r, c in parsed["atoms"]}
            correct = sum(1 for r, c in config if f"{r},{c}" in guess_set)
            result["atomsCorrect"] = correct
            messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response}]

        elif action == "guess" and allow_hypotheses:
            result["invalidMoves"] += 1
            consecutive_failures += 1
            messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response},
                         {"role": "user", "content": 'ERROR: Use "mark" to mark positions, then "check" to submit.'}]
            continue

        elif action == "fire":
            side = (parsed.get("side") or "").lower()
            pos = parsed.get("position")
            pos_key = f"{side.upper()}-{pos}"

            if pos_key in used_pos:
                result["invalidMoves"] += 1
                consecutive_failures += 1
                messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response},
                             {"role": "user", "content": f"ERROR: Position {pos_key} already used."}]
                continue

            if side not in ("north", "south", "east", "west") or not pos or pos < 1 or pos > 8:
                result["invalidMoves"] += 1
                consecutive_failures += 1
                messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response},
                             {"role": "user", "content": "ERROR: Invalid ray. Use side (north/south/east/west) and position (1-8)."}]
                continue

            ray_result = trace_ray(atom_set, side, pos)
            ray_result["id"] = len(fired_rays) + 1
            fired_rays.append(ray_result)

            used_pos.add(pos_key)
            if ray_result.get("exit"):
                used_pos.add(f"{ray_result['exit']['side'].upper()}-{ray_result['exit']['pos']}")

            log.info(f"  Fired {side.upper()}-{pos}: {format_ray_result(ray_result)}")

            result["raySequence"].append({
                "action": "fire", "userPrompt": ctx,
                "rayEntry": {"side": side, "pos": pos},
                "rayResult": ray_result,
                "result": format_ray_result(ray_result),
                "reasoning": parsed.get("reasoning", ""),
                "thinking": "\n---\n".join(thinking),
                "responseTimeMs": response_time_ms,
                "inputTokens": usage.get("input_tokens", 0),
                "outputTokens": usage.get("output_tokens", 0),
            })
            messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response}]
            ray_num += 1

        elif action == "mark" and allow_hypotheses:
            row, col = parsed.get("row"), parsed.get("col")
            if not row or not col or row < 1 or row > 8 or col < 1 or col > 8:
                result["invalidMoves"] += 1
                consecutive_failures += 1
                messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response},
                             {"role": "user", "content": "ERROR: Row and column must be 1-8."}]
                continue
            ck = f"{row},{col}"
            if len(hypotheses) >= 4 and ck not in hypotheses:
                result["invalidMoves"] += 1
                consecutive_failures += 1
                messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response},
                             {"role": "user", "content": "ERROR: Already 4 positions marked. Unmark one first."}]
                continue
            hypotheses.add(ck)
            log.info(f"  Marked ({row},{col}) - {len(hypotheses)}/4")
            result["raySequence"].append({
                "action": "mark", "userPrompt": ctx, "position": {"row": row, "col": col},
                "hypothesesCount": len(hypotheses), "reasoning": parsed.get("reasoning", ""),
                "thinking": "\n---\n".join(thinking),
                "responseTimeMs": response_time_ms,
                "inputTokens": usage.get("input_tokens", 0),
                "outputTokens": usage.get("output_tokens", 0),
            })
            result["hypothesisActions"] += 1
            messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response}]

        elif action == "unmark" and allow_hypotheses:
            row, col = parsed.get("row"), parsed.get("col")
            ck = f"{row},{col}"
            hypotheses.discard(ck)
            log.info(f"  Unmarked ({row},{col}) - {len(hypotheses)}/4")
            result["raySequence"].append({
                "action": "unmark", "userPrompt": ctx, "position": {"row": row, "col": col},
                "hypothesesCount": len(hypotheses), "reasoning": parsed.get("reasoning", ""),
                "thinking": "\n---\n".join(thinking),
                "responseTimeMs": response_time_ms,
                "inputTokens": usage.get("input_tokens", 0),
                "outputTokens": usage.get("output_tokens", 0),
            })
            result["hypothesisActions"] += 1
            messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response}]

        else:
            result["invalidMoves"] += 1
            consecutive_failures += 1
            messages += [{"role": "user", "content": ctx}, {"role": "assistant", "content": response},
                         {"role": "user", "content": f"ERROR: Unknown action '{action}'."}]
            continue

        time.sleep(rate_cfg["delay_between_calls_ms"] / 1000)

    # Finalize
    result["raysUsed"] = len(fired_rays)
    if done and result["finalGuess"]:
        score = calculate_score(fired_rays, result["atomsCorrect"])
        result["score"] = score["total"]
        result["atomsMissed"] = score["atomsMissed"]
    else:
        result["atomsCorrect"] = 0
        result["atomsMissed"] = 4
        result["score"] = len(fired_rays) + 20  # penalty

    result["endTime"] = datetime.now(timezone.utc).isoformat()
    log.info(f"Completed: {result['atomsCorrect']}/4 atoms, score={result['score']}, "
             f"{result['raysUsed']} rays, {result['invalidMoves']} invalid, "
             f"{result['totalApiCalls']} API calls")
    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _actual_outcome(actual: dict) -> str:
    if actual["absorbed"]:
        return "absorbed"
    if (actual.get("exit") and actual["entry"]["side"] == actual["exit"]["side"]
            and actual["entry"]["pos"] == actual["exit"]["pos"]):
        return "reflected"
    if actual.get("exit"):
        return f"{actual['exit']['side']}-{actual['exit']['pos']}"
    return "unknown"


def _mark_exit_tested(actual: dict, tested: set):
    if (actual.get("exit") and not (
        actual["entry"]["side"] == actual["exit"]["side"]
        and actual["entry"]["pos"] == actual["exit"]["pos"]
    )):
        tested.add(f"{actual['exit']['side']}-{actual['exit']['pos']}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Black Box Experiment Runner (Non-Anthropic Models)")
    parser.add_argument("--config", default="experiment_config.yaml", help="Path to config YAML")
    parser.add_argument("--dry-run", action="store_true", help="Validate config without running")
    parser.add_argument("-v", "--verbose", action="store_true", help="Debug logging")
    args = parser.parse_args()

    # Setup logging
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s [%(levelname)s] %(message)s",
                        datefmt="%H:%M:%S")

    # Load config
    config_path = Path(args.config)
    if not config_path.exists():
        log.error(f"Config not found: {config_path}")
        sys.exit(1)

    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    exp = cfg["experiment"]
    rate = cfg.get("rate_limit", {
        "delay_between_calls_ms": 500, "max_retries": 3,
        "backoff_base_ms": 1000, "backoff_max_ms": 30000,
    })
    output_cfg = cfg.get("output", {"directory": "./results"})
    api_keys = cfg.get("api_keys", {})

    # Validate
    task_mode = exp["task_mode"]
    if task_mode not in ("predict", "play"):
        log.error(f"Invalid task_mode: {task_mode}")
        sys.exit(1)

    models = exp["models"]
    config_indices = exp["config_indices"]

    log.info(f"Task: {task_mode}, Style: {exp['prompt_style']}, "
             f"Configs: {config_indices}, Models: {[m['name'] for m in models]}")
    log.info(f"Total runs: {len(config_indices)} configs × {len(models)} models = {len(config_indices) * len(models)}")

    if args.dry_run:
        log.info("Dry run - validating config only")
        for m in models:
            try:
                p = create_provider(m, api_keys)
                log.info(f"  ✓ {m['name']} ({m['provider']}) - provider OK")
            except ValueError as e:
                log.error(f"  ✗ {m['name']} ({m['provider']}) - {e}")
        return

    # Create output directory
    out_dir = Path(output_cfg.get("directory", "./results"))
    out_dir.mkdir(parents=True, exist_ok=True)

    # Also log to file
    log_path = output_cfg.get("log_file")
    if log_path:
        Path(log_path).parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_path)
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S"))
        logging.getLogger().addHandler(fh)

    # Run experiments
    all_results = []
    total_runs = len(config_indices) * len(models)
    run_num = 0

    for ci in config_indices:
        for model_cfg in models:
            run_num += 1
            log.info(f"\n{'='*60}")
            log.info(f"Run {run_num}/{total_runs}: Config {ci + 1}, {model_cfg['name']}")
            log.info(f"{'='*60}")

            try:
                provider = create_provider(model_cfg, api_keys)
            except ValueError as e:
                log.error(f"Skipping {model_cfg['name']}: {e}")
                continue

            try:
                if task_mode == "predict":
                    result = run_predict_experiment(ci, provider, model_cfg, exp, rate)
                else:
                    result = run_play_experiment(ci, provider, model_cfg, exp, rate)
                all_results.append(result)
            except KeyboardInterrupt:
                log.warning("Interrupted by user")
                break
            except Exception as e:
                log.error(f"Experiment failed: {e}", exc_info=True)
                continue

    # Export results in same format as React app
    export_data = {
        "exportTime": datetime.now(timezone.utc).isoformat(),
        "experimentConfig": {
            "taskMode": task_mode,
            "promptStyle": exp["prompt_style"],
            "includeVisualization": exp.get("include_visualization", False),
            "allowHypotheses": exp.get("allow_hypotheses", False),
            "enableThinking": exp.get("enable_thinking", False),
            "thinkingBudget": exp.get("thinking_budget", 10000),
            "votGridState": exp.get("vot", {}).get("grid_state", False),
            "votRayTrace": exp.get("vot", {}).get("ray_trace", False),
            "votHypothesis": exp.get("vot", {}).get("hypothesis", False),
            "configIndices": config_indices,
            "modelsToTest": [m["id"] for m in models],
            "promptCondition": exp["prompt_style"],
        },
        "configs": EXPERIMENT_CONFIGS,
        "promptStyles": {k: {"name": v["name"], "description": v["description"],
                              "playPrompt": v["playPrompt"], "predictPrompt": v["predictPrompt"]}
                         for k, v in PROMPT_STYLES.items()},
        "results": all_results,
        "runner": "python",  # Distinguish from React-generated results
    }

    viz_suffix = "_viz" if exp.get("include_visualization") else ""
    hyp_suffix = "_hyp" if task_mode == "play" and exp.get("allow_hypotheses") else ""
    timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    filename = f"blackbox_experiment_{task_mode}_{exp['prompt_style']}{viz_suffix}{hyp_suffix}_{timestamp}.json"
    out_path = out_dir / filename

    with open(out_path, "w") as f:
        json.dump(export_data, f, indent=2, default=str)

    log.info(f"\nResults saved to: {out_path}")
    log.info(f"Total runs: {len(all_results)}")

    # Print summary
    if all_results:
        log.info("\n--- Summary ---")
        for r in all_results:
            if r["mode"] == "predict":
                correct = sum(1 for p in r["predictions"] if p["correct"])
                total = len(r["predictions"])
                pct = (correct / total * 100) if total > 0 else 0
                log.info(f"  Config {r['configIndex'] + 1} | {r['modelName']:>15} | {correct}/{total} ({pct:.1f}%) | "
                         f"{r['totalInputTokens'] + r['totalOutputTokens']} tokens | {r['totalResponseTimeMs']/1000:.1f}s")
            else:
                log.info(f"  Config {r['configIndex'] + 1} | {r['modelName']:>15} | {r['atomsCorrect']}/4 atoms | "
                         f"score={r['score']} | {r['raysUsed']} rays | {r['totalResponseTimeMs']/1000:.1f}s")


if __name__ == "__main__":
    main()
