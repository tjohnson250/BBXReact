#!/usr/bin/env python3
"""
prerender.py — Quarto pre-render script for Black Box LLM study.

Checks whether derived data files are stale (older than their inputs)
and rebuilds them as needed before quarto renders the document.

Derived files and their dependencies:
  optimal_solver_results.json   <- blackbox_solver.py
  error_classifications.json    <- classify_errors.py, Experiment 1/{Predict,Play}/*.json
  experiment1_play_combined.json <- Experiment 1/Play/*.json
  experiment1_play_combined_analysis.json <- experiment1_play_combined.json,
                                             blackbox_solver.py, optimal_solver_results.json

Always exits 0 so quarto doesn't abort the render.
"""

import glob
import json
import os
import subprocess
import sys
import time


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def newest_mtime(patterns):
    """Return the newest mtime across all files matching the given glob patterns.
    Returns 0 if no files match."""
    newest = 0
    for pat in patterns:
        for f in glob.glob(pat):
            newest = max(newest, os.path.getmtime(f))
    return newest


def file_mtime(path):
    """Return mtime of a file, or 0 if it doesn't exist."""
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0


def is_stale(output_path, input_patterns):
    """Check if output is missing or older than any input."""
    out_mt = file_mtime(output_path)
    if out_mt == 0:
        return True  # missing
    in_mt = newest_mtime(input_patterns)
    return in_mt > out_mt


def run_command(cmd, description, slow_warning=None):
    """Run a shell command, printing status. Returns True on success."""
    print(f"  Running: {' '.join(cmd)}")
    if slow_warning:
        print(f"  Note: {slow_warning}")
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        if result.stdout:
            # Print last few lines of output as summary
            lines = result.stdout.strip().split("\n")
            for line in lines[-5:]:
                print(f"    {line}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"  WARNING: {description} failed (exit code {e.returncode})")
        if e.stderr:
            for line in e.stderr.strip().split("\n")[-5:]:
                print(f"    {line}")
        return False


# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

PLAY_DIR = "Experiment 1/Play"
PREDICT_DIR = "Experiment 1/Predict"


def step_optimal_solver():
    """Rebuild optimal_solver_results.json if blackbox_solver.py changed."""
    output = "optimal_solver_results.json"
    inputs = ["blackbox_solver.py"]

    if not is_stale(output, inputs):
        print(f"[OK] {output} is current")
        return

    print(f"[REBUILD] {output}")
    run_command(
        [sys.executable, "blackbox_solver.py", "benchmark"],
        "optimal solver benchmark",
        slow_warning="This may take ~10 minutes",
    )


def step_error_classifications():
    """Check error_classifications.json staleness.

    This file has two independent sections (predict and play).
    - Predict mode is deterministic and fast, but running --mode predict alone
      would overwrite any existing play classifications.
    - Play mode requires an API key and costs money.

    To avoid data loss, we only auto-run when the file doesn't exist at all
    (predict-only). Otherwise we warn about staleness.
    """
    output = "error_classifications.json"
    predict_inputs = ["classify_errors.py"] + glob.glob(f"{PREDICT_DIR}/*.json")
    play_inputs = glob.glob(f"{PLAY_DIR}/*.json")

    if not os.path.exists(output):
        print(f"[REBUILD] {output} (predict mode only)")
        run_command(
            [sys.executable, "classify_errors.py", "--mode", "predict"],
            "predict error classification",
        )
        if play_inputs:
            print(f"  WARNING: Play error classifications not included.")
            print(f"  Run manually: python3 classify_errors.py --mode play --api-key YOUR_KEY --resume")
        return

    # File exists — check staleness for each portion
    out_mt = file_mtime(output)
    predict_mt = newest_mtime(["classify_errors.py"] + [f"{PREDICT_DIR}/*.json"])
    play_mt = newest_mtime([f"{PLAY_DIR}/*.json"])

    stale_parts = []
    if predict_mt > out_mt:
        stale_parts.append("predict")
    if play_mt > out_mt:
        stale_parts.append("play")

    if not stale_parts:
        print(f"[OK] {output} is current")
        return

    print(f"[STALE] {output} — stale portions: {', '.join(stale_parts)}")
    if "predict" in stale_parts:
        print(f"  Re-run predict: python3 classify_errors.py --mode predict --resume")
    if "play" in stale_parts:
        print(f"  Re-run play:    python3 classify_errors.py --mode play --api-key YOUR_KEY --resume")


def step_combine_play():
    """Merge all Play experiment JSONs into experiment1_play_combined.json."""
    output = "experiment1_play_combined.json"
    input_pattern = f"{PLAY_DIR}/*.json"
    play_files = sorted(glob.glob(input_pattern))

    if not play_files:
        print(f"[SKIP] No Play experiment files found in {PLAY_DIR}/")
        return

    if not is_stale(output, [input_pattern]):
        print(f"[OK] {output} is current")
        return

    print(f"[REBUILD] {output} (merging {len(play_files)} files)")
    all_results = []
    for f in play_files:
        try:
            data = json.load(open(f))
            results = data.get("results", [])
            all_results.extend(results)
        except (json.JSONDecodeError, KeyError) as e:
            print(f"  WARNING: Skipping {f}: {e}")

    combined = {
        "exportTime": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "results": all_results,
    }
    with open(output, "w") as out:
        json.dump(combined, out, indent=2)
    print(f"  Merged {len(all_results)} results from {len(play_files)} files")


def step_analyze_play():
    """Run deterministic play analysis on the combined file."""
    input_file = "experiment1_play_combined.json"
    output = "experiment1_play_combined_analysis.json"
    inputs = [input_file, "blackbox_solver.py", "optimal_solver_results.json"]

    if not os.path.exists(input_file):
        print(f"[SKIP] {output} — {input_file} not found")
        return

    if not os.path.exists("optimal_solver_results.json"):
        print(f"[SKIP] {output} — optimal_solver_results.json not found")
        return

    if not is_stale(output, inputs):
        print(f"[OK] {output} is current")
        return

    print(f"[REBUILD] {output}")
    run_command(
        [sys.executable, "blackbox_solver.py", "analyze", input_file,
         "--output", output],
        "deterministic play analysis",
        slow_warning="This may take 10-30+ minutes depending on game count",
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("prerender.py — checking derived data files")
    print("=" * 60)

    step_optimal_solver()
    step_error_classifications()
    step_combine_play()
    step_analyze_play()

    print("=" * 60)
    print("prerender.py — done")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Always exit 0 so quarto doesn't abort the render
        print(f"prerender.py ERROR: {e}", file=sys.stderr)
        sys.exit(0)
