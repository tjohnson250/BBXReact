import React, { useState, useCallback, useRef } from 'react';

const GRID_SIZE = 8;
const NUM_ATOMS = 4;

// ============================================
// EXPERIMENT CONFIGURATIONS
// ============================================
// Fixed atom configurations for reproducible experiments
// Each configuration is used for both Predict and Play modes
// Format: Array of [row, col] pairs
const EXPERIMENT_CONFIGS = [
  // Config 1: Spread pattern
  [[2, 3], [3, 6], [6, 2], [7, 7]],
  // Config 2: Cluster in corner
  [[1, 1], [1, 3], [2, 2], [5, 6]],
  // Config 3: Diagonal pattern
  [[2, 2], [4, 4], [6, 6], [8, 8]],
  // Config 4: Edge-heavy
  [[1, 4], [4, 8], [8, 5], [5, 1]],
  // Config 5: Central cluster
  [[3, 4], [4, 3], [4, 5], [5, 4]],
  // Config 6: L-shape
  [[2, 2], [2, 3], [2, 4], [4, 2]],
  // Config 7: Corners
  [[1, 1], [1, 8], [8, 1], [8, 8]],
  // Config 8: Asymmetric
  [[2, 7], [3, 2], [6, 5], [7, 3]],
  // Config 9: Row cluster
  [[4, 2], [4, 4], [4, 6], [4, 8]],
  // Config 10: Mixed
  [[1, 5], [3, 3], [5, 7], [8, 2]],
];

// Convert config array to Set format used by game
function configToAtomSet(config) {
  const atoms = new Set();
  config.forEach(([row, col]) => atoms.add(`${row},${col}`));
  return atoms;
}

// ============================================
// PROMPT CONDITIONS
// ============================================

// BASELINE: Human-equivalent instructions (adapted from traditional Emacs Black Box rules)
const BASELINE_PLAY_PROMPT = `You are playing Black Box, a game of hide and seek played on an 8 by 8 grid (the Black Box).

Your opponent has hidden 4 balls within this box. By shooting rays into the box and observing where they emerge, it is possible to deduce the positions of the hidden balls.

GRID: 8x8, rows 1-8 (top to bottom), columns 1-8 (left to right).
RAYS: Fire from edge positions - NORTH/SOUTH use columns 1-8, EAST/WEST use rows 1-8.

There are three possible outcomes for each ray you send into the box:

DETOUR: The ray is deflected and emerges somewhere other than where you sent it in. Detours are denoted by matching pairs of numbers -- one where the ray went in, and the other where it came out.

REFLECTION (R): The ray is reflected and emerges in the same place it was sent in.

HIT (H): The ray strikes a ball directly and is absorbed. It does not emerge from the box.

The rules for how balls deflect rays are simple and are best shown by example.

As a ray approaches a ball it is deflected ninety degrees. Rays can be deflected multiple times. In the diagrams below, the dashes represent empty box locations and the letter O represents a ball. The entrance and exit points of each ray are marked with numbers. Note that the entrance and exit points are always interchangeable. * denotes the path taken by the ray.

Note carefully the relative positions of the ball and the ninety degree deflection it causes.

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

In the first example, the ray is deflected downwards by the upper ball, then left by the lower ball, and finally retraces its path to its point of origin. The second example is similar. The third example is a bit anomalous but can be rationalized by realizing the ray never gets a chance to get into the box. Alternatively, the ray can be thought of as being deflected downwards and immediately emerging from the box.

A hit occurs when a ray runs straight into a ball:

  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - O - - -
  - - - - - - - -         - - - - O - - -        H * * * * - - - -
  - - - - - - - -       H * * * * O - - -          - - - * - - - -
  - - - - - - - -         - - - - O - - -          - - - O - - - -
H * * * O - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - - - - -

Be sure to compare the second example of a hit with the first example of a reflection.

Important: A hit takes priority over a reflection. If a ball is in the entry cell, the ray is absorbed even if there are also balls diagonally adjacent that would otherwise cause a reflection:

  O - - - - - - -
H O - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -

In this example, even though there is a ball at row 1 that would normally cause an edge reflection, the ball at row 2 absorbs the ray first.

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

When you think you know where all 4 balls are, make your guess.`;

const BASELINE_PREDICT_PROMPT = `Predict where a ray will exit in Black Box.

GRID: 8x8, rows 1-8 (top to bottom), columns 1-8 (left to right).
EDGES: NORTH/SOUTH use columns 1-8, EAST/WEST use rows 1-8.

As a ray approaches a ball it is deflected ninety degrees. Rays can be deflected multiple times. In these diagrams, - is empty, O is a ball, * is the ray path.

DEFLECTION examples (note carefully the relative position of ball and deflection):

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

REFLECTION (R) - ray returns to entry point:
                                                                           
  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - O - - -         - - O - O - - -          - - - - - - - -
R * * * * - - - -         - - - * - - - -          O - - - - - - -
  - - - - O - - -         - - - * - - - -        R - - - - - - - -
  - - - - - - - -         - - - * - - - -          - - - - - - - -
  - - - - - - - -         - - - * - - - -          - - - - - - - -
  - - - - - - - -       R * * * * - - - -          - - - - - - - -
  - - - - - - - -         - - - - O - - -          - - - - - - - -

The third example: ray never enters because ball is adjacent to entry point.

HIT (H) - ray absorbed when striking ball directly:

  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - O - - -
  - - - - - - - -         - - - - O - - -        H * * * * - - - -
  - - - - - - - -       H * * * * O - - -          - - - * - - - -
  - - - - - - - -         - - - - O - - -          - - - O - - - -
H * * * O - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - - - - -

Compare the second hit example (3 balls in column) with the first reflection example (2 balls).

Important: A hit takes priority over a reflection. If a ball is in the entry cell, it is absorbed even if diagonal balls would otherwise cause reflection:

  O - - - - - - -
H O - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -

Respond with JSON only:
{"exit_side": "north|south|east|west", "exit_position": 1-8, "reasoning": "..."}
OR for absorption: {"absorbed": true, "reasoning": "..."}
OR for reflection: {"reflected": true, "reasoning": "..."}`;

// AUGMENTED: Current detailed prompts (defined below as DEFAULT_*)

// AUGMENTED+VIZ: Same as augmented but with board visualization in context
// (This is handled programmatically by including generateTextBoard output)

// Separate factors for factorial design
const PROMPT_STYLES = {
  baseline: {
    name: 'Baseline',
    description: 'Human-equivalent rules (Emacs style)',
    playPrompt: BASELINE_PLAY_PROMPT,
    predictPrompt: BASELINE_PREDICT_PROMPT,
  },
  augmented: {
    name: 'Augmented',
    description: 'Detailed strategy guidance',
    // playPrompt and predictPrompt set after DEFAULT_* definitions
  }
};

// Legacy PROMPT_CONDITIONS for backward compatibility (will be removed)
const PROMPT_CONDITIONS = {
  baseline: {
    name: 'Baseline',
    description: 'Human-equivalent rules with ASCII diagrams (Emacs style)',
    playPrompt: BASELINE_PLAY_PROMPT,
    predictPrompt: BASELINE_PREDICT_PROMPT,
    includeVisualization: false
  },
  augmented: {
    name: 'Augmented',
    description: 'Detailed strategy guidance and error warnings',
    // playPrompt and predictPrompt set after DEFAULT_* definitions
    includeVisualization: false
  },
  augmented_viz: {
    name: 'Augmented+Viz',
    description: 'Augmented with text board visualization',
    // playPrompt and predictPrompt set after DEFAULT_* definitions
    includeVisualization: true
  }
};

function generateAtoms() {
  const atoms = new Set();
  while (atoms.size < NUM_ATOMS) {
    const row = Math.floor(Math.random() * GRID_SIZE) + 1;
    const col = Math.floor(Math.random() * GRID_SIZE) + 1;
    atoms.add(`${row},${col}`);
  }
  return atoms;
}

function getKey(row, col) {
  return `${row},${col}`;
}

function getDiagonalsAhead(row, col, dr, dc) {
  if (dr === 1) return { left: [row + 1, col + 1], right: [row + 1, col - 1] };
  if (dr === -1) return { left: [row - 1, col - 1], right: [row - 1, col + 1] };
  if (dc === 1) return { left: [row - 1, col + 1], right: [row + 1, col + 1] };
  return { left: [row + 1, col - 1], right: [row - 1, col - 1] };
}

function traceRay(atoms, entrySide, entryPos) {
  const path = [];
  let row, col, dr, dc;
  
  if (entrySide === 'north') { row = 0; col = entryPos; dr = 1; dc = 0; }
  else if (entrySide === 'south') { row = GRID_SIZE + 1; col = entryPos; dr = -1; dc = 0; }
  else if (entrySide === 'west') { row = entryPos; col = 0; dr = 0; dc = 1; }
  else { row = entryPos; col = GRID_SIZE + 1; dr = 0; dc = -1; }
  
  const entry = { side: entrySide, pos: entryPos };
  
  // Calculate entry cell position
  const entryRow = row + dr;
  const entryCol = col + dc;
  
  // FIRST: Check if entry cell has an atom → ABSORBED (takes priority over reflection)
  if (atoms.has(getKey(entryRow, entryCol))) {
    return { entry, exit: null, path: [[entryRow, entryCol]], absorbed: true };
  }
  
  // SECOND: Check diagonal cells for reflection
  const initDiags = getDiagonalsAhead(row, col, dr, dc);
  if (atoms.has(getKey(...initDiags.left)) || atoms.has(getKey(...initDiags.right))) {
    return { entry, exit: { side: entrySide, pos: entryPos }, path: [], absorbed: false };
  }
  
  for (let step = 0; step < 100; step++) {
    row += dr; col += dc;
    
    if (row < 1 || row > GRID_SIZE || col < 1 || col > GRID_SIZE) {
      let exitSide, exitPos;
      if (row < 1) { exitSide = 'north'; exitPos = col; }
      else if (row > GRID_SIZE) { exitSide = 'south'; exitPos = col; }
      else if (col < 1) { exitSide = 'west'; exitPos = row; }
      else { exitSide = 'east'; exitPos = row; }
      return { entry, exit: { side: exitSide, pos: exitPos }, path, absorbed: false };
    }
    
    path.push([row, col]);
    if (atoms.has(getKey(row, col))) return { entry, exit: null, path, absorbed: true };
    
    const ahead = [row + dr, col + dc];
    if (!atoms.has(getKey(...ahead))) {
      const diags = getDiagonalsAhead(row, col, dr, dc);
      const leftAtom = atoms.has(getKey(...diags.left));
      const rightAtom = atoms.has(getKey(...diags.right));
      
      if (leftAtom && rightAtom) { dr = -dr; dc = -dc; }
      else if (leftAtom) { [dr, dc] = [dc, -dr]; }
      else if (rightAtom) { [dr, dc] = [-dc, dr]; }
    }
  }
  return { entry, exit: null, path, absorbed: false, error: 'max_steps' };
}

function formatRayResult(ray) {
  if (ray.absorbed) return `Ray from ${ray.entry.side.toUpperCase()}-${ray.entry.pos}: ABSORBED`;
  if (ray.entry.side === ray.exit?.side && ray.entry.pos === ray.exit?.pos) 
    return `Ray from ${ray.entry.side.toUpperCase()}-${ray.entry.pos}: REFLECTED`;
  return `Ray from ${ray.entry.side.toUpperCase()}-${ray.entry.pos}: Exited at ${ray.exit.side.toUpperCase()}-${ray.exit.pos}`;
}

function generateTextBoard(rays, gridSize = 8, atomSet = null, hypotheses = null) {
  // Build edge markers from ray results
  // Format: { side: { position: marker } }
  const edgeMarkers = { north: {}, south: {}, east: {}, west: {} };
  
  rays.forEach(ray => {
    const entrySide = ray.entry.side;
    const entryPos = ray.entry.pos;
    
    if (ray.absorbed) {
      edgeMarkers[entrySide][entryPos] = 'H';
    } else if (ray.entry.side === ray.exit?.side && ray.entry.pos === ray.exit?.pos) {
      edgeMarkers[entrySide][entryPos] = 'R';
    } else if (ray.exit) {
      // Use ray id for matched entry/exit pairs
      edgeMarkers[entrySide][entryPos] = ray.id;
      edgeMarkers[ray.exit.side][ray.exit.pos] = ray.id;
    }
  });
  
  let board = '';
  
  // Row prefix is: ' ' + digit + marker(2) + ' ' = 5 chars before first dash
  // Column headers need same 5 space prefix for alignment
  
  // Column numbers header
  board += '     ';  // 5 spaces
  for (let c = 1; c <= gridSize; c++) {
    board += c + ' ';
  }
  board += '\n';
  
  // North edge markers row
  board += '     ';  // 5 spaces
  for (let c = 1; c <= gridSize; c++) {
    const marker = edgeMarkers.north[c];
    board += (marker !== undefined ? String(marker) : ' ') + ' ';
  }
  board += '\n';
  
  // Grid rows
  for (let r = 1; r <= gridSize; r++) {
    board += ' ' + r;  // 2 chars
    const westMarker = edgeMarkers.west[r];
    board += (westMarker !== undefined ? String(westMarker).padStart(2, ' ') : '  ') + ' ';  // 3 chars
    for (let c = 1; c <= gridSize; c++) {
      // Check if atom is at this position (for Predict mode)
      const cellKey = `${r},${c}`;
      if (atomSet && atomSet.has(cellKey)) {
        board += 'O ';  // O for actual atom
      } else if (hypotheses && hypotheses.has(cellKey)) {
        board += 'X ';  // X for hypothesized atom
      } else {
        board += '- ';
      }
    }
    const eastMarker = edgeMarkers.east[r];
    board += (eastMarker !== undefined ? String(eastMarker) : ' ');
    board += '\n';
  }
  
  // South edge markers row
  board += '     ';  // 5 spaces
  for (let c = 1; c <= gridSize; c++) {
    const marker = edgeMarkers.south[c];
    board += (marker !== undefined ? String(marker) : ' ') + ' ';
  }
  board += '\n';
  
  board += '\nColumns 1-8 (top/bottom), Rows 1-8 (left)\n';
  if (atomSet) {
    board += 'O=atom, H=hit/absorbed, R=reflected, numbers=entry/exit pairs\n';
  } else if (hypotheses && hypotheses.size > 0) {
    board += 'X=hypothesized atom, H=hit/absorbed, R=reflected, numbers=entry/exit pairs\n';
  } else {
    board += 'H=hit/absorbed, R=reflected, numbers=entry/exit pairs\n';
  }
  
  return board;
}

const DEFAULT_SYSTEM_PROMPT = `You are playing Black Box. Find exactly 4 hidden atoms in an 8x8 grid by firing rays.

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

Max 20 rays. Be strategic and cross-reference observations.`;

const DEFAULT_PREDICT_SYSTEM_PROMPT = `You are testing your understanding of Black Box ray tracing rules.

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

Trace the ray step by step in your reasoning.`;

// Complete the PROMPT_CONDITIONS setup (legacy)
PROMPT_CONDITIONS.augmented.playPrompt = DEFAULT_SYSTEM_PROMPT;
PROMPT_CONDITIONS.augmented.predictPrompt = DEFAULT_PREDICT_SYSTEM_PROMPT;
PROMPT_CONDITIONS.augmented_viz.playPrompt = DEFAULT_SYSTEM_PROMPT;
PROMPT_CONDITIONS.augmented_viz.predictPrompt = DEFAULT_PREDICT_SYSTEM_PROMPT;

// Complete the PROMPT_STYLES setup
PROMPT_STYLES.augmented.playPrompt = DEFAULT_SYSTEM_PROMPT;
PROMPT_STYLES.augmented.predictPrompt = DEFAULT_PREDICT_SYSTEM_PROMPT;

// ============================================
// VISUALIZATION OF THINKING (VoT) PROMPTS
// ============================================

const VOT_PROMPTS = {
  // Option A: Grid State Tracking - Play modes only
  gridState: `
=== VISUALIZATION: GRID STATE TRACKING ===
Before each action, draw the current 8x8 grid state in your reasoning:
- Use '.' for unknown cells
- Use '?' for cells where you suspect an atom might be
- Use 'X' for cells you've ruled out
- Use '*' for cells a ray has passed through
- Mark edge results (H, R, or exit numbers) around the border

This helps you see patterns and constrain possibilities spatially.
`,

  // Option B: Ray Trace Visualization - All modes
  rayTrace: `
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
`,

  // Option C: Hypothesis Testing - Play modes only
  hypothesis: `
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
`
};

// Helper function to build prompt with VoT additions
function buildPromptWithVoT(basePrompt, votConfig) {
  let prompt = basePrompt;
  
  if (votConfig.gridState) {
    prompt += VOT_PROMPTS.gridState;
  }
  if (votConfig.rayTrace) {
    prompt += VOT_PROMPTS.rayTrace;
  }
  if (votConfig.hypothesis) {
    prompt += VOT_PROMPTS.hypothesis;
  }
  
  return prompt;
}

// ============================================
// EXPERIMENT DATA STRUCTURES
// ============================================

function createExperimentResult() {
  return {
    experimentId: `exp_${Date.now()}`,
    startTime: new Date().toISOString(),
    endTime: null,
    model: null,
    modelName: null,
    promptStyle: null,
    includeVisualization: null,
    allowHypotheses: null,
    enableThinking: null,
    thinkingBudget: null,
    // VoT settings
    votGridState: null,
    votRayTrace: null,
    votHypothesis: null,
    promptCondition: null, // Legacy combined field
    mode: null, // 'predict' or 'play'
    configIndex: null,
    atomConfig: null,
    
    // Prompts used (for verification)
    systemPrompt: null,
    sampleUserPrompt: null,
    
    // For Predict mode
    predictions: [], // Array of {rayEntry, predicted, actual, correct, reasoning, thinking, responseTimeMs, inputTokens, outputTokens}
    
    // For Play mode
    raysUsed: 0,
    raySequence: [], // Array of {rayEntry, result, reasoning, thinking, responseTimeMs, inputTokens, outputTokens}
    invalidMoves: 0,
    finalGuess: null,
    atomsCorrect: 0,
    atomsMissed: 0,
    score: 0, // Entry/exit points + 5 per missed atom
    hypothesisActions: 0, // Count of mark/unmark actions
    
    // Timing and tokens
    totalApiCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalResponseTimeMs: 0,
  };
}

function getAllRayEntries() {
  const entries = [];
  ['north', 'south'].forEach(side => {
    for (let pos = 1; pos <= 8; pos++) {
      entries.push({ side, pos });
    }
  });
  ['east', 'west'].forEach(side => {
    for (let pos = 1; pos <= 8; pos++) {
      entries.push({ side, pos });
    }
  });
  return entries;
}

// Calculate score for Play mode
// Each entry point = 1, each exit point = 1 (reflection = 1, absorbed = 1, detour = 2)
// Each missed atom = 5 points
// Lower score is better
function calculateScore(rays, atomsCorrect, totalAtoms = 4) {
  let rayPoints = 0;
  rays.forEach(ray => {
    rayPoints += 1; // Entry point
    if (ray.exit && !ray.absorbed) {
      // Has exit point
      if (ray.entry.side !== ray.exit.side || ray.entry.pos !== ray.exit.pos) {
        // Detour (different entry and exit)
        rayPoints += 1;
      }
      // Reflection (same entry and exit) doesn't add extra point
    }
    // Absorbed rays only count entry point (already added)
  });
  
  const atomsMissed = totalAtoms - atomsCorrect;
  const missedPenalty = atomsMissed * 5;
  
  return {
    rayPoints,
    missedPenalty,
    total: rayPoints + missedPenalty,
    atomsMissed
  };
}

async function callClaude(messages, systemPrompt, model = 'claude-sonnet-4-5-20250929', useThinking = true, thinkingBudget = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout
  
  try {
    const headers = { 
      "Content-Type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true"
    };
    
    // Add thinking beta header if thinking is enabled
    if (useThinking) {
      headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";
    }
    
    const body = {
      model: model,
      max_tokens: 16000,
      system: systemPrompt,
      messages: messages,
    };
    
    // Add thinking config if enabled
    if (useThinking) {
      body.thinking = {
        type: "enabled",
        budget_tokens: thinkingBudget
      };
    }
    
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText.slice(0, 200)}`);
    }
    
    const data = await response.json();
    
    // Extract thinking and text blocks
    let thinking = [];
    let text = "";
    
    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'thinking') {
          thinking.push(block.thinking);
        } else if (block.type === 'text') {
          text += block.text;
        }
      }
    }
    
    // Check for API errors in response
    if (data.error) {
      throw new Error(`API error: ${data.error.message || JSON.stringify(data.error)}`);
    }
    
    // Extract usage data
    const usage = data.usage || { input_tokens: 0, output_tokens: 0 };
    
    return { thinking, text: text || "Error: No response content", usage };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { thinking: [], text: `Error: Request timed out after 90 seconds`, usage: { input_tokens: 0, output_tokens: 0 } };
    }
    return { thinking: [], text: `Error: ${error.message}`, usage: { input_tokens: 0, output_tokens: 0 } };
  }
}

function parseResponse(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {}
  return null;
}

export default function BlackBoxGame() {
  const [atoms, setAtoms] = useState(() => generateAtoms());
  const [rays, setRays] = useState([]);
  const [rayCounter, setRayCounter] = useState(1);
  const [guesses, setGuesses] = useState(new Set());
  const [gameChecked, setGameChecked] = useState(false);
  const [mode, setMode] = useState('play');
  const [llmRunning, setLlmRunning] = useState(false);
  const [llmMessages, setLlmMessages] = useState([]);
  const [llmLog, setLlmLog] = useState([]);
  const [predictLog, setPredictLog] = useState([]);
  const [predicting, setPredicting] = useState(false);
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5-20250929');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [predictPrompt, setPredictPrompt] = useState(DEFAULT_PREDICT_SYSTEM_PROMPT);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  
  // VoT (Visualization of Thinking) settings for LLM/Predict modes
  const [votConfig, setVotConfig] = useState({
    gridState: false,   // Option A - Play modes only
    rayTrace: false,    // Option B - All modes
    hypothesis: false,  // Option C - Play modes only
  });
  
  // Additional settings for LLM/Predict modes (matching experiment options)
  const [llmSettings, setLlmSettings] = useState({
    promptStyle: 'baseline',      // 'baseline' or 'augmented'
    includeVisualization: false,  // Show text board in prompts
    allowHypotheses: false,       // Enable mark/unmark/check actions (LLM mode only)
    enableThinking: true,         // Enable extended thinking
    thinkingBudget: 10000,        // Token budget for extended thinking
  });
  
  // ============================================
  // EXPERIMENT STATE
  // ============================================
  const [experimentMode, setExperimentMode] = useState(false);
  const [experimentRunning, setExperimentRunning] = useState(false);
  const [experimentResults, setExperimentResults] = useState([]);
  const [currentExperiment, setCurrentExperiment] = useState(null);
  const shouldStopExperiment = useRef(false);
  const [experimentPausedForRateLimit, setExperimentPausedForRateLimit] = useState(false);
  const resumeExperimentResolve = useRef(null);
  // Rerun failures state
  const [rerunSourceData, setRerunSourceData] = useState(null);
  const [rerunFailures, setRerunFailures] = useState([]);
  // Visualization state for experiment mode
  const [experimentAtoms, setExperimentAtoms] = useState(new Set());
  const [experimentRays, setExperimentRays] = useState([]);
  const [experimentPredictions, setExperimentPredictions] = useState([]);
  const [experimentHypotheses, setExperimentHypotheses] = useState(new Set());
  const [experimentConfig, setExperimentConfig] = useState({
    taskMode: 'predict', // 'predict' or 'play'
    promptStyle: 'baseline', // 'baseline' or 'augmented'
    includeVisualization: false, // whether to include text board
    allowHypotheses: false, // whether LLM can mark/unmark hypothesized atom positions (Play mode only)
    enableThinking: true, // whether to enable extended thinking
    thinkingBudget: 10000, // token budget for extended thinking
    // VoT (Visualization of Thinking) settings
    votGridState: false,   // Option A - Play modes only
    votRayTrace: false,    // Option B - All modes
    votHypothesis: false,  // Option C - Play modes only
    configIndices: [0, 1, 2, 3, 4], // Which configs to run (0-9)
    modelsToTest: ['claude-sonnet-4-5-20250929'], // Can select multiple
    // Legacy field for backward compatibility
    promptCondition: 'baseline',
  });
  const [experimentProgress, setExperimentProgress] = useState({
    currentConfigIndex: 0,
    currentModelIndex: 0,
    currentRayIndex: 0,
    totalConfigs: 0,
    totalModels: 0,
    status: 'idle',
    log: []
  });
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  
  const modelOptions = [
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5' },
    { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5' },
  ];
  
  // Track used edge positions (entry and exit points)
  const usedPositions = new Set();
  rays.forEach(ray => {
    usedPositions.add(`${ray.entry.side}-${ray.entry.pos}`);
    if (ray.exit) {
      usedPositions.add(`${ray.exit.side}-${ray.exit.pos}`);
    }
  });
  
  const handleNewGame = () => {
    setAtoms(generateAtoms());
    setRays([]);
    setRayCounter(1);
    setGuesses(new Set());
    setGameChecked(false);
    setLlmMessages([]);
    setLlmLog([]);
    setLlmRunning(false);
    setPredictLog([]);
    setPredicting(false);
  };
  
  // ============================================
  // EXPERIMENT FUNCTIONS
  // ============================================
  
  const addExperimentLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setExperimentProgress(prev => ({
      ...prev,
      log: [...prev.log, `[${timestamp}] ${message}`]
    }));
  };

  // Pause experiment on rate limit and wait for user to resume
  const waitForRateLimitResume = () => {
    return new Promise(resolve => {
      resumeExperimentResolve.current = resolve;
      setExperimentPausedForRateLimit(true);
    });
  };

  const handleResumeExperiment = () => {
    setExperimentPausedForRateLimit(false);
    if (resumeExperimentResolve.current) {
      resumeExperimentResolve.current();
      resumeExperimentResolve.current = null;
    }
  };

  const runPredictExperiment = async (configIndex, model, promptStyle, includeVisualization, enableThinking, thinkingBudget, votSettings) => {
    const config = EXPERIMENT_CONFIGS[configIndex];
    const atomSet = configToAtomSet(config);
    const promptConfig = PROMPT_STYLES[promptStyle];
    const modelName = modelOptions.find(m => m.id === model)?.name || model;
    
    // Build VoT config for predict mode (only rayTrace and coordinate apply)
    const votConfigForPrompt = {
      gridState: false, // Not applicable for predict mode
      rayTrace: votSettings?.rayTrace || false,
      hypothesis: false, // Not applicable for predict mode
    };
    
    // Initialize visualization for this experiment
    setExperimentAtoms(atomSet);
    setExperimentRays([]);
    setExperimentPredictions([]);
    
    const result = createExperimentResult();
    result.model = model;
    result.modelName = modelName;
    result.promptStyle = promptStyle;
    result.includeVisualization = includeVisualization;
    result.enableThinking = enableThinking;
    result.thinkingBudget = thinkingBudget;
    result.votGridState = votConfigForPrompt.gridState;
    result.votRayTrace = votConfigForPrompt.rayTrace;
    result.votHypothesis = votConfigForPrompt.hypothesis;
    const votSuffix = (votConfigForPrompt.rayTrace ? '+votB' : '');
    result.promptCondition = `${promptStyle}${includeVisualization ? '+viz' : ''}${enableThinking ? '+think' : ''}${votSuffix}`; // Legacy field
    result.mode = 'predict';
    result.configIndex = configIndex;
    result.atomConfig = config;
    
    // Build system prompt with VoT additions
    const systemPromptWithVoT = buildPromptWithVoT(promptConfig.predictPrompt, votConfigForPrompt);
    
    // Store prompts used
    result.systemPrompt = systemPromptWithVoT;
    const atomList = config.map(([r, c]) => `(${r},${c})`).join(', ');
    let sampleUserPrompt = `Atoms are located at: ${atomList}\n\n`;
    if (includeVisualization) {
      sampleUserPrompt += `Board (O = atom positions):\n\`\`\`\n`;
      sampleUserPrompt += generateTextBoard([], 8, atomSet);
      sampleUserPrompt += `\`\`\`\n\n`;
    }
    sampleUserPrompt += `A ray is fired from NORTH-1.\n\nTrace the ray step by step and predict where it will exit (or if it will be absorbed/reflected).`;
    result.sampleUserPrompt = sampleUserPrompt;
    
    const allRays = getAllRayEntries();
    const testedPositions = new Set(); // Track positions we've tested or inferred
    const visualRays = []; // Track rays for visualization
    const visualPredictions = []; // Track predictions for visualization
    
    addExperimentLog(`Starting Predict experiment: Config ${configIndex + 1}, ${modelName}, ${promptStyle}${includeVisualization ? '+viz' : ''}${enableThinking ? '+think' : ''}${votSuffix}`);
    
    let raysTested = 0;
    let raysSkipped = 0;
    
    for (let i = 0; i < allRays.length; i++) {
      // Check for stop request
      if (shouldStopExperiment.current) {
        addExperimentLog(`Stopped by user at position ${i + 1}`);
        break;
      }
      
      const { side, pos } = allRays[i];
      const posKey = `${side}-${pos}`;
      
      // Skip if we already know the result for this position
      if (testedPositions.has(posKey)) {
        raysSkipped++;
        continue;
      }
      
      testedPositions.add(posKey);
      raysTested++;
      
      setExperimentProgress(prev => ({
        ...prev,
        currentRayIndex: raysTested,
        status: `Config ${configIndex + 1}: Testing ${side.toUpperCase()}-${pos} (ray ${raysTested}, ${raysSkipped} skipped)`
      }));
      
      const atomList = config.map(([r, c]) => `(${r},${c})`).join(', ');
      
      // Build prompt - optionally include visual board showing atom positions
      let prompt = `Atoms are located at: ${atomList}\n\n`;
      if (includeVisualization) {
        prompt += `Board (O = atom positions):\n\`\`\`\n`;
        prompt += generateTextBoard([], 8, atomSet);  // Empty rays, show atoms
        prompt += `\`\`\`\n\n`;
      }
      prompt += `A ray is fired from ${side.toUpperCase()}-${pos}.\n\nTrace the ray step by step and predict where it will exit (or if it will be absorbed/reflected).`;
      
      const startTime = Date.now();
      addExperimentLog(`→ ${side.toUpperCase()}-${pos}: Calling API...`);
      
      try {
        // Retry logic for transient API errors
        const maxRetries = 3;
        let lastError = null;
        let response = null;
        let thinking = [];
        let usage = { input_tokens: 0, output_tokens: 0 };
        let totalResponseTimeMs = 0;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          const attemptStart = Date.now();
          const apiResult = await callClaude(
            [{ role: "user", content: prompt }],
            systemPromptWithVoT,
            model,
            enableThinking,
            thinkingBudget
          );

          const attemptTimeMs = Date.now() - attemptStart;
          totalResponseTimeMs += attemptTimeMs;
          result.totalApiCalls++;

          thinking = apiResult.thinking;
          response = apiResult.text;
          usage = apiResult.usage;

          // Check for rate limit errors - pause and wait for user to resume
          if (response.startsWith('Error:') &&
              (response.includes('429') || response.includes('rate_limit') ||
               response.includes('rate limit') || response.includes('Too many requests'))) {
            addExperimentLog(`  ⏸️ Rate limit hit. Pausing experiment - click Resume when ready.`);
            await waitForRateLimitResume();
            addExperimentLog(`  ▶️ Resuming experiment...`);
            // Retry this attempt after resume
            attempt--;
            continue;
          }

          // Check if this is a retryable server error (500, 529, overloaded)
          if (response.startsWith('Error:') &&
              (response.includes('500') || response.includes('529') ||
               response.includes('overloaded') || response.includes('Internal server error'))) {
            lastError = response;
            if (attempt < maxRetries) {
              const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000); // 1s, 2s, 4s, max 8s
              addExperimentLog(`  ⚠️ Attempt ${attempt}/${maxRetries} failed, retrying in ${backoffMs/1000}s...`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
              continue;
            }
          }

          // Success or non-retryable error - exit retry loop
          lastError = null;
          break;
        }

        const responseTimeMs = Date.now() - startTime;
        const elapsed = (responseTimeMs / 1000).toFixed(1);
        result.totalInputTokens += usage.input_tokens || 0;
        result.totalOutputTokens += usage.output_tokens || 0;
        result.totalResponseTimeMs += totalResponseTimeMs;

        // Log response (truncated)
        const respPreview = response.substring(0, 100).replace(/\n/g, ' ');
        addExperimentLog(`  [${elapsed}s] Response: "${respPreview}${response.length > 100 ? '...' : ''}" (${usage.input_tokens}+${usage.output_tokens} tokens)`);

        // Check for error responses (after all retries exhausted)
        if (response.startsWith('Error:')) {
          addExperimentLog(`  ⚠️ API Error after ${maxRetries} attempts: ${response}`);

          // Still compute actual ray trace result even when API fails
          const actual = traceRay(atomSet, side, pos);
          let actualOutcome = 'unknown';
          if (actual.absorbed) {
            actualOutcome = 'absorbed';
          } else if (actual.entry.side === actual.exit?.side && actual.entry.pos === actual.exit?.pos) {
            actualOutcome = 'reflected';
          } else if (actual.exit) {
            actualOutcome = `${actual.exit.side}-${actual.exit.pos}`;
          }

          result.predictions.push({
            rayEntry: { side, pos },
            userPrompt: prompt,
            rayResult: actual,
            predicted: 'error',
            actual: actualOutcome,
            correct: false,
            reasoning: response,
            thinking: '',
            responseTimeMs,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0
          });

          // Update visualization
          actual.id = visualRays.length + 1;
          visualRays.push(actual);
          visualPredictions.push({
            ray: `${side.toUpperCase()}-${pos}`,
            correct: false
          });
          setExperimentRays([...visualRays]);
          setExperimentPredictions([...visualPredictions]);

          // Mark exit position as tested (for symmetry optimization)
          if (actual.exit && !(actual.entry.side === actual.exit.side && actual.entry.pos === actual.exit.pos)) {
            const exitKey = `${actual.exit.side}-${actual.exit.pos}`;
            testedPositions.add(exitKey);
          }

          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        
        // Parse prediction with retry logic for malformed JSON
        let prediction = null;
        let parseAttempts = 0;
        const maxParseAttempts = 2;
        let currentResponse = response;
        
        while (prediction === null && parseAttempts < maxParseAttempts) {
          parseAttempts++;
          try {
            // Try to extract JSON from response
            const match = currentResponse.match(/\{[\s\S]*?\}/);
            if (match) {
              prediction = JSON.parse(match[0]);
            } else {
              // No JSON found - try to interpret the text response
              const lowerResp = currentResponse.toLowerCase();
              if (lowerResp.includes('absorb') || lowerResp.includes('hit')) {
                prediction = { absorbed: true, reasoning: currentResponse };
              } else if (lowerResp.includes('reflect')) {
                prediction = { reflected: true, reasoning: currentResponse };
              } else {
                // Try to find exit information in text
                const sideMatch = lowerResp.match(/(north|south|east|west)[^\d]*(\d)/);
                if (sideMatch) {
                  prediction = { 
                    exit_side: sideMatch[1], 
                    exit_position: parseInt(sideMatch[2]),
                    reasoning: currentResponse 
                  };
                }
              }
            }
          } catch (e) {
            // JSON parse failed - retry with correction prompt if first attempt
            if (parseAttempts < maxParseAttempts) {
              addExperimentLog(`JSON parse failed for ${side.toUpperCase()}-${pos}, retrying...`);
              const retryResult = await callClaude(
                [{ role: "user", content: `Your previous response was not valid JSON. Please respond with ONLY a JSON object, nothing else:\n\nOriginal question: Atoms at ${config.map(([r, c]) => `(${r},${c})`).join(', ')}. Ray from ${side.toUpperCase()}-${pos}. Where does it exit?\n\nRespond with ONE of these exact formats:\n{"exit_side": "north", "exit_position": 5, "reasoning": "..."}\n{"absorbed": true, "reasoning": "..."}\n{"reflected": true, "reasoning": "..."}` }],
                "Respond with JSON only. No other text.",
                model,
                enableThinking,
                thinkingBudget
              );
              result.totalApiCalls++;
              currentResponse = retryResult.text;
            }
          }
        }
        
        // If still no prediction, mark as parse error
        if (prediction === null) {
          addExperimentLog(`Could not parse response for ${side.toUpperCase()}-${pos}`);
          prediction = { parse_error: true, raw_response: response };
        }
        
        // Get actual result
        const actual = traceRay(atomSet, side, pos);
        
        // Determine correctness
        let correct = false;
        let predictedOutcome = 'unknown';
        let actualOutcome = 'unknown';
        
        if (actual.absorbed) {
          actualOutcome = 'absorbed';
          correct = prediction?.absorbed === true;
        } else if (actual.entry.side === actual.exit?.side && actual.entry.pos === actual.exit?.pos) {
          actualOutcome = 'reflected';
          correct = prediction?.reflected === true;
        } else {
          actualOutcome = `${actual.exit.side}-${actual.exit.pos}`;
          correct = prediction?.exit_side === actual.exit.side && 
                   prediction?.exit_position === actual.exit.pos;
        }
        
        if (prediction?.absorbed) predictedOutcome = 'absorbed';
        else if (prediction?.reflected) predictedOutcome = 'reflected';
        else if (prediction?.exit_side) predictedOutcome = `${prediction.exit_side}-${prediction.exit_position}`;
        
        // Log result
        const resultIcon = correct ? '✓' : '✗';
        addExperimentLog(`  ${resultIcon} Predicted: ${predictedOutcome} | Actual: ${actualOutcome}`);
        
        result.predictions.push({
          rayEntry: { side, pos },
          userPrompt: prompt,
          rayResult: actual, // Store full ray result including path for HTML report
          predicted: predictedOutcome,
          actual: actualOutcome,
          correct,
          reasoning: prediction?.reasoning || response,
          thinking: thinking.join('\n---\n'),
          responseTimeMs,
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0
        });
        
        // Update visualization
        actual.id = visualRays.length + 1;
        visualRays.push(actual);
        visualPredictions.push({
          ray: `${side.toUpperCase()}-${pos}`,
          correct
        });
        setExperimentRays([...visualRays]);
        setExperimentPredictions([...visualPredictions]);
        
        // Mark exit position as tested (reverse path gives same info)
        // Only for detours - absorbed/reflected don't have different exit positions
        if (actual.exit && !(actual.entry.side === actual.exit.side && actual.entry.pos === actual.exit.pos)) {
          const exitKey = `${actual.exit.side}-${actual.exit.pos}`;
          testedPositions.add(exitKey);
        }
        
      } catch (error) {
        const responseTimeMs = Date.now() - startTime;
        const elapsed = (responseTimeMs / 1000).toFixed(1);
        addExperimentLog(`  ⚠️ [${elapsed}s] Error: ${error.message}`);
        result.totalResponseTimeMs += responseTimeMs;
        
        // Get actual result for visualization even on error
        const actual = traceRay(atomSet, side, pos);
        actual.id = visualRays.length + 1;
        visualRays.push(actual);
        visualPredictions.push({
          ray: `${side.toUpperCase()}-${pos}`,
          correct: false
        });
        setExperimentRays([...visualRays]);
        setExperimentPredictions([...visualPredictions]);
        
        // Determine actual outcome for logging
        let actualOutcome = 'unknown';
        if (actual.absorbed) {
          actualOutcome = 'absorbed';
        } else if (actual.entry.side === actual.exit?.side && actual.entry.pos === actual.exit?.pos) {
          actualOutcome = 'reflected';
        } else if (actual.exit) {
          actualOutcome = `${actual.exit.side}-${actual.exit.pos}`;
        }
        
        result.predictions.push({
          rayEntry: { side, pos },
          userPrompt: prompt,
          rayResult: actual, // Store ray result even on error
          predicted: 'error',
          actual: actualOutcome,
          correct: false,
          reasoning: error.message,
          thinking: '',
          responseTimeMs,
          inputTokens: 0,
          outputTokens: 0
        });
        
        // Mark exit position as tested even on error (reverse path gives same info)
        if (actual.exit && !(actual.entry.side === actual.exit.side && actual.entry.pos === actual.exit.pos)) {
          const exitKey = `${actual.exit.side}-${actual.exit.pos}`;
          testedPositions.add(exitKey);
        }
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    result.endTime = new Date().toISOString();
    const correctCount = result.predictions.filter(p => p.correct).length;
    const totalTested = result.predictions.length;
    addExperimentLog(`Completed: ${correctCount}/${totalTested} correct (${(correctCount/totalTested*100).toFixed(1)}%) - ${32 - totalTested} reverse rays skipped`);
    addExperimentLog(`Tokens: ${result.totalInputTokens} in + ${result.totalOutputTokens} out = ${result.totalInputTokens + result.totalOutputTokens} total`);
    addExperimentLog(`Time: ${(result.totalResponseTimeMs / 1000).toFixed(1)}s total API time`);
    
    return result;
  };
  
  const runPlayExperiment = async (configIndex, model, promptStyle, includeVisualization, allowHypotheses, enableThinking, thinkingBudget, votSettings) => {
    const config = EXPERIMENT_CONFIGS[configIndex];
    const atomSet = configToAtomSet(config);
    const promptConfig = PROMPT_STYLES[promptStyle];
    const modelName = modelOptions.find(m => m.id === model)?.name || model;
    
    // Build VoT config for play mode (all options apply)
    const votConfigForPrompt = {
      gridState: votSettings?.gridState || false,
      rayTrace: votSettings?.rayTrace || false,
      hypothesis: votSettings?.hypothesis || false,
    };
    
    // Initialize visualization for this experiment
    setExperimentAtoms(atomSet);  // Hidden atoms (for reference, shown at end)
    setExperimentRays([]);
    setExperimentPredictions([]);
    setExperimentHypotheses(new Set());
    
    const result = createExperimentResult();
    result.model = model;
    result.modelName = modelName;
    result.promptStyle = promptStyle;
    result.includeVisualization = includeVisualization;
    result.allowHypotheses = allowHypotheses;
    result.enableThinking = enableThinking;
    result.thinkingBudget = thinkingBudget;
    result.votGridState = votConfigForPrompt.gridState;
    result.votRayTrace = votConfigForPrompt.rayTrace;
    result.votHypothesis = votConfigForPrompt.hypothesis;
    const votSuffix = (votConfigForPrompt.gridState ? '+votA' : '') + (votConfigForPrompt.rayTrace ? '+votB' : '') + 
                      (votConfigForPrompt.hypothesis ? '+votC' : '');
    result.promptCondition = `${promptStyle}${includeVisualization ? '+viz' : ''}${allowHypotheses ? '+hyp' : ''}${enableThinking ? '+think' : ''}${votSuffix}`; // Legacy field
    result.mode = 'play';
    result.configIndex = configIndex;
    result.atomConfig = config;
    
    // Build sample user prompt for export
    let sampleUserPrompt = "Current ray results:\n(No rays fired yet)\n";
    if (includeVisualization) {
      sampleUserPrompt += "\nBoard state:\n```\n";
      sampleUserPrompt += generateTextBoard([], 8, null, null);  // No atoms, no hypotheses yet
      sampleUserPrompt += "```\n";
    }
    if (allowHypotheses) {
      sampleUserPrompt += "\nHypothesized atom positions: (none marked yet)\n";
    }
    sampleUserPrompt += `\nRays fired: 0/20\n\nDecide your next action. JSON only.`;
    result.sampleUserPrompt = sampleUserPrompt;
    
    addExperimentLog(`Starting Play experiment: Config ${configIndex + 1}, ${modelName}, ${promptStyle}${includeVisualization ? '+viz' : ''}${allowHypotheses ? '+hyp' : ''}${enableThinking ? '+think' : ''}${votSuffix}`);
    
    // Build system prompt - modify JSON instructions if hypotheses enabled
    let systemPrompt = promptConfig.playPrompt;
    if (allowHypotheses) {
      // Handle baseline prompt format
      const baselineJsonSection = `Respond with JSON only:
{"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
{"action": "guess", "atoms": [[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}

When you think you know where all 4 balls are, make your guess.`;
      
      const baselineNewSection = `Respond with JSON only:
{"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
{"action": "mark", "row": 1-8, "col": 1-8, "reasoning": "..."} - mark where you think an atom is
{"action": "unmark", "row": 1-8, "col": 1-8, "reasoning": "..."} - remove a marked position
{"action": "check", "reasoning": "..."} - submit your answer (requires exactly 4 marked positions)

You must mark exactly 4 positions where you think the atoms are located. Use mark/unmark to adjust your guesses as you gather information. When you have exactly 4 positions marked and are confident, use the check action to submit your answer.`;

      // Handle augmented prompt format
      const augmentedJsonSection = `Respond with JSON only:
Fire ray: {"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
Final guess: {"action": "guess", "atoms": [[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}

Max 20 rays. Be strategic and cross-reference observations.`;
      
      const augmentedNewSection = `Respond with JSON only:
Fire ray: {"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
Mark atom: {"action": "mark", "row": 1-8, "col": 1-8, "reasoning": "..."} - mark where you think an atom is
Unmark: {"action": "unmark", "row": 1-8, "col": 1-8, "reasoning": "..."} - remove a marked position
Check: {"action": "check", "reasoning": "..."} - submit your answer (requires exactly 4 marked positions)

You must mark exactly 4 positions where you think the atoms are located. Use mark/unmark to refine your guesses. When you have exactly 4 positions marked and are confident, use check to submit. Max 20 rays. Be strategic and cross-reference observations.`;

      // Try both replacements
      if (systemPrompt.includes(baselineJsonSection)) {
        systemPrompt = systemPrompt.replace(baselineJsonSection, baselineNewSection);
      } else if (systemPrompt.includes(augmentedJsonSection)) {
        systemPrompt = systemPrompt.replace(augmentedJsonSection, augmentedNewSection);
      }
    }
    
    // Add VoT prompts
    systemPrompt = buildPromptWithVoT(systemPrompt, votConfigForPrompt);
    result.systemPrompt = systemPrompt;
    
    const messages = [];
    const firedRays = [];
    const usedPos = new Set();
    const hypotheses = new Set(); // Track hypothesized atom positions
    let done = false;
    let rayNum = 0;
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 5;
    let totalIterations = 0;
    const maxIterations = 100; // Prevent infinite loops from mark/unmark
    
    while (!done && rayNum < 20 && consecutiveFailures < maxConsecutiveFailures && totalIterations < maxIterations) {
      totalIterations++;
      
      // Check for stop request
      if (shouldStopExperiment.current) {
        addExperimentLog(`Stopped by user at turn ${rayNum + 1}`);
        break;
      }
      
      setExperimentProgress(prev => ({
        ...prev,
        currentRayIndex: rayNum + 1,
        status: `Iter ${totalIterations}: Turn ${rayNum + 1}/20, ${firedRays.length} rays, ${hypotheses.size} hyp`
      }));
      
      // Build context
      let ctx = "Current ray results:\n";
      if (firedRays.length === 0) {
        ctx += "(No rays fired yet)\n";
      } else {
        firedRays.forEach(r => { ctx += formatRayResult(r) + "\n"; });
        if (includeVisualization) {
          ctx += "\nBoard state:\n```\n";
          ctx += generateTextBoard(firedRays, 8, null, allowHypotheses ? hypotheses : null);
          ctx += "```\n";
        }
      }
      
      if (allowHypotheses) {
        if (hypotheses.size > 0) {
          const hypList = Array.from(hypotheses).map(k => `(${k})`).join(', ');
          ctx += `\nMarked atom positions (${hypotheses.size}/4): ${hypList}`;
          if (hypotheses.size === 4) {
            ctx += ` — Ready to check!\n`;
          } else {
            ctx += `\n`;
          }
        } else {
          ctx += `\nMarked atom positions: (none marked yet)\n`;
        }
      }
      
      if (usedPos.size > 0) {
        ctx += `\nUnavailable positions (already used as entry/exit): ${Array.from(usedPos).sort().join(', ')}\n`;
      }
      ctx += `\nRays fired: ${firedRays.length}/20\n\nDecide your next action. JSON only.`;
      
      const msgs = [...messages, { role: "user", content: ctx }];
      
      addExperimentLog(`Turn ${rayNum + 1}: Calling API...`);
      const startTime = Date.now();
      
      try {
        const { thinking, text: response, usage } = await callClaude(msgs, systemPrompt, model, enableThinking, thinkingBudget);
        const responseTimeMs = Date.now() - startTime;
        const elapsed = (responseTimeMs / 1000).toFixed(1);
        result.totalApiCalls++;
        result.totalInputTokens += usage.input_tokens || 0;
        result.totalOutputTokens += usage.output_tokens || 0;
        result.totalResponseTimeMs += responseTimeMs;
        
        // Log response preview
        const respPreview = response.substring(0, 120).replace(/\n/g, ' ');
        addExperimentLog(`  [${elapsed}s] Response: "${respPreview}${response.length > 120 ? '...' : ''}" (${usage.input_tokens}+${usage.output_tokens} tokens)`);;
        
        // Check for error responses
        if (response.startsWith('Error:')) {
          addExperimentLog(`  ⚠️ API Error: ${response}`);
          consecutiveFailures++;
          rayNum++;
          continue;
        }
        
        let parsed = parseResponse(response);
        
        // Retry logic for failed JSON parsing
        if (!parsed) {
          addExperimentLog(`Parse error on turn ${rayNum + 1}, retrying...`);
          
          // Try to extract action from text
          const lowerResp = response.toLowerCase();
          if (lowerResp.includes('check') && allowHypotheses) {
            // Check action
            parsed = { action: 'check', reasoning: response };
          } else if (lowerResp.includes('guess') && lowerResp.includes('atoms') && !allowHypotheses) {
            // Try to extract coordinates (only for non-hypothesis mode)
            const coordMatches = response.match(/\[?\s*\[?\s*(\d)\s*,\s*(\d)\s*\]?/g);
            if (coordMatches && coordMatches.length >= 4) {
              const atoms = coordMatches.slice(0, 4).map(m => {
                const nums = m.match(/(\d)\s*,\s*(\d)/);
                return [parseInt(nums[1]), parseInt(nums[2])];
              });
              parsed = { action: 'guess', atoms, reasoning: response };
            }
          } else if (lowerResp.includes('fire') || lowerResp.match(/(north|south|east|west)/)) {
            const sideMatch = lowerResp.match(/(north|south|east|west)/);
            const posMatch = response.match(/position[^\d]*(\d)|(\d)\s*$/);
            if (sideMatch) {
              const pos = posMatch ? parseInt(posMatch[1] || posMatch[2]) : null;
              if (pos && pos >= 1 && pos <= 8) {
                parsed = { action: 'fire', side: sideMatch[1], position: pos, reasoning: response };
              }
            }
          }
          
          // If still not parsed, ask for JSON correction
          if (!parsed) {
            addExperimentLog(`  Requesting JSON correction...`);
            let retryPrompt;
            if (allowHypotheses) {
              retryPrompt = "Your response was not valid JSON. Please respond with ONLY a valid JSON object in one of these formats:\n\nTo fire a ray: {\"action\": \"fire\", \"side\": \"north\", \"position\": 5, \"reasoning\": \"...\"}\nTo mark an atom position: {\"action\": \"mark\", \"row\": 3, \"col\": 5, \"reasoning\": \"...\"}\nTo unmark a position: {\"action\": \"unmark\", \"row\": 3, \"col\": 5, \"reasoning\": \"...\"}\nTo submit answer (requires exactly 4 marked positions): {\"action\": \"check\", \"reasoning\": \"...\"}";
            } else {
              retryPrompt = "Your response was not valid JSON. Please respond with ONLY a valid JSON object in one of these formats:\n\nTo fire a ray: {\"action\": \"fire\", \"side\": \"north\", \"position\": 5, \"reasoning\": \"...\"}\nTo guess atoms: {\"action\": \"guess\", \"atoms\": [[r1,c1], [r2,c2], [r3,c3], [r4,c4]], \"reasoning\": \"...\"}";
            }
            retryPrompt += "\n\nJSON only, no other text:";
            
            const retryStartTime = Date.now();
            const retryResult = await callClaude(
              [...msgs, 
               { role: "assistant", content: response },
               { role: "user", content: retryPrompt }
              ],
              systemPrompt,
              model,
              enableThinking,
              thinkingBudget
            );
            const retryResponseTimeMs = Date.now() - retryStartTime;
            const retryElapsed = (retryResponseTimeMs / 1000).toFixed(1);
            result.totalApiCalls++;
            result.totalInputTokens += retryResult.usage.input_tokens || 0;
            result.totalOutputTokens += retryResult.usage.output_tokens || 0;
            result.totalResponseTimeMs += retryResponseTimeMs;
            addExperimentLog(`  [${retryElapsed}s] Retry response: "${retryResult.text.substring(0, 80).replace(/\n/g, ' ')}..." (${retryResult.usage.input_tokens}+${retryResult.usage.output_tokens} tokens)`);
            parsed = parseResponse(retryResult.text);
            
            if (!parsed) {
              // Give up on this turn after retry
              addExperimentLog(`Still could not parse after retry on turn ${rayNum + 1}`);
              result.invalidMoves++;
              consecutiveFailures++;
              result.raySequence.push({
                action: 'parse_error',
                userPrompt: ctx,
                response: response + "\n---RETRY---\n" + retryResult.text,
                thinking: thinking.join('\n---\n'),
                responseTimeMs: responseTimeMs + retryResponseTimeMs,
                inputTokens: (usage.input_tokens || 0) + (retryResult.usage.input_tokens || 0),
                outputTokens: (usage.output_tokens || 0) + (retryResult.usage.output_tokens || 0)
              });
              
              // Add to message history so model knows it failed
              messages.push({ role: "user", content: ctx });
              messages.push({ role: "assistant", content: response });
              messages.push({ role: "user", content: "ERROR: Could not parse your response as JSON. Please use the exact JSON format specified." });
              rayNum++;
              continue;
            }
          }
        }
        
        // Reset consecutive failures on successful parse
        consecutiveFailures = 0;
        addExperimentLog(`  ✓ Parsed action: ${parsed.action}${parsed.action === 'fire' ? ` ${parsed.side?.toUpperCase()}-${parsed.position}` : ''}${parsed.action === 'mark' || parsed.action === 'unmark' ? ` (${parsed.row},${parsed.col})` : ''}`);
        
        if (parsed.action === 'check' && allowHypotheses) {
          // Check action - requires exactly 4 marked positions
          if (hypotheses.size !== 4) {
            const diff = 4 - hypotheses.size;
            const errorMsg = hypotheses.size < 4 
              ? `ERROR: You have only ${hypotheses.size} positions marked. You need to mark ${diff} more position${diff > 1 ? 's' : ''} before checking.`
              : `ERROR: You have ${hypotheses.size} positions marked. You need to unmark ${-diff} position${-diff > 1 ? 's' : ''} to have exactly 4.`;
            
            addExperimentLog(`  ⚠️ Check failed: ${hypotheses.size}/4 positions marked`);
            result.invalidMoves++;
            consecutiveFailures++;
            
            messages.push({ role: "user", content: ctx });
            messages.push({ role: "assistant", content: response });
            messages.push({ role: "user", content: errorMsg });
            continue;
          }
          
          // Exactly 4 hypotheses - score and end game
          done = true;
          const guessAtoms = Array.from(hypotheses).map(k => k.split(',').map(Number));
          addExperimentLog(`  🎯 Check with ${hypotheses.size} marked positions: ${Array.from(hypotheses).map(k => `(${k})`).join(', ')}`);
          result.finalGuess = guessAtoms;
          result.raySequence.push({
            action: 'check',
            userPrompt: ctx,
            guess: guessAtoms,
            reasoning: parsed.reasoning,
            thinking: thinking.join('\n---\n'),
            responseTimeMs,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0
          });
          
          // Score based on marked hypotheses
          let correct = 0;
          config.forEach(([r, c]) => {
            if (hypotheses.has(`${r},${c}`)) correct++;
          });
          result.atomsCorrect = correct;
          
          messages.push({ role: "user", content: ctx });
          messages.push({ role: "assistant", content: response });
          
        } else if (parsed.action === 'guess' && !allowHypotheses) {
          // Traditional guess action (only when hypotheses not enabled)
          done = true;
          addExperimentLog(`  🎯 Final guess: ${JSON.stringify(parsed.atoms)}`);
          result.finalGuess = parsed.atoms;
          result.raySequence.push({
            action: 'guess',
            userPrompt: ctx,
            guess: parsed.atoms,
            reasoning: parsed.reasoning,
            thinking: thinking.join('\n---\n'),
            responseTimeMs,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0
          });
          
          // Score the guess
          const guessSet = new Set(parsed.atoms.map(([r, c]) => `${r},${c}`));
          let correct = 0;
          config.forEach(([r, c]) => {
            if (guessSet.has(`${r},${c}`)) correct++;
          });
          result.atomsCorrect = correct;
          
          messages.push({ role: "user", content: ctx });
          messages.push({ role: "assistant", content: response });
          
        } else if (parsed.action === 'guess' && allowHypotheses) {
          // Guess action not allowed when hypotheses enabled - must use check
          result.invalidMoves++;
          consecutiveFailures++;
          messages.push({ role: "user", content: ctx });
          messages.push({ role: "assistant", content: response });
          messages.push({ role: "user", content: `ERROR: The "guess" action is not available. Use "mark" to mark atom positions, then use "check" when you have exactly 4 positions marked.` });
          continue;
          
        } else if (parsed.action === 'fire') {
          const side = parsed.side?.toLowerCase();
          const pos = parsed.position;
          const posKey = `${side?.toUpperCase()}-${pos}`;
          
          if (usedPos.has(posKey)) {
            result.invalidMoves++;
            consecutiveFailures++;
            addExperimentLog(`Invalid move: ${posKey} already used`);
            // Give feedback and retry
            messages.push({ role: "user", content: ctx });
            messages.push({ role: "assistant", content: response });
            messages.push({ role: "user", content: `ERROR: Position ${posKey} is already used. Choose a different position.` });
            continue;
          }
          
          if (!side || !pos || !['north', 'south', 'east', 'west'].includes(side) || pos < 1 || pos > 8) {
            result.invalidMoves++;
            consecutiveFailures++;
            messages.push({ role: "user", content: ctx });
            messages.push({ role: "assistant", content: response });
            messages.push({ role: "user", content: `ERROR: Invalid ray specification. Use side (north/south/east/west) and position (1-8).` });
            continue;
          }
          
          const rayResult = traceRay(atomSet, side, pos);
          rayResult.id = firedRays.length + 1;
          firedRays.push(rayResult);
          
          // Update visualization
          setExperimentRays([...firedRays]);
          
          usedPos.add(posKey);
          if (rayResult.exit) {
            usedPos.add(`${rayResult.exit.side.toUpperCase()}-${rayResult.exit.pos}`);
          }
          
          addExperimentLog(`Fired ${side.toUpperCase()}-${pos}: ${formatRayResult(rayResult)}`);
          
          result.raySequence.push({
            action: 'fire',
            userPrompt: ctx,
            rayEntry: { side, pos },
            rayResult: rayResult, // Store full ray result including path for HTML report
            result: formatRayResult(rayResult),
            reasoning: parsed.reasoning,
            thinking: thinking.join('\n---\n'),
            responseTimeMs,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0
          });
          
          messages.push({ role: "user", content: ctx });
          messages.push({ role: "assistant", content: response });
          rayNum++;
          
        } else if (parsed.action === 'mark' && allowHypotheses) {
          const row = parsed.row;
          const col = parsed.col;
          const cellKey = `${row},${col}`;
          
          if (!row || !col || row < 1 || row > 8 || col < 1 || col > 8) {
            result.invalidMoves++;
            consecutiveFailures++;
            messages.push({ role: "user", content: ctx });
            messages.push({ role: "assistant", content: response });
            messages.push({ role: "user", content: `ERROR: Invalid position. Row and column must be 1-8.` });
            continue;
          }
          
          if (hypotheses.has(cellKey)) {
            // Already marked, not an error but note it
            addExperimentLog(`Position (${row},${col}) already marked`);
          } else if (hypotheses.size >= 4) {
            result.invalidMoves++;
            consecutiveFailures++;
            messages.push({ role: "user", content: ctx });
            messages.push({ role: "assistant", content: response });
            messages.push({ role: "user", content: `ERROR: Already have 4 positions marked. Unmark one first, or use "check" to submit your answer.` });
            continue;
          } else {
            hypotheses.add(cellKey);
            // Update visualization
            setExperimentHypotheses(new Set(hypotheses));
            addExperimentLog(`Marked position at (${row},${col}) - now ${hypotheses.size}/4`);
          }
          
          result.raySequence.push({
            action: 'mark',
            userPrompt: ctx,
            position: { row, col },
            hypothesesCount: hypotheses.size,
            reasoning: parsed.reasoning,
            thinking: thinking.join('\n---\n'),
            responseTimeMs,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0
          });
          result.hypothesisActions++;
          
          messages.push({ role: "user", content: ctx });
          messages.push({ role: "assistant", content: response });
          // Don't increment rayNum for mark/unmark actions
          
        } else if (parsed.action === 'unmark' && allowHypotheses) {
          const row = parsed.row;
          const col = parsed.col;
          const cellKey = `${row},${col}`;
          
          if (!row || !col || row < 1 || row > 8 || col < 1 || col > 8) {
            result.invalidMoves++;
            consecutiveFailures++;
            messages.push({ role: "user", content: ctx });
            messages.push({ role: "assistant", content: response });
            messages.push({ role: "user", content: `ERROR: Invalid position. Row and column must be 1-8.` });
            continue;
          }
          
          if (!hypotheses.has(cellKey)) {
            addExperimentLog(`Position (${row},${col}) was not marked`);
          } else {
            hypotheses.delete(cellKey);
            // Update visualization
            setExperimentHypotheses(new Set(hypotheses));
            addExperimentLog(`Unmarked hypothesis at (${row},${col}) - now ${hypotheses.size}/4`);
          }
          
          result.raySequence.push({
            action: 'unmark',
            userPrompt: ctx,
            position: { row, col },
            hypothesesCount: hypotheses.size,
            reasoning: parsed.reasoning,
            thinking: thinking.join('\n---\n'),
            responseTimeMs,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0
          });
          result.hypothesisActions++;
          
          messages.push({ role: "user", content: ctx });
          messages.push({ role: "assistant", content: response });
          // Don't increment rayNum for mark/unmark actions
          
        } else if ((parsed.action === 'mark' || parsed.action === 'unmark') && !allowHypotheses) {
          // Hypothesis actions not allowed in this experiment
          result.invalidMoves++;
          consecutiveFailures++;
          messages.push({ role: "user", content: ctx });
          messages.push({ role: "assistant", content: response });
          messages.push({ role: "user", content: `ERROR: mark/unmark actions are not available. Use fire or guess.` });
          continue;
        } else if (parsed.action === 'check' && !allowHypotheses) {
          // Check action not allowed without hypotheses mode
          result.invalidMoves++;
          consecutiveFailures++;
          messages.push({ role: "user", content: ctx });
          messages.push({ role: "assistant", content: response });
          messages.push({ role: "user", content: `ERROR: The "check" action is not available. Use "guess" with atoms array to submit your answer.` });
          continue;
        } else {
          // Unknown action
          addExperimentLog(`  ⚠️ Unknown action: ${parsed.action}`);
          result.invalidMoves++;
          consecutiveFailures++;
          messages.push({ role: "user", content: ctx });
          messages.push({ role: "assistant", content: response });
          messages.push({ role: "user", content: `ERROR: Unknown action "${parsed.action}". Use fire${allowHypotheses ? ', mark, unmark, or check' : ' or guess'}.` });
          continue;
        }
        
      } catch (error) {
        addExperimentLog(`❌ Error on turn ${rayNum + 1}: ${error.message}`);
        if (error.stack) {
          addExperimentLog(`  Stack: ${error.stack.split('\n')[1]?.trim() || 'N/A'}`);
        }
        consecutiveFailures++;
        rayNum++;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Log why the experiment ended
    addExperimentLog(`--- Experiment ended ---`);
    if (done) {
      addExperimentLog(`Reason: LLM submitted answer${allowHypotheses ? ' (check)' : ' (guess)'}`);
    } else if (consecutiveFailures >= maxConsecutiveFailures) {
      addExperimentLog(`Reason: ${maxConsecutiveFailures} consecutive failures`);
    } else if (rayNum >= 20) {
      addExperimentLog(`Reason: Maximum 20 rays reached`);
    } else if (totalIterations >= maxIterations) {
      addExperimentLog(`Reason: Maximum ${maxIterations} iterations reached (possible infinite loop)`);
    } else if (shouldStopExperiment.current) {
      addExperimentLog(`Reason: Stopped by user`);
    } else {
      addExperimentLog(`Reason: Unknown`);
    }
    addExperimentLog(`Stats: ${totalIterations} iterations, ${firedRays.length} rays, ${result.hypothesisActions || 0} hypothesis actions`);
    addExperimentLog(`Tokens: ${result.totalInputTokens} in + ${result.totalOutputTokens} out = ${result.totalInputTokens + result.totalOutputTokens} total`);
    addExperimentLog(`Time: ${(result.totalResponseTimeMs / 1000).toFixed(1)}s total API time`);
    
    result.raysUsed = firedRays.length;
    
    // Calculate score
    const scoreInfo = calculateScore(firedRays, result.atomsCorrect, 4);
    result.atomsMissed = scoreInfo.atomsMissed;
    result.score = scoreInfo.total;
    
    result.endTime = new Date().toISOString();
    addExperimentLog(`Completed: ${result.atomsCorrect}/4 atoms correct, ${result.raysUsed} rays used, Score: ${result.score} (${scoreInfo.rayPoints} ray pts + ${scoreInfo.missedPenalty} miss penalty)`);
    
    return result;
  };
  
  const runFullExperiment = async () => {
    shouldStopExperiment.current = false;
    setExperimentRunning(true);
    setExperimentResults([]);
    setExperimentProgress({
      currentConfigIndex: 0,
      currentModelIndex: 0,
      currentRayIndex: 0,
      totalConfigs: experimentConfig.configIndices.length,
      totalModels: experimentConfig.modelsToTest.length,
      status: 'Starting...',
      log: []
    });
    
    const allResults = [];
    
    addExperimentLog(`=== EXPERIMENT START ===`);
    addExperimentLog(`Mode: ${experimentConfig.taskMode}`);
    addExperimentLog(`Prompt Style: ${experimentConfig.promptStyle}`);
    addExperimentLog(`Include Visualization: ${experimentConfig.includeVisualization}`);
    addExperimentLog(`Extended Thinking: ${experimentConfig.enableThinking}${experimentConfig.enableThinking ? ` (${experimentConfig.thinkingBudget} tokens)` : ''}`);
    if (experimentConfig.taskMode === 'play') {
      addExperimentLog(`Allow Hypotheses: ${experimentConfig.allowHypotheses}`);
      addExperimentLog(`VoT Grid State: ${experimentConfig.votGridState}`);
      addExperimentLog(`VoT Hypothesis: ${experimentConfig.votHypothesis}`);
    }
    addExperimentLog(`VoT Ray Trace: ${experimentConfig.votRayTrace}`);
    addExperimentLog(`Configs: ${experimentConfig.configIndices.join(', ')}`);
    addExperimentLog(`Models: ${experimentConfig.modelsToTest.map(m => modelOptions.find(o => o.id === m)?.name).join(', ')}`);
    
    // Build VoT settings object to pass to experiment functions
    const votSettings = {
      gridState: experimentConfig.votGridState,
      rayTrace: experimentConfig.votRayTrace,
      hypothesis: experimentConfig.votHypothesis,
    };
    
    for (let mi = 0; mi < experimentConfig.modelsToTest.length; mi++) {
      if (shouldStopExperiment.current) {
        addExperimentLog(`=== STOPPED BY USER ===`);
        break;
      }
      
      const model = experimentConfig.modelsToTest[mi];
      
      for (let ci = 0; ci < experimentConfig.configIndices.length; ci++) {
        if (shouldStopExperiment.current) {
          break;
        }
        
        const configIndex = experimentConfig.configIndices[ci];
        
        setExperimentProgress(prev => ({
          ...prev,
          currentConfigIndex: ci + 1,
          currentModelIndex: mi + 1,
          status: `Config ${ci + 1}/${experimentConfig.configIndices.length}, Model ${mi + 1}/${experimentConfig.modelsToTest.length}`
        }));
        
        let result;
        if (experimentConfig.taskMode === 'predict') {
          result = await runPredictExperiment(configIndex, model, experimentConfig.promptStyle, experimentConfig.includeVisualization, experimentConfig.enableThinking, experimentConfig.thinkingBudget, votSettings);
        } else {
          result = await runPlayExperiment(configIndex, model, experimentConfig.promptStyle, experimentConfig.includeVisualization, experimentConfig.allowHypotheses, experimentConfig.enableThinking, experimentConfig.thinkingBudget, votSettings);
        }
        
        allResults.push(result);
        setExperimentResults([...allResults]);
      }
    }
    
    addExperimentLog(`=== EXPERIMENT COMPLETE ===`);
    setExperimentProgress(prev => ({ ...prev, status: 'Complete!' }));
    setExperimentRunning(false);
  };

  // ============================================
  // RERUN FAILURES FUNCTIONS
  // ============================================

  const handleLoadRerunFile = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        setRerunSourceData(data);

        // Find all failed predictions
        const failures = [];
        for (const result of data.results || []) {
          for (let i = 0; i < (result.predictions || []).length; i++) {
            const pred = result.predictions[i];
            if (pred.predicted === 'error' || pred.actual === 'unknown') {
              failures.push({
                resultIndex: data.results.indexOf(result),
                predictionIndex: i,
                configIndex: result.configIndex,
                model: result.model,
                modelName: result.modelName,
                rayEntry: pred.rayEntry,
                promptStyle: result.promptStyle,
                includeVisualization: result.includeVisualization,
                enableThinking: result.enableThinking,
                thinkingBudget: result.thinkingBudget,
                votGridState: result.votGridState,
                votRayTrace: result.votRayTrace,
                votHypothesis: result.votHypothesis,
              });
            }
          }
        }

        setRerunFailures(failures);
        addExperimentLog(`Loaded ${file.name}: found ${failures.length} failed predictions to rerun`);
      } catch (err) {
        addExperimentLog(`Error loading file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const runRerunFailures = async () => {
    if (!rerunSourceData || rerunFailures.length === 0) return;

    setExperimentRunning(true);
    shouldStopExperiment.current = false;

    addExperimentLog(`=== RERUNNING ${rerunFailures.length} FAILED PREDICTIONS ===`);

    // Make a deep copy of the source data to modify
    const updatedData = JSON.parse(JSON.stringify(rerunSourceData));
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < rerunFailures.length; i++) {
      if (shouldStopExperiment.current) {
        addExperimentLog('Rerun stopped by user');
        break;
      }

      const failure = rerunFailures[i];
      const { configIndex, model, modelName, rayEntry, promptStyle,
              includeVisualization, enableThinking, thinkingBudget,
              votGridState, votRayTrace, votHypothesis,
              resultIndex, predictionIndex } = failure;

      const config = EXPERIMENT_CONFIGS[configIndex];
      const atomSet = configToAtomSet(config);
      const side = rayEntry.side;
      const pos = rayEntry.pos;

      setExperimentProgress(prev => ({
        ...prev,
        status: `Rerunning ${i + 1}/${rerunFailures.length}: ${modelName} Config ${configIndex} ${side.toUpperCase()}-${pos}`
      }));

      addExperimentLog(`→ Rerunning: ${modelName}, Config ${configIndex}, ${side.toUpperCase()}-${pos}`);

      // Build the prompt (similar to runPredictExperiment)
      const promptConfig = PROMPT_STYLES[promptStyle];
      const atomList = config.map(([r, c]) => `(${r},${c})`).join(', ');

      let prompt = `Atoms are located at: ${atomList}\n\n`;
      if (includeVisualization) {
        prompt += `Board (O = atom positions):\n\`\`\`\n${generateTextBoard(atoms, rays, guesses)}\n\`\`\`\n\n`;
      }
      prompt += `A ray is fired from ${side.toUpperCase()}-${pos}.\n\n`;
      prompt += `Trace the ray step by step and predict where it will exit (or if it will be absorbed/reflected).`;

      // Build system prompt with VoT
      let systemPromptWithVoT = promptConfig.predictPrompt;
      if (votRayTrace) {
        systemPromptWithVoT += '\n\n' + VOT_PROMPTS.rayTrace;
      }

      const startTime = Date.now();

      try {
        // Use retry logic
        const maxRetries = 3;
        let response = null;
        let thinking = [];
        let usage = { input_tokens: 0, output_tokens: 0 };

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          const apiResult = await callClaude(
            [{ role: "user", content: prompt }],
            systemPromptWithVoT,
            model,
            enableThinking,
            thinkingBudget
          );

          thinking = apiResult.thinking;
          response = apiResult.text;
          usage = apiResult.usage;

          // Check for rate limit - pause
          if (response.startsWith('Error:') &&
              (response.includes('429') || response.includes('rate_limit') ||
               response.includes('rate limit') || response.includes('Too many requests'))) {
            addExperimentLog(`  ⏸️ Rate limit hit. Pausing - click Resume when ready.`);
            await waitForRateLimitResume();
            addExperimentLog(`  ▶️ Resuming...`);
            attempt--;
            continue;
          }

          // Check for retryable server error
          if (response.startsWith('Error:') &&
              (response.includes('500') || response.includes('529') ||
               response.includes('overloaded') || response.includes('Internal server error'))) {
            if (attempt < maxRetries) {
              const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
              addExperimentLog(`  ⚠️ Attempt ${attempt}/${maxRetries} failed, retrying in ${backoffMs/1000}s...`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
              continue;
            }
          }

          break;
        }

        const responseTimeMs = Date.now() - startTime;

        // Get actual result
        const actual = traceRay(atomSet, side, pos);
        let actualOutcome = 'unknown';
        if (actual.absorbed) {
          actualOutcome = 'absorbed';
        } else if (actual.entry.side === actual.exit?.side && actual.entry.pos === actual.exit?.pos) {
          actualOutcome = 'reflected';
        } else if (actual.exit) {
          actualOutcome = `${actual.exit.side}-${actual.exit.pos}`;
        }

        // Check for error response
        if (response.startsWith('Error:')) {
          addExperimentLog(`  ✗ Still failed: ${response.substring(0, 60)}...`);
          failCount++;
          // Update with actual outcome even if prediction failed
          updatedData.results[resultIndex].predictions[predictionIndex].actual = actualOutcome;
          updatedData.results[resultIndex].predictions[predictionIndex].rayResult = actual;
          continue;
        }

        // Parse prediction
        let prediction = null;
        try {
          const match = response.match(/\{[\s\S]*?\}/);
          if (match) {
            prediction = JSON.parse(match[0]);
          }
        } catch (e) {
          // Parse failed
        }

        // Determine predicted outcome
        let predictedOutcome = 'unknown';
        if (prediction?.absorbed) predictedOutcome = 'absorbed';
        else if (prediction?.reflected) predictedOutcome = 'reflected';
        else if (prediction?.exit_side) predictedOutcome = `${prediction.exit_side}-${prediction.exit_position}`;

        // Check correctness
        let correct = false;
        if (actual.absorbed) {
          correct = prediction?.absorbed === true;
        } else if (actual.entry.side === actual.exit?.side && actual.entry.pos === actual.exit?.pos) {
          correct = prediction?.reflected === true;
        } else {
          correct = prediction?.exit_side === actual.exit?.side &&
                   prediction?.exit_position === actual.exit?.pos;
        }

        // Update the prediction in the data
        updatedData.results[resultIndex].predictions[predictionIndex] = {
          ...updatedData.results[resultIndex].predictions[predictionIndex],
          rayResult: actual,
          predicted: predictedOutcome,
          actual: actualOutcome,
          correct,
          reasoning: prediction?.reasoning || response,
          thinking: thinking.join('\n---\n'),
          responseTimeMs,
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0
        };

        const icon = correct ? '✓' : '✗';
        addExperimentLog(`  ${icon} Predicted: ${predictedOutcome} | Actual: ${actualOutcome}`);
        successCount++;

      } catch (error) {
        addExperimentLog(`  ✗ Error: ${error.message}`);
        failCount++;
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    addExperimentLog(`=== RERUN COMPLETE: ${successCount} succeeded, ${failCount} failed ===`);

    // Update the source data with fixed predictions
    setRerunSourceData(updatedData);
    setExperimentResults(updatedData.results);

    // Recount failures
    const remainingFailures = [];
    for (const result of updatedData.results || []) {
      for (let i = 0; i < (result.predictions || []).length; i++) {
        const pred = result.predictions[i];
        if (pred.predicted === 'error' || pred.actual === 'unknown') {
          remainingFailures.push({
            resultIndex: updatedData.results.indexOf(result),
            predictionIndex: i,
            configIndex: result.configIndex,
            model: result.model,
            modelName: result.modelName,
            rayEntry: pred.rayEntry,
            promptStyle: result.promptStyle,
            includeVisualization: result.includeVisualization,
            enableThinking: result.enableThinking,
            thinkingBudget: result.thinkingBudget,
            votGridState: result.votGridState,
            votRayTrace: result.votRayTrace,
            votHypothesis: result.votHypothesis,
          });
        }
      }
    }
    setRerunFailures(remainingFailures);

    if (remainingFailures.length > 0) {
      addExperimentLog(`${remainingFailures.length} failures remain - you can rerun again or export`);
    }

    setExperimentProgress(prev => ({ ...prev, status: 'Rerun complete!' }));
    setExperimentRunning(false);
  };

  const exportRerunResults = () => {
    if (!rerunSourceData) return;

    const exportData = {
      ...rerunSourceData,
      exportTime: new Date().toISOString(),
      rerunNote: `Rerun of failed predictions from original export`
    };

    const filename = `rerun_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    addExperimentLog(`Exported updated results to ${filename}`);
  };

  const exportExperimentResults = (format = 'json') => {
    const exportData = {
      exportTime: new Date().toISOString(),
      experimentConfig,
      configs: EXPERIMENT_CONFIGS,
      promptStyles: Object.fromEntries(
        Object.entries(PROMPT_STYLES).map(([k, v]) => [k, {
          name: v.name,
          description: v.description,
          playPrompt: v.playPrompt,
          predictPrompt: v.predictPrompt,
        }])
      ),
      // Legacy field for backward compatibility
      promptConditions: Object.fromEntries(
        Object.entries(PROMPT_CONDITIONS).map(([k, v]) => [k, {
          name: v.name,
          description: v.description,
          playPrompt: v.playPrompt,
          predictPrompt: v.predictPrompt,
          includeVisualization: v.includeVisualization
        }])
      ),
      results: experimentResults
    };
    
    const vizSuffix = experimentConfig.includeVisualization ? '_viz' : '';
    const hypSuffix = (experimentConfig.taskMode === 'play' && experimentConfig.allowHypotheses) ? '_hyp' : '';
    const timestamp = new Date().toISOString().slice(0,19).replace(/:/g,'-');
    
    let blob, filename;
    
    if (format === 'html') {
      // Generate HTML report
      const html = generateExperimentHtml(exportData);
      blob = new Blob([html], { type: 'text/html' });
      filename = `blackbox_experiment_${experimentConfig.taskMode}_${experimentConfig.promptStyle}${vizSuffix}${hypSuffix}_${timestamp}.html`;
    } else {
      blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      filename = `blackbox_experiment_${experimentConfig.taskMode}_${experimentConfig.promptStyle}${vizSuffix}${hypSuffix}_${timestamp}.json`;
    }
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const generateExperimentHtml = (exportData) => {
    const { experimentConfig: config, results } = exportData;
    const isPredictMode = config.taskMode === 'predict';
    
    // CSS styles shared between modes
    const styles = `
  body { font-family: system-ui, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; background: #f9fafb; }
  h1 { color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
  h2 { color: #374151; margin-top: 2.5rem; border-left: 4px solid ${isPredictMode ? '#06b6d4' : '#f59e0b'}; padding-left: 1rem; }
  h3 { color: #1f2937; margin: 0 0 0.5rem 0; }
  h4 { color: #4b5563; margin: 1rem 0 0.5rem 0; }
  .intro { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 2rem; }
  .config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1rem 0; }
  .config-item { background: #f3f4f6; padding: 0.75rem; border-radius: 6px; }
  .config-item .label { font-size: 0.75rem; color: #6b7280; text-transform: uppercase; }
  .config-item .value { font-weight: 600; color: #1f2937; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
  .summary-card { background: white; padding: 1rem; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .summary-card .number { font-size: 2rem; font-weight: 700; }
  .summary-card .label { color: #6b7280; font-size: 0.875rem; }
  .summary-card.good .number { color: #10b981; }
  .summary-card.bad .number { color: #ef4444; }
  .summary-card.neutral .number { color: #3b82f6; }
  .result-card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; border-left: 4px solid #9ca3af; }
  .result-card.perfect { border-left-color: #10b981; }
  .result-card.good { border-left-color: #3b82f6; }
  .result-card.poor { border-left-color: #f59e0b; }
  .result-card.bad { border-left-color: #ef4444; }
  .result-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .result-header h3 { margin: 0; }
  .result-score { font-size: 1.25rem; font-weight: 600; padding: 0.25rem 0.75rem; border-radius: 6px; }
  .result-score.perfect { background: #d1fae5; color: #065f46; }
  .result-score.good { background: #dbeafe; color: #1e40af; }
  .result-score.poor { background: #fef3c7; color: #92400e; }
  .result-score.bad { background: #fee2e2; color: #991b1b; }
  .result-meta { display: flex; gap: 1.5rem; flex-wrap: wrap; font-size: 0.875rem; color: #6b7280; margin-bottom: 1rem; }
  .step { background: #f9fafb; padding: 1rem; border-radius: 6px; margin: 0.5rem 0; border-left: 3px solid #d1d5db; }
  .step.correct { border-left-color: #3b82f6; }
  .step.wrong { border-left-color: #ef4444; }
  .step.fire { border-left-color: #10b981; }
  .step.mark { border-left-color: #8b5cf6; }
  .step.unmark { border-left-color: #6b7280; }
  .step.guess { border-left-color: #f59e0b; }
  .step-header { font-weight: 600; color: #374151; }
  .step-detail { font-size: 0.875rem; color: #6b7280; margin-top: 0.25rem; }
  .thinking { margin: 0.5rem 0; }
  .thinking summary { cursor: pointer; color: #7c3aed; font-weight: 500; font-size: 0.875rem; }
  .thinking-content { margin-top: 0.5rem; padding: 0.75rem; background: #f5f3ff; border-radius: 6px; font-size: 0.8rem; color: #4b5563; max-height: 200px; overflow-y: auto; white-space: pre-wrap; }
  .reasoning { margin: 0.5rem 0; }
  .reasoning summary { cursor: pointer; color: #6b7280; font-weight: 500; font-size: 0.875rem; }
  .reasoning-content { margin-top: 0.5rem; padding: 0.75rem; background: #f3f4f6; border-radius: 6px; font-size: 0.8rem; color: #4b5563; max-height: 150px; overflow-y: auto; white-space: pre-wrap; }
  .board-container { margin: 1rem 0; text-align: center; }
  .board-container svg { max-width: 100%; height: auto; }
  .atoms-list { font-family: monospace; background: #f3f4f6; padding: 0.5rem; border-radius: 4px; display: inline-block; }
  .final-board { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.875rem; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #e5e7eb; }
  th { background: #f3f4f6; font-weight: 600; }
  .toc { background: white; padding: 1rem; border-radius: 8px; margin-bottom: 2rem; }
  .toc ul { margin: 0; padding-left: 1.5rem; }
  .toc li { margin: 0.25rem 0; }
  .toc a { color: #3b82f6; text-decoration: none; }
  .toc a:hover { text-decoration: underline; }
  .prompt-section { margin: 1.5rem 0; }
  .prompt-section summary { cursor: pointer; color: #0369a1; font-weight: 600; font-size: 0.95rem; padding: 0.5rem; background: #e0f2fe; border-radius: 6px; }
  .prompt-section summary:hover { background: #bae6fd; }
  .prompt-content { margin-top: 0.5rem; padding: 1rem; background: #f0f9ff; border-radius: 6px; font-size: 0.75rem; font-family: monospace; color: #1e3a5f; max-height: 400px; overflow-y: auto; white-space: pre-wrap; border: 1px solid #bae6fd; }
  .user-prompt { margin: 0.5rem 0; }
  .user-prompt summary { cursor: pointer; color: #0891b2; font-weight: 500; font-size: 0.8rem; }
  .user-prompt summary:hover { color: #0369a1; }
  .user-prompt-content { margin-top: 0.5rem; padding: 0.75rem; background: #ecfeff; border-radius: 6px; font-size: 0.7rem; font-family: monospace; color: #164e63; max-height: 200px; overflow-y: auto; white-space: pre-wrap; border: 1px solid #a5f3fc; }
`;
    
    // Generate board SVG for static HTML - matches the main generateBoardSVG style with ray paths
    const generateStaticBoardSVG = (atomConfig, raysData = [], hypothesesData = [], showAtoms = true, predictions = null, guesses = null) => {
      const gridSize = 8;
      const cellSize = 40;
      const edgeSize = 35;
      const totalSize = gridSize * cellSize + 2 * edgeSize;
      
      const atomSet = new Set(atomConfig.map(([r, c]) => `${r},${c}`));
      const hypSet = new Set(hypothesesData.map(h => typeof h === 'string' ? h : `${h.row},${h.col}`));
      
      // Build guess result sets for coloring
      let correctGuessSet = new Set();
      let wrongGuessSet = new Set();
      let missedAtomSet = new Set();
      if (guesses && showAtoms) {
        const guessSet = new Set(guesses.map(([r, c]) => `${r},${c}`));
        atomConfig.forEach(([r, c]) => {
          const key = `${r},${c}`;
          if (guessSet.has(key)) {
            correctGuessSet.add(key);
          } else {
            missedAtomSet.add(key);
          }
        });
        guesses.forEach(([r, c]) => {
          const key = `${r},${c}`;
          if (!atomSet.has(key)) {
            wrongGuessSet.add(key);
          }
        });
      }
      
      // Build edge markers for ray entry/exit points
      const markers = {};
      raysData.forEach(ray => {
        if (!ray.entry) return;
        const ek = `${ray.entry.side}-${ray.entry.pos}`;
        if (!markers[ek]) markers[ek] = [];
        if (ray.exit) {
          const xk = `${ray.exit.side}-${ray.exit.pos}`;
          if (!markers[xk]) markers[xk] = [];
          if (ek === xk) {
            markers[ek].push({ type: 'reflect', id: ray.id, correct: ray.correct });
          } else {
            markers[ek].push({ type: 'entry', id: ray.id, absorbed: ray.absorbed, correct: ray.correct });
            markers[xk].push({ type: 'exit', id: ray.id, correct: ray.correct });
          }
        } else {
          markers[ek].push({ type: 'entry', id: ray.id, absorbed: ray.absorbed, correct: ray.correct });
        }
      });
      
      const getEdgePos = (side, pos) => {
        if (side === 'north') return { x: edgeSize + (pos - 0.5) * cellSize, y: edgeSize / 2 };
        if (side === 'south') return { x: edgeSize + (pos - 0.5) * cellSize, y: edgeSize + gridSize * cellSize + edgeSize / 2 };
        if (side === 'west') return { x: edgeSize / 2, y: edgeSize + (pos - 0.5) * cellSize };
        return { x: edgeSize + gridSize * cellSize + edgeSize / 2, y: edgeSize + (pos - 0.5) * cellSize };
      };
      
      // Helper to get color based on prediction correctness
      const getRayColor = (ray) => {
        if (ray.correct === true) return '#3b82f6'; // Blue for correct
        if (ray.correct === false) return '#ef4444'; // Red for wrong
        return ray.absorbed ? '#ef4444' : '#3b82f6'; // Default colors
      };
      
      let svg = `<svg width="${totalSize}" height="${totalSize}" style="background:white;border:1px solid #ccc;">`;
      
      // Grid cells with backgrounds for guess results
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          const row = r + 1, col = c + 1;
          const key = `${row},${col}`;
          let fill = 'white';
          if (guesses && showAtoms) {
            if (correctGuessSet.has(key)) fill = '#86efac';
            else if (wrongGuessSet.has(key)) fill = '#fca5a5';
            else if (missedAtomSet.has(key)) fill = '#fde047';
          }
          svg += `<rect x="${edgeSize + c * cellSize}" y="${edgeSize + r * cellSize}" width="${cellSize}" height="${cellSize}" fill="${fill}" stroke="#ccc"/>`;
        }
      }
      
      // Atoms
      if (showAtoms) {
        atomConfig.forEach(([r, c]) => {
          const cx = edgeSize + (c - 0.5) * cellSize;
          const cy = edgeSize + (r - 0.5) * cellSize;
          svg += `<circle cx="${cx}" cy="${cy}" r="${cellSize * 0.35}" fill="#333"/>`;
        });
      }
      
      // Wrong guesses as X marks (when showing guess results)
      if (guesses && showAtoms) {
        wrongGuessSet.forEach(key => {
          const [r, c] = key.split(',').map(Number);
          const cx = edgeSize + (c - 0.5) * cellSize;
          const cy = edgeSize + (r - 0.5) * cellSize;
          const s = cellSize * 0.3;
          svg += `<line x1="${cx-s}" y1="${cy-s}" x2="${cx+s}" y2="${cy+s}" stroke="#dc2626" stroke-width="4"/>`;
          svg += `<line x1="${cx+s}" y1="${cy-s}" x2="${cx-s}" y2="${cy+s}" stroke="#dc2626" stroke-width="4"/>`;
        });
      }
      
      // Hypotheses (purple X marks)
      hypSet.forEach(key => {
        const [r, c] = key.split(',').map(Number);
        const cx = edgeSize + (c - 0.5) * cellSize;
        const cy = edgeSize + (r - 0.5) * cellSize;
        const s = cellSize * 0.25;
        svg += `<line x1="${cx-s}" y1="${cy-s}" x2="${cx+s}" y2="${cy+s}" stroke="#8b5cf6" stroke-width="3"/>`;
        svg += `<line x1="${cx+s}" y1="${cy-s}" x2="${cx-s}" y2="${cy+s}" stroke="#8b5cf6" stroke-width="3"/>`;
      });
      
      // Ray paths - draw the actual path through the grid
      raysData.forEach(ray => {
        if (ray.path && ray.path.length > 0) {
          const points = [
            getEdgePos(ray.entry.side, ray.entry.pos),
            ...ray.path.map(([r,c]) => ({x: edgeSize + (c - 0.5) * cellSize, y: edgeSize + (r - 0.5) * cellSize})),
            ray.exit && !ray.absorbed ? getEdgePos(ray.exit.side, ray.exit.pos) : null
          ].filter(Boolean);
          const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');
          const color = getRayColor(ray);
          const dash = ray.absorbed ? 'stroke-dasharray="5,5"' : '';
          svg += `<polyline points="${pointsStr}" fill="none" stroke="${color}" stroke-width="2" ${dash} opacity="0.7"/>`;
        }
      });
      
      // Edge numbers and markers
      ['north', 'south', 'east', 'west'].forEach(side => {
        for (let pos = 1; pos <= gridSize; pos++) {
          const { x, y } = getEdgePos(side, pos);
          svg += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#666">${pos}</text>`;
          
          const ml = markers[`${side}-${pos}`] || [];
          ml.forEach((m, idx) => {
            const off = (idx - (ml.length - 1) / 2) * 8;
            let col, sym;
            if (m.type === 'reflect') { col = '#f59e0b'; sym = 'R'; }
            else if (m.type === 'entry' && m.absorbed) { col = '#ef4444'; sym = 'H'; }
            else { col = '#22c55e'; sym = m.id; }
            
            // Override color based on prediction correctness if available
            if (m.correct === true) col = '#3b82f6';
            else if (m.correct === false) col = '#ef4444';
            
            const mx = side === 'north' || side === 'south' ? x + off : x;
            const my = side === 'east' || side === 'west' ? y + off : y;
            const lo = side === 'north' ? -14 : side === 'south' ? 14 : side === 'west' ? -16 : 16;
            const tx = side === 'east' || side === 'west' ? mx + lo : mx;
            const ty = side === 'north' || side === 'south' ? my + lo : my;
            svg += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="bold" fill="${col}">${sym}</text>`;
          });
        }
      });
      
      svg += '</svg>';
      return svg;
    };
    
    // Helper function to parse exit from prediction result string
    const parseExitFromPrediction = (actualStr) => {
      if (!actualStr) return null;
      const lower = actualStr.toLowerCase();
      if (lower.includes('absorb')) return null;
      if (lower.includes('reflect')) return null; // Reflection exits at entry
      const match = actualStr.match(/(north|south|east|west)[^\d]*(\d)/i);
      if (match) {
        return { side: match[1].toLowerCase(), pos: parseInt(match[2]) };
      }
      return null;
    };
    
    // Build results HTML
    let resultsHtml = '';
    
    results.forEach((result, idx) => {
      const atomConfig = result.atomConfig || EXPERIMENT_CONFIGS[result.configIndex];
      const atomsStr = atomConfig.map(([r, c]) => `(${r},${c})`).join(', ');
      
      if (isPredictMode) {
        // Predict mode result
        const predictions = result.predictions || [];
        const correctCount = predictions.filter(p => p.correct).length;
        const totalCount = predictions.length;
        const accuracy = totalCount > 0 ? Math.round(correctCount / totalCount * 100) : 0;
        
        const scoreClass = accuracy === 100 ? 'perfect' : accuracy >= 75 ? 'good' : accuracy >= 50 ? 'poor' : 'bad';
        
        resultsHtml += `
<div class="result-card ${scoreClass}" id="result-${idx}">
  <div class="result-header">
    <h3>Config ${result.configIndex + 1}: ${result.modelName}</h3>
    <span class="result-score ${scoreClass}">${correctCount}/${totalCount} (${accuracy}%)</span>
  </div>
  <div class="result-meta">
    <span>Prompt: ${result.promptStyle}${result.includeVisualization ? ' +viz' : ''}${result.enableThinking ? ' +think' : ''}${result.votRayTrace ? ' +votB' : ''}</span>
    <span>API calls: ${result.totalApiCalls}</span>
  </div>
  <div><strong>Atoms:</strong> <span class="atoms-list">${atomsStr}</span></div>
  
  <h4>Initial Board</h4>
  <div class="board-container">
    ${generateStaticBoardSVG(atomConfig, [], [], true)}
  </div>
  
  <h4>Predictions</h4>
  <div class="predictions">
    ${predictions.map((pred, i) => {
      // Build rays up to this point for progressive board display - use stored rayResult with path
      const raysUpToNow = predictions.slice(0, i + 1).map((p, j) => {
        // Use stored rayResult if available (has path), otherwise fall back to reconstructed
        if (p.rayResult) {
          return {
            ...p.rayResult,
            id: j + 1,
            correct: p.correct
          };
        }
        return {
          id: j + 1,
          entry: p.rayEntry,
          exit: parseExitFromPrediction(p.actual),
          absorbed: p.actual?.toLowerCase().includes('absorb'),
          correct: p.correct
        };
      });
      
      return `
    <div class="step ${pred.correct ? 'correct' : 'wrong'}">
      <div class="step-header">${pred.rayEntry?.side?.toUpperCase() || 'RAY'}-${pred.rayEntry?.pos || i+1}: ${pred.correct ? '✓' : '✗'}</div>
      <div class="step-detail">Predicted: ${pred.predicted} | Actual: ${pred.actual}</div>
      ${pred.userPrompt ? `<details class="user-prompt"><summary>📝 User Prompt</summary><div class="user-prompt-content">${pred.userPrompt.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></details>` : ''}
      ${pred.reasoning ? `<details class="reasoning"><summary>Reasoning</summary><div class="reasoning-content">${pred.reasoning.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></details>` : ''}
      ${pred.thinking ? `<details class="thinking"><summary>Thinking</summary><div class="thinking-content">${pred.thinking.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></details>` : ''}
      <div class="board-container">
        ${generateStaticBoardSVG(atomConfig, raysUpToNow, [], true, raysUpToNow)}
      </div>
    </div>
    `;
    }).join('')}
  </div>
  <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 0.5rem; font-size: 0.75rem;">
    <span>🔵 Correct prediction</span>
    <span>🔴 Wrong prediction</span>
    <span>⚫ Atom position</span>
  </div>
</div>`;
      } else {
        // Play mode result
        const raySequence = result.raySequence || [];
        const atomsCorrect = result.atomsCorrect || 0;
        const raysUsed = result.raysUsed || 0;
        const scoreClass = atomsCorrect === 4 ? 'perfect' : atomsCorrect >= 3 ? 'good' : atomsCorrect >= 2 ? 'poor' : 'bad';
        
        // Reconstruct rays for board display - use stored rayResult with path if available
        const raysForBoard = raySequence
          .filter(s => s.action === 'fire')
          .map((s, i) => {
            if (s.rayResult) {
              return { ...s.rayResult, id: i + 1 };
            }
            return {
              id: i + 1,
              entry: s.rayEntry,
              exit: s.result?.includes('Exited') ? parseExitFromResult(s.result) : null,
              absorbed: s.result?.includes('ABSORBED')
            };
          });
        
        // Get final hypotheses
        const finalHypotheses = [];
        raySequence.forEach(s => {
          if (s.action === 'mark' && s.position) {
            finalHypotheses.push(`${s.position.row},${s.position.col}`);
          } else if (s.action === 'unmark' && s.position) {
            const idx = finalHypotheses.indexOf(`${s.position.row},${s.position.col}`);
            if (idx > -1) finalHypotheses.splice(idx, 1);
          }
        });
        
        resultsHtml += `
<div class="result-card ${scoreClass}" id="result-${idx}">
  <div class="result-header">
    <h3>Config ${result.configIndex + 1}: ${result.modelName}</h3>
    <span class="result-score ${scoreClass}">${atomsCorrect}/4 atoms • Score: ${result.score || 'N/A'}</span>
  </div>
  <div class="result-meta">
    <span>Prompt: ${result.promptStyle}${result.includeVisualization ? ' +viz' : ''}${result.allowHypotheses ? ' +hyp' : ''}${result.enableThinking ? ' +think' : ''}${result.votGridState ? ' +votA' : ''}${result.votRayTrace ? ' +votB' : ''}${result.votHypothesis ? ' +votC' : ''}</span>
    <span>Rays: ${raysUsed}</span>
    <span>Score: ${result.score || 0} (${raysUsed > 0 ? (() => {
      // Calculate ray points for display
      let pts = 0;
      (result.raySequence || []).filter(s => s.action === 'fire' && s.result).forEach(s => {
        pts += 1;
        if (s.result.exit && !s.result.absorbed && (s.result.entry?.side !== s.result.exit?.side || s.result.entry?.pos !== s.result.exit?.pos)) pts += 1;
      });
      return pts;
    })() : 0} ray + ${(4 - atomsCorrect) * 5} miss)</span>
    ${result.hypothesisActions ? `<span>Hypothesis actions: ${result.hypothesisActions}</span>` : ''}
  </div>
  <div><strong>Hidden Atoms:</strong> <span class="atoms-list">${atomsStr}</span></div>
  ${result.finalGuess ? `<div><strong>Final Guess:</strong> <span class="atoms-list">${result.finalGuess.map(([r,c]) => `(${r},${c})`).join(', ')}</span></div>` : ''}
  
  <h4>Initial Board <span style="font-weight: normal; font-size: 0.85em; color: #6b7280;">(atoms shown for reference — LLM does not see them)</span></h4>
  <div class="board-container">
    ${generateStaticBoardSVG(atomConfig, [], [], true)}
  </div>
  
  <h4>Action Sequence</h4>
  <div class="actions">
    ${(() => {
      // Track progressive state for board display
      let raysUpToNow = [];
      let hypothesesUpToNow = [];
      let rayCounter = 0;
      
      return raySequence.map((step, i) => {
        let stepClass = step.action;
        let header = '';
        let detail = '';
        
        // Update state based on action
        if (step.action === 'fire') {
          rayCounter++;
          // Use stored rayResult with path if available
          if (step.rayResult) {
            raysUpToNow.push({ ...step.rayResult, id: rayCounter });
          } else {
            raysUpToNow.push({
              id: rayCounter,
              entry: step.rayEntry,
              exit: step.result?.includes('Exited') ? parseExitFromResult(step.result) : null,
              absorbed: step.result?.includes('ABSORBED')
            });
          }
          header = `Fire ${step.rayEntry?.side?.toUpperCase()}-${step.rayEntry?.pos}`;
          detail = step.result || '';
        } else if (step.action === 'mark') {
          hypothesesUpToNow.push(`${step.position?.row},${step.position?.col}`);
          header = `Mark atom (${step.position?.row},${step.position?.col})`;
          detail = `Now ${step.hypothesesCount}/4 marked`;
        } else if (step.action === 'unmark') {
          const idx = hypothesesUpToNow.indexOf(`${step.position?.row},${step.position?.col}`);
          if (idx > -1) hypothesesUpToNow.splice(idx, 1);
          header = `Unmark (${step.position?.row},${step.position?.col})`;
          detail = `Now ${step.hypothesesCount}/4 marked`;
        } else if (step.action === 'check') {
          stepClass = 'guess';
          header = `Check: ${step.guess?.map(([r,c]) => `(${r},${c})`).join(', ')}`;
          detail = `${atomsCorrect}/4 correct`;
        } else if (step.action === 'guess') {
          header = `Final Guess: ${step.guess?.map(([r,c]) => `(${r},${c})`).join(', ')}`;
          detail = `${atomsCorrect}/4 correct`;
        } else if (step.action === 'parse_error') {
          stepClass = 'wrong';
          header = 'Parse Error';
          detail = 'Failed to parse LLM response';
        }
        
        // For guess/check step, show atoms for comparison
        const showAtoms = step.action === 'guess' || step.action === 'check';
        
        return `
    <div class="step ${stepClass}">
      <div class="step-header">${i + 1}. ${header}</div>
      ${detail ? `<div class="step-detail">${detail}</div>` : ''}
      ${step.userPrompt ? `<details class="user-prompt"><summary>📝 User Prompt</summary><div class="user-prompt-content">${step.userPrompt.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></details>` : ''}
      ${step.reasoning ? `<details class="reasoning"><summary>Reasoning</summary><div class="reasoning-content">${step.reasoning.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></details>` : ''}
      ${step.thinking ? `<details class="thinking"><summary>Thinking</summary><div class="thinking-content">${step.thinking.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></details>` : ''}
      <div class="board-container">
        ${generateStaticBoardSVG(atomConfig, [...raysUpToNow], [...hypothesesUpToNow], showAtoms, null, (step.action === 'guess' || step.action === 'check') ? step.guess : null)}
      </div>
    </div>`;
      }).join('');
    })()}
  </div>
  
  <div class="final-board">
    <strong>Final Board State (with guess results):</strong>
    <div class="board-container">
      ${generateStaticBoardSVG(atomConfig, raysForBoard, finalHypotheses, true, null, result.finalGuess)}
    </div>
    <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 0.5rem; font-size: 0.75rem;">
      <span>🟢 Correct guess</span>
      <span>🔴 Wrong guess</span>
      <span>🟡 Missed atom</span>
    </div>
  </div>
</div>`;
      }
    });
    
    // Helper function to parse exit from result string
    function parseExitFromResult(resultStr) {
      const match = resultStr?.match(/Exited at ([A-Z]+)-(\d)/);
      if (match) {
        return { side: match[1].toLowerCase(), pos: parseInt(match[2]) };
      }
      return null;
    }
    
    // Calculate summary statistics
    let summaryHtml = '';
    if (isPredictMode) {
      const totalCorrect = results.reduce((sum, r) => sum + (r.predictions?.filter(p => p.correct).length || 0), 0);
      const totalPredictions = results.reduce((sum, r) => sum + (r.predictions?.length || 0), 0);
      const avgAccuracy = totalPredictions > 0 ? Math.round(totalCorrect / totalPredictions * 100) : 0;
      const perfectRuns = results.filter(r => r.predictions?.every(p => p.correct)).length;
      
      summaryHtml = `
  <div class="summary-grid">
    <div class="summary-card good"><div class="number">${totalCorrect}</div><div class="label">Total Correct</div></div>
    <div class="summary-card bad"><div class="number">${totalPredictions - totalCorrect}</div><div class="label">Total Wrong</div></div>
    <div class="summary-card neutral"><div class="number">${avgAccuracy}%</div><div class="label">Avg Accuracy</div></div>
    <div class="summary-card ${perfectRuns > 0 ? 'good' : 'neutral'}"><div class="number">${perfectRuns}</div><div class="label">Perfect Runs</div></div>
  </div>`;
    } else {
      const avgAtoms = results.length > 0 ? (results.reduce((sum, r) => sum + (r.atomsCorrect || 0), 0) / results.length).toFixed(1) : 0;
      const avgRays = results.length > 0 ? (results.reduce((sum, r) => sum + (r.raysUsed || 0), 0) / results.length).toFixed(1) : 0;
      const avgScore = results.length > 0 ? (results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length).toFixed(1) : 0;
      const perfectGames = results.filter(r => r.atomsCorrect === 4).length;
      const totalInvalid = results.reduce((sum, r) => sum + (r.invalidMoves || 0), 0);
      
      summaryHtml = `
  <div class="summary-grid">
    <div class="summary-card neutral"><div class="number">${avgAtoms}</div><div class="label">Avg Atoms Correct</div></div>
    <div class="summary-card neutral"><div class="number">${avgScore}</div><div class="label">Avg Score</div></div>
    <div class="summary-card neutral"><div class="number">${avgRays}</div><div class="label">Avg Rays Used</div></div>
    <div class="summary-card ${perfectGames > 0 ? 'good' : 'neutral'}"><div class="number">${perfectGames}</div><div class="label">Perfect Games</div></div>
  </div>`;
    }
    
    // Table of contents
    const tocHtml = `
<div class="toc">
  <strong>Results (${results.length}):</strong>
  <ul>
    ${results.map((r, i) => `<li><a href="#result-${i}">Config ${r.configIndex + 1}: ${r.modelName} - ${isPredictMode ? 
      `${r.predictions?.filter(p => p.correct).length}/${r.predictions?.length} correct` : 
      `${r.atomsCorrect}/4 atoms, Score: ${r.score || 0}`}</a></li>`).join('')}
  </ul>
</div>`;
    
    // Build final HTML
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Black Box Experiment Report - ${isPredictMode ? 'Predict' : 'Play'} Mode</title>
<style>${styles}</style></head><body>

<h1>🧪 Black Box Experiment Report</h1>

<div class="intro">
  <p><strong>Date:</strong> ${new Date(exportData.exportTime).toLocaleString()}</p>
  <p><strong>Mode:</strong> ${isPredictMode ? 'Predict (Forward Reasoning)' : 'Play (Inverse Reasoning)'}</p>
  
  <div class="config-grid">
    <div class="config-item"><div class="label">Prompt Style</div><div class="value">${config.promptStyle}</div></div>
    <div class="config-item"><div class="label">Visualization</div><div class="value">${config.includeVisualization ? 'Yes' : 'No'}</div></div>
    <div class="config-item"><div class="label">Extended Thinking</div><div class="value">${config.enableThinking ? 'Yes' : 'No'}</div></div>
    ${!isPredictMode ? `<div class="config-item"><div class="label">Hypotheses</div><div class="value">${config.allowHypotheses ? 'Yes' : 'No'}</div></div>` : ''}
    <div class="config-item"><div class="label">Configs Tested</div><div class="value">${config.configIndices?.length || results.length}</div></div>
    <div class="config-item"><div class="label">Models</div><div class="value">${[...new Set(results.map(r => r.modelName))].join(', ')}</div></div>
  </div>
  
  <div class="config-grid" style="margin-top: 0.5rem;">
    <div class="config-item"><div class="label">VoT: Grid State</div><div class="value">${!isPredictMode && config.votGridState ? 'Yes' : 'No'}</div></div>
    <div class="config-item"><div class="label">VoT: Ray Trace</div><div class="value">${config.votRayTrace ? 'Yes' : 'No'}</div></div>
    <div class="config-item"><div class="label">VoT: Hypothesis</div><div class="value">${!isPredictMode && config.votHypothesis ? 'Yes' : 'No'}</div></div>
  </div>
  
  <details class="prompt-section">
    <summary>📋 System Prompt</summary>
    <div class="prompt-content">${(results[0]?.systemPrompt || 'N/A').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </details>
</div>

<h2>Summary</h2>
${summaryHtml}

<h2>Results by Configuration</h2>
${tocHtml}
${resultsHtml}

</body></html>`;
    
    return html;
  };
  
  
  const handleFireRay = useCallback((side, pos) => {
    if (gameChecked || mode === 'llm' || predicting) return;
    const posKey = `${side}-${pos}`;
    if (usedPositions.has(posKey)) return; // Position already used
    
    if (mode === 'predict') {
      // In predict mode, ask Claude first
      handlePredictRay(side, pos);
      return;
    }
    
    const result = traceRay(atoms, side, pos);
    result.id = rayCounter;
    setRays(prev => [...prev, result]);
    setRayCounter(prev => prev + 1);
    return result;
  }, [atoms, rayCounter, gameChecked, mode, usedPositions, predicting]);
  
  const handlePredictRay = async (side, pos) => {
    setPredicting(true);
    
    const atomList = Array.from(atoms).map(k => {
      const [r, c] = k.split(',').map(Number);
      return `(${r},${c})`;
    }).join(', ');
    
    // Build user prompt - optionally include visualization
    let prompt = `Atoms are located at: ${atomList}\n\n`;
    if (llmSettings.includeVisualization) {
      prompt += `Board (O = atom positions):\n\`\`\`\n`;
      prompt += generateTextBoard([], 8, atoms);
      prompt += `\`\`\`\n\n`;
    }
    prompt += `A ray is fired from ${side.toUpperCase()}-${pos}.\n\nTrace the ray step by step and predict where it will exit (or if it will be absorbed/reflected).`;
    
    // Get base system prompt from selected style
    const baseSystemPrompt = PROMPT_STYLES[llmSettings.promptStyle]?.predictPrompt || predictPrompt;
    
    // Build prompt with VoT additions (only rayTrace and coordinate apply to predict mode)
    const votConfigForPrompt = {
      gridState: false,
      rayTrace: votConfig.rayTrace,
      hypothesis: false,
    };
    const systemPromptWithVoT = buildPromptWithVoT(baseSystemPrompt, votConfigForPrompt);
    
    try {
      const { thinking, text: response } = await callClaude(
        [{ role: "user", content: prompt }], 
        systemPromptWithVoT, 
        selectedModel,
        llmSettings.enableThinking,
        llmSettings.thinkingBudget
      );
      
      // Parse Claude's prediction
      let prediction = null;
      try {
        const match = response.match(/\{[\s\S]*\}/);
        if (match) prediction = JSON.parse(match[0]);
      } catch (e) {}
      
      // Get actual result
      const actual = traceRay(atoms, side, pos);
      actual.id = rayCounter;
      setRays(prev => [...prev, actual]);
      setRayCounter(prev => prev + 1);
      
      // Compare prediction to actual
      let correct = false;
      let predictedStr = "Parse error";
      let actualStr = formatRayResult(actual);
      
      if (prediction) {
        if (prediction.absorbed) {
          predictedStr = `ABSORBED`;
          correct = actual.absorbed;
        } else if (prediction.reflected) {
          predictedStr = `REFLECTED at ${side.toUpperCase()}-${pos}`;
          correct = !actual.absorbed && actual.entry.side === actual.exit?.side && actual.entry.pos === actual.exit?.pos;
        } else if (prediction.exit_side && prediction.exit_position) {
          predictedStr = `Exit at ${prediction.exit_side.toUpperCase()}-${prediction.exit_position}`;
          correct = !actual.absorbed && 
                    actual.exit?.side === prediction.exit_side.toLowerCase() && 
                    actual.exit?.pos === prediction.exit_position;
        }
      }
      
      setPredictLog(prev => [...prev, {
        ray: `${side.toUpperCase()}-${pos}`,
        predicted: predictedStr,
        actual: actualStr,
        correct,
        reasoning: prediction?.reasoning || response,
        thinking: thinking.length > 0 ? thinking.join('\n\n') : null
      }]);
      
    } catch (e) {
      setPredictLog(prev => [...prev, {
        ray: `${side.toUpperCase()}-${pos}`,
        predicted: "Error",
        actual: "Error",
        correct: false,
        reasoning: e.message
      }]);
    }
    
    setPredicting(false);
  };
  
  const handleCellClick = useCallback((row, col) => {
    if (gameChecked || mode !== 'play') return;
    const key = getKey(row, col);
    setGuesses(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < NUM_ATOMS) next.add(key);
      return next;
    });
  }, [gameChecked, mode]);
  
  const setModeAndReset = (m) => { 
    setMode(m); 
    handleNewGame(); 
    // Clear experiment state when switching modes
    setExperimentMode(false);
    setExperimentRunning(false);
    setExperimentAtoms(new Set());
    setExperimentRays([]);
    setExperimentPredictions([]);
    setExperimentHypotheses(new Set());
  };
  
  const saveResults = (format = 'json') => {
    const data = {
      timestamp: new Date().toISOString(),
      model: selectedModel,
      modelName: modelOptions.find(m => m.id === selectedModel)?.name || selectedModel,
      prompts: {
        system: systemPrompt,
        predict: predictPrompt
      },
      atoms: Array.from(atoms).map(k => k.split(',').map(Number)),
      rays: rays.map(r => ({
        id: r.id,
        entry: r.entry,
        exit: r.exit,
        absorbed: r.absorbed,
        path: r.path,
        result: formatRayResult(r)
      })),
      guesses: Array.from(guesses).map(k => k.split(',').map(Number)),
      results: {
        correct: Array.from(correctGuesses).map(k => k.split(',').map(Number)),
        wrong: Array.from(wrongGuesses).map(k => k.split(',').map(Number)),
        missed: Array.from(missedAtoms).map(k => k.split(',').map(Number)),
        atomsCorrect: correctGuesses.size,
        atomsMissed: missedAtoms.size,
        score: calculateScore(rays, correctGuesses.size, NUM_ATOMS)
      },
      llmReasoning: llmLog,
      predictions: predictLog
    };
    
    // Helper to generate board SVG
    const generateBoardSVG = (showAtoms, raysToShow = [], guessesToShow = [], results = null, predictions = null) => {
      const cellSize = 40;
      const edgeSize = 35;
      const totalSize = GRID_SIZE * cellSize + 2 * edgeSize;
      
      // Build markers for rays
      const markers = {};
      raysToShow.forEach(ray => {
        const ek = `${ray.entry.side}-${ray.entry.pos}`;
        if (!markers[ek]) markers[ek] = [];
        if (ray.exit) {
          const xk = `${ray.exit.side}-${ray.exit.pos}`;
          if (!markers[xk]) markers[xk] = [];
          if (ek === xk) markers[ek].push({ type: 'reflect', id: ray.id });
          else {
            markers[ek].push({ type: 'entry', id: ray.id, absorbed: ray.absorbed });
            markers[xk].push({ type: 'exit', id: ray.id });
          }
        } else {
          markers[ek].push({ type: 'entry', id: ray.id, absorbed: ray.absorbed });
        }
      });
      
      // Helper to get prediction correctness for a ray
      const getPredictionColor = (ray) => {
        if (!predictions) return ray.absorbed ? '#ef4444' : '#3b82f6';
        const rayKey = `${ray.entry.side.toUpperCase()}-${ray.entry.pos}`;
        const pred = predictions.find(p => p.ray === rayKey);
        if (pred) return pred.correct ? '#3b82f6' : '#ef4444';
        return ray.absorbed ? '#ef4444' : '#3b82f6';
      };
      
      const getEdgePos = (side, pos) => {
        if (side === 'north') return { x: edgeSize + (pos - 0.5) * cellSize, y: edgeSize / 2 };
        if (side === 'south') return { x: edgeSize + (pos - 0.5) * cellSize, y: edgeSize + GRID_SIZE * cellSize + edgeSize / 2 };
        if (side === 'west') return { x: edgeSize / 2, y: edgeSize + (pos - 0.5) * cellSize };
        return { x: edgeSize + GRID_SIZE * cellSize + edgeSize / 2, y: edgeSize + (pos - 0.5) * cellSize };
      };
      
      let svg = `<svg width="${totalSize}" height="${totalSize}" style="background:white;border:1px solid #ccc;">`;
      
      // Grid cells
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          const row = r + 1, col = c + 1, key = getKey(row, col);
          let fill = 'white';
          if (results) {
            if (results.correct.has(key)) fill = '#86efac';
            else if (results.wrong.has(key)) fill = '#fca5a5';
            else if (results.missed.has(key)) fill = '#fde047';
          }
          svg += `<rect x="${edgeSize + c * cellSize}" y="${edgeSize + r * cellSize}" width="${cellSize}" height="${cellSize}" fill="${fill}" stroke="#ccc"/>`;
        }
      }
      
      // Atoms
      if (showAtoms) {
        atoms.forEach(key => {
          const [row, col] = key.split(',').map(Number);
          svg += `<circle cx="${edgeSize + (col - 0.5) * cellSize}" cy="${edgeSize + (row - 0.5) * cellSize}" r="${cellSize * 0.35}" fill="#333"/>`;
        });
      }
      
      // Guesses (X marks)
      guessesToShow.forEach(key => {
        const [row, col] = key.split(',').map(Number);
        const cx = edgeSize + (col - 0.5) * cellSize;
        const cy = edgeSize + (row - 0.5) * cellSize;
        const s = cellSize * 0.25;
        const color = results ? (results.correct.has(key) ? '#16a34a' : '#ef4444') : '#f59e0b';
        svg += `<line x1="${cx-s}" y1="${cy-s}" x2="${cx+s}" y2="${cy+s}" stroke="${color}" stroke-width="3"/>`;
        svg += `<line x1="${cx+s}" y1="${cy-s}" x2="${cx-s}" y2="${cy+s}" stroke="${color}" stroke-width="3"/>`;
      });
      
      // Ray paths
      raysToShow.forEach(ray => {
        if (ray.path && ray.path.length > 0) {
          const points = [
            getEdgePos(ray.entry.side, ray.entry.pos),
            ...ray.path.map(([r,c]) => ({x: edgeSize + (c - 0.5) * cellSize, y: edgeSize + (r - 0.5) * cellSize})),
            ray.exit && !ray.absorbed ? getEdgePos(ray.exit.side, ray.exit.pos) : null
          ].filter(Boolean);
          const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');
          const color = getPredictionColor(ray);
          const dash = ray.absorbed ? 'stroke-dasharray="5,5"' : '';
          svg += `<polyline points="${pointsStr}" fill="none" stroke="${color}" stroke-width="2" ${dash} opacity="0.7"/>`;
        }
      });
      
      // Edge numbers and markers
      ['north','south','east','west'].forEach(side => {
        for (let i = 0; i < GRID_SIZE; i++) {
          const pos = i + 1;
          const {x, y} = getEdgePos(side, pos);
          svg += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#666">${pos}</text>`;
          
          const ml = markers[`${side}-${pos}`] || [];
          ml.forEach((m, idx) => {
            const off = (idx - (ml.length - 1) / 2) * 8;
            let col, sym;
            if(m.type==='reflect'){col='#f59e0b';sym='R';}
            else if(m.type==='entry'&&m.absorbed){col='#ef4444';sym='H';}
            else{col='#22c55e';sym=m.id;}
            
            // Override color based on predictions if available
            if (predictions) {
              const ray = raysToShow.find(r => r.id === m.id);
              if (ray) {
                col = getPredictionColor(ray);
              }
            }
            
            const mx = side === 'north' || side === 'south' ? x + off : x;
            const my = side === 'east' || side === 'west' ? y + off : y;
            const lo = side === 'north' ? -14 : side === 'south' ? 14 : side === 'west' ? -16 : 16;
            const tx = side === 'east' || side === 'west' ? mx + lo : mx;
            const ty = side === 'north' || side === 'south' ? my + lo : my;
            svg += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="bold" fill="${col}">${sym}</text>`;
          });
        }
      });
      
      svg += '</svg>';
      return svg;
    };
    
    let blob, filename;
    
    if (format === 'html') {
      // Build step-by-step sections
      let stepsHtml = '';
      
      // Match reasoning entries with rays
      let rayIndex = 0;
      llmLog.forEach((entry, i) => {
        if (entry.type === 'action') {
          const raysUpToNow = rays.slice(0, rayIndex + 1);
          const currentRay = rays[rayIndex];
          const thinkingHtml = entry.thinking ? `
  <details class="thinking">
    <summary>Show ${data.modelName}'s thinking...</summary>
    <div class="thinking-content">${entry.thinking.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </details>` : '';
          
          stepsHtml += `
<div class="step">
  <h3>Step ${rayIndex + 1}: ${entry.content}</h3>
  ${entry.reasoning ? `<div class="thought">"${entry.reasoning}"</div>` : ''}${thinkingHtml}
  <div class="result">${entry.result}</div>
  <div class="board">
    ${generateBoardSVG(false, raysUpToNow, [], null)}
  </div>
</div>`;
          rayIndex++;
        } else if (entry.type === 'guess') {
          const thinkingHtml = entry.thinking ? `
  <details class="thinking">
    <summary>Show ${data.modelName}'s thinking...</summary>
    <div class="thinking-content">${entry.thinking.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </details>` : '';
          
          stepsHtml += `
<div class="step guess-step">
  <h3>Final Guess</h3>
  ${entry.reasoning ? `<div class="thought">"${entry.reasoning}"</div>` : ''}${thinkingHtml}
  <div class="result">${entry.content}</div>
</div>`;
        }
      });
      
      const resultsSet = {
        correct: correctGuesses,
        wrong: wrongGuesses,
        missed: missedAtoms
      };
      
      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Black Box Game - Sequential Report</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; background: #f9fafb; }
  h1 { color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
  h2 { color: #374151; margin-top: 2.5rem; border-left: 4px solid #3b82f6; padding-left: 1rem; }
  h3 { color: #1f2937; margin: 0 0 0.5rem 0; }
  .intro { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 2rem; }
  .score { font-size: 1.5rem; padding: 1rem; background: #f0fdf4; border-radius: 8px; margin: 1rem 0; display: inline-block; }
  .score.perfect { background: #dcfce7; }
  .step { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
  .step h3 { color: #3b82f6; }
  .guess-step h3 { color: #f59e0b; }
  .thought { font-style: italic; color: #6b7280; margin: 0.5rem 0; padding: 0.75rem; background: #f3f4f6; border-radius: 6px; border-left: 3px solid #9ca3af; }
  .thinking { margin: 0.75rem 0; }
  .thinking summary { cursor: pointer; color: #7c3aed; font-weight: 500; padding: 0.5rem; }
  .thinking summary:hover { color: #5b21b6; }
  .thinking-content { margin-top: 0.5rem; padding: 1rem; background: #f5f3ff; border-radius: 6px; border-left: 3px solid #7c3aed; white-space: pre-wrap; font-size: 0.9rem; color: #4b5563; max-height: 300px; overflow-y: auto; }
  .result { font-family: monospace; color: #374151; margin: 0.5rem 0; font-weight: 500; }
  .board { margin: 1rem 0; }
  .board svg { display: block; margin: 0 auto; }
  .final { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .legend { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 1rem 0; justify-content: center; }
  .legend span { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
  .legend .box { width: 20px; height: 20px; border-radius: 4px; }
  .legend .atom { background: #1f2937; border-radius: 50%; }
  .summary { margin-top: 1.5rem; }
  .summary li { margin: 0.5rem 0; }
</style></head><body>

<h1>Black Box Game - Sequential Report</h1>

<div class="intro">
  <p><strong>Date:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
  <p><strong>Mode:</strong> LLM (${data.modelName})</p>
  <div class="score ${correctGuesses.size === NUM_ATOMS ? 'perfect' : ''}">
    <strong>Final Score: ${data.results.score.total}</strong> (${data.results.score.rayPoints} ray pts + ${data.results.score.missedPenalty} miss penalty)
    ${correctGuesses.size === NUM_ATOMS ? ' 🎉 Perfect!' : ''}
  </div>
</div>

<h2>Hidden Atoms</h2>
<div class="step">
  <p>The puzzle begins with 4 atoms hidden in the 8×8 grid. ${data.modelName} must deduce their locations by firing rays.</p>
  <p><strong>Actual positions:</strong> ${data.atoms.map(([r,c]) => `(row ${r}, col ${c})`).join(', ')}</p>
  <div class="board">
    ${generateBoardSVG(true, [], [], null)}
  </div>
</div>

<h2>${data.modelName}'s Reasoning Process</h2>
${stepsHtml}

<h2>Final Result</h2>
<div class="final">
  <p><strong>${data.modelName}'s guesses:</strong> ${data.guesses.map(([r,c]) => `(${r},${c})`).join(', ')}</p>
  <p><strong>Actual atoms:</strong> ${data.atoms.map(([r,c]) => `(${r},${c})`).join(', ')}</p>
  
  <div class="legend">
    <span><div class="box" style="background:#86efac"></div> Correct guess</span>
    <span><div class="box" style="background:#fca5a5"></div> Wrong guess</span>
    <span><div class="box" style="background:#fde047"></div> Missed atom</span>
    <span><div class="box atom"></div> Atom location</span>
  </div>
  
  <div class="board">
    ${generateBoardSVG(true, rays, guesses, resultsSet)}
  </div>
  
  <div class="summary">
    <h3>Summary</h3>
    <ul>
      <li><strong>Correct guesses (${data.results.correct.length}):</strong> ${data.results.correct.map(([r,c]) => `(${r},${c})`).join(', ') || 'None'}</li>
      <li><strong>Wrong guesses (${data.results.wrong.length}):</strong> ${data.results.wrong.map(([r,c]) => `(${r},${c})`).join(', ') || 'None'}</li>
      <li><strong>Missed atoms (${data.results.missed.length}):</strong> ${data.results.missed.map(([r,c]) => `(${r},${c})`).join(', ') || 'None'}</li>
      <li><strong>Total rays fired:</strong> ${data.rays.length}</li>
      <li><strong>Score:</strong> ${data.results.score.total} (${data.results.score.rayPoints} ray points + ${data.results.score.missedPenalty} miss penalty)</li>
    </ul>
  </div>
</div>

</body></html>`;
      blob = new Blob([html], { type: 'text/html' });
      filename = `blackbox-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.html`;
    } else if (format === 'predict-html') {
      // Build step-by-step sections for predictions
      let stepsHtml = '';
      const correctCount = predictLog.filter(p => p.correct).length;
      
      predictLog.forEach((pred, i) => {
        const raysUpToNow = rays.slice(0, i + 1);
        const predsUpToNow = predictLog.slice(0, i + 1);
        const thinkingHtml = pred.thinking ? `
  <details class="thinking">
    <summary>Show ${data.modelName}'s thinking...</summary>
    <div class="thinking-content">${pred.thinking.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </details>` : '';
        
        stepsHtml += `
<div class="step ${pred.correct ? 'correct-step' : 'wrong-step'}">
  <h3>Ray ${i + 1}: ${pred.ray}</h3>
  <div class="prediction-result">
    <div class="pred-row"><span class="label">Predicted:</span> <span class="value">${pred.predicted}</span></div>
    <div class="pred-row"><span class="label">Actual:</span> <span class="value">${pred.actual}</span></div>
    <div class="verdict ${pred.correct ? 'correct' : 'wrong'}">${pred.correct ? '✓ Correct' : '✗ Wrong'}</div>
  </div>
  ${pred.reasoning ? `<details class="reasoning"><summary>Show reasoning...</summary><div class="reasoning-content">${pred.reasoning.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></details>` : ''}${thinkingHtml}
  <div class="board">
    ${generateBoardSVG(true, raysUpToNow, [], null, predsUpToNow)}
  </div>
</div>`;
      });
      
      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Black Box - Prediction Test Report</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; background: #f9fafb; }
  h1 { color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
  h2 { color: #374151; margin-top: 2.5rem; border-left: 4px solid #06b6d4; padding-left: 1rem; }
  h3 { color: #1f2937; margin: 0 0 0.5rem 0; }
  .intro { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 2rem; }
  .score { font-size: 1.5rem; padding: 1rem; background: #ecfeff; border-radius: 8px; margin: 1rem 0; display: inline-block; }
  .score.perfect { background: #cffafe; }
  .step { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; border-left: 4px solid #9ca3af; }
  .step.correct-step { border-left-color: #3b82f6; }
  .step.correct-step h3 { color: #3b82f6; }
  .step.wrong-step { border-left-color: #ef4444; }
  .step.wrong-step h3 { color: #ef4444; }
  .prediction-result { margin: 0.75rem 0; padding: 0.75rem; background: #f9fafb; border-radius: 6px; }
  .pred-row { margin: 0.25rem 0; }
  .pred-row .label { font-weight: 500; color: #6b7280; min-width: 80px; display: inline-block; }
  .pred-row .value { font-family: monospace; }
  .verdict { font-weight: 600; margin-top: 0.5rem; padding: 0.25rem 0.5rem; border-radius: 4px; display: inline-block; }
  .verdict.correct { background: #dbeafe; color: #1d4ed8; }
  .verdict.wrong { background: #fee2e2; color: #dc2626; }
  .reasoning { margin: 0.75rem 0; }
  .reasoning summary { cursor: pointer; color: #6b7280; font-weight: 500; padding: 0.5rem; }
  .reasoning summary:hover { color: #374151; }
  .reasoning-content { margin-top: 0.5rem; padding: 1rem; background: #f3f4f6; border-radius: 6px; border-left: 3px solid #9ca3af; font-size: 0.9rem; color: #4b5563; max-height: 200px; overflow-y: auto; white-space: pre-wrap; }
  .thinking { margin: 0.75rem 0; }
  .thinking summary { cursor: pointer; color: #7c3aed; font-weight: 500; padding: 0.5rem; }
  .thinking summary:hover { color: #5b21b6; }
  .thinking-content { margin-top: 0.5rem; padding: 1rem; background: #f5f3ff; border-radius: 6px; border-left: 3px solid #7c3aed; white-space: pre-wrap; font-size: 0.9rem; color: #4b5563; max-height: 300px; overflow-y: auto; }
  .board { margin: 1rem 0; }
  .board svg { display: block; margin: 0 auto; }
  .final { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .legend { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 1rem 0; justify-content: center; }
  .legend span { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
  .legend .box { width: 20px; height: 20px; border-radius: 4px; }
  .legend .atom { background: #1f2937; border-radius: 50%; }
  .summary { margin-top: 1.5rem; }
  .summary li { margin: 0.5rem 0; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem; }
  .summary-card { background: #f9fafb; padding: 1rem; border-radius: 8px; text-align: center; }
  .summary-card .number { font-size: 2rem; font-weight: 700; }
  .summary-card .label { color: #6b7280; font-size: 0.875rem; }
  .summary-card.correct .number { color: #3b82f6; }
  .summary-card.wrong .number { color: #ef4444; }
</style></head><body>

<h1>Black Box - Prediction Test Report</h1>

<div class="intro">
  <p><strong>Date:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
  <p><strong>Mode:</strong> Prediction (${data.modelName})</p>
  <div class="score ${correctCount === predictLog.length ? 'perfect' : ''}">
    <strong>Score: ${correctCount}/${predictLog.length} correct</strong>
    ${correctCount === predictLog.length ? ' 🎉 Perfect!' : ` (${Math.round(correctCount/predictLog.length*100)}%)`}
  </div>
</div>

<h2>Atom Configuration</h2>
<div class="step">
  <p>${data.modelName} was shown the atom positions and asked to predict ray outcomes.</p>
  <p><strong>Atom positions:</strong> ${data.atoms.map(([r,c]) => `(row ${r}, col ${c})`).join(', ')}</p>
  <div class="board">
    ${generateBoardSVG(true, [], [], null)}
  </div>
</div>

<h2>Prediction Results</h2>
${stepsHtml}

<h2>Summary</h2>
<div class="final">
  <div class="summary-grid">
    <div class="summary-card correct">
      <div class="number">${correctCount}</div>
      <div class="label">Correct Predictions</div>
    </div>
    <div class="summary-card wrong">
      <div class="number">${predictLog.length - correctCount}</div>
      <div class="label">Wrong Predictions</div>
    </div>
    <div class="summary-card">
      <div class="number">${predictLog.length}</div>
      <div class="label">Total Rays</div>
    </div>
    <div class="summary-card">
      <div class="number">${Math.round(correctCount/predictLog.length*100) || 0}%</div>
      <div class="label">Accuracy</div>
    </div>
  </div>
  
  <div class="legend" style="margin-top: 1.5rem;">
    <span><div class="box" style="background:#3b82f6"></div> Correct prediction</span>
    <span><div class="box" style="background:#ef4444"></div> Wrong prediction</span>
    <span><div class="box atom"></div> Atom location</span>
  </div>
  
  <div class="board">
    ${generateBoardSVG(true, rays, [], null, predictLog)}
  </div>
  
  <div class="summary">
    <h3>Details</h3>
    <ul>
      ${predictLog.map((p, i) => `<li><strong>Ray ${i+1} (${p.ray}):</strong> ${p.correct ? '✓' : '✗'} Predicted "${p.predicted}", Actual "${p.actual}"</li>`).join('\n      ')}
    </ul>
  </div>
</div>

</body></html>`;
      blob = new Blob([html], { type: 'text/html' });
      filename = `blackbox-predict-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.html`;
    } else {
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      filename = `blackbox-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
    }
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const runLlmFull = async () => {
    if (llmRunning) return;
    setLlmRunning(true);
    
    let currentRays = [];
    let currentMessages = [];
    let counter = 1;
    let done = false;
    let retryCount = 0;
    const maxRetries = 3;
    const hypotheses = new Set(); // Track marked positions when allowHypotheses is true
    
    // Get base system prompt from selected style
    let baseSystemPrompt = PROMPT_STYLES[llmSettings.promptStyle]?.playPrompt || systemPrompt;
    
    // Modify prompt if hypotheses are enabled
    if (llmSettings.allowHypotheses) {
      const baselineJsonSection = `Respond with JSON only:
{"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
{"action": "guess", "atoms": [[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}

When you think you know where all 4 balls are, make your guess.`;
      
      const baselineNewSection = `Respond with JSON only:
{"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
{"action": "mark", "row": 1-8, "col": 1-8, "reasoning": "..."} - mark where you think an atom is
{"action": "unmark", "row": 1-8, "col": 1-8, "reasoning": "..."} - remove a marked position
{"action": "check", "reasoning": "..."} - submit your answer (requires exactly 4 marked positions)

You must mark exactly 4 positions where you think the atoms are located. Use mark/unmark to adjust your guesses as you gather information. When you have exactly 4 positions marked and are confident, use the check action to submit your answer.`;

      const augmentedJsonSection = `Respond with JSON only:
Fire ray: {"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
Final guess: {"action": "guess", "atoms": [[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}

Max 20 rays. Be strategic and cross-reference observations.`;
      
      const augmentedNewSection = `Respond with JSON only:
Fire ray: {"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
Mark atom: {"action": "mark", "row": 1-8, "col": 1-8, "reasoning": "..."} - mark where you think an atom is
Unmark: {"action": "unmark", "row": 1-8, "col": 1-8, "reasoning": "..."} - remove a marked position
Check: {"action": "check", "reasoning": "..."} - submit your answer (requires exactly 4 marked positions)

You must mark exactly 4 positions where you think the atoms are located. Use mark/unmark to refine your guesses. When you have exactly 4 positions marked and are confident, use check to submit. Max 20 rays. Be strategic and cross-reference observations.`;

      if (baseSystemPrompt.includes(baselineJsonSection)) {
        baseSystemPrompt = baseSystemPrompt.replace(baselineJsonSection, baselineNewSection);
      } else if (baseSystemPrompt.includes(augmentedJsonSection)) {
        baseSystemPrompt = baseSystemPrompt.replace(augmentedJsonSection, augmentedNewSection);
      }
    }
    
    // Build prompt with VoT additions
    const systemPromptWithVoT = buildPromptWithVoT(baseSystemPrompt, votConfig);
    
    while (!done && currentRays.length < 20) {
      // Track used positions for this iteration
      const usedPos = new Set();
      currentRays.forEach(r => {
        usedPos.add(`${r.entry.side.toUpperCase()}-${r.entry.pos}`);
        if (r.exit) usedPos.add(`${r.exit.side.toUpperCase()}-${r.exit.pos}`);
      });
      
      let ctx = "Current ray results:\n";
      if (currentRays.length === 0) ctx += "(No rays fired yet)\n";
      else {
        currentRays.forEach(r => { ctx += formatRayResult(r) + "\n"; });
        if (llmSettings.includeVisualization) {
          ctx += "\nBoard (numbers = entry/exit pairs, H = absorbed, R = reflected):\n```\n";
          ctx += generateTextBoard(currentRays);
          ctx += "```\n";
        }
      }
      
      // Show hypotheses if enabled
      if (llmSettings.allowHypotheses) {
        if (hypotheses.size > 0) {
          const hypList = Array.from(hypotheses).map(k => `(${k})`).join(', ');
          ctx += `\nMarked atom positions (${hypotheses.size}/4): ${hypList}`;
          if (hypotheses.size === 4) {
            ctx += ` — Ready to check!\n`;
          } else {
            ctx += `\n`;
          }
        } else {
          ctx += `\nMarked atom positions: (none marked yet)\n`;
        }
      }
      
      if (usedPos.size > 0) {
        ctx += `\nUnavailable positions (already used as entry/exit): ${Array.from(usedPos).sort().join(', ')}\n`;
      }
      
      ctx += `\nRays fired: ${currentRays.length}/20\n\nDecide your next action. You cannot fire from positions already used. JSON only.`;
      
      const msgs = [...currentMessages, { role: "user", content: ctx }];
      
      try {
        const { thinking, text: response } = await callClaude(msgs, systemPromptWithVoT, selectedModel, llmSettings.enableThinking, llmSettings.thinkingBudget);
        const parsed = parseResponse(response);
        
        if (parsed?.action === 'fire') {
          const fireKey = `${parsed.side.toUpperCase()}-${parsed.position}`;
          if (usedPos.has(fireKey)) {
            retryCount++;
            if (retryCount >= maxRetries) {
              setLlmLog(prev => [...prev, { 
                type: 'error', 
                content: `Failed after ${maxRetries} invalid position attempts. Stopping.`
              }]);
              done = true;
              continue;
            }
            // LLM tried to fire from an unavailable position - inform and retry
            setLlmLog(prev => [...prev, { 
              type: 'error', 
              content: `Invalid: ${fireKey} already used. Retrying (${retryCount}/${maxRetries})...`
            }]);
            currentMessages = [...msgs, 
              { role: "assistant", content: response },
              { role: "user", content: `Error: Position ${fireKey} is unavailable (already used as entry/exit). Choose a different position.` }
            ];
            setLlmMessages(currentMessages);
            await new Promise(r => setTimeout(r, 300));
            continue; // Retry the loop
          }
          
          retryCount = 0; // Reset on successful move
          
          const result = traceRay(atoms, parsed.side, parsed.position);
          result.id = counter++;
          currentRays = [...currentRays, result];
          setRays(currentRays);
          setRayCounter(counter);
          
          setLlmLog(prev => [...prev, { 
            type: 'action', 
            content: `Fired: ${parsed.side.toUpperCase()}-${parsed.position}`,
            result: formatRayResult(result),
            reasoning: parsed.reasoning,
            thinking: thinking.length > 0 ? thinking.join('\n\n') : null
          }]);
          
          currentMessages = [...msgs, 
            { role: "assistant", content: response },
            { role: "user", content: `Result: ${formatRayResult(result)}` }
          ];
          setLlmMessages(currentMessages);
          await new Promise(r => setTimeout(r, 300));
          
        } else if (parsed?.action === 'mark' && llmSettings.allowHypotheses) {
          const row = parsed.row;
          const col = parsed.col;
          const cellKey = `${row},${col}`;
          
          if (!row || !col || row < 1 || row > 8 || col < 1 || col > 8) {
            setLlmLog(prev => [...prev, { type: 'error', content: `Invalid position (${row},${col}). Row and column must be 1-8.` }]);
            currentMessages = [...msgs, { role: "assistant", content: response }, { role: "user", content: `ERROR: Invalid position. Row and column must be 1-8.` }];
            continue;
          }
          
          if (hypotheses.has(cellKey)) {
            setLlmLog(prev => [...prev, { type: 'action', content: `Position (${row},${col}) already marked` }]);
          } else if (hypotheses.size >= 4) {
            setLlmLog(prev => [...prev, { type: 'error', content: `Already have 4 positions marked. Unmark one first or use check.` }]);
            currentMessages = [...msgs, { role: "assistant", content: response }, { role: "user", content: `ERROR: Already have 4 positions marked. Unmark one first, or use "check" to submit your answer.` }];
            continue;
          } else {
            hypotheses.add(cellKey);
            setGuesses(new Set(hypotheses)); // Update visual display
            setLlmLog(prev => [...prev, { 
              type: 'action', 
              content: `Marked (${row},${col}) - now ${hypotheses.size}/4`,
              reasoning: parsed.reasoning,
              thinking: thinking.length > 0 ? thinking.join('\n\n') : null
            }]);
          }
          
          currentMessages = [...msgs, { role: "assistant", content: response }];
          setLlmMessages(currentMessages);
          await new Promise(r => setTimeout(r, 300));
          
        } else if (parsed?.action === 'unmark' && llmSettings.allowHypotheses) {
          const row = parsed.row;
          const col = parsed.col;
          const cellKey = `${row},${col}`;
          
          if (!hypotheses.has(cellKey)) {
            setLlmLog(prev => [...prev, { type: 'action', content: `Position (${row},${col}) was not marked` }]);
          } else {
            hypotheses.delete(cellKey);
            setGuesses(new Set(hypotheses)); // Update visual display
            setLlmLog(prev => [...prev, { 
              type: 'action', 
              content: `Unmarked (${row},${col}) - now ${hypotheses.size}/4`,
              reasoning: parsed.reasoning,
              thinking: thinking.length > 0 ? thinking.join('\n\n') : null
            }]);
          }
          
          currentMessages = [...msgs, { role: "assistant", content: response }];
          setLlmMessages(currentMessages);
          await new Promise(r => setTimeout(r, 300));
          
        } else if (parsed?.action === 'check' && llmSettings.allowHypotheses) {
          if (hypotheses.size !== 4) {
            const diff = 4 - hypotheses.size;
            const errorMsg = hypotheses.size < 4 
              ? `ERROR: You have only ${hypotheses.size} positions marked. You need to mark ${diff} more position${diff > 1 ? 's' : ''} before checking.`
              : `ERROR: You have ${hypotheses.size} positions marked. You need to unmark ${-diff} position${-diff > 1 ? 's' : ''} to have exactly 4.`;
            setLlmLog(prev => [...prev, { type: 'error', content: `Check failed: ${hypotheses.size}/4 marked` }]);
            currentMessages = [...msgs, { role: "assistant", content: response }, { role: "user", content: errorMsg }];
            continue;
          }
          
          // Check action with exactly 4 hypotheses
          setGuesses(new Set(hypotheses));
          setGameChecked(true);
          setLlmLog(prev => [...prev, { 
            type: 'guess', 
            content: `Check: ${Array.from(hypotheses).map(k => `(${k})`).join(', ')}`,
            reasoning: parsed.reasoning,
            thinking: thinking.length > 0 ? thinking.join('\n\n') : null
          }]);
          done = true;
          
        } else if (parsed?.action === 'guess' && !llmSettings.allowHypotheses) {
          const guessSet = new Set();
          parsed.atoms.forEach(([r, c]) => guessSet.add(getKey(r, c)));
          setGuesses(guessSet);
          setGameChecked(true);
          setLlmLog(prev => [...prev, { 
            type: 'guess', 
            content: `Guess: ${parsed.atoms.map(([r,c]) => `(${r},${c})`).join(', ')}`,
            reasoning: parsed.reasoning,
            thinking: thinking.length > 0 ? thinking.join('\n\n') : null
          }]);
          done = true;
          
        } else if (parsed?.action === 'guess' && llmSettings.allowHypotheses) {
          setLlmLog(prev => [...prev, { type: 'error', content: 'Guess action not available. Use mark/unmark and check.' }]);
          currentMessages = [...msgs, { role: "assistant", content: response }, { role: "user", content: `ERROR: The "guess" action is not available. Use "mark" to mark atom positions, then use "check" when you have exactly 4 positions marked.` }];
          continue;
          
        } else {
          setLlmLog(prev => [...prev, { type: 'error', content: `Unknown action: ${parsed?.action || 'parse failed'}` }]);
          done = true;
        }
      } catch (e) {
        setLlmLog(prev => [...prev, { type: 'error', content: e.message }]);
        done = true;
      }
    }
    setLlmRunning(false);
  };
  
  const correctGuesses = new Set();
  const wrongGuesses = new Set();
  const missedAtoms = new Set();
  
  if (gameChecked) {
    guesses.forEach(g => { if (atoms.has(g)) correctGuesses.add(g); else wrongGuesses.add(g); });
    atoms.forEach(a => { if (!guesses.has(a)) missedAtoms.add(a); });
  }
  
  const cellSize = 50, edgeSize = 55;
  const totalSize = GRID_SIZE * cellSize + 2 * edgeSize;
  
  const markers = {};
  rays.forEach(ray => {
    const ek = `${ray.entry.side}-${ray.entry.pos}`;
    if (!markers[ek]) markers[ek] = [];
    if (ray.exit) {
      const xk = `${ray.exit.side}-${ray.exit.pos}`;
      if (!markers[xk]) markers[xk] = [];
      if (ek === xk) markers[ek].push({ type: 'reflect', id: ray.id });
      else {
        markers[ek].push({ type: 'entry', id: ray.id, absorbed: ray.absorbed });
        markers[xk].push({ type: 'exit', id: ray.id });
      }
    } else {
      markers[ek].push({ type: 'entry', id: ray.id, absorbed: ray.absorbed });
    }
  });
  
  // Add experiment markers when running experiment (both predict and play)
  const experimentMarkers = {};
  if (experimentRunning) {
    experimentRays.forEach(ray => {
      const ek = `${ray.entry.side}-${ray.entry.pos}`;
      if (!experimentMarkers[ek]) experimentMarkers[ek] = [];
      if (ray.exit) {
        const xk = `${ray.exit.side}-${ray.exit.pos}`;
        if (!experimentMarkers[xk]) experimentMarkers[xk] = [];
        if (ek === xk) experimentMarkers[ek].push({ type: 'reflect', id: ray.id, isExperiment: true });
        else {
          experimentMarkers[ek].push({ type: 'entry', id: ray.id, absorbed: ray.absorbed, isExperiment: true });
          experimentMarkers[xk].push({ type: 'exit', id: ray.id, isExperiment: true });
        }
      } else {
        experimentMarkers[ek].push({ type: 'entry', id: ray.id, absorbed: ray.absorbed, isExperiment: true });
      }
    });
  }
  
  const getEdgePos = (side, pos) => {
    if (side === 'north') return { x: edgeSize + (pos - 0.5) * cellSize, y: edgeSize / 2 };
    if (side === 'south') return { x: edgeSize + (pos - 0.5) * cellSize, y: edgeSize + GRID_SIZE * cellSize + edgeSize / 2 };
    if (side === 'west') return { x: edgeSize / 2, y: edgeSize + (pos - 0.5) * cellSize };
    return { x: edgeSize + GRID_SIZE * cellSize + edgeSize / 2, y: edgeSize + (pos - 0.5) * cellSize };
  };
  
  const showAtoms = mode === 'sandbox' || mode === 'predict' || gameChecked;
  
  return (
    <div className="flex flex-col items-center p-4 bg-gray-100 min-h-screen">
      <div className="flex items-center gap-2 mb-2">
        <h1 className="text-2xl font-bold">Black Box</h1>
        <button 
          onClick={() => setShowHelp(true)}
          className="w-6 h-6 rounded-full bg-blue-500 text-white text-sm font-bold hover:bg-blue-600 flex items-center justify-center"
          title="Help"
        >
          ?
        </button>
      </div>
      <p className="text-sm text-gray-600 mb-3">
        Mode: <span className="font-semibold">
          {experimentRunning 
            ? `🧪 Experiment (${experimentConfig.taskMode === 'predict' ? 'Predict' : 'Play'})` 
            : mode === 'play' ? 'Human' : mode === 'sandbox' ? 'Sandbox' : mode === 'predict' ? `Predict (${modelOptions.find(m => m.id === selectedModel)?.name})` : `LLM (${modelOptions.find(m => m.id === selectedModel)?.name})`}
        </span>
      </p>
      
      <div className="flex gap-2 mb-3 flex-wrap justify-center">
        <button onClick={handleNewGame} className="px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm">New Game</button>
        <button onClick={() => { setRays([]); setRayCounter(1); }} className="px-3 py-1.5 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm">Clear Rays</button>
        {mode === 'play' && <button onClick={() => setGuesses(new Set())} disabled={gameChecked} className="px-3 py-1.5 bg-orange-500 text-white rounded hover:bg-orange-600 text-sm disabled:opacity-50">Clear Guesses</button>}
      </div>
      
      <div className="flex gap-2 mb-3 flex-wrap justify-center">
        <button onClick={() => setModeAndReset('play')} className={`px-3 py-1.5 rounded text-sm ${mode === 'play' ? 'bg-green-600 text-white' : 'bg-green-100 hover:bg-green-200'}`}>Play</button>
        <button onClick={() => setModeAndReset('sandbox')} className={`px-3 py-1.5 rounded text-sm ${mode === 'sandbox' ? 'bg-purple-600 text-white' : 'bg-purple-100 hover:bg-purple-200'}`}>Sandbox</button>
        <button onClick={() => setModeAndReset('llm')} className={`px-3 py-1.5 rounded text-sm ${mode === 'llm' ? 'bg-amber-600 text-white' : 'bg-amber-100 hover:bg-amber-200'}`}>LLM</button>
        <button onClick={() => setModeAndReset('predict')} className={`px-3 py-1.5 rounded text-sm ${mode === 'predict' ? 'bg-cyan-600 text-white' : 'bg-cyan-100 hover:bg-cyan-200'}`}>Predict</button>
        <button onClick={() => {
          if (experimentMode) {
            // Turning off experiment mode - clear experiment state
            setExperimentMode(false);
            setExperimentRunning(false);
            setExperimentAtoms(new Set());
            setExperimentRays([]);
            setExperimentPredictions([]);
            setExperimentHypotheses(new Set());
            handleNewGame();
          } else {
            // Turning on experiment mode
            setExperimentMode(true);
          }
        }} className={`px-3 py-1.5 rounded text-sm ${experimentMode ? 'bg-rose-600 text-white' : 'bg-rose-100 hover:bg-rose-200'}`}>Experiment</button>
        
        {(mode === 'llm' || mode === 'predict') && !experimentMode && (
          <button 
            onClick={() => setShowPromptEditor(!showPromptEditor)}
            className="px-2 py-1.5 rounded text-sm border border-gray-300 bg-white hover:bg-gray-50"
          >
            {showPromptEditor ? 'Hide Settings' : '⚙️ Settings'}
          </button>
        )}
      </div>
      
      {showPromptEditor && (mode === 'llm' || mode === 'predict') && !experimentMode && (
        <div className="mb-3 p-3 bg-white rounded shadow w-full max-w-2xl">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-sm">{mode === 'llm' ? 'LLM' : 'Predict'} Mode Settings</h3>
            <div className="flex gap-2">
              <button 
                onClick={() => {
                  const promptData = JSON.stringify({ system: systemPrompt, predict: predictPrompt }, null, 2);
                  navigator.clipboard.writeText(promptData);
                  alert('Prompts copied to clipboard as JSON');
                }}
                className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 rounded"
              >
                Copy JSON
              </button>
              <button 
                onClick={() => {
                  const input = prompt('Paste prompt JSON:');
                  if (input) {
                    try {
                      const parsed = JSON.parse(input);
                      if (parsed.system) setSystemPrompt(parsed.system);
                      if (parsed.predict) setPredictPrompt(parsed.predict);
                    } catch (e) {
                      alert('Invalid JSON');
                    }
                  }
                }}
                className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 rounded"
              >
                Paste JSON
              </button>
              <button 
                onClick={() => {
                  setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
                  setPredictPrompt(DEFAULT_PREDICT_SYSTEM_PROMPT);
                }}
                className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
              >
                Reset to Defaults
              </button>
            </div>
          </div>
          
          <div className="space-y-3">
            {/* Settings Panel - matching experiment options */}
            <div className="p-3 bg-gray-50 rounded border border-gray-200">
              <div className="text-xs font-semibold text-gray-700 mb-2">Settings</div>
              
              {/* Model Selection */}
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
                <select 
                  value={selectedModel} 
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
                >
                  {modelOptions.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              
              {/* Prompt Style - full width */}
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">Prompt Style</label>
                <select
                  value={llmSettings.promptStyle}
                  onChange={(e) => setLlmSettings(prev => ({ ...prev, promptStyle: e.target.value }))}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
                >
                  {Object.entries(PROMPT_STYLES).map(([key, val]) => (
                    <option key={key} value={key}>{val.name}: {val.description}</option>
                  ))}
                </select>
              </div>
              
              {/* Checkbox options */}
              <div className="space-y-2">
                {/* Include Text Board - shown first for Predict mode */}
                {mode === 'predict' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="llmIncludeViz"
                      checked={llmSettings.includeVisualization}
                      onChange={(e) => setLlmSettings(prev => ({ ...prev, includeVisualization: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <label htmlFor="llmIncludeViz" className="text-xs text-gray-700">
                      Include Text Board Visualization
                    </label>
                  </div>
                )}
                
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="llmEnableThinking"
                    checked={llmSettings.enableThinking}
                    onChange={(e) => setLlmSettings(prev => ({ ...prev, enableThinking: e.target.checked }))}
                    className="w-3 h-3"
                  />
                  <label htmlFor="llmEnableThinking" className="text-xs text-gray-700">
                    Extended Thinking
                  </label>
                  <select
                    value={llmSettings.thinkingBudget}
                    onChange={(e) => setLlmSettings(prev => ({ ...prev, thinkingBudget: parseInt(e.target.value) }))}
                    disabled={!llmSettings.enableThinking}
                    className={`px-1 py-0.5 text-xs border border-gray-300 rounded ${!llmSettings.enableThinking ? 'opacity-50' : ''}`}
                  >
                    <option value={5000}>5K tokens</option>
                    <option value={10000}>10K tokens</option>
                    <option value={16000}>16K tokens</option>
                    <option value={32000}>32K tokens</option>
                    <option value={64000}>64K tokens</option>
                    <option value={128000}>128K tokens</option>
                  </select>
                </div>
                
                {mode === 'llm' && (
                  <>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="llmAllowHypotheses"
                        checked={llmSettings.allowHypotheses}
                        onChange={(e) => {
                          if (e.target.checked) {
                            // Auto-enable visualization when hypotheses enabled
                            setLlmSettings(prev => ({ ...prev, allowHypotheses: true, includeVisualization: true }));
                          } else {
                            setLlmSettings(prev => ({ ...prev, allowHypotheses: false }));
                          }
                        }}
                        className="w-3 h-3"
                      />
                      <label htmlFor="llmAllowHypotheses" className="text-xs text-gray-700">
                        Allow Hypothesis Marking <span className="text-gray-400">(mark/check)</span>
                      </label>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="llmIncludeVizLLM"
                        checked={llmSettings.includeVisualization}
                        onChange={(e) => setLlmSettings(prev => ({ ...prev, includeVisualization: e.target.checked }))}
                        className="w-3 h-3"
                        disabled={llmSettings.allowHypotheses}
                      />
                      <label htmlFor="llmIncludeVizLLM" className={`text-xs ${llmSettings.allowHypotheses ? 'text-gray-400' : 'text-gray-700'}`}>
                        Include Text Board Visualization {llmSettings.allowHypotheses && <span className="text-gray-400">(required for hypothesis marking)</span>}
                      </label>
                    </div>
                  </>
                )}
              </div>
            </div>
            
            {/* Prompt Preview */}
            <details className="p-2 bg-blue-50 rounded border border-blue-200">
              <summary className="text-xs font-semibold text-blue-700 cursor-pointer">
                📋 Preview Effective System Prompt ({mode === 'llm' ? 'LLM' : 'Predict'} mode)
              </summary>
              <pre className="mt-2 text-xs whitespace-pre-wrap bg-white p-2 rounded border max-h-64 overflow-y-auto">
                {(() => {
                  let basePrompt = PROMPT_STYLES[llmSettings.promptStyle]?.[mode === 'llm' ? 'playPrompt' : 'predictPrompt'] || (mode === 'llm' ? systemPrompt : predictPrompt);
                  
                  // If LLM mode with hypotheses, modify prompt
                  if (mode === 'llm' && llmSettings.allowHypotheses) {
                    const baselineJsonSection = `Respond with JSON only:
{"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
{"action": "guess", "atoms": [[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}

When you think you know where all 4 balls are, make your guess.`;
                    
                    const baselineNewSection = `Respond with JSON only:
{"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
{"action": "mark", "row": 1-8, "col": 1-8, "reasoning": "..."} - mark where you think an atom is
{"action": "unmark", "row": 1-8, "col": 1-8, "reasoning": "..."} - remove a marked position
{"action": "check", "reasoning": "..."} - submit your answer (requires exactly 4 marked positions)

You must mark exactly 4 positions where you think the atoms are located. Use mark/unmark to adjust your guesses as you gather information. When you have exactly 4 positions marked and are confident, use the check action to submit your answer.`;

                    const augmentedJsonSection = `Respond with JSON only:
Fire ray: {"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
Final guess: {"action": "guess", "atoms": [[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}

Max 20 rays. Be strategic and cross-reference observations.`;
                    
                    const augmentedNewSection = `Respond with JSON only:
Fire ray: {"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
Mark atom: {"action": "mark", "row": 1-8, "col": 1-8, "reasoning": "..."} - mark where you think an atom is
Unmark: {"action": "unmark", "row": 1-8, "col": 1-8, "reasoning": "..."} - remove a marked position
Check: {"action": "check", "reasoning": "..."} - submit your answer (requires exactly 4 marked positions)

You must mark exactly 4 positions where you think the atoms are located. Use mark/unmark to refine your guesses. When you have exactly 4 positions marked and are confident, use check to submit. Max 20 rays. Be strategic and cross-reference observations.`;

                    if (basePrompt.includes(baselineJsonSection)) {
                      basePrompt = basePrompt.replace(baselineJsonSection, baselineNewSection);
                    } else if (basePrompt.includes(augmentedJsonSection)) {
                      basePrompt = basePrompt.replace(augmentedJsonSection, augmentedNewSection);
                    }
                  }
                  
                  // Add VoT prompts
                  const votConfigForPreview = {
                    gridState: mode === 'llm' && votConfig.gridState,
                    rayTrace: votConfig.rayTrace,
                    hypothesis: mode === 'llm' && votConfig.hypothesis,
                  };
                  return buildPromptWithVoT(basePrompt, votConfigForPreview);
                })()}
              </pre>
            </details>
            
            {/* Custom Prompt Editors (collapsed by default) */}
            <details className="p-2 bg-gray-50 rounded border border-gray-200">
              <summary className="text-xs font-semibold text-gray-600 cursor-pointer">
                ✏️ Custom Prompt Overrides (Advanced)
              </summary>
              <div className="mt-2 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    LLM Mode Prompt ({systemPrompt.length} chars)
                  </label>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    className="w-full h-32 p-2 text-xs font-mono border border-gray-300 rounded resize-y"
                    placeholder="System prompt for LLM game mode..."
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Predict Mode Prompt ({predictPrompt.length} chars)
                  </label>
                  <textarea
                    value={predictPrompt}
                    onChange={(e) => setPredictPrompt(e.target.value)}
                    className="w-full h-32 p-2 text-xs font-mono border border-gray-300 rounded resize-y"
                    placeholder="System prompt for prediction mode..."
                  />
                </div>
              </div>
            </details>
            
            {/* VoT toggles for LLM/Predict modes */}
            <div className="mt-3 p-2 bg-purple-50 rounded border border-purple-200">
              <div className="text-xs font-semibold text-purple-700 mb-2">Visualization of Thinking (VoT) Prompts:</div>
              <div className="grid grid-cols-2 gap-2">
                {/* Option A - Grid State - LLM mode only */}
                {mode === 'llm' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="votGridStateLLM"
                      checked={votConfig.gridState}
                      onChange={(e) => setVotConfig(prev => ({ ...prev, gridState: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <label htmlFor="votGridStateLLM" className="text-xs text-gray-700">
                      A: Grid State Tracking
                    </label>
                  </div>
                )}
                
                {/* Option B - Ray Trace - All modes */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="votRayTraceLLM"
                    checked={votConfig.rayTrace}
                    onChange={(e) => setVotConfig(prev => ({ ...prev, rayTrace: e.target.checked }))}
                    className="w-3 h-3"
                  />
                  <label htmlFor="votRayTraceLLM" className="text-xs text-gray-700">
                    B: Ray Trace Visualization
                  </label>
                </div>
                
                {/* Option C - Hypothesis Testing - LLM mode only */}
                {mode === 'llm' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="votHypothesisLLM"
                      checked={votConfig.hypothesis}
                      onChange={(e) => setVotConfig(prev => ({ ...prev, hypothesis: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <label htmlFor="votHypothesisLLM" className="text-xs text-gray-700">
                      C: Hypothesis Verification
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* EXPERIMENT PANEL */}
      {experimentMode && (
        <div className="mb-3 p-4 bg-white rounded shadow w-full max-w-4xl">
          <h3 className="font-bold text-lg mb-3 text-rose-700">🧪 Experiment Mode</h3>
          
          {!experimentRunning ? (
            <div className="space-y-4">
              {/* Configuration */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Task Mode</label>
                  <select
                    value={experimentConfig.taskMode}
                    onChange={(e) => {
                      const newMode = e.target.value;
                      if (newMode === 'predict') {
                        // Reset hypothesis setting when switching to Predict mode
                        setExperimentConfig(prev => ({ ...prev, taskMode: newMode, allowHypotheses: false }));
                      } else {
                        setExperimentConfig(prev => ({ ...prev, taskMode: newMode }));
                      }
                    }}
                    className="w-full px-2 py-1 border rounded text-sm"
                  >
                    <option value="predict">Predict (Forward Reasoning)</option>
                    <option value="play">Play (Inverse Reasoning)</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prompt Style</label>
                  <select
                    value={experimentConfig.promptStyle}
                    onChange={(e) => setExperimentConfig(prev => ({ ...prev, promptStyle: e.target.value }))}
                    className="w-full px-2 py-1 border rounded text-sm"
                  >
                    {Object.entries(PROMPT_STYLES).map(([key, val]) => (
                      <option key={key} value={key}>{val.name}: {val.description}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              {/* Hypothesis marking toggle (Play mode only) */}
              {experimentConfig.taskMode === 'play' && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="allowHypotheses"
                    checked={experimentConfig.allowHypotheses}
                    onChange={(e) => {
                      if (e.target.checked) {
                        // Auto-enable visualization when hypotheses enabled
                        setExperimentConfig(prev => ({ ...prev, allowHypotheses: true, includeVisualization: true }));
                      } else {
                        setExperimentConfig(prev => ({ ...prev, allowHypotheses: false }));
                      }
                    }}
                    className="w-4 h-4"
                  />
                  <label htmlFor="allowHypotheses" className="text-sm text-gray-700">
                    Allow Hypothesis Marking
                    <span className="text-gray-500 ml-1">(LLM can mark/unmark hypothesized atom positions)</span>
                  </label>
                </div>
              )}
              
              {/* Visualization toggle */}
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="checkbox"
                  id="includeVisualization"
                  checked={experimentConfig.includeVisualization}
                  onChange={(e) => {
                    // Don't allow disabling visualization if hypotheses are enabled
                    if (!e.target.checked && experimentConfig.allowHypotheses) {
                      return;
                    }
                    setExperimentConfig(prev => ({ ...prev, includeVisualization: e.target.checked }));
                  }}
                  disabled={experimentConfig.allowHypotheses}
                  className="w-4 h-4"
                />
                <label htmlFor="includeVisualization" className={`text-sm ${experimentConfig.allowHypotheses ? 'text-gray-400' : 'text-gray-700'}`}>
                  Include Text Board Visualization
                  <span className="text-gray-500 ml-1">
                    ({experimentConfig.taskMode === 'predict' ? 'shows atom positions' : 'shows ray results only'})
                  </span>
                  {experimentConfig.allowHypotheses && (
                    <span className="text-gray-400 ml-1">(required for hypothesis marking)</span>
                  )}
                </label>
              </div>
              
              {/* Extended Thinking toggle */}
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="checkbox"
                  id="enableThinking"
                  checked={experimentConfig.enableThinking}
                  onChange={(e) => setExperimentConfig(prev => ({ ...prev, enableThinking: e.target.checked }))}
                  className="w-4 h-4"
                />
                <label htmlFor="enableThinking" className="text-sm text-gray-700">
                  Enable Extended Thinking
                </label>
                <select
                  value={experimentConfig.thinkingBudget}
                  onChange={(e) => setExperimentConfig(prev => ({ ...prev, thinkingBudget: parseInt(e.target.value) }))}
                  disabled={!experimentConfig.enableThinking}
                  className={`px-2 py-1 text-sm border border-gray-300 rounded ${!experimentConfig.enableThinking ? 'opacity-50' : ''}`}
                >
                  <option value={5000}>5K tokens</option>
                  <option value={10000}>10K tokens</option>
                  <option value={16000}>16K tokens</option>
                  <option value={32000}>32K tokens</option>
                  <option value={64000}>64K tokens</option>
                  <option value={128000}>128K tokens</option>
                </select>
              </div>
              
              {/* VoT (Visualization of Thinking) toggles */}
              <div className="mt-2 p-2 bg-purple-50 rounded border border-purple-200">
                <div className="text-xs font-semibold text-purple-700 mb-2">Visualization of Thinking (VoT) Prompts:</div>
                
                {/* Option A - Grid State - Play modes only */}
                {experimentConfig.taskMode === 'play' && (
                  <div className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      id="votGridState"
                      checked={experimentConfig.votGridState}
                      onChange={(e) => setExperimentConfig(prev => ({ ...prev, votGridState: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <label htmlFor="votGridState" className="text-xs text-gray-700">
                      A: Grid State Tracking
                      <span className="text-gray-500 ml-1">(draw grid with ?, X, * markers)</span>
                    </label>
                  </div>
                )}
                
                {/* Option B - Ray Trace - All modes */}
                <div className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    id="votRayTrace"
                    checked={experimentConfig.votRayTrace}
                    onChange={(e) => setExperimentConfig(prev => ({ ...prev, votRayTrace: e.target.checked }))}
                    className="w-3 h-3"
                  />
                  <label htmlFor="votRayTrace" className="text-xs text-gray-700">
                    B: Ray Trace Visualization
                    <span className="text-gray-500 ml-1">(draw ray path with arrows)</span>
                  </label>
                </div>
                
                {/* Option C - Hypothesis Testing - Play modes only */}
                {experimentConfig.taskMode === 'play' && (
                  <div className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      id="votHypothesis"
                      checked={experimentConfig.votHypothesis}
                      onChange={(e) => setExperimentConfig(prev => ({ ...prev, votHypothesis: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <label htmlFor="votHypothesis" className="text-xs text-gray-700">
                      C: Hypothesis Verification
                      <span className="text-gray-500 ml-1">(verify guesses against all rays)</span>
                    </label>
                  </div>
                )}
                
              </div>
              
              {/* Show Prompt Preview button */}
              <div>
                <button
                  onClick={() => setShowPromptPreview(!showPromptPreview)}
                  className="px-2 py-1 text-xs bg-purple-100 hover:bg-purple-200 rounded"
                >
                  {showPromptPreview ? 'Hide' : 'Show'} Prompt Preview
                </button>
              </div>
              
              {/* Prompt Preview */}
              {showPromptPreview && (
                <div className="mt-2 p-3 bg-gray-50 rounded border text-xs font-mono overflow-auto max-h-96">
                  <div className="mb-3">
                    <div className="font-bold text-purple-700 mb-1">System Prompt ({experimentConfig.promptStyle}{experimentConfig.taskMode === 'play' && experimentConfig.allowHypotheses ? ' + hypothesis' : ''}):</div>
                    <pre className="whitespace-pre-wrap bg-white p-2 rounded border text-gray-700 max-h-40 overflow-auto">
                      {(() => {
                        let prompt = PROMPT_STYLES[experimentConfig.promptStyle]?.[experimentConfig.taskMode === 'predict' ? 'predictPrompt' : 'playPrompt'] || 'N/A';
                        
                        // If Play mode with hypotheses, show modified prompt
                        if (experimentConfig.taskMode === 'play' && experimentConfig.allowHypotheses) {
                          // Handle baseline format
                          const baselineJsonSection = `Respond with JSON only:
{"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
{"action": "guess", "atoms": [[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}

When you think you know where all 4 balls are, make your guess.`;
                          
                          const baselineNewSection = `Respond with JSON only:
{"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
{"action": "mark", "row": 1-8, "col": 1-8, "reasoning": "..."} - mark where you think an atom is
{"action": "unmark", "row": 1-8, "col": 1-8, "reasoning": "..."} - remove a marked position
{"action": "check", "reasoning": "..."} - submit your answer (requires exactly 4 marked positions)

You must mark exactly 4 positions where you think the atoms are located. Use mark/unmark to adjust your guesses as you gather information. When you have exactly 4 positions marked and are confident, use the check action to submit your answer.`;

                          // Handle augmented format
                          const augmentedJsonSection = `Respond with JSON only:
Fire ray: {"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
Final guess: {"action": "guess", "atoms": [[row,col], [row,col], [row,col], [row,col]], "reasoning": "..."}

Max 20 rays. Be strategic and cross-reference observations.`;
                          
                          const augmentedNewSection = `Respond with JSON only:
Fire ray: {"action": "fire", "side": "north|south|east|west", "position": 1-8, "reasoning": "..."}
Mark atom: {"action": "mark", "row": 1-8, "col": 1-8, "reasoning": "..."} - mark where you think an atom is
Unmark: {"action": "unmark", "row": 1-8, "col": 1-8, "reasoning": "..."} - remove a marked position
Check: {"action": "check", "reasoning": "..."} - submit your answer (requires exactly 4 marked positions)

You must mark exactly 4 positions where you think the atoms are located. Use mark/unmark to refine your guesses. When you have exactly 4 positions marked and are confident, use check to submit. Max 20 rays. Be strategic and cross-reference observations.`;

                          if (prompt.includes(baselineJsonSection)) {
                            prompt = prompt.replace(baselineJsonSection, baselineNewSection);
                          } else if (prompt.includes(augmentedJsonSection)) {
                            prompt = prompt.replace(augmentedJsonSection, augmentedNewSection);
                          }
                        }
                        
                        // Add VoT prompts to preview
                        const votConfigForPreview = {
                          gridState: experimentConfig.taskMode === 'play' && experimentConfig.votGridState,
                          rayTrace: experimentConfig.votRayTrace,
                          hypothesis: experimentConfig.taskMode === 'play' && experimentConfig.votHypothesis,
                        };
                        prompt = buildPromptWithVoT(prompt, votConfigForPreview);
                        
                        return prompt;
                      })()}
                    </pre>
                  </div>
                  <div>
                    <div className="font-bold text-purple-700 mb-1">
                      Sample User Message ({experimentConfig.taskMode === 'predict' ? 'Predict' : 'Play'} mode, Config #1{experimentConfig.taskMode === 'predict' ? ', NORTH-3' : ''}):
                    </div>
                    <pre className="whitespace-pre-wrap bg-white p-2 rounded border text-gray-700">
                      {(() => {
                        const sampleConfig = EXPERIMENT_CONFIGS[0];
                        const sampleAtomSet = configToAtomSet(sampleConfig);
                        const atomList = sampleConfig.map(([r, c]) => `(${r},${c})`).join(', ');
                        
                        if (experimentConfig.taskMode === 'predict') {
                          let prompt = `Atoms are located at: ${atomList}\n\n`;
                          if (experimentConfig.includeVisualization) {
                            prompt += `Board (O = atom positions):\n\`\`\`\n`;
                            prompt += generateTextBoard([], 8, sampleAtomSet);
                            prompt += `\`\`\`\n\n`;
                          }
                          prompt += `A ray is fired from NORTH-3.\n\nTrace the ray step by step and predict where it will exit (or if it will be absorbed/reflected).`;
                          return prompt;
                        } else {
                          // Play mode sample - show after some rays fired
                          const sampleRays = [
                            { id: 1, entry: { side: 'north', pos: 3 }, exit: { side: 'south', pos: 3 }, absorbed: false },
                            { id: 2, entry: { side: 'west', pos: 5 }, exit: null, absorbed: true }
                          ];
                          const sampleHypotheses = experimentConfig.allowHypotheses ? new Set(['5,4']) : null;
                          
                          let ctx = "Current ray results:\n";
                          sampleRays.forEach(r => { ctx += formatRayResult(r) + "\n"; });
                          if (experimentConfig.includeVisualization) {
                            ctx += "\nBoard state:\n```\n";
                            ctx += generateTextBoard(sampleRays, 8, null, sampleHypotheses);
                            ctx += "```\n";
                          }
                          if (experimentConfig.allowHypotheses) {
                            if (sampleHypotheses && sampleHypotheses.size > 0) {
                              const hypList = Array.from(sampleHypotheses).map(k => `(${k})`).join(', ');
                              ctx += `\nHypothesized atom positions (${sampleHypotheses.size}/4): ${hypList}\n`;
                            } else {
                              ctx += `\nHypothesized atom positions: (none marked yet)\n`;
                            }
                          }
                          ctx += `\nUnavailable positions (already used as entry/exit): NORTH-3, SOUTH-3, WEST-5\n`;
                          ctx += `\nRays fired: 2/20\n\nDecide your next action. JSON only.`;
                          return ctx;
                        }
                      })()}
                    </pre>
                  </div>
                  {experimentConfig.taskMode === 'play' && (
                    <div className="mt-3 p-2 bg-blue-50 rounded text-xs">
                      <div className="font-bold text-blue-700 mb-1">Available Actions (JSON format):</div>
                      <div className="text-gray-700">
                        <div>• Fire ray: {`{"action": "fire", "side": "north", "position": 5, "reasoning": "..."}`}</div>
                        <div>• Final guess: {`{"action": "guess", "atoms": [[r1,c1], [r2,c2], [r3,c3], [r4,c4]], "reasoning": "..."}`}</div>
                        {experimentConfig.allowHypotheses && (
                          <>
                            <div className="text-green-700">• Mark hypothesis: {`{"action": "mark", "row": 3, "col": 5, "reasoning": "..."}`}</div>
                            <div className="text-green-700">• Unmark hypothesis: {`{"action": "unmark", "row": 3, "col": 5, "reasoning": "..."}`}</div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Models */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Models to Test
                  <button
                    onClick={() => setExperimentConfig(prev => ({ ...prev, modelsToTest: modelOptions.map(m => m.id) }))}
                    className="ml-2 text-xs text-blue-600 hover:underline"
                  >
                    all
                  </button>
                  <button
                    onClick={() => setExperimentConfig(prev => ({ ...prev, modelsToTest: [] }))}
                    className="ml-1 text-xs text-blue-600 hover:underline"
                  >
                    none
                  </button>
                </label>
                <div className="flex gap-2 flex-wrap">
                  {modelOptions.map(m => (
                    <label key={m.id} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={experimentConfig.modelsToTest.includes(m.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setExperimentConfig(prev => ({ ...prev, modelsToTest: [...prev.modelsToTest, m.id] }));
                          } else {
                            setExperimentConfig(prev => ({ ...prev, modelsToTest: prev.modelsToTest.filter(id => id !== m.id) }));
                          }
                        }}
                        className="rounded"
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              </div>
              
              {/* Configurations */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Atom Configurations (10 available, same for all models)
                  <button
                    onClick={() => setExperimentConfig(prev => ({ ...prev, configIndices: EXPERIMENT_CONFIGS.map((_, i) => i) }))}
                    className="ml-2 text-xs text-blue-600 hover:underline"
                  >
                    all
                  </button>
                  <button
                    onClick={() => setExperimentConfig(prev => ({ ...prev, configIndices: [] }))}
                    className="ml-1 text-xs text-blue-600 hover:underline"
                  >
                    none
                  </button>
                </label>
                <div className="flex gap-2 flex-wrap">
                  {EXPERIMENT_CONFIGS.map((config, idx) => (
                    <div key={idx} className="flex items-center gap-1 text-sm border rounded px-2 py-1 bg-gray-50">
                      <input
                        type="checkbox"
                        checked={experimentConfig.configIndices.includes(idx)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setExperimentConfig(prev => ({ ...prev, configIndices: [...prev.configIndices, idx].sort((a,b) => a-b) }));
                          } else {
                            setExperimentConfig(prev => ({ ...prev, configIndices: prev.configIndices.filter(i => i !== idx) }));
                          }
                        }}
                        className="rounded"
                      />
                      <span>#{idx + 1}</span>
                      <button
                        onClick={() => {
                          setAtoms(configToAtomSet(config));
                          setRays([]);
                          setRayCounter(1);
                          setGuesses(new Set());
                          setGameChecked(false);
                          setMode('sandbox');
                        }}
                        className="text-xs text-blue-600 hover:underline ml-1"
                        title={`Atoms: ${config.map(([r,c]) => `(${r},${c})`).join(', ')}`}
                      >
                        preview
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Selected configs: {experimentConfig.configIndices.length} × {experimentConfig.modelsToTest.length} models = {experimentConfig.configIndices.length * experimentConfig.modelsToTest.length} experiment runs
                </p>
              </div>
              
              {/* Estimated time */}
              <div className="bg-gray-50 p-2 rounded text-sm">
                <strong>Estimated duration:</strong>{' '}
                {experimentConfig.taskMode === 'predict' 
                  ? `~${Math.ceil(experimentConfig.configIndices.length * experimentConfig.modelsToTest.length * 22 * 3 / 60)} minutes (~22 unique rays × ${experimentConfig.configIndices.length} configs × ${experimentConfig.modelsToTest.length} models)`
                  : `~${Math.ceil(experimentConfig.configIndices.length * experimentConfig.modelsToTest.length * 15 * 5 / 60)} minutes (~15 rays × ${experimentConfig.configIndices.length} configs × ${experimentConfig.modelsToTest.length} models)`
                }
              </div>
              
              {/* Run button */}
              <div className="flex gap-2">
                <button
                  onClick={runFullExperiment}
                  disabled={experimentConfig.modelsToTest.length === 0 || experimentConfig.configIndices.length === 0}
                  className="px-4 py-2 bg-rose-600 text-white rounded hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  🚀 Run Experiment
                </button>
              </div>

              {/* Rerun Failures Section */}
              <details className="border rounded p-3 bg-amber-50">
                <summary className="cursor-pointer font-medium text-amber-800">
                  🔄 Rerun Failed Predictions
                </summary>
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-gray-600">
                    Load a previous experiment JSON file to rerun only the predictions that failed due to API errors.
                  </p>

                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium">Load JSON file:</label>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleLoadRerunFile}
                      className="text-sm"
                    />
                  </div>

                  {rerunSourceData && (
                    <div className="bg-white p-2 rounded border text-sm">
                      <div><strong>Loaded:</strong> {rerunSourceData.results?.length || 0} results</div>
                      <div><strong>Failed predictions:</strong> {rerunFailures.length}</div>
                      {rerunFailures.length > 0 && (
                        <div className="mt-2 max-h-32 overflow-y-auto text-xs font-mono">
                          {rerunFailures.map((f, i) => (
                            <div key={i}>
                              Config {f.configIndex}, {f.modelName}, {f.rayEntry.side.toUpperCase()}-{f.rayEntry.pos}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={runRerunFailures}
                      disabled={!rerunSourceData || rerunFailures.length === 0}
                      className="px-3 py-1 bg-amber-600 text-white rounded text-sm hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      🔄 Rerun {rerunFailures.length} Failures
                    </button>
                    <button
                      onClick={exportRerunResults}
                      disabled={!rerunSourceData}
                      className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      💾 Export Updated JSON
                    </button>
                    {rerunSourceData && (
                      <button
                        onClick={() => {
                          setRerunSourceData(null);
                          setRerunFailures([]);
                        }}
                        className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
                      >
                        ✕ Clear
                      </button>
                    )}
                  </div>
                </div>
              </details>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Progress */}
              <div className="bg-rose-50 p-3 rounded">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">Running...</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600">
                      Config {experimentProgress.currentConfigIndex}/{experimentProgress.totalConfigs}, 
                      Model {experimentProgress.currentModelIndex}/{experimentProgress.totalModels}
                    </span>
                    <button
                      onClick={() => {
                        shouldStopExperiment.current = true;
                        addExperimentLog('Stop requested...');
                      }}
                      className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
                    >
                      ⏹ Stop
                    </button>
                    {experimentPausedForRateLimit && (
                      <button
                        onClick={handleResumeExperiment}
                        className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600 animate-pulse"
                      >
                        ▶️ Resume
                      </button>
                    )}
                  </div>
                </div>
                {experimentPausedForRateLimit && (
                  <div className="text-amber-600 font-medium">⏸️ Paused - Rate limit reached. Click Resume when ready.</div>
                )}
                <div className="text-sm text-gray-700">{experimentProgress.status}</div>
                <div className="w-full bg-gray-200 rounded h-2 mt-2">
                  <div 
                    className="bg-rose-600 h-2 rounded transition-all"
                    style={{ 
                      width: `${((experimentProgress.currentModelIndex - 1) * experimentProgress.totalConfigs + experimentProgress.currentConfigIndex) / (experimentProgress.totalModels * experimentProgress.totalConfigs) * 100}%` 
                    }}
                  />
                </div>
              </div>
              
              {/* Log */}
              <div 
                className="bg-gray-900 text-green-400 p-3 rounded font-mono text-xs max-h-64 overflow-y-auto"
                ref={el => { if (el) el.scrollTop = el.scrollHeight; }}
              >
                {experimentProgress.log.map((line, i) => (
                  <div key={i} className={line.includes('⚠️') || line.includes('Error') ? 'text-red-400' : line.includes('✓') ? 'text-green-400' : line.includes('✗') ? 'text-yellow-400' : ''}>{line}</div>
                ))}
              </div>
            </div>
          )}
          
          {/* Results */}
          {experimentResults.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-semibold">Results ({experimentResults.length} runs)</h4>
                <div className="flex gap-2">
                  <button
                    onClick={() => exportExperimentResults('html')}
                    className="px-3 py-1 bg-rose-500 text-white rounded text-sm hover:bg-rose-600"
                  >
                    📄 Export HTML
                  </button>
                  <button
                    onClick={() => exportExperimentResults('json')}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                  >
                    📥 Export JSON
                  </button>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-2 py-1 text-left">Model</th>
                      <th className="px-2 py-1 text-left">Config</th>
                      <th className="px-2 py-1 text-left">Mode</th>
                      <th className="px-2 py-1 text-left">Prompt</th>
                      {experimentConfig.taskMode === 'predict' ? (
                        <th className="px-2 py-1 text-right">Accuracy</th>
                      ) : (
                        <>
                          <th className="px-2 py-1 text-right">Atoms</th>
                          <th className="px-2 py-1 text-right">Score</th>
                          <th className="px-2 py-1 text-right">Rays</th>
                          {experimentConfig.allowHypotheses && (
                            <th className="px-2 py-1 text-right">Hyp</th>
                          )}
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {experimentResults.map((r, i) => (
                      <tr key={i} className="border-b">
                        <td className="px-2 py-1">{r.modelName}</td>
                        <td className="px-2 py-1">{r.configIndex + 1}</td>
                        <td className="px-2 py-1">{r.mode}</td>
                        <td className="px-2 py-1">{r.promptCondition}</td>
                        {r.mode === 'predict' ? (
                          <td className="px-2 py-1 text-right font-mono">
                            {r.predictions.filter(p => p.correct).length}/{r.predictions.length} 
                            ({(r.predictions.filter(p => p.correct).length / r.predictions.length * 100).toFixed(1)}%)
                          </td>
                        ) : (
                          <>
                            <td className="px-2 py-1 text-right font-mono">{r.atomsCorrect}/4</td>
                            <td className="px-2 py-1 text-right font-mono">{r.score || 0}</td>
                            <td className="px-2 py-1 text-right font-mono">{r.raysUsed}</td>
                            {experimentConfig.allowHypotheses && (
                              <td className="px-2 py-1 text-right font-mono">{r.hypothesisActions || 0}</td>
                            )}
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Summary stats */}
              {experimentResults.length > 1 && (
                <div className="mt-3 p-2 bg-gray-50 rounded text-sm">
                  <strong>Summary:</strong>{' '}
                  {experimentConfig.taskMode === 'predict' ? (
                    <>
                      Mean accuracy: {(experimentResults.reduce((sum, r) => sum + r.predictions.filter(p => p.correct).length / r.predictions.length, 0) / experimentResults.length * 100).toFixed(1)}%
                    </>
                  ) : (
                    <>
                      Mean atoms correct: {(experimentResults.reduce((sum, r) => sum + r.atomsCorrect, 0) / experimentResults.length).toFixed(2)}/4,
                      Mean score: {(experimentResults.reduce((sum, r) => sum + (r.score || 0), 0) / experimentResults.length).toFixed(1)},
                      Mean rays used: {(experimentResults.reduce((sum, r) => sum + r.raysUsed, 0) / experimentResults.length).toFixed(1)}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      
      {mode === 'play' && (
        <button onClick={() => setGameChecked(true)} disabled={guesses.size !== NUM_ATOMS || gameChecked}
          className={`mb-3 px-4 py-2 rounded font-semibold ${guesses.size === NUM_ATOMS && !gameChecked ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-gray-300 text-gray-500'}`}>
          Check ({guesses.size}/{NUM_ATOMS})
        </button>
      )}
      
      {mode === 'llm' && !gameChecked && (
        <button onClick={runLlmFull} disabled={llmRunning}
          className={`mb-3 px-4 py-2 rounded font-semibold ${!llmRunning ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-gray-300 text-gray-500'}`}>
          {llmRunning ? `${modelOptions.find(m => m.id === selectedModel)?.name} is thinking...` : `Let ${modelOptions.find(m => m.id === selectedModel)?.name} Play`}
        </button>
      )}
      
      {gameChecked && (
        <div className="mb-3 p-2 bg-white rounded shadow flex items-center gap-3 flex-wrap">
          <span className="font-semibold">{correctGuesses.size}/{NUM_ATOMS} correct!</span>
          <span className="text-sm text-gray-600">
            Score: {(() => {
              const scoreInfo = calculateScore(rays, correctGuesses.size, NUM_ATOMS);
              return `${scoreInfo.total} (${scoreInfo.rayPoints} ray + ${scoreInfo.missedPenalty} miss)`;
            })()}
          </span>
          <button onClick={() => saveResults('html')} className="px-3 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600 text-sm">
            Save Report
          </button>
          <button onClick={() => saveResults('json')} className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm">
            Save JSON
          </button>
        </div>
      )}
      
      <svg width={totalSize} height={totalSize} className="bg-white border border-gray-300">
        {Array.from({ length: GRID_SIZE }, (_, r) =>
          Array.from({ length: GRID_SIZE }, (_, c) => {
            const row = r + 1, col = c + 1, key = getKey(row, col);
            let fill = 'white';
            if (correctGuesses.has(key)) fill = '#86efac';
            else if (wrongGuesses.has(key)) fill = '#fca5a5';
            else if (missedAtoms.has(key)) fill = '#fde047';
            else if (guesses.has(key) && !gameChecked) fill = '#bfdbfe';
            
            return (
              <rect key={`c-${r}-${c}`} x={edgeSize + c * cellSize} y={edgeSize + r * cellSize}
                width={cellSize} height={cellSize} fill={fill} stroke="#ccc"
                className={mode === 'play' && !gameChecked ? 'cursor-pointer hover:fill-blue-100' : ''}
                onClick={() => handleCellClick(row, col)} />
            );
          })
        )}
        
        {showAtoms && !experimentRunning && Array.from(atoms).map(key => {
          const [row, col] = key.split(',').map(Number);
          return <circle key={`a-${key}`} cx={edgeSize + (col - 0.5) * cellSize} cy={edgeSize + (row - 0.5) * cellSize} r={cellSize * 0.35} fill="#333" />;
        })}
        
        {/* Experiment mode atoms */}
        {experimentRunning && experimentConfig.taskMode === 'predict' && Array.from(experimentAtoms).map(key => {
          const [row, col] = key.split(',').map(Number);
          return <circle key={`ea-${key}`} cx={edgeSize + (col - 0.5) * cellSize} cy={edgeSize + (row - 0.5) * cellSize} r={cellSize * 0.35} fill="#333" />;
        })}
        
        {/* Experiment mode hypotheses (Play mode) - shown as X marks */}
        {experimentRunning && experimentConfig.taskMode === 'play' && Array.from(experimentHypotheses).map(key => {
          const [row, col] = key.split(',').map(Number);
          const cx = edgeSize + (col - 0.5) * cellSize, cy = edgeSize + (row - 0.5) * cellSize, s = cellSize * 0.25;
          return (
            <g key={`eh-${key}`}>
              <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke="#10b981" strokeWidth="3"/>
              <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke="#10b981" strokeWidth="3"/>
            </g>
          );
        })}
        
        {(mode === 'play' || mode === 'llm') && !gameChecked && Array.from(guesses).map(key => {
          const [row, col] = key.split(',').map(Number);
          const cx = edgeSize + (col - 0.5) * cellSize, cy = edgeSize + (row - 0.5) * cellSize, s = cellSize * 0.25;
          return (
            <g key={`g-${key}`}>
              <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke={mode==='llm'?'#f59e0b':'#3b82f6'} strokeWidth="3"/>
              <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke={mode==='llm'?'#f59e0b':'#3b82f6'} strokeWidth="3"/>
            </g>
          );
        })}
        
        {gameChecked && Array.from(wrongGuesses).map(key => {
          const [row, col] = key.split(',').map(Number);
          const cx = edgeSize + (col - 0.5) * cellSize, cy = edgeSize + (row - 0.5) * cellSize, s = cellSize * 0.25;
          return (
            <g key={`w-${key}`}>
              <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke="#ef4444" strokeWidth="3"/>
              <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke="#ef4444" strokeWidth="3"/>
            </g>
          );
        })}
        
        {gameChecked && Array.from(correctGuesses).map(key => {
          const [row, col] = key.split(',').map(Number);
          return <text key={`ok-${key}`} x={edgeSize+(col-0.5)*cellSize} y={edgeSize+(row-0.5)*cellSize} textAnchor="middle" dominantBaseline="middle" fontSize="24" fill="#16a34a" fontWeight="bold">✓</text>;
        })}
        
        {(mode === 'sandbox' || mode === 'predict') && !experimentRunning && rays.map(ray => {
          // In predict mode, color based on prediction correctness
          let strokeColor = ray.absorbed ? '#ef4444' : '#3b82f6'; // default: red for absorbed, blue otherwise
          if (mode === 'predict') {
            const rayKey = `${ray.entry.side.toUpperCase()}-${ray.entry.pos}`;
            const prediction = predictLog.find(p => p.ray === rayKey);
            if (prediction) {
              strokeColor = prediction.correct ? '#3b82f6' : '#ef4444'; // blue if correct, red if wrong
            }
          }
          return (
            <g key={`p-${ray.id}`}>
              {ray.path.length > 0 && (
                <polyline
                  points={[getEdgePos(ray.entry.side, ray.entry.pos), ...ray.path.map(([r,c])=>({x:edgeSize+(c-0.5)*cellSize,y:edgeSize+(r-0.5)*cellSize})), ray.exit&&!ray.absorbed?getEdgePos(ray.exit.side,ray.exit.pos):null].filter(Boolean).map(p=>`${p.x},${p.y}`).join(' ')}
                  fill="none" stroke={strokeColor} strokeWidth="2" strokeDasharray={ray.absorbed?'5,5':'none'} opacity="0.6"/>
              )}
            </g>
          );
        })}
        
        {/* Experiment mode rays */}
        {experimentRunning && experimentConfig.taskMode === 'predict' && experimentRays.map(ray => {
          const rayKey = `${ray.entry.side.toUpperCase()}-${ray.entry.pos}`;
          const prediction = experimentPredictions.find(p => p.ray === rayKey);
          const strokeColor = prediction?.correct ? '#3b82f6' : '#ef4444'; // blue if correct, red if wrong
          return (
            <g key={`ep-${ray.id}`}>
              {ray.path.length > 0 && (
                <polyline
                  points={[getEdgePos(ray.entry.side, ray.entry.pos), ...ray.path.map(([r,c])=>({x:edgeSize+(c-0.5)*cellSize,y:edgeSize+(r-0.5)*cellSize})), ray.exit&&!ray.absorbed?getEdgePos(ray.exit.side,ray.exit.pos):null].filter(Boolean).map(p=>`${p.x},${p.y}`).join(' ')}
                  fill="none" stroke={strokeColor} strokeWidth="2" strokeDasharray={ray.absorbed?'5,5':'none'} opacity="0.6"/>
              )}
            </g>
          );
        })}
        
        {/* Experiment mode rays (Play mode) */}
        {experimentRunning && experimentConfig.taskMode === 'play' && experimentRays.map(ray => {
          return (
            <g key={`epr-${ray.id}`}>
              {ray.path.length > 0 && (
                <polyline
                  points={[getEdgePos(ray.entry.side, ray.entry.pos), ...ray.path.map(([r,c])=>({x:edgeSize+(c-0.5)*cellSize,y:edgeSize+(r-0.5)*cellSize})), ray.exit&&!ray.absorbed?getEdgePos(ray.exit.side,ray.exit.pos):null].filter(Boolean).map(p=>`${p.x},${p.y}`).join(' ')}
                  fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray={ray.absorbed?'5,5':'none'} opacity="0.6"/>
              )}
            </g>
          );
        })}
        
        {['north','south','east','west'].map(side =>
          Array.from({length:GRID_SIZE},(_,i)=>{
            const pos=i+1, {x,y}=getEdgePos(side,pos);
            // Use experiment markers when running any experiment, otherwise regular markers
            const ml = experimentRunning 
              ? (experimentMarkers[`${side}-${pos}`]||[])
              : (markers[`${side}-${pos}`]||[]);
            const isUsed = usedPositions.has(`${side}-${pos}`);
            return (
              <g key={`e-${side}-${pos}`}>
                <rect x={x-12} y={y-12} width={24} height={24} fill={isUsed ? "#e5e7eb" : "transparent"}
                  className={mode!=='llm' && !isUsed && !predicting ?"cursor-pointer hover:fill-blue-100":""}
                  onClick={()=>handleFireRay(side,pos)}/>
                <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill={isUsed ? "#9ca3af" : "#666"} className="pointer-events-none">{pos}</text>
                {ml.map((m,idx)=>{
                  const off=(idx-(ml.length-1)/2)*8;
                  let col,sym;
                  if(m.type==='reflect'){col='#f59e0b';sym='R';}
                  else if(m.type==='entry'&&m.absorbed){col='#ef4444';sym='H';}
                  else{col='#22c55e';sym=m.id;}
                  
                  // In predict mode or experiment predict mode, override color based on prediction correctness
                  if (mode === 'predict') {
                    // Find the ray with this ID to get its entry point
                    const ray = rays.find(r => r.id === m.id);
                    if (ray) {
                      const rayKey = `${ray.entry.side.toUpperCase()}-${ray.entry.pos}`;
                      const prediction = predictLog.find(p => p.ray === rayKey);
                      if (prediction) {
                        col = prediction.correct ? '#3b82f6' : '#ef4444'; // blue if correct, red if wrong
                      }
                    }
                  }
                  
                  // For experiment mode predictions
                  if (m.isExperiment) {
                    const ray = experimentRays.find(r => r.id === m.id);
                    if (ray) {
                      const rayKey = `${ray.entry.side.toUpperCase()}-${ray.entry.pos}`;
                      const prediction = experimentPredictions.find(p => p.ray === rayKey);
                      if (prediction) {
                        col = prediction.correct ? '#3b82f6' : '#ef4444'; // blue if correct, red if wrong
                      }
                    }
                  }
                  
                  const mx=side==='north'||side==='south'?x+off:x;
                  const my=side==='east'||side==='west'?y+off:y;
                  const lo=side==='north'?-18:side==='south'?18:side==='west'?-20:20;
                  return <text key={`m-${m.type}-${m.id}-${idx}`} x={side==='east'||side==='west'?mx+lo:mx} y={side==='north'||side==='south'?my+lo:my} textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight="bold" fill={col}>{sym}</text>;
                })}
              </g>
            );
          })
        )}
      </svg>
      
      <div className="mt-3 text-xs text-gray-600 max-w-md">
        {(mode === 'predict' || (experimentRunning && experimentConfig.taskMode === 'predict')) ? (
          <span><span className="text-blue-500 font-bold">Blue</span>=Correct prediction | <span className="text-red-500 font-bold">Red</span>=Wrong prediction | <span className="font-bold">R</span>=Reflect | <span className="font-bold">H</span>=Hit</span>
        ) : (
          <span><span className="text-green-500 font-bold">Numbers</span>=Entry/Exit | <span className="text-yellow-500 font-bold">R</span>=Reflect | <span className="text-red-500 font-bold">H</span>=Hit</span>
        )}
        {mode==='play'&&<span> | Click cells to guess</span>}
      </div>
      
      {/* Experiment status display */}
      {experimentRunning && experimentConfig.taskMode === 'predict' && (
        <div className="mt-2 p-2 bg-rose-100 rounded text-sm max-w-md">
          <div className="font-semibold text-rose-700">
            🧪 Testing: Config #{experimentProgress.currentConfigIndex} | {experimentProgress.status}
          </div>
          <div className="text-xs text-gray-600 mt-1">
            Atoms: {Array.from(experimentAtoms).map(k => `(${k})`).join(', ')}
          </div>
          <div className="text-xs mt-1">
            <span className="text-blue-600 font-medium">{experimentPredictions.filter(p => p.correct).length} correct</span>
            {' / '}
            <span className="text-red-600 font-medium">{experimentPredictions.filter(p => !p.correct).length} wrong</span>
            {' / '}
            <span>{experimentRays.length} tested</span>
          </div>
        </div>
      )}
      
      {/* Experiment status display for Play mode */}
      {experimentRunning && experimentConfig.taskMode === 'play' && (
        <div className="mt-2 p-2 bg-amber-100 rounded text-sm max-w-md">
          <div className="font-semibold text-amber-700">
            🧪 Playing: Config #{experimentProgress.currentConfigIndex} | {experimentProgress.status}
          </div>
          <div className="text-xs text-gray-600 mt-1">
            Atoms (hidden): {Array.from(experimentAtoms).map(k => `(${k})`).join(', ')}
          </div>
          <div className="text-xs mt-1">
            <span className="text-blue-600 font-medium">{experimentRays.length} rays fired</span>
            {experimentConfig.allowHypotheses && (
              <>
                {' | '}
                <span className="text-green-600 font-medium">{experimentHypotheses.size} hypotheses</span>
              </>
            )}
          </div>
        </div>
      )}
      
      {mode === 'llm' && llmLog.length > 0 && (
        <div className="mt-3 p-3 bg-white rounded shadow max-w-lg w-full">
          <h2 className="font-semibold mb-2 text-sm">{modelOptions.find(m => m.id === selectedModel)?.name}'s Reasoning:</h2>
          <div className="text-xs space-y-2 max-h-64 overflow-y-auto">
            {llmLog.map((e,i) => (
              <div key={i} className={`p-2 rounded ${e.type==='error'?'bg-red-100':e.type==='guess'?'bg-green-100':'bg-blue-50'}`}>
                <div className="font-medium">{e.content}</div>
                {e.result && <div className="text-gray-600 mt-0.5">{e.result}</div>}
                {e.reasoning && <div className="text-gray-500 mt-0.5 italic">"{e.reasoning}"</div>}
                {e.thinking && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-purple-600 hover:text-purple-800 text-xs">Show thinking...</summary>
                    <div className="mt-1 p-2 bg-purple-50 rounded text-gray-700 whitespace-pre-wrap text-xs max-h-40 overflow-y-auto">{e.thinking}</div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {mode === 'predict' && (
        <div className="mt-3 p-3 bg-white rounded shadow max-w-lg w-full">
          <h2 className="font-semibold mb-2 text-sm">
            Prediction Mode - {modelOptions.find(m => m.id === selectedModel)?.name} predicts ray outcomes
            {predicting && <span className="ml-2 text-cyan-600">(Thinking...)</span>}
          </h2>
          <p className="text-xs text-gray-500 mb-2">Click edge positions to fire rays. {modelOptions.find(m => m.id === selectedModel)?.name} will predict the outcome before seeing the result.</p>
          {predictLog.length > 0 && (
            <div className="text-xs space-y-2 max-h-64 overflow-y-auto">
              <div className="flex items-center gap-3 mb-2">
                <span className="font-medium text-gray-700">
                  Score: {predictLog.filter(p => p.correct).length}/{predictLog.length} correct
                </span>
                <button onClick={() => saveResults('predict-html')} className="px-2 py-1 bg-cyan-500 text-white rounded hover:bg-cyan-600 text-xs">
                  Save Report
                </button>
                <button onClick={() => saveResults('json')} className="px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs">
                  Save JSON
                </button>
              </div>
              {predictLog.map((p, i) => (
                <div key={i} className={`p-2 rounded ${p.correct ? 'bg-green-100' : 'bg-red-100'}`}>
                  <div className="font-medium">Ray: {p.ray}</div>
                  <div className="mt-0.5">
                    <span className="text-gray-600">Predicted:</span> {p.predicted}
                  </div>
                  <div className="mt-0.5">
                    <span className="text-gray-600">Actual:</span> {p.actual}
                  </div>
                  <div className={`mt-0.5 font-semibold ${p.correct ? 'text-green-700' : 'text-red-700'}`}>
                    {p.correct ? '✓ Correct' : '✗ Wrong'}
                  </div>
                  {p.reasoning && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-gray-500 hover:text-gray-700 text-xs">Show reasoning...</summary>
                      <div className="mt-1 p-2 bg-gray-50 rounded text-gray-600 text-xs">{p.reasoning}</div>
                    </details>
                  )}
                  {p.thinking && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-purple-600 hover:text-purple-800 text-xs">Show thinking...</summary>
                      <div className="mt-1 p-2 bg-purple-50 rounded text-gray-700 whitespace-pre-wrap text-xs max-h-40 overflow-y-auto">{p.thinking}</div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {rays.length > 0 && mode !== 'llm' && (
        <div className="mt-3 p-3 bg-white rounded shadow max-w-md w-full">
          <h2 className="font-semibold mb-1 text-sm">Ray Log:</h2>
          <div className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
            {rays.map(r => (
              <div key={r.id} className="font-mono">
                {r.id}: {r.entry.side.toUpperCase()}-{r.entry.pos} → {r.absorbed?<span className="text-red-500">ABSORBED</span>:r.entry.side===r.exit?.side&&r.entry.pos===r.exit?.pos?<span className="text-yellow-500">REFLECTED</span>:<span className="text-green-500">{r.exit?.side.toUpperCase()}-{r.exit?.pos}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Help Modal */}
      {showHelp && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center"
          onClick={() => setShowHelp(false)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl mx-4 flex flex-col"
            style={{ maxWidth: '48rem', maxHeight: '85vh', width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex-shrink-0 border-b px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Black Box Help</h2>
              <button 
                onClick={() => setShowHelp(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold leading-none"
              >
                ×
              </button>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {/* Game Overview */}
              <section>
                <h3 className="text-lg font-semibold text-blue-700 mb-2">🎯 Game Overview</h3>
                <p className="text-sm text-gray-700">
                  Black Box is a game of hide and seek played on an 8×8 grid. Four atoms (balls) are hidden inside the box. 
                  Your goal is to deduce their positions by firing rays into the box and observing how they behave.
                </p>
              </section>
              
              {/* Ray Behaviors */}
              <section>
                <h3 className="text-lg font-semibold text-blue-700 mb-2">💡 Ray Behaviors</h3>
                <div className="space-y-3 text-sm text-gray-700">
                  <div>
                    <span className="font-semibold text-green-600">DETOUR:</span> The ray enters at one point and exits at another. 
                    Entry and exit points are marked with matching numbers.
                  </div>
                  <div>
                    <span className="font-semibold text-yellow-600">REFLECTION (R):</span> The ray emerges from the same point it entered. 
                    This happens when a ray would be deflected back toward its origin.
                  </div>
                  <div>
                    <span className="font-semibold text-red-600">HIT (H):</span> The ray strikes an atom directly and is absorbed. 
                    It does not emerge from the box.
                  </div>
                </div>
              </section>
              
              {/* Deflection Rules */}
              <section>
                <h3 className="text-lg font-semibold text-blue-700 mb-2">↪️ Deflection Rules</h3>
                <p className="text-sm text-gray-700 mb-2">
                  As a ray approaches an atom, it is deflected 90 degrees. Rays can be deflected multiple times.
                  The deflection occurs when an atom is diagonally ahead of the ray's path.
                </p>
                <pre className="text-xs bg-gray-100 p-3 rounded font-mono overflow-x-auto whitespace-pre">
{`    1                                            
  - * - - - - - -         - - - - - - - -         - - - - - - - -       
  - * - - - - - -         - - - - - - - -         - - - - - - - -       
1 * * - - - - - -         - - - - - - - -         - O - - - - O -       
  - - O - - - - -         - - O - - - - -         - - * * * * - -
  - - - - - - - -         - - - * * * * * 2     3 * * * - - * - -
  - - - - - - - -         - - - * - - - -         - - - O - * - -      
  - - - - - - - -         - - - * - - - -         - - - - * * - -       
  - - - - - - - -         - - - * - - - -         - - - - * - O -       
                                2                         3`}
                </pre>
              </section>
              
              {/* Reflection Examples */}
              <section>
                <h3 className="text-lg font-semibold text-blue-700 mb-2">🔄 Reflection Examples</h3>
                <pre className="text-xs bg-gray-100 p-3 rounded font-mono overflow-x-auto whitespace-pre">
{`  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - O - - -         - - O - O - - -          - - - - - - - -
R * * * * - - - -         - - - * - - - -          O - - - - - - -
  - - - - O - - -         - - - * - - - -        R - - - - - - - -
  - - - - - - - -         - - - * - - - -          - - - - - - - -
  - - - - - - - -         - - - * - - - -          - - - - - - - -
  - - - - - - - -       R * * * * - - - -          - - - - - - - -
  - - - - - - - -         - - - - O - - -          - - - - - - - -`}
                </pre>
                <p className="text-xs text-gray-600 mt-1">
                  Edge reflection (right) occurs when an atom is adjacent to the entry point.
                </p>
              </section>
              
              {/* Hit Examples */}
              <section>
                <h3 className="text-lg font-semibold text-blue-700 mb-2">💥 Hit Examples</h3>
                <pre className="text-xs bg-gray-100 p-3 rounded font-mono overflow-x-auto whitespace-pre">
{`  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - O - - -
  - - - - - - - -         - - - - O - - -        H * * * * - - - -
  - - - - - - - -       H * * * * O - - -          - - - * - - - -
  - - - - - - - -         - - - - O - - -          - - - O - - - -
H * * * O - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - - - - -
  - - - - - - - -         - - - - - - - -          - - - - - - - -`}
                </pre>
                <p className="text-xs text-gray-600 mt-2 mb-2">
                  <strong>Important:</strong> A hit takes priority over a reflection. If an atom is in the entry cell, 
                  the ray is absorbed even if there are also atoms diagonally adjacent that would otherwise cause a reflection:
                </p>
                <pre className="text-xs bg-gray-100 p-3 rounded font-mono overflow-x-auto whitespace-pre">
{`  O - - - - - - -
H O - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -
  - - - - - - - -`}
                </pre>
                <p className="text-xs text-gray-600 mt-1">
                  Even though row 1 has an atom that would normally cause an edge reflection, 
                  the atom at row 2 absorbs the ray first.
                </p>
              </section>
              
              {/* Game Modes */}
              <section>
                <h3 className="text-lg font-semibold text-blue-700 mb-2">🎮 Game Modes</h3>
                <div className="space-y-2 text-sm">
                  <div className="p-2 bg-green-50 rounded">
                    <span className="font-semibold text-green-700">Play:</span> Human player mode. Fire rays by clicking edge positions, 
                    then click cells to mark your guesses. Click "Check" to see how you did.
                  </div>
                  <div className="p-2 bg-purple-50 rounded">
                    <span className="font-semibold text-purple-700">Sandbox:</span> Atoms are visible. Use this to explore how rays 
                    interact with different atom configurations.
                  </div>
                  <div className="p-2 bg-amber-50 rounded">
                    <span className="font-semibold text-amber-700">LLM:</span> Watch an AI play the game. The LLM fires rays, 
                    reasons about the results, and makes guesses.
                  </div>
                  <div className="p-2 bg-cyan-50 rounded">
                    <span className="font-semibold text-cyan-700">Predict:</span> Test the LLM's understanding of ray physics. 
                    Given visible atoms, can it predict where rays will exit?
                  </div>
                  <div className="p-2 bg-rose-50 rounded">
                    <span className="font-semibold text-rose-700">Experiment:</span> Run systematic experiments across multiple 
                    configurations to measure LLM performance with different settings.
                  </div>
                </div>
              </section>
              
              {/* Rules */}
              <section>
                <h3 className="text-lg font-semibold text-blue-700 mb-2">📋 Rules</h3>
                <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
                  <li>You cannot fire from positions already used as entry or exit points</li>
                  <li>Maximum 20 rays per game</li>
                  <li>There are always exactly 4 hidden atoms</li>
                  <li>Atoms can be anywhere on the 8×8 grid (rows 1-8, columns 1-8)</li>
                </ul>
              </section>
              
              {/* Scoring */}
              <section>
                <h3 className="text-lg font-semibold text-blue-700 mb-2">🏆 Scoring</h3>
                <p className="text-sm text-gray-700 mb-2">
                  <strong>Goal: Minimize your score.</strong> Lower is better!
                </p>
                <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
                  <li><strong>Ray costs:</strong> Each entry point = 1 pt, each exit point = 1 pt</li>
                  <li className="ml-4 list-none text-gray-600">• Detour (different entry/exit): 2 points</li>
                  <li className="ml-4 list-none text-gray-600">• Reflection (same point): 1 point</li>
                  <li className="ml-4 list-none text-gray-600">• Absorption (no exit): 1 point</li>
                  <li><strong>Miss penalty:</strong> Each missed atom = 5 points</li>
                </ul>
                <p className="text-sm text-gray-600 mt-2 italic">
                  Strategy: Balance gathering information against point cost. Use as few rays as possible while still finding all 4 atoms.
                </p>
              </section>
            </div>
            
            {/* Footer */}
            <div className="flex-shrink-0 bg-gray-50 border-t px-6 py-3 flex justify-end">
              <button 
                onClick={() => setShowHelp(false)}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
