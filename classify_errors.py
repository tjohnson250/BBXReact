#!/usr/bin/env python3
"""
classify_errors.py — Error classification for Black Box LLM reasoning experiments.

Predict mode: DETERMINISTIC classification based on outcome type mismatch patterns.
    No LLM needed — compares predicted vs actual outcomes to identify specific
    ray physics rule failures.

Play mode: LLM-as-judge classification (Claude) for non-spatial diagnostic failures.
    Uses Haiku for bulk classification with optional Opus gold-standard validation.

Usage:
    # Predict mode (no API key needed — fully deterministic):
    python classify_errors.py --mode predict

    # Play mode (requires API key):
    python classify_errors.py --mode play --api-key YOUR_KEY

    # Both modes:
    python classify_errors.py --api-key YOUR_KEY

    # Play mode with Opus gold-standard validation on subset:
    python classify_errors.py --mode play --api-key YOUR_KEY --gold-standard

    # Dry run (extract data, show counts):
    python classify_errors.py --dry-run

Output: error_classifications.json
"""

import argparse
import json
import glob
import os
import time
import hashlib

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PREDICT_DIR = "Experiment 1/Predict"
PLAY_DIR = "Experiment 1/Play"
OUTPUT_FILE = "error_classifications.json"
CHECKPOINT_FILE = "error_classifications_checkpoint.json"

HAIKU_MODEL = "claude-haiku-4-5-20251001"
OPUS_MODEL = "claude-opus-4-5-20251101"
API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"

MAX_PLAY_GAMES = 100
GOLD_STANDARD_SIZE = 100  # Opus validates this many Play classifications
REQUESTS_PER_MINUTE = 50
REQUEST_INTERVAL = 60.0 / REQUESTS_PER_MINUTE


# ---------------------------------------------------------------------------
# Predict mode: Deterministic error taxonomy
# ---------------------------------------------------------------------------
# In Predict mode, ALL errors are spatial (the task is purely spatial).
# The interesting question is WHICH ray physics rule broke down.

PREDICT_ERROR_CATEGORIES = {
    "missed_absorption": {
        "label": "Missed absorption",
        "description": "Predicted detour or reflection but ray was actually absorbed. "
                       "Model failed to check for an atom directly in the ray's forward path "
                       "before checking for diagonal deflections.",
        "pattern": "predicted detour/reflected → actual absorbed",
    },
    "missed_reflection": {
        "label": "Missed reflection",
        "description": "Predicted detour or absorption but ray actually reflected. "
                       "Model failed to recognize the reflection condition: atom diagonally "
                       "adjacent to the entry point, or atoms on both sides causing reversal.",
        "pattern": "predicted detour/absorbed → actual reflected",
    },
    "false_absorption": {
        "label": "False absorption",
        "description": "Predicted absorption but ray actually deflected or reflected. "
                       "Model incorrectly identified an atom in the ray's forward path, "
                       "or confused a diagonal atom with a forward atom.",
        "pattern": "predicted absorbed → actual detour/reflected",
    },
    "false_reflection": {
        "label": "False reflection",
        "description": "Predicted reflection but ray actually deflected or was absorbed. "
                       "Model incorrectly identified a reflection condition at the entry point.",
        "pattern": "predicted reflected → actual detour/absorbed",
    },
    "deflection_direction_error": {
        "label": "Deflection direction error",
        "description": "Both predicted and actual are detours, but ray exits on a different "
                       "side entirely. Model identified that deflection occurs but sent the "
                       "ray in the wrong direction (e.g., deflected south instead of west).",
        "pattern": "predicted detour(side-A) → actual detour(side-B), A ≠ B",
    },
    "off_by_one_error": {
        "label": "Off-by-one path error",
        "description": "Both predicted and actual are detours exiting the same side, but at "
                       "adjacent positions (off by exactly 1). Likely a coordinate indexing "
                       "error in cell-by-cell ray tracing, or confusion about which cell the "
                       "ray exits from after a deflection.",
        "pattern": "predicted detour(side-N) → actual detour(side-N±1)",
    },
    "large_path_error": {
        "label": "Large path tracking error",
        "description": "Both predicted and actual are detours exiting the same side, but "
                       "positions differ by 2 or more. Multiple accumulated errors in "
                       "cell-by-cell ray tracing.",
        "pattern": "predicted detour(side-N) → actual detour(side-M), |N-M| ≥ 2",
    },
}

# Play mode: keeps the original 6-category taxonomy (spatial + non-spatial)
PLAY_ERROR_CATEGORIES = {
    "ray_path_error": {
        "label": "Ray path error",
        "spatial": True,
        "description": "Misinterpreted ray results, traced paths incorrectly in mental model"
    },
    "deflection_geometry_error": {
        "label": "Deflection geometry error",
        "spatial": True,
        "description": "Misunderstood how atoms deflect/reflect/absorb rays"
    },
    "constraint_tracking_error": {
        "label": "Constraint tracking error",
        "spatial": False,
        "description": "Failed to maintain or update candidate positions from earlier rays"
    },
    "experiment_design_error": {
        "label": "Experiment design error",
        "spatial": False,
        "description": "Chose uninformative or redundant rays"
    },
    "belief_updating_error": {
        "label": "Belief updating error",
        "spatial": False,
        "description": "Had contradicting evidence but failed to revise hypothesis"
    },
    "premature_commitment": {
        "label": "Premature commitment",
        "spatial": False,
        "description": "Locked onto atom positions too early"
    },
}


# ---------------------------------------------------------------------------
# Outcome parsing helpers
# ---------------------------------------------------------------------------

def classify_outcome_type(s):
    """Parse a prediction/actual string into outcome type."""
    s = s.strip().lower()
    if "absorbed" in s or "hit" in s:
        return "absorbed"
    if "reflected" in s or "reflection" in s:
        return "reflected"
    return "detour"


def parse_exit(s):
    """Parse 'side-pos' from a detour outcome string. Returns (side, pos) or None."""
    s = s.strip().lower()
    for side in ["north", "south", "east", "west"]:
        if side in s:
            for tok in s.replace("-", " ").split():
                if tok.isdigit():
                    return (side, int(tok))
    return None


# ---------------------------------------------------------------------------
# Deterministic Predict mode classifier
# ---------------------------------------------------------------------------

def deterministic_classify_predict(predicted, actual):
    """
    Classify a Predict mode error deterministically from outcome comparison.

    Returns dict with error_category, error_label, and description.
    No LLM needed — this is 100% deterministic.
    """
    pred_type = classify_outcome_type(predicted)
    actual_type = classify_outcome_type(actual)

    # Category mismatch errors (different outcome types)
    if pred_type != actual_type:
        if actual_type == "absorbed":
            if pred_type == "reflected":
                return "missed_absorption"
            else:  # detour
                return "missed_absorption"

        if actual_type == "reflected":
            if pred_type == "absorbed":
                return "missed_reflection"
            else:  # detour
                return "missed_reflection"

        if pred_type == "absorbed":
            return "false_absorption"

        if pred_type == "reflected":
            return "false_reflection"

    # Same-type errors (both detour, but different exit)
    if pred_type == "detour" and actual_type == "detour":
        pred_exit = parse_exit(predicted)
        actual_exit = parse_exit(actual)

        if pred_exit and actual_exit:
            if pred_exit[0] != actual_exit[0]:
                return "deflection_direction_error"
            else:
                delta = abs(pred_exit[1] - actual_exit[1])
                if delta <= 1:
                    return "off_by_one_error"
                else:
                    return "large_path_error"

    # Fallback (shouldn't normally reach here)
    return "large_path_error"


# ---------------------------------------------------------------------------
# Data extraction
# ---------------------------------------------------------------------------

def extract_predict_errors(predict_dir):
    """Extract all incorrect predictions from Predict experiment files."""
    errors = []
    for filepath in sorted(glob.glob(os.path.join(predict_dir, "*.json"))):
        with open(filepath) as f:
            data = json.load(f)

        for result in data.get("results", []):
            for pred in result.get("predictions", []):
                if pred.get("correct", True):
                    continue

                thinking = pred.get("thinking", "")
                reasoning = pred.get("reasoning", "")
                has_thinking = bool(thinking and len(thinking) > 50)

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
                    "has_thinking": has_thinking,
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
                        f"RAY {i}: Fired {entry.get('side', '?').upper()}-{entry.get('pos', '?')}"
                        f" → {ray_result}\n"
                        f"REASONING: {trace[:800] if trace else '(none)'}\n"
                    )
                elif action.get("action") == "mark":
                    pos = action.get("position", {})
                    transcript_parts.append(
                        f"ACTION {i}: Marked hypothesis at ({pos.get('row', '?')},{pos.get('col', '?')})\n"
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

    if len(games) > max_games:
        import random
        random.seed(42)
        games.sort(key=lambda g: (g["model"], g["config_index"]))
        games = random.sample(games, max_games)

    return games


# ---------------------------------------------------------------------------
# API call helper
# ---------------------------------------------------------------------------

RAY_PHYSICS_REFERENCE = """
BLACK BOX RAY PHYSICS RULES:
- The grid is 8x8 with rows 1-8 and columns 1-8.
- Rays enter from edge positions: NORTH/SOUTH use columns 1-8, EAST/WEST use rows 1-8.
- A ray from NORTH-c enters at row 1, column c, traveling south (increasing row).
- A ray from SOUTH-c enters at row 8, column c, traveling north (decreasing row).
- A ray from WEST-r enters at row r, column 1, traveling east (increasing column).
- A ray from EAST-r enters at row r, column 8, traveling west (decreasing column).

INTERACTION RULES (checked in order at each step):
1. ABSORPTION: If the ray's next cell contains an atom, the ray is absorbed (HIT).
   - Entry absorption: If the first cell the ray enters has an atom -> absorbed.
2. REFLECTION: At the entry point only, if an atom is diagonally ahead to the left
   or right, the ray reflects back out. Also: atoms on BOTH sides ahead -> 180 reversal.
3. DEFLECTION: During traversal, if a single atom is diagonally ahead on one side:
   - Atom on LEFT diagonal ahead -> ray turns RIGHT (90 degrees)
   - Atom on RIGHT diagonal ahead -> ray turns LEFT (90 degrees)
   - Atoms on BOTH sides ahead -> ray reverses (180 degrees)
   Note: absorption (atom directly ahead) is checked BEFORE deflection.
4. The ray continues until it exits the grid or is absorbed.
"""

PLAY_CLASSIFICATION_PROMPT = """You are classifying errors in an LLM's game play of Black Box.

{ray_physics}

The LLM played a full game: firing rays, observing results, and guessing 4 hidden atom positions.

ACTUAL ATOM POSITIONS: {atom_config}
LLM'S FINAL GUESS: {final_guess}
ATOMS CORRECT: {atoms_correct}/4
RAYS USED: {rays_used}

GAME TRANSCRIPT:
{transcript}

Classify the PRIMARY failure mode. Focus on the root cause — the earliest or most impactful error that led to the wrong final guess.

CATEGORIES:
1. ray_path_error — Misinterpreted ray results spatially (traced paths incorrectly in mental model)
2. deflection_geometry_error — Misunderstood deflection/reflection/absorption rules when interpreting results
3. constraint_tracking_error — Failed to maintain or update candidate positions; "forgot" constraints from earlier rays
4. experiment_design_error — Chose uninformative or redundant rays; didn't systematically narrow candidates
5. belief_updating_error — Had contradicting evidence but failed to revise hypothesis
6. premature_commitment — Locked onto positions too early, stopped using discriminating evidence

Respond with ONLY a JSON object:
{{
  "primary_failure_mode": "<category_id>",
  "secondary_failure_mode": "<category_id or null>",
  "is_spatial": <true if primary is ray_path_error or deflection_geometry_error, else false>,
  "confidence": "<high|medium|low>",
  "spatial_errors_in_game": <count of individual ray interpretations with spatial errors>,
  "total_reasoning_steps": <count of distinct reasoning steps>,
  "key_decision_point": "<1-2 sentences: where did it go wrong?>",
  "justification": "<1-2 sentences: why this category?>"
}}
"""


def call_claude(api_key, prompt, model=HAIKU_MODEL, max_retries=3):
    """Call Claude API with retries and rate limiting."""
    import urllib.request
    import urllib.error

    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": API_VERSION,
    }

    body = json.dumps({
        "model": model,
        "max_tokens": 512,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
    }).encode("utf-8")

    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(API_URL, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                text = result["content"][0]["text"]
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
# Play mode classifier
# ---------------------------------------------------------------------------

def classify_play_game(api_key, game, model=HAIKU_MODEL):
    """Classify a single Play mode game failure via LLM."""
    atom_str = ", ".join(f"({r},{c})" for r, c in game["atom_config"])
    guess_str = (", ".join(f"({r},{c})" for r, c in game["final_guess"])
                 if game["final_guess"] else "(no guess)")

    prompt = PLAY_CLASSIFICATION_PROMPT.format(
        ray_physics=RAY_PHYSICS_REFERENCE,
        atom_config=atom_str,
        final_guess=guess_str,
        atoms_correct=game["atoms_correct"],
        rays_used=game["rays_used"],
        transcript=game["transcript"],
    )

    result = call_claude(api_key, prompt, model=model)
    if result is None:
        return None

    primary = result.get("primary_failure_mode", "unknown")
    if primary not in PLAY_ERROR_CATEGORIES:
        for cat_id in PLAY_ERROR_CATEGORIES:
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
        "classifier_model": model,
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
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {"predict": [], "play": [], "play_gold": [],
            "play_done_ids": [], "play_gold_ids": []}


def save_checkpoint(data):
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(data, f, indent=2)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Classify Black Box experiment errors. "
                    "Predict mode is fully deterministic (no API key needed). "
                    "Play mode uses Claude as judge (API key required)."
    )
    parser.add_argument("--api-key",
                        default=os.environ.get("ANTHROPIC_API_KEY"),
                        help="Anthropic API key (required for Play mode; "
                             "defaults to ANTHROPIC_API_KEY env var)")
    parser.add_argument("--mode", choices=["predict", "play", "both"], default="both",
                        help="Which mode to classify (default: both)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Extract data and show counts without classifying")
    parser.add_argument("--resume", action="store_true",
                        help="Resume Play mode from checkpoint")
    parser.add_argument("--gold-standard", action="store_true",
                        help="Also run Opus on a subset for gold-standard validation")
    parser.add_argument("--max-play", type=int, default=MAX_PLAY_GAMES,
                        help=f"Max play games to classify (default: {MAX_PLAY_GAMES})")
    args = parser.parse_args()

    if args.mode in ("play", "both") and not args.api_key and not args.dry_run:
        parser.error("--api-key is required for Play mode classification "
                     "(pass --api-key or set ANTHROPIC_API_KEY)")

    checkpoint = load_checkpoint() if args.resume else {
        "predict": [], "play": [], "play_gold": [],
        "play_done_ids": [], "play_gold_ids": []
    }

    # =======================================================================
    # PREDICT MODE — Fully deterministic
    # =======================================================================
    if args.mode in ("predict", "both"):
        print("=" * 60)
        print("PREDICT MODE: Deterministic error classification")
        print("=" * 60)

        predict_errors = extract_predict_errors(PREDICT_DIR)
        print(f"Found {len(predict_errors)} incorrect predictions")

        # Classify every error deterministically
        predict_results = []
        for error in predict_errors:
            category = deterministic_classify_predict(error["predicted"], error["actual"])
            pred_type = classify_outcome_type(error["predicted"])
            actual_type = classify_outcome_type(error["actual"])

            pred_exit = parse_exit(error["predicted"]) if pred_type == "detour" else None
            actual_exit = parse_exit(error["actual"]) if actual_type == "detour" else None

            predict_results.append({
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
                "predicted_type": pred_type,
                "actual_type": actual_type,
                "predicted_exit": pred_exit,
                "actual_exit": actual_exit,
                "error_category": category,
                "error_label": PREDICT_ERROR_CATEGORIES[category]["label"],
                "classification_method": "deterministic",
            })

        checkpoint["predict"] = predict_results

        # --- Summary ---
        print(f"\nClassified {len(predict_results)} errors:")
        cats = {}
        for r in predict_results:
            c = r["error_category"]
            cats[c] = cats.get(c, 0) + 1
        for c, n in sorted(cats.items(), key=lambda x: -x[1]):
            label = PREDICT_ERROR_CATEGORIES[c]["label"]
            print(f"  {label:35s}: {n:5d} ({100*n/len(predict_results):5.1f}%)")

        # Breakdown by model
        print("\nBy model:")
        models = sorted(set(r["model"] for r in predict_results))
        for model in models:
            model_results = [r for r in predict_results if r["model"] == model]
            model_cats = {}
            for r in model_results:
                model_cats[r["error_category"]] = model_cats.get(r["error_category"], 0) + 1
            print(f"  {model} ({len(model_results)} errors):")
            for c, n in sorted(model_cats.items(), key=lambda x: -x[1]):
                label = PREDICT_ERROR_CATEGORIES[c]["label"]
                print(f"    {label:33s}: {n:4d} ({100*n/len(model_results):5.1f}%)")

        # Breakdown by prompt style
        print("\nBy prompt style:")
        for style in sorted(set(r["prompt_style"] for r in predict_results)):
            style_results = [r for r in predict_results if r["prompt_style"] == style]
            style_cats = {}
            for r in style_results:
                style_cats[r["error_category"]] = style_cats.get(r["error_category"], 0) + 1
            print(f"  {style} ({len(style_results)} errors):")
            for c, n in sorted(style_cats.items(), key=lambda x: -x[1]):
                label = PREDICT_ERROR_CATEGORIES[c]["label"]
                print(f"    {label:33s}: {n:4d} ({100*n/len(style_results):5.1f}%)")

        # Entry side asymmetry
        print("\nBy entry side:")
        for side in ["north", "south", "east", "west"]:
            side_results = [r for r in predict_results
                            if r["ray_entry"]["side"] == side]
            if side_results:
                print(f"  {side:6s}: {len(side_results)} errors")

    # =======================================================================
    # PLAY MODE — LLM-as-judge
    # =======================================================================
    if args.mode in ("play", "both"):
        print("\n" + "=" * 60)
        print("PLAY MODE: LLM-as-judge classification (Claude)")
        print("=" * 60)

        play_games = extract_play_games(PLAY_DIR, max_games=args.max_play)
        print(f"Found {len(play_games)} games with <4 atoms correct")

        models = {}
        for g in play_games:
            models.setdefault(g["model"], 0)
            models[g["model"]] += 1
        for m, c in sorted(models.items()):
            print(f"  {m}: {c} games")

        if args.dry_run:
            print("[DRY RUN] Would classify these games via Haiku API")
            if args.gold_standard:
                print(f"[DRY RUN] Would also classify {min(GOLD_STANDARD_SIZE, len(play_games))} "
                      f"via Opus for gold-standard validation")
        else:
            # --- Haiku classification ---
            done_ids = set(checkpoint.get("play_done_ids", []))
            remaining = [g for g in play_games if g["game_id"] not in done_ids]
            print(f"Already classified: {len(done_ids)}, remaining: {len(remaining)}")

            for i, game in enumerate(remaining, 1):
                print(f"  [{i}/{len(remaining)}] {game['model']} "
                      f"config={game['config_index']} "
                      f"atoms={game['atoms_correct']}/4...", end="")
                try:
                    result = classify_play_game(args.api_key, game, model=HAIKU_MODEL)
                    if result:
                        checkpoint["play"].append(result)
                        checkpoint["play_done_ids"].append(game["game_id"])
                        print(f" → {result['primary_failure_mode']} "
                              f"({'spatial' if result['is_spatial'] else 'non-spatial'}) "
                              f"[{result['confidence']}]")
                    else:
                        print(" → FAILED")
                except Exception as e:
                    print(f" → ERROR: {e}")

                time.sleep(REQUEST_INTERVAL)
                if i % 20 == 0:
                    save_checkpoint(checkpoint)

            save_checkpoint(checkpoint)

            # --- Opus gold-standard validation ---
            if args.gold_standard:
                print(f"\nRunning Opus gold-standard validation...")
                gold_ids = set(checkpoint.get("play_gold_ids", []))
                # Select games that have Haiku classifications
                haiku_classified = {r["game_id"]: r for r in checkpoint["play"]}
                gold_candidates = [g for g in play_games
                                   if g["game_id"] in haiku_classified
                                   and g["game_id"] not in gold_ids]

                import random
                random.seed(42)
                gold_sample = random.sample(
                    gold_candidates,
                    min(GOLD_STANDARD_SIZE, len(gold_candidates))
                )
                print(f"Validating {len(gold_sample)} games with Opus...")

                for i, game in enumerate(gold_sample, 1):
                    print(f"  [{i}/{len(gold_sample)}] {game['model']} "
                          f"config={game['config_index']}...", end="")
                    try:
                        result = classify_play_game(
                            args.api_key, game, model=OPUS_MODEL
                        )
                        if result:
                            # Store Haiku's classification alongside for comparison
                            haiku_result = haiku_classified[game["game_id"]]
                            result["haiku_primary"] = haiku_result["primary_failure_mode"]
                            result["haiku_is_spatial"] = haiku_result["is_spatial"]
                            result["haiku_confidence"] = haiku_result["confidence"]
                            result["agreement"] = (
                                result["primary_failure_mode"] ==
                                haiku_result["primary_failure_mode"]
                            )
                            checkpoint["play_gold"].append(result)
                            checkpoint["play_gold_ids"].append(game["game_id"])
                            agree = "AGREE" if result["agreement"] else "DISAGREE"
                            print(f" → Opus: {result['primary_failure_mode']} | "
                                  f"Haiku: {haiku_result['primary_failure_mode']} "
                                  f"[{agree}]")
                        else:
                            print(" → FAILED")
                    except Exception as e:
                        print(f" → ERROR: {e}")

                    time.sleep(REQUEST_INTERVAL)
                    if i % 10 == 0:
                        save_checkpoint(checkpoint)

                save_checkpoint(checkpoint)

            # --- Play summary ---
            if checkpoint["play"]:
                print(f"\nPlay mode: {len(checkpoint['play'])} games classified (Haiku)")
                cats = {}
                for p in checkpoint["play"]:
                    c = p.get("primary_failure_mode", "unknown")
                    cats[c] = cats.get(c, 0) + 1
                total = len(checkpoint["play"])
                spatial = sum(1 for p in checkpoint["play"] if p.get("is_spatial"))
                print(f"  Spatial: {spatial} ({100*spatial/total:.1f}%)")
                print(f"  Non-spatial: {total-spatial} ({100*(total-spatial)/total:.1f}%)")
                for c, n in sorted(cats.items(), key=lambda x: -x[1]):
                    label = PLAY_ERROR_CATEGORIES.get(c, {}).get("label", c)
                    print(f"    {label:30s}: {n:3d} ({100*n/total:5.1f}%)")

            if checkpoint.get("play_gold"):
                gold = checkpoint["play_gold"]
                agree = sum(1 for g in gold if g.get("agreement"))
                print(f"\nGold-standard validation: {agree}/{len(gold)} "
                      f"({100*agree/len(gold):.1f}%) Haiku-Opus agreement")

                # Per-category agreement
                spatial_gold = [g for g in gold
                                if g["is_spatial"] or g["haiku_is_spatial"]]
                if spatial_gold:
                    spatial_agree = sum(1 for g in spatial_gold if g.get("agreement"))
                    print(f"  Spatial categories: {spatial_agree}/{len(spatial_gold)} "
                          f"({100*spatial_agree/len(spatial_gold):.1f}%) agreement")

                nonspatial_gold = [g for g in gold
                                   if not g["is_spatial"] and not g["haiku_is_spatial"]]
                if nonspatial_gold:
                    ns_agree = sum(1 for g in nonspatial_gold if g.get("agreement"))
                    print(f"  Non-spatial categories: {ns_agree}/{len(nonspatial_gold)} "
                          f"({100*ns_agree/len(nonspatial_gold):.1f}%) agreement")

    # =======================================================================
    # Write final output
    # =======================================================================
    if not args.dry_run:
        # When running a single mode, preserve the other mode's data from
        # the existing output file so we don't clobber prior results.
        existing = {}
        if os.path.exists(OUTPUT_FILE):
            with open(OUTPUT_FILE) as f:
                existing = json.load(f)

        predict_data = checkpoint.get("predict", [])
        play_data = checkpoint.get("play", [])
        play_gold_data = checkpoint.get("play_gold", [])

        if args.mode == "play" and not predict_data:
            predict_data = existing.get("predict", [])
        if args.mode == "predict" and not play_data:
            play_data = existing.get("play", [])
            play_gold_data = existing.get("play_gold_standard", [])

        output = {
            "metadata": {
                "classification_date": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "predict_method": "deterministic (outcome type comparison)",
                "play_method": f"LLM-as-judge ({HAIKU_MODEL})",
                "play_gold_standard_model": OPUS_MODEL if args.gold_standard else None,
                "predict_taxonomy": PREDICT_ERROR_CATEGORIES,
                "play_taxonomy": PLAY_ERROR_CATEGORIES,
                "predict_count": len(predict_data),
                "play_count": len(play_data),
                "play_gold_count": len(play_gold_data),
            },
            "predict": predict_data,
            "play": play_data,
            "play_gold_standard": play_gold_data,
        }

        with open(OUTPUT_FILE, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nWrote {OUTPUT_FILE}")

        if os.path.exists(CHECKPOINT_FILE):
            os.remove(CHECKPOINT_FILE)


if __name__ == "__main__":
    main()
