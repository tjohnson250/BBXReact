#!/usr/bin/env python3
"""
Optimal Black Box Solver

Determines the information-theoretically optimal sequence of ray shots
using a greedy strategy that minimizes expected remaining candidates
at each step.

The state space has C(64,4) = 635,376 possible atom configurations.
Each ray partitions this space by observable outcome. The optimal ray
at each step is the one whose partition minimizes E[remaining candidates],
equivalent to maximizing Shannon entropy of the outcome distribution.

Usage:
    python blackbox_solver.py first            # Analyze optimal first shot
    python blackbox_solver.py sim [N]          # Simulate N games (default 20)
    python blackbox_solver.py play             # Interactive mode
    python blackbox_solver.py tree [DEPTH]     # Build decision tree to given depth
"""

import sys
import itertools
import math
import time
import random
import json
import hashlib
from datetime import datetime, timezone
from collections import defaultdict, Counter


# =============================================================================
# Constants
# =============================================================================

GRID = 8
SIDES = ['north', 'south', 'east', 'west']
MAX_RAYS = 20

# Entry conditions: side → (boundary_i, boundary_j_func, vi, vj)
ENTRY = {
    'north': lambda p: (0, p, 1, 0),
    'south': lambda p: (9, p, -1, 0),
    'west':  lambda p: (p, 0, 0, 1),
    'east':  lambda p: (p, 9, 0, -1),
}

ALL_RAYS = [(s, p) for s in SIDES for p in range(1, GRID + 1)]

# 10 fixed experiment configurations matching blackbox.jsx EXPERIMENT_CONFIGS
# Each is a tuple of (row, col) tuples, 1-indexed
EXPERIMENT_CONFIGS = (
    ((2, 3), (3, 6), (6, 2), (7, 7)),  # Config 0: Spread pattern
    ((1, 1), (1, 3), (2, 2), (5, 6)),  # Config 1: Cluster in corner
    ((2, 2), (4, 4), (6, 6), (8, 8)),  # Config 2: Diagonal pattern
    ((1, 4), (4, 8), (8, 5), (5, 1)),  # Config 3: Edge-heavy
    ((3, 4), (4, 3), (4, 5), (5, 4)),  # Config 4: Central cluster
    ((2, 2), (2, 3), (2, 4), (4, 2)),  # Config 5: L-shape
    ((1, 1), (1, 8), (8, 1), (8, 8)),  # Config 6: Corners
    ((2, 7), (3, 2), (6, 5), (7, 3)),  # Config 7: Asymmetric
    ((4, 2), (4, 4), (4, 6), (4, 8)),  # Config 8: Row cluster
    ((1, 5), (3, 3), (5, 7), (8, 2)),  # Config 9: Mixed
)


# =============================================================================
# Ray Tracing — implements the deterministic transition system
# =============================================================================

def trace_ray(atoms, side, pos):
    """Trace a ray through the grid and return the observable outcome.

    Implements the full transition function including:
    - Entry absorption (e ∈ S)
    - Entry reflection (flanking atoms at entry cell)
    - Interior traversal with deflection rules
    - Boundary exit detection

    Args:
        atoms: set/frozenset of (row, col) tuples, 1-indexed
        side: 'north' | 'south' | 'east' | 'west'
        pos: 1-8

    Returns:
        Hashable outcome tuple:
            ('H',)            — absorbed
            ('R',)            — reflected (entry reflection or loop-back to entry)
            ('X', side, pos)  — exits at given channel (different from entry)
    """
    bi, bj, vi, vj = ENTRY[side](pos)

    # First interior cell
    ei, ej = bi + vi, bj + vj

    # Entry rule 1: direct hit → absorbed
    if (ei, ej) in atoms:
        return ('H',)

    # Entry rule 2: flanking atoms → reflected
    # q1 = e + Q(v) [CCW flank], q2 = e + P(v) [CW flank]
    if (ei - vj, ej + vi) in atoms or (ei + vj, ej - vi) in atoms:
        return ('R',)

    # Enter grid — move cell by cell, checking deflection ahead before advancing
    i, j = ei, ej

    for _ in range(200):  # safety bound
        # Check what's ahead from current cell
        ai, aj = i + vi, j + vj

        # Boundary exit check — if exit matches entry, it's observationally
        # indistinguishable from a reflection (the player sees 'R' either way)
        if ai < 1:
            exit_side, exit_pos = 'north', aj
        elif ai > GRID:
            exit_side, exit_pos = 'south', aj
        elif aj < 1:
            exit_side, exit_pos = 'west', ai
        elif aj > GRID:
            exit_side, exit_pos = 'east', ai
        else:
            exit_side = None

        if exit_side is not None:
            if exit_side == side and exit_pos == pos:
                return ('R',)
            return ('X', exit_side, exit_pos)

        # Absorption: atom directly ahead
        if (ai, aj) in atoms:
            return ('H',)

        # Deflection: check flanks of ahead cell, but only if the cell
        # beyond it is empty (absorption takes priority over deflection)
        if (ai + vi, aj + vj) not in atoms:
            f1 = (ai - vj, aj + vi) in atoms   # CCW flank (q1)
            f2 = (ai + vj, aj - vi) in atoms   # CW flank (q2)
            if f1 and f2:
                vi, vj = -vi, -vj               # N(v): reverse
                continue                        # stay at current cell
            elif f1:
                vi, vj = vj, -vi                # P(v): CW turn
                continue                        # stay at current cell
            elif f2:
                vi, vj = -vj, vi                # Q(v): CCW turn
                continue                        # stay at current cell

        # No deflection — advance to ahead cell
        i, j = ai, aj

    return ('H',)  # safety fallback


# =============================================================================
# Candidate Generation
# =============================================================================

def generate_configs():
    """Generate all C(64,4) = 635,376 atom configurations as frozensets."""
    positions = [(r, c) for r in range(1, GRID + 1) for c in range(1, GRID + 1)]
    return [frozenset(combo) for combo in itertools.combinations(positions, 4)]


# =============================================================================
# Information-Theoretic Ray Evaluation
# =============================================================================

def partition_by_ray(candidates, side, pos):
    """Partition candidates by their outcome for a given ray.

    Returns:
        partition: dict mapping outcome → list of configs
    """
    partition = defaultdict(list)
    for cfg in candidates:
        outcome = trace_ray(cfg, side, pos)
        partition[outcome].append(cfg)
    return dict(partition)


def score_partition(partition, total):
    """Compute expected remaining candidates for a partition.

    E[remaining] = Σ (n_i² / N)

    This is the expected size of the group the true config falls into.
    Lower is better. Minimum possible = N/K for K equally-sized groups.
    """
    return sum(len(g) ** 2 for g in partition.values()) / total


def entropy_partition(partition, total):
    """Compute Shannon entropy of a partition in bits.

    H = -Σ (p_i · log₂(p_i))

    Higher is better (more information gained).
    """
    return -sum(
        (len(g) / total) * math.log2(len(g) / total)
        for g in partition.values()
    )


def find_best_ray(candidates, used=None):
    """Find the ray minimizing expected remaining candidates.

    Args:
        candidates: list of frozenset configs
        used: set of (side, pos) tuples already fired

    Returns:
        (best_ray, best_score, best_partition, all_results)
        where all_results is sorted list of (side, pos, score, n_outcomes, max_group)
    """
    if used is None:
        used = set()

    available = [(s, p) for s, p in ALL_RAYS if (s, p) not in used]
    total = len(candidates)

    best_ray = None
    best_score = float('inf')
    best_partition = None
    all_results = []

    for side, pos in available:
        partition = partition_by_ray(candidates, side, pos)
        score = score_partition(partition, total)
        n_outcomes = len(partition)
        max_group = max(len(g) for g in partition.values())

        all_results.append((side, pos, score, n_outcomes, max_group))

        if score < best_score:
            best_score = score
            best_ray = (side, pos)
            best_partition = partition

    all_results.sort(key=lambda x: x[2])
    return best_ray, best_score, best_partition, all_results


# =============================================================================
# Formatting Helpers
# =============================================================================

def fmt_outcome(outcome):
    """Human-readable outcome string."""
    if outcome[0] == 'H':
        return 'ABSORBED'
    elif outcome[0] == 'R':
        return 'REFLECTED'
    else:
        return f'{outcome[1].upper()}-{outcome[2]}'


def fmt_ray(side, pos):
    return f'{side.upper()}-{pos}'


def fmt_atoms(config):
    """Format atom positions as row,col pairs for clarity."""
    return ', '.join(f'row {r} col {c}' for r, c in sorted(config))


def bar_chart(value, max_val, width=30):
    """Simple text bar."""
    filled = int(value / max_val * width) if max_val > 0 else 0
    return '█' * filled


# =============================================================================
# Command: Analyze First Shot
# =============================================================================

def cmd_first(configs):
    """Analyze optimal first shot using D4 symmetry of the grid."""
    N = len(configs)

    print(f'\n{"=" * 65}')
    print(f'OPTIMAL FIRST SHOT ANALYSIS')
    print(f'{"=" * 65}')
    print(f'Total candidate configurations: C(64,4) = {N:,}')
    print(f'Theoretical information content: log₂({N:,}) = {math.log2(N):.2f} bits')
    print(f'\nThe 8x8 grid has D₄ symmetry (4 rotations × 2 reflections).')
    print(f'Under D₄, the 32 rays fall into 4 equivalence classes:')
    print(f'  Class 1: NORTH-1 ~ SOUTH-1 ~ EAST-1 ~ WEST-1 ~ *-8  (8 rays)')
    print(f'  Class 2: NORTH-2 ~ SOUTH-2 ~ EAST-2 ~ WEST-2 ~ *-7  (8 rays)')
    print(f'  Class 3: NORTH-3 ~ SOUTH-3 ~ EAST-3 ~ WEST-3 ~ *-6  (8 rays)')
    print(f'  Class 4: NORTH-4 ~ SOUTH-4 ~ EAST-4 ~ WEST-4 ~ *-5  (8 rays)')
    print(f'\nEvaluating one representative from each class...\n')

    representatives = [('north', k) for k in range(1, 5)]
    results = []

    for side, pos in representatives:
        t0 = time.time()
        partition = partition_by_ray(configs, side, pos)
        elapsed = time.time() - t0

        score = score_partition(partition, N)
        n_outcomes = len(partition)
        entropy = entropy_partition(partition, N)
        max_group = max(len(g) for g in partition.values())
        min_group = min(len(g) for g in partition.values())

        results.append({
            'side': side, 'pos': pos,
            'score': score, 'n_outcomes': n_outcomes,
            'entropy': entropy, 'max_group': max_group,
            'min_group': min_group, 'partition': partition,
            'time': elapsed,
        })

        print(f'  {fmt_ray(side, pos)} (class {pos}):  [{elapsed:.1f}s]')
        print(f'    E[remaining]   = {score:,.1f}  (lower is better)')
        print(f'    Entropy        = {entropy:.3f} bits  (higher is better)')
        print(f'    Outcomes       = {n_outcomes}')
        print(f'    Largest group  = {max_group:,}  ({100 * max_group / N:.1f}%)')
        print(f'    Smallest group = {min_group:,}')
        print()

    # Determine winner
    best = min(results, key=lambda r: r['score'])

    print(f'{"=" * 65}')
    print(f'>>> OPTIMAL FIRST SHOT: {fmt_ray(best["side"], best["pos"])}')
    print(f'    (and all 7 symmetric equivalents in class {best["pos"]})')
    print(f'    E[remaining] = {best["score"]:,.1f} / {N:,}')
    print(f'    Information gain ≈ {math.log2(N) - math.log2(best["score"]):.2f} bits')
    print(f'{"=" * 65}')

    # Show outcome distribution for best ray
    print(f'\nOutcome distribution for {fmt_ray(best["side"], best["pos"])}:')
    sorted_outcomes = sorted(
        best['partition'].items(), key=lambda x: -len(x[1])
    )
    max_count = max(len(g) for g in best['partition'].values())
    for rank, (outcome, group) in enumerate(sorted_outcomes[:20], 1):
        pct = 100 * len(group) / N
        b = bar_chart(len(group), max_count, 25)
        print(f'  {rank:2d}. {fmt_outcome(outcome):>12s}: {len(group):>7,} ({pct:5.2f}%) {b}')
    if len(sorted_outcomes) > 20:
        print(f'  ... and {len(sorted_outcomes) - 20} more outcomes')

    return best


# =============================================================================
# Command: Simulate Games
# =============================================================================

def solve_game(configs, target, first_shot=None, first_partition=None, verbose=False):
    """Solve one game using greedy optimal strategy.

    Args:
        configs: full config list
        target: frozenset — the hidden atom config
        first_shot: (side, pos) precomputed optimal first shot
        first_partition: precomputed partition for first shot
        verbose: print play-by-play

    Returns:
        dict with game statistics
    """
    target_set = set(target)
    candidates = list(configs)
    used = set()
    history = []

    if verbose:
        print(f'\n  Target: {sorted(target)}')
        print(f'  Starting candidates: {len(candidates):,}')

    for ray_num in range(1, MAX_RAYS + 1):
        if len(candidates) <= 1:
            break

        # Choose ray
        if ray_num == 1 and first_shot and first_partition:
            side, pos = first_shot
            partition = first_partition
            score = score_partition(partition, len(candidates))
            n_outcomes = len(partition)
        else:
            (side, pos), score, partition, _ = find_best_ray(candidates, used)
            n_outcomes = len(partition)

        # Observe outcome against the true target
        outcome = trace_ray(target_set, side, pos)

        # Filter candidates
        old_count = len(candidates)
        candidates = partition.get(outcome, [])
        used.add((side, pos))
        history.append((side, pos, outcome, old_count, len(candidates), n_outcomes))

        if verbose:
            print(f'  #{ray_num:2d}  {fmt_ray(side, pos):>8s} → {fmt_outcome(outcome):<12s}'
                  f'  {old_count:>7,} → {len(candidates):>7,}  '
                  f'({n_outcomes} outcomes, E[remain]={score:,.0f})')

    solved = len(candidates) == 1 and list(candidates)[0] == target
    n_rays = len(history)

    if verbose:
        if solved:
            print(f'  ✓ SOLVED in {n_rays} rays! → {sorted(candidates[0])}')
        else:
            print(f'  Ended with {len(candidates)} candidates after {n_rays} rays')
            if len(candidates) <= 5:
                for c in candidates:
                    marker = ' ←' if c == target else ''
                    print(f'    {sorted(c)}{marker}')

    return {
        'n_rays': n_rays,
        'n_remaining': len(candidates),
        'solved': solved,
        'target_in_remaining': target in candidates,
        'history': history,
    }


def cmd_sim(configs, n_games=20):
    """Run simulation with greedy optimal strategy."""
    # First, compute optimal first shot
    best = cmd_first(configs)
    first_shot = (best['side'], best['pos'])
    first_partition = best['partition']

    print(f'\n{"=" * 65}')
    print(f'SIMULATION: {n_games} games with greedy optimal strategy')
    print(f'{"=" * 65}')

    results = []
    t_total = time.time()

    for game in range(1, n_games + 1):
        target = random.choice(configs)
        verbose = game <= 3  # show first 3 games in detail

        if verbose:
            print(f'\n--- Game {game} ---')

        t0 = time.time()
        result = solve_game(configs, target, first_shot, first_partition, verbose=verbose)
        result['time'] = time.time() - t0
        results.append(result)

        if not verbose and game % 5 == 0:
            avg_rays = sum(r['n_rays'] for r in results) / len(results)
            print(f'  Game {game}/{n_games}  '
                  f'(avg rays so far: {avg_rays:.1f}, '
                  f'this game: {result["n_rays"]} rays, '
                  f'{result["time"]:.1f}s)')

    # Aggregate statistics
    elapsed = time.time() - t_total
    ray_counts = [r['n_rays'] for r in results]
    solve_counts = sum(1 for r in results if r['solved'])
    target_retained = sum(1 for r in results if r['target_in_remaining'])
    remaining = [r['n_remaining'] for r in results]

    print(f'\n{"=" * 65}')
    print(f'RESULTS  ({n_games} games, {elapsed:.1f}s total)')
    print(f'{"=" * 65}')
    print(f'  Rays to unique solution:')
    print(f'    Mean:   {sum(ray_counts) / len(ray_counts):.2f}')
    print(f'    Median: {sorted(ray_counts)[len(ray_counts) // 2]}')
    print(f'    Min:    {min(ray_counts)}')
    print(f'    Max:    {max(ray_counts)}')
    print(f'  Uniquely solved:    {solve_counts}/{n_games} ({100 * solve_counts / n_games:.0f}%)')
    print(f'  Target in finalists: {target_retained}/{n_games}')
    print(f'  Avg final candidates: {sum(remaining) / len(remaining):.2f}')
    print(f'  Avg time per game: {elapsed / n_games:.1f}s')

    # Distribution
    dist = Counter(ray_counts)
    max_count = max(dist.values())
    print(f'\n  Rays needed (distribution):')
    for k in sorted(dist):
        b = bar_chart(dist[k], max_count, 30)
        print(f'    {k:2d} rays: {dist[k]:3d} games  {b}')


# =============================================================================
# Command: Interactive Play
# =============================================================================

def cmd_play(configs):
    """Interactive mode — user fires recommended rays and enters outcomes."""
    N = len(configs)

    print(f'\n{"=" * 65}')
    print(f'INTERACTIVE BLACK BOX SOLVER')
    print(f'{"=" * 65}')
    print(f'Starting with {N:,} candidate configurations.')
    print(f'I will recommend the optimal ray at each step.')
    print(f'Enter the observed outcome after firing each ray.\n')
    print(f'Outcome formats:')
    print(f'  NORTH-3, SOUTH-7, EAST-1, WEST-5  (exit channel)')
    print(f'  ABSORBED  or  H                     (absorbed)')
    print(f'  REFLECTED or  R                     (reflected)')
    print(f'  QUIT                                 (exit)\n')

    candidates = list(configs)
    used = set()

    for ray_num in range(1, MAX_RAYS + 1):
        if len(candidates) <= 1:
            if len(candidates) == 1:
                print(f'\n{"=" * 65}')
                print(f'✓ SOLVED in {ray_num - 1} rays!')
                print(f'{"=" * 65}')
                print(f'  Atom positions (row, col):')
                for r, c in sorted(candidates[0]):
                    print(f'    Row {r}, Col {c}')
                print(f'{"=" * 65}')
            else:
                print(f'\n✗ No candidates remain — there may have been an input error.')
            return

        if len(candidates) <= 10:
            print(f'\nRemaining candidates ({len(candidates)}):')
            for cfg in sorted(candidates, key=lambda c: sorted(c)):
                print(f'  [{fmt_atoms(cfg)}]')

        print(f'\n--- Ray #{ray_num} ({len(candidates):,} candidates) ---')

        t0 = time.time()
        best_ray, best_score, best_partition, all_results = find_best_ray(candidates, used)
        elapsed = time.time() - t0

        side, pos = best_ray
        n_outcomes = len(best_partition)
        entropy = entropy_partition(best_partition, len(candidates))

        print(f'  Evaluated {len(all_results)} rays in {elapsed:.1f}s')
        print(f'\n  Top 5 rays:')
        for rank, (s, p, sc, no, mg) in enumerate(all_results[:5], 1):
            print(f'    {rank}. {fmt_ray(s, p):>8s}  E[remain]={sc:,.0f}  '
                  f'outcomes={no}  worst_case={mg:,}')

        print(f'\n  >>> FIRE: {fmt_ray(side, pos)}')
        print(f'      E[remaining]={best_score:,.0f}  outcomes={n_outcomes}  '
              f'entropy={entropy:.2f} bits')

        # Show what each outcome would do
        sorted_outs = sorted(best_partition.items(), key=lambda x: -len(x[1]))
        print(f'\n  Possible outcomes:')
        for outcome, group in sorted_outs[:10]:
            print(f'    {fmt_outcome(outcome):>12s} → {len(group):,} candidates')
        if len(sorted_outs) > 10:
            print(f'    ... and {len(sorted_outs) - 10} more')

        # Get user input
        while True:
            raw = input(f'\n  Outcome of {fmt_ray(side, pos)}: ').strip().upper()

            if raw in ('QUIT', 'Q', 'EXIT'):
                print('Goodbye!')
                return

            outcome = parse_outcome(raw)
            if outcome is not None:
                break
            print('  Invalid format. Examples: SOUTH-3, ABSORBED, REFLECTED')

        # Filter
        old_count = len(candidates)
        candidates = best_partition.get(outcome, [])
        used.add((side, pos))

        print(f'  {old_count:,} → {len(candidates):,} candidates')

        if not candidates:
            print('\n  ⚠ No candidates match this outcome!')
            print('  Check that the outcome was entered correctly.')
            print('  (The true configuration may not be in the search space.)')
            return

    # Exhausted rays
    print(f'\n  Reached {MAX_RAYS}-ray limit with {len(candidates)} candidates.')
    if len(candidates) <= 20:
        print('  Remaining candidates (row, col):')
        for cfg in sorted(candidates, key=lambda c: sorted(c)):
            print(f'    [{fmt_atoms(cfg)}]')


def parse_outcome(text):
    """Parse user-entered outcome string into outcome tuple."""
    text = text.strip().upper()

    if text in ('ABSORBED', 'H', 'HIT'):
        return ('H',)
    if text in ('REFLECTED', 'R', 'REFL'):
        return ('R',)

    # Try SIDE-POS format
    for sep in ['-', ' ']:
        parts = text.split(sep)
        if len(parts) == 2:
            side_str = parts[0].lower()
            # Handle abbreviations
            side_map = {
                'n': 'north', 'north': 'north',
                's': 'south', 'south': 'south',
                'e': 'east', 'east': 'east',
                'w': 'west', 'west': 'west',
            }
            if side_str in side_map:
                try:
                    p = int(parts[1])
                    if 1 <= p <= GRID:
                        return ('X', side_map[side_str], p)
                except ValueError:
                    pass

    return None


# =============================================================================
# Command: Decision Tree
# =============================================================================

def cmd_tree(configs, max_depth=3):
    """Build and display the optimal decision tree to a given depth."""
    print(f'\n{"=" * 65}')
    print(f'DECISION TREE (depth {max_depth})')
    print(f'{"=" * 65}')
    print(f'Starting with {len(configs):,} candidates\n')

    def build_tree(candidates, used, depth, indent=''):
        if depth > max_depth or len(candidates) <= 1:
            if len(candidates) == 1:
                print(f'{indent}→ SOLVED ({len(candidates)} candidate)')
            else:
                print(f'{indent}→ {len(candidates):,} candidates remain')
            return

        (side, pos), score, partition, _ = find_best_ray(candidates, used)
        n_out = len(partition)
        print(f'{indent}FIRE {fmt_ray(side, pos)}  '
              f'(E[remain]={score:,.0f}, {n_out} outcomes)')

        sorted_outs = sorted(partition.items(), key=lambda x: -len(x[1]))

        # Show all branches but only recurse into the largest few
        for outcome, group in sorted_outs:
            pct = 100 * len(group) / len(candidates)
            print(f'{indent}  {fmt_outcome(outcome):>12s}: {len(group):>7,} ({pct:5.1f}%)')

            if depth < max_depth and len(group) > 1:
                new_used = used | {(side, pos)}
                build_tree(group, new_used, depth + 1, indent + '    ')

    build_tree(list(configs), set(), 1)


# =============================================================================
# Command: Benchmark Experiment Configs
# =============================================================================

def configs_hash():
    """SHA-256 hash of EXPERIMENT_CONFIGS for cache invalidation (first 16 hex chars)."""
    data = str(sorted(EXPERIMENT_CONFIGS)).encode()
    return hashlib.sha256(data).hexdigest()[:16]


def compute_game_score(history):
    """Compute game score matching JSX calculateScore() (lines 707-731).

    Args:
        history: list of (side, pos, outcome, old_count, new_count, n_outcomes)

    Returns:
        dict with ray_points, missed_penalty, total, atoms_missed
    """
    ray_points = 0
    for side, pos, outcome, *_ in history:
        ray_points += 1  # Entry point
        if outcome[0] == 'X':
            # Detour: exit at different channel → entry + exit = 2
            ray_points += 1
        # Absorbed ('H') and Reflected ('R') only cost entry point
    # Optimal solver always finds all 4 atoms when solved
    return {
        'ray_points': ray_points,
        'missed_penalty': 0,
        'total': ray_points,
        'atoms_missed': 0,
    }


def cmd_benchmark(configs, output_path='optimal_solver_results.json'):
    """Run greedy optimal solver on all 10 experiment configs and write JSON."""
    N = len(configs)

    print(f'\n{"=" * 65}')
    print(f'BENCHMARK: Optimal solver on {len(EXPERIMENT_CONFIGS)} experiment configs')
    print(f'{"=" * 65}')
    print(f'Candidate space: {N:,}')
    print(f'Strategy: greedy optimal (minimize E[remaining])')
    print(f'Configs hash: {configs_hash()}\n')

    # Compute optimal first shot (reuse find_best_ray, not cmd_first which prints)
    print('Computing optimal first shot...', flush=True)
    t0 = time.time()
    first_ray, first_score, first_partition, first_results = find_best_ray(configs)
    first_time = time.time() - t0
    first_side, first_pos = first_ray
    first_entropy = entropy_partition(first_partition, N)
    print(f'  Best first shot: {fmt_ray(first_side, first_pos)}  '
          f'E[remain]={first_score:,.0f}  '
          f'outcomes={len(first_partition)}  '
          f'entropy={first_entropy:.2f} bits  '
          f'[{first_time:.1f}s]\n')

    # Solve each experiment config
    results = []
    t_total = time.time()

    for idx, cfg_tuple in enumerate(EXPERIMENT_CONFIGS):
        target = frozenset(cfg_tuple)
        print(f'  Config {idx}: {sorted(target)}  ', end='', flush=True)

        t_game = time.time()
        game = solve_game(configs, target, first_ray, first_partition, verbose=False)
        elapsed = time.time() - t_game

        score = compute_game_score(game['history'])

        # Build history detail
        history_detail = []
        for side, pos, outcome, old_count, new_count, n_outcomes in game['history']:
            history_detail.append({
                'ray': {'side': side, 'position': pos},
                'outcome': fmt_outcome(outcome),
                'outcome_raw': list(outcome),
                'candidates_before': old_count,
                'candidates_after': new_count,
                'n_outcomes': n_outcomes,
            })

        results.append({
            'config_index': idx,
            'atoms': [list(a) for a in sorted(cfg_tuple)],
            'optimal_rays': game['n_rays'],
            'solved': game['solved'],
            'score': score,
            'history': history_detail,
            'compute_time_s': round(elapsed, 2),
        })

        status = '✓' if game['solved'] else '✗'
        print(f'{status} {game["n_rays"]} rays, score={score["total"]}, [{elapsed:.1f}s]')

    total_time = time.time() - t_total

    # Build output JSON
    output = {
        'metadata': {
            'generator': 'blackbox_solver.py benchmark',
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'configs_hash': configs_hash(),
            'n_configs': len(EXPERIMENT_CONFIGS),
            'candidate_space': N,
            'strategy': 'greedy_optimal',
            'total_compute_time_s': round(total_time + first_time, 2),
        },
        'first_shot': {
            'side': first_side,
            'position': first_pos,
            'expected_remaining': round(first_score, 2),
            'n_outcomes': len(first_partition),
            'entropy_bits': round(first_entropy, 4),
        },
        'configs': results,
    }

    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)

    # Summary
    rays_list = [r['optimal_rays'] for r in results]
    scores_list = [r['score']['total'] for r in results]
    solved_count = sum(1 for r in results if r['solved'])

    print(f'\n{"=" * 65}')
    print(f'SUMMARY')
    print(f'{"=" * 65}')
    print(f'  Solved: {solved_count}/{len(results)}')
    print(f'  Rays:  mean={sum(rays_list)/len(rays_list):.1f}  '
          f'min={min(rays_list)}  max={max(rays_list)}')
    print(f'  Score: mean={sum(scores_list)/len(scores_list):.1f}  '
          f'min={min(scores_list)}  max={max(scores_list)}')
    print(f'  Total compute time: {total_time + first_time:.1f}s')
    print(f'  Output: {output_path}')
    print(f'{"=" * 65}')


# =============================================================================
# Main
# =============================================================================

def main():
    if len(sys.argv) < 2:
        print('Optimal Black Box Solver')
        print()
        print('Usage:')
        print('  python blackbox_solver.py first         Analyze optimal first shot')
        print('  python blackbox_solver.py sim [N]       Simulate N games (default 20)')
        print('  python blackbox_solver.py play          Interactive solver')
        print('  python blackbox_solver.py tree [DEPTH]  Decision tree (default depth 2)')
        print('  python blackbox_solver.py benchmark     Solve all 10 experiment configs')
        sys.exit(0)

    mode = sys.argv[1].lower()

    print('Generating all C(64,4) configurations...', flush=True)
    t0 = time.time()
    configs = generate_configs()
    print(f'Generated {len(configs):,} configurations in {time.time() - t0:.1f}s\n')

    if mode == 'first':
        cmd_first(configs)

    elif mode == 'sim':
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        cmd_sim(configs, n_games=n)

    elif mode in ('play', 'interactive'):
        cmd_play(configs)

    elif mode == 'tree':
        depth = int(sys.argv[2]) if len(sys.argv) > 2 else 2
        cmd_tree(configs, max_depth=depth)

    elif mode == 'benchmark':
        cmd_benchmark(configs)

    else:
        print(f'Unknown command: {mode}')
        print('Use: first, sim, play, tree, or benchmark')
        sys.exit(1)


if __name__ == '__main__':
    main()
