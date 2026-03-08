#!/usr/bin/env python3
"""
classify_errors.py — LLM-as-judge error classification for Black Box experiments.

Reads experiment JSON files, extracts incorrect predictions with thinking traces,
and uses Claude (Haiku 4.5) to classify each error into the paper's error taxonomy.

Usage:
    python classify_errors.py --api-key YOUR_KEY [--mode predict|play|both] [--dry-run]
    python classify_errors.py --api-key YOUR_KEY --resume  # resume from checkpoint

Output: error_classifications.json
"""

import argparse
import json
import glob
import os
import sys
import time
import hashlib
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PREDICT_DIR = "Experiment 1/Predict"
PLAY_DIR = "Experiment 1/Play"
OUTPUT_FILE = "error_classifications.json"
CHECKPOINT_FILE = "error_classifications_checkpoint.json"

CLASSIFIER_MODEL = "claude-haiku-4-5-20251001"
API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"

# Max play games to classify (sample from full set)
MAX_PLAY_GAMES = 100

# Rate limiting
REQUESTS_PER_MINUTE = 50
REQUEST_INTERVAL = 60.0 / REQUESTS_PER_MINUTE

# Error taxonomy from QMD lines 1080-1091
ERROR_CATEGORIES = {
    "ray_path_error": {
        "label": "Ray path error",
        "spatial": True,
        "description": "Path traced incorrectly through grid"
    },
    "deflection_geometry_error": {
        "label": "Deflection geometry error",
        "spatial": True,
        "description": "Misunderstood deflection rules (how atoms deflect/reflect/absorb rays)"
    },
    "constraint_tracking_error": {
        "label": "Constraint tracking error",
        "spatial": False,
        "description": "Failed to update or maintain ruled-out positions based on evidence"
    },
    "experiment_design_error": {
        "label": "Experiment design error",
        "spatial": False,
        "description": "Fired uninformative or redundant rays that didn't help narrow candidates"
    },
    "belief_updating_error": {
        "label": "Belief updating error",
        "spatial": False,
        "description": "Did not revise hypothesis when contradicted by new evidence"
    },
    "premature_commitment": {
        "label": "Premature commitment",
        "spatial": False,
        "description": "Anchored on hypothesis before sufficient evidence"
    },
}

# ---------------------------------------------------------------------------
# Ray physics summary for the classification prompt
# ---------------------------------------------------------------------------

RAY_PHYSICS_REFERENCE = """
BLACK BOX RAY PHYSICS RULES:
- The grid is 8×8 with rows 1-8 and columns 1-8.
- Rays enter from edge positions: NORTH/SOUTH use columns 1-8, EAST/WEST use rows 1-8.
- A ray from NORTH-c enters at row 1, column c, traveling south (increasing row).
- A ray from SOUTH-c enters at row 8, column c, traveling north (decreasing row).
- A ray from WEST-r enters at row r, column 1, traveling east (increasing column).
- A ray from EAST-r enters at row r, column 8, traveling west (decreasing column).

INTERACTION RULES (checked in order):
1. ABSORPTION: If the ray's next cell contains an atom, the ray is absorbed (HIT).
   - Entry absorption: If the very first cell the ray enters has an atom → absorbed.
2. REFLECTION: If an atom is diagonally ahead to the left or right at the entry point
   (before the ray enters the grid), the ray reflects back out the entry point.
   - Also: if atoms are on BOTH sides ahead simultaneously → ray reverses (180° reflection).
3. DEFLECTION: If a single atom is diagonally ahead on one side:
   - Atom on the LEFT diagonal ahead → ray turns RIGHT (90°)
   - Atom on the RIGHT diagonal ahead → ray turns LEFT (90°)
   Note: "ahead" means along the ray's current direction of travel.
4. The ray continues until it exits the grid or is absorbed.

RESULT FORMAT:
- "absorbed" or "HIT" — ray was absorbed by an atom
- "reflected" or "REFLECTION" — ray reflected back out its entry point
- "SIDE-N" (e.g., "east-5", "south-3") — ray exited at the given edge position
"""

# ---------------------------------------------------------------------------
# Classification prompt for Predict mode errors
# ---------------------------------------------------------------------------

PREDICT_CLASSIFICATION_PROMPT = """You are an expert analyst classifying errors in LLM reasoning about a spatial physics game called Black Box.

{ray_physics}

TASK: An LLM was given the atom positions and asked to predict where a ray would exit. It predicted incorrectly. Analyze the LLM's thinking trace to classify the PRIMARY error.

ATOM POSITIONS: {atom_config}
RAY ENTRY: {ray_entry_side}-{ray_entry_pos}
CORRECT ANSWER: {actual}
LLM'S PREDICTION: {predicted}

LLM'S THINKING TRACE:
{thinking}

ERROR CATEGORIES:
1. ray_path_error (SPATIAL) — The LLM traced the ray path incorrectly through the grid. It moved the ray to wrong cells, lost track of position, or made arithmetic errors in coordinates.
2. deflection_geometry_error (SPATIAL) — The LLM misunderstood or misapplied the deflection/reflection/absorption rules. For example: deflected wrong direction, didn't recognize a reflection condition, thought absorption happened when it didn't, or vice versa.
3. constraint_tracking_error (NON-SPATIAL) — The LLM lost track of which cells it had already visited or which atoms had already affected the ray. It "forgot" earlier interactions.
4. experiment_design_error (NON-SPATIAL) — Not applicable in Predict mode (this is for Play mode only).
5. belief_updating_error (NON-SPATIAL) — The LLM recognized an interaction correctly but then ignored it or contradicted its own earlier correct reasoning.
6. premature_commitment (NON-SPATIAL) — The LLM jumped to a conclusion early in the trace and then force-fit the remaining reasoning to match, ignoring contradicting evidence.

Respond with ONLY a JSON object (no markdown, no explanation):
{{
  "primary_error": "<category_id>",
  "secondary_error": "<category_id or null>",
  "is_spatial": <true or false>,
  "confidence": "<high|medium|low>",
  "justification": "<1-2 sentence explanation of what went wrong>"
}}
"""

# ---------------------------------------------------------------------------
# Classification prompt for Play mode errors
# ---------------------------------------------------------------------------

PLAY_CLASSIFICATION_PROMPT = """You are an expert analyst classifying errors in LLM reasoning about a spatial physics game called Black Box.

{ray_physics}

TASK: An LLM played a full Black Box game. It had to fire rays, observe results, and deduce the positions of 4 hidden atoms. It got {atoms_correct}/4 atoms correct. Analyze the game transcript to classify the PRIMARY failure mode.

ACTUAL ATOM POSITIONS: {atom_config}
LLM'S FINAL GUESS: {final_guess}
ATOMS CORRECT: {atoms_correct}/4
RAYS USED: {rays_used}

GAME TRANSCRIPT (ray fires and reasoning):
{transcript}

ERROR CATEGORIES:
1. ray_path_error (SPATIAL) — The LLM misinterpreted ray results, tracing paths incorrectly in its mental model.
2. deflection_geometry_error (SPATIAL) — The LLM misunderstood how atoms deflect/reflect/absorb rays when reasoning about what the results mean.
3. constraint_tracking_error (NON-SPATIAL) — The LLM failed to maintain or update its set of candidate positions. It "forgot" constraints from earlier rays.
4. experiment_design_error (NON-SPATIAL) — The LLM chose uninformative or redundant rays. It didn't systematically narrow down candidates.
5. belief_updating_error (NON-SPATIAL) — The LLM had evidence contradicting its hypothesis but failed to revise it.
6. premature_commitment (NON-SPATIAL) — The LLM locked onto atom positions too early and stopped gathering/using discriminating evidence.

Also count: how many individual ray result interpretations in the game transcript show spatial reasoning errors (misunderstanding what a ray result implies about atom positions)?

Respond with ONLY a JSON object (no markdown, no explanation):
{{
  "primary_failure_mode": "<category_id>",
  "secondary_failure_mode": "<category_id or null>",
  "is_spatial": <true or false>,
  "confidence": "<high|medium|low>",
  "spatial_errors_in_game": <integer count of spatial reasoning errors>,
  "total_reasoning_steps": <integer count of reasoning steps>,
  "key_decision_point": "<1-2 sentence description of where the game went wrong>",
  "justification": "<1-2 sentence overall assessment>"
}}
"""


# ---------------------------------------------------------------------------
# API call helper
# ---------------------------------------------------------------------------

def call_claude(api_key, prompt, max_retries=3):
    """Call Claude API with retries and rate limiting."""
    import urllib.request
    import urllib.error

    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": API_VERSION,
    }

    body = json.dumps({
        "model": CLASSIFIER_MODEL,
        "max_tokens": 512,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
    }).encode("utf-8")

    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(API_URL, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                text = result["content"][0]["text"]
                # Strip markdown code fences if present
                text = text.strip()
                if text.startswith("```"):
                    text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                    if text.endswith("```"):
                        text = text[:-3]
                    text = text.strip()
                return json.loads(text)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"  HTTP {e.code}, retrying in {wait}s...")
                time.sleep(wait)
                continue
            raise
        except (json.JSONDecodeError, KeyError, IndexError) as e:
            if attempt < max_retries - 1:
                print(f"  Parse error: {e}, retrying...")
                time.sleep(2)
                continue
            raise

    return None


# ---------------------------------------------------------------------------
# Data extraction
# ---------------------------------------------------------------------------

def extract_predict_errors(predict_dir):
    """Extract all incorrect predictions with thinking traces from Predict experiment files."""
    errors = []
    # Only look at thinking-enabled files (they have the richest traces)
    # But also include non-thinking files for outcome-level classification
    for filepath in sorted(glob.glob(os.path.join(predict_dir, "*.json"))):
        with open(filepath) as f:
            data = json.load(f)

        for result in data.get("results", []):
            for pred in result.get("predictions", []):
                if pred.get("correct", True):
                    continue

                thinking = pred.get("thinking", "")
                reasoning = pred.get("reasoning", "")

                # Need at least some reasoning content to classify
                trace = thinking if thinking and len(thinking) > 50 else reasoning
                if not trace or len(trace) < 20:
                    continue

                error_id = hashlib.md5(
                    f"{result['experimentId']}_{pred['rayEntry']['side']}_{pred['rayEntry']['pos']}".encode()
                ).hexdigest()[:12]

                errors.append({
                    "error_id": error_id,
                    "experiment_id": result.get("experimentId", ""),
                    "model": result.get("modelName", ""),
                    "config_index": result.get("configIndex", -1),
                    "atom_config": result.get("atomConfig", []),
                    "prompt_style": result.get("promptStyle", ""),
                    "enable_thinking": result.get("enableThinking", False),
                    "vot_ray_trace": result.get("votRayTrace", False),
                    "ray_entry": pred["rayEntry"],
                    "predicted": pred.get("predicted", ""),
                    "actual": pred.get("actual", ""),
                    "trace": trace,
                    "has_thinking": bool(thinking and len(thinking) > 50),
                })

    return errors


def extract_play_games(play_dir, max_games=MAX_PLAY_GAMES):
    """Extract play games with <4 atoms correct for error classification."""
    games = []

    for filepath in sorted(glob.glob(os.path.join(play_dir, "*.json"))):
        with open(filepath) as f:
            data = json.load(f)

        for result in data.get("results", []):
            atoms_correct = result.get("atomsCorrect", 0)
            if atoms_correct >= 4:
                continue

            # Build transcript from ray sequence
            transcript_parts = []
            has_any_reasoning = False
            for i, action in enumerate(result.get("raySequence", []), 1):
                if action.get("action") == "fire":
                    entry = action.get("rayEntry", {})
                    ray_result = action.get("result", "")
                    thinking = action.get("thinking", "")
                    reasoning = action.get("reasoning", "")
                    trace = thinking if thinking and len(thinking) > 50 else reasoning
                    if trace and len(trace) > 20:
                        has_any_reasoning = True
                    transcript_parts.append(
                        f"RAY {i}: Fired {entry.get('side','?').upper()}-{entry.get('pos','?')}"
                        f" → {ray_result}\n"
                        f"REASONING: {trace[:800] if trace else '(none)'}\n"
                    )
                elif action.get("action") == "mark":
                    pos = action.get("position", {})
                    transcript_parts.append(
                        f"ACTION {i}: Marked hypothesis at ({pos.get('row','?')},{pos.get('col','?')})\n"
                    )
                elif action.get("action") == "check":
                    guess = action.get("guess", [])
                    transcript_parts.append(
                        f"ACTION {i}: Final guess: {guess}\n"
                    )

            if not has_any_reasoning:
                continue

            game_id = hashlib.md5(
                f"{result.get('experimentId', '')}_{result.get('configIndex', '')}".encode()
            ).hexdigest()[:12]

            # Truncate transcript to avoid exceeding context limits
            transcript = "\n".join(transcript_parts)
            if len(transcript) > 6000:
                transcript = transcript[:6000] + "\n... (truncated)"

            games.append({
                "game_id": game_id,
                "experiment_id": result.get("experimentId", ""),
                "model": result.get("modelName", ""),
                "config_index": result.get("configIndex", -1),
                "atom_config": result.get("atomConfig", []),
                "prompt_style": result.get("promptStyle", ""),
                "enable_thinking": result.get("enableThinking", False),
                "atoms_correct": atoms_correct,
                "atoms_missed": result.get("atomsMissed", 0),
                "rays_used": result.get("raysUsed", 0),
                "score": result.get("score", 0),
                "final_guess": result.get("finalGuess", []),
                "hypothesis_actions": result.get("hypothesisActions", 0),
                "transcript": transcript,
            })

    # Sample if too many
    if len(games) > max_games:
        import random
        random.seed(42)
        # Stratified sample: ensure representation across models and configs
        games.sort(key=lambda g: (g["model"], g["config_index"]))
        games = random.sample(games, max_games)

    return games


# ---------------------------------------------------------------------------
# Classification runners
# ---------------------------------------------------------------------------

def classify_predict_error(api_key, error):
    """Classify a single Predict mode error."""
    atom_str = ", ".join(f"({r},{c})" for r, c in error["atom_config"])
    prompt = PREDICT_CLASSIFICATION_PROMPT.format(
        ray_physics=RAY_PHYSICS_REFERENCE,
        atom_config=atom_str,
        ray_entry_side=error["ray_entry"]["side"].upper(),
        ray_entry_pos=error["ray_entry"]["pos"],
        actual=error["actual"],
        predicted=error["predicted"],
        thinking=error["trace"][:4000],  # Truncate very long traces
    )

    result = call_claude(api_key, prompt)
    if result is None:
        return None

    # Validate and normalize the response
    primary = result.get("primary_error", "unknown")
    if primary not in ERROR_CATEGORIES:
        # Try to fuzzy match
        for cat_id in ERROR_CATEGORIES:
            if cat_id in primary or primary in cat_id:
                primary = cat_id
                break

    return {
        "error_id": error["error_id"],
        "experiment_id": error["experiment_id"],
        "model": error["model"],
        "config_index": error["config_index"],
        "atom_config": error["atom_config"],
        "prompt_style": error["prompt_style"],
        "enable_thinking": error["enable_thinking"],
        "vot_ray_trace": error.get("vot_ray_trace", False),
        "has_thinking_trace": error["has_thinking"],
        "ray_entry": error["ray_entry"],
        "predicted": error["predicted"],
        "actual": error["actual"],
        "primary_error": primary,
        "secondary_error": result.get("secondary_error"),
        "is_spatial": result.get("is_spatial", primary in (
            "ray_path_error", "deflection_geometry_error"
        )),
        "confidence": result.get("confidence", "unknown"),
        "justification": result.get("justification", ""),
    }


def classify_play_game(api_key, game):
    """Classify a single Play mode game failure."""
    atom_str = ", ".join(f"({r},{c})" for r, c in game["atom_config"])
    guess_str = ", ".join(f"({r},{c})" for r, c in game["final_guess"]) if game["final_guess"] else "(no guess)"

    prompt = PLAY_CLASSIFICATION_PROMPT.format(
        ray_physics=RAY_PHYSICS_REFERENCE,
        atom_config=atom_str,
        final_guess=guess_str,
        atoms_correct=game["atoms_correct"],
        rays_used=game["rays_used"],
        transcript=game["transcript"],
    )

    result = call_claude(api_key, prompt)
    if result is None:
        return None

    primary = result.get("primary_failure_mode", "unknown")
    if primary not in ERROR_CATEGORIES:
        for cat_id in ERROR_CATEGORIES:
            if cat_id in primary or primary in cat_id:
                primary = cat_id
                break

    return {
        "game_id": game["game_id"],
        "experiment_id": game["experiment_id"],
        "model": game["model"],
        "config_index": game["config_index"],
        "atom_config": game["atom_config"],
        "prompt_style": game["prompt_style"],
        "enable_thinking": game["enable_thinking"],
        "atoms_correct": game["atoms_correct"],
        "rays_used": game["rays_used"],
        "score": game["score"],
        "final_guess": game["final_guess"],
        "hypothesis_actions": game["hypothesis_actions"],
        "primary_failure_mode": primary,
        "secondary_failure_mode": result.get("secondary_failure_mode"),
        "is_spatial": result.get("is_spatial", primary in (
            "ray_path_error", "deflection_geometry_error"
        )),
        "confidence": result.get("confidence", "unknown"),
        "spatial_errors_in_game": result.get("spatial_errors_in_game", 0),
        "total_reasoning_steps": result.get("total_reasoning_steps", 0),
        "key_decision_point": result.get("key_decision_point", ""),
        "justification": result.get("justification", ""),
    }


# ---------------------------------------------------------------------------
# Checkpoint support
# ---------------------------------------------------------------------------

def load_checkpoint():
    """Load checkpoint if it exists."""
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {"predict": [], "play": [], "predict_done_ids": [], "play_done_ids": []}


def save_checkpoint(data):
    """Save checkpoint for resuming."""
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(data, f, indent=2)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Classify Black Box experiment errors using Claude")
    parser.add_argument("--api-key", required=True, help="Anthropic API key")
    parser.add_argument("--mode", choices=["predict", "play", "both"], default="both",
                        help="Which mode to classify (default: both)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Extract data and show counts without calling API")
    parser.add_argument("--resume", action="store_true",
                        help="Resume from checkpoint")
    parser.add_argument("--max-play", type=int, default=MAX_PLAY_GAMES,
                        help=f"Max play games to classify (default: {MAX_PLAY_GAMES})")
    args = parser.parse_args()

    # Load checkpoint if resuming
    checkpoint = load_checkpoint() if args.resume else {
        "predict": [], "play": [],
        "predict_done_ids": [], "play_done_ids": []
    }

    # --- Predict mode ---
    if args.mode in ("predict", "both"):
        print(f"Extracting Predict mode errors from {PREDICT_DIR}/...")
        predict_errors = extract_predict_errors(PREDICT_DIR)
        print(f"  Found {len(predict_errors)} incorrect predictions with reasoning traces")

        # Group by thinking vs no-thinking
        with_thinking = [e for e in predict_errors if e["has_thinking"]]
        without_thinking = [e for e in predict_errors if not e["has_thinking"]]
        print(f"  With extended thinking: {len(with_thinking)}")
        print(f"  Without extended thinking (reasoning only): {len(without_thinking)}")

        # Show breakdown by model
        models = {}
        for e in predict_errors:
            models.setdefault(e["model"], 0)
            models[e["model"]] += 1
        for m, c in sorted(models.items()):
            print(f"    {m}: {c} errors")

        if args.dry_run:
            print("  [DRY RUN] Would classify these errors via API")
        else:
            # Filter out already-classified
            done_ids = set(checkpoint.get("predict_done_ids", []))
            remaining = [e for e in predict_errors if e["error_id"] not in done_ids]
            print(f"  Already classified: {len(done_ids)}, remaining: {len(remaining)}")

            for i, error in enumerate(remaining, 1):
                print(f"  Classifying predict error {i}/{len(remaining)}: "
                      f"{error['model']} config={error['config_index']} "
                      f"{error['ray_entry']['side']}-{error['ray_entry']['pos']}...", end="")
                try:
                    result = classify_predict_error(args.api_key, error)
                    if result:
                        checkpoint["predict"].append(result)
                        checkpoint["predict_done_ids"].append(error["error_id"])
                        print(f" → {result['primary_error']} "
                              f"({'spatial' if result['is_spatial'] else 'non-spatial'}) "
                              f"[{result['confidence']}]")
                    else:
                        print(" → FAILED (no response)")
                except Exception as e:
                    print(f" → ERROR: {e}")

                # Rate limiting
                time.sleep(REQUEST_INTERVAL)

                # Checkpoint every 50 items
                if i % 50 == 0:
                    save_checkpoint(checkpoint)
                    print(f"  [Checkpoint saved at {i}/{len(remaining)}]")

            save_checkpoint(checkpoint)

    # --- Play mode ---
    if args.mode in ("play", "both"):
        print(f"\nExtracting Play mode games from {PLAY_DIR}/...")
        play_games = extract_play_games(PLAY_DIR, max_games=args.max_play)
        print(f"  Found {len(play_games)} games with <4 atoms correct and reasoning traces")

        # Show breakdown
        models = {}
        for g in play_games:
            models.setdefault(g["model"], 0)
            models[g["model"]] += 1
        for m, c in sorted(models.items()):
            print(f"    {m}: {c} games")

        if args.dry_run:
            print("  [DRY RUN] Would classify these games via API")
        else:
            done_ids = set(checkpoint.get("play_done_ids", []))
            remaining = [g for g in play_games if g["game_id"] not in done_ids]
            print(f"  Already classified: {len(done_ids)}, remaining: {len(remaining)}")

            for i, game in enumerate(remaining, 1):
                print(f"  Classifying play game {i}/{len(remaining)}: "
                      f"{game['model']} config={game['config_index']} "
                      f"atoms={game['atoms_correct']}/4...", end="")
                try:
                    result = classify_play_game(args.api_key, game)
                    if result:
                        checkpoint["play"].append(result)
                        checkpoint["play_done_ids"].append(game["game_id"])
                        print(f" → {result['primary_failure_mode']} "
                              f"({'spatial' if result['is_spatial'] else 'non-spatial'}) "
                              f"[{result['confidence']}]")
                    else:
                        print(" → FAILED (no response)")
                except Exception as e:
                    print(f" → ERROR: {e}")

                time.sleep(REQUEST_INTERVAL)

                if i % 20 == 0:
                    save_checkpoint(checkpoint)
                    print(f"  [Checkpoint saved at {i}/{len(remaining)}]")

            save_checkpoint(checkpoint)

    # --- Write final output ---
    if not args.dry_run:
        output = {
            "metadata": {
                "classifier_model": CLASSIFIER_MODEL,
                "classification_date": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "error_taxonomy": ERROR_CATEGORIES,
                "predict_count": len(checkpoint["predict"]),
                "play_count": len(checkpoint["play"]),
            },
            "predict": checkpoint["predict"],
            "play": checkpoint["play"],
        }

        with open(OUTPUT_FILE, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nWrote {OUTPUT_FILE}: {len(checkpoint['predict'])} predict + "
              f"{len(checkpoint['play'])} play classifications")

        # Clean up checkpoint
        if os.path.exists(CHECKPOINT_FILE):
            os.remove(CHECKPOINT_FILE)
            print("Removed checkpoint file")

    # --- Summary statistics ---
    print("\n=== SUMMARY ===")
    if checkpoint["predict"]:
        spatial = sum(1 for p in checkpoint["predict"] if p.get("is_spatial"))
        total = len(checkpoint["predict"])
        print(f"Predict mode: {total} errors classified")
        print(f"  Spatial errors: {spatial} ({100*spatial/total:.1f}%)")
        print(f"  Non-spatial errors: {total-spatial} ({100*(total-spatial)/total:.1f}%)")

        # By category
        cats = {}
        for p in checkpoint["predict"]:
            c = p.get("primary_error", "unknown")
            cats[c] = cats.get(c, 0) + 1
        print("  By category:")
        for c, n in sorted(cats.items(), key=lambda x: -x[1]):
            label = ERROR_CATEGORIES.get(c, {}).get("label", c)
            print(f"    {label}: {n} ({100*n/total:.1f}%)")

    if checkpoint["play"]:
        spatial = sum(1 for p in checkpoint["play"] if p.get("is_spatial"))
        total = len(checkpoint["play"])
        print(f"\nPlay mode: {total} games classified")
        print(f"  Spatial primary failure: {spatial} ({100*spatial/total:.1f}%)")
        print(f"  Non-spatial primary failure: {total-spatial} ({100*(total-spatial)/total:.1f}%)")

        cats = {}
        for p in checkpoint["play"]:
            c = p.get("primary_failure_mode", "unknown")
            cats[c] = cats.get(c, 0) + 1
        print("  By category:")
        for c, n in sorted(cats.items(), key=lambda x: -x[1]):
            label = ERROR_CATEGORIES.get(c, {}).get("label", c)
            print(f"    {label}: {n} ({100*n/total:.1f}%)")


if __name__ == "__main__":
    main()
