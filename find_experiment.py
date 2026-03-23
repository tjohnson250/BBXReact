#!/usr/bin/env python3
"""
Find and filter Black Box experiment result files by condition.

Interactive mode (default):
    python find_experiment.py

Command-line mode (any filter flag):
    python find_experiment.py --mode play --model "Opus 4.5" --prompt augmented
    python find_experiment.py --mode predict --vot B --json
    python find_experiment.py --files-only --experiment 3
"""

import argparse
import json
import os
import re
import sys
import webbrowser
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CACHE_FILE = BASE_DIR / ".find_experiment_cache.json"
CACHE_VERSION = 2

SCAN_DIRS = [
    ("Exp1/Play",           BASE_DIR / "Experiment 1" / "Play"),
    ("Exp1/Predict",        BASE_DIR / "Experiment 1" / "Predict"),
    ("ErrBase/Play",        BASE_DIR / "Experiment 1" / "Erroneous Baseline" / "Play"),
    ("ErrBase/Predict",     BASE_DIR / "Experiment 1" / "Erroneous Baseline" / "Predict"),
    ("Exp3",                BASE_DIR / "Experiment 3 Multiple Runs Top Leaders"),
]

# ─── Scanning & Indexing ────────────────────────────────────────────────────

def parse_timestamp(filename):
    """Extract ISO-ish timestamp from filename like ..._2026-01-03T20-52-24.json"""
    m = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})', filename)
    if not m:
        return None
    return datetime.strptime(m.group(1), "%Y-%m-%dT%H-%M-%S")

def filename_prefix(filename):
    """Strip timestamp and extension: blackbox_experiment_play_augmented_viz_hyp"""
    return re.sub(r'_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\w+$', '', filename)

def find_html_pair(json_path, html_files_by_prefix):
    """Find the HTML file matching a JSON file by prefix and closest timestamp."""
    json_name = json_path.name
    prefix = filename_prefix(json_name)
    json_ts = parse_timestamp(json_name)
    if json_ts is None:
        return None

    candidates = html_files_by_prefix.get(prefix, [])
    best = None
    best_delta = None
    for html_path in candidates:
        html_ts = parse_timestamp(html_path.name)
        if html_ts is None:
            continue
        delta = abs((json_ts - html_ts).total_seconds())
        if delta <= 120 and (best_delta is None or delta < best_delta):
            best = html_path
            best_delta = delta
    return best

def extract_metadata(json_path, source_label):
    """Parse a JSON experiment file and return lightweight metadata."""
    try:
        with open(json_path, "r") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None

    ec = data.get("experimentConfig", {})
    results = data.get("results", [])
    if not results:
        return None

    # Collect unique models
    models = sorted(set(r.get("modelName", "Unknown") for r in results))

    # Collect unique config indices
    config_indices = sorted(set(r.get("configIndex", -1) for r in results))

    # Build per-model summaries
    model_summaries = {}
    mode = ec.get("taskMode", "unknown")
    for r in results:
        mn = r.get("modelName", "Unknown")
        if mn not in model_summaries:
            model_summaries[mn] = {"count": 0}
            if mode == "play":
                model_summaries[mn].update({"total_atoms": 0, "total_score": 0, "total_rays": 0})
            elif mode == "predict":
                model_summaries[mn].update({"total_correct": 0, "total_predictions": 0})

        s = model_summaries[mn]
        s["count"] += 1

        if mode == "play":
            s["total_atoms"] += r.get("atomsCorrect", 0)
            s["total_score"] += r.get("score", 0)
            s["total_rays"] += r.get("raysUsed", 0)
        elif mode == "predict":
            preds = r.get("predictions", [])
            s["total_predictions"] += len(preds)
            s["total_correct"] += sum(1 for p in preds if p.get("correct"))

    # Compute averages
    for mn, s in model_summaries.items():
        if s["count"] > 0:
            if mode == "play":
                s["avg_atoms"] = round(s["total_atoms"] / s["count"], 1)
                s["avg_score"] = round(s["total_score"] / s["count"], 1)
                s["avg_rays"] = round(s["total_rays"] / s["count"], 1)
            elif mode == "predict":
                if s["total_predictions"] > 0:
                    s["accuracy"] = round(s["total_correct"] / s["total_predictions"] * 100, 1)
                else:
                    s["accuracy"] = 0.0

    # Extract date from exportTime
    export_time = data.get("exportTime", "")
    date_str = export_time[:10] if len(export_time) >= 10 else "unknown"

    return {
        "json_path": str(json_path),
        "json_mtime": os.path.getmtime(json_path),
        "source": source_label,
        "mode": mode,
        "models": models,
        "prompt_style": ec.get("promptStyle", "unknown"),
        "include_viz": ec.get("includeVisualization", False),
        "allow_hyp": ec.get("allowHypotheses", False),
        "enable_thinking": ec.get("enableThinking", False),
        "thinking_budget": ec.get("thinkingBudget", 0),
        "vot_grid": ec.get("votGridState", False),
        "vot_ray": ec.get("votRayTrace", False),
        "vot_hyp": ec.get("votHypothesis", False),
        "prompt_condition": ec.get("promptCondition", ""),
        "config_indices": config_indices,
        "result_count": len(results),
        "model_summaries": model_summaries,
        "date": date_str,
        "is_erroneous": "ErrBase" in source_label,
    }

def scan_directories():
    """Scan all known directories and build the file index."""
    entries = []
    for source_label, dir_path in SCAN_DIRS:
        if not dir_path.is_dir():
            continue

        # Collect HTML files by prefix for pairing
        html_files_by_prefix = {}
        for f in dir_path.iterdir():
            if f.suffix == ".html" and f.name.startswith("blackbox_experiment_"):
                prefix = filename_prefix(f.name)
                html_files_by_prefix.setdefault(prefix, []).append(f)

        # Process JSON files
        for f in sorted(dir_path.iterdir()):
            if f.suffix != ".json" or not f.name.startswith("blackbox_experiment_"):
                continue

            meta = extract_metadata(f, source_label)
            if meta is None:
                continue

            html_pair = find_html_pair(f, html_files_by_prefix)
            meta["html_path"] = str(html_pair) if html_pair else None
            entries.append(meta)

    return entries

def load_cache():
    """Load cached index if it exists and is fresh."""
    if not CACHE_FILE.exists():
        return None
    try:
        with open(CACHE_FILE, "r") as f:
            cache = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None

    if cache.get("version") != CACHE_VERSION:
        return None

    # Check staleness: compare stored mtimes with current
    for entry in cache.get("entries", []):
        jp = entry.get("json_path")
        if not jp or not os.path.exists(jp):
            return None
        if abs(os.path.getmtime(jp) - entry.get("json_mtime", 0)) > 1:
            return None

    # Also check if any new JSON files appeared
    cached_paths = {e["json_path"] for e in cache.get("entries", [])}
    for _, dir_path in SCAN_DIRS:
        if not dir_path.is_dir():
            continue
        for f in dir_path.iterdir():
            if f.suffix == ".json" and f.name.startswith("blackbox_experiment_"):
                if str(f) not in cached_paths:
                    return None

    return cache["entries"]

def save_cache(entries):
    """Save index to cache file."""
    cache = {"version": CACHE_VERSION, "entries": entries}
    try:
        with open(CACHE_FILE, "w") as f:
            json.dump(cache, f, indent=2)
    except OSError:
        pass

def get_entries(use_cache=True, rebuild_cache=False):
    """Get file entries, using cache when possible."""
    if use_cache and not rebuild_cache:
        cached = load_cache()
        if cached is not None:
            return cached

    entries = scan_directories()
    if use_cache:
        save_cache(entries)
    return entries


# ─── Filtering ──────────────────────────────────────────────────────────────

def apply_filters(entries, filters):
    """Apply filter dict to entries. Returns filtered list."""
    result = []
    for e in entries:
        if filters.get("mode") and e["mode"] != filters["mode"]:
            continue
        if filters.get("prompt") and e["prompt_style"] != filters["prompt"]:
            continue
        if filters.get("thinking") is not None:
            if e["enable_thinking"] != filters["thinking"]:
                continue
        if filters.get("models"):
            # File matches if ANY of its models match ANY of the filter models
            filter_models_lower = [m.lower() for m in filters["models"]]
            if not any(m.lower() in filter_models_lower for m in e["models"]):
                continue
        if filters.get("vot") is not None:
            vot = filters["vot"]
            if vot == "none":
                if e["vot_grid"] or e["vot_ray"] or e["vot_hyp"]:
                    continue
            elif vot == "A":
                if not e["vot_grid"]:
                    continue
            elif vot == "B":
                if not e["vot_ray"]:
                    continue
            elif vot == "C":
                if not e["vot_hyp"]:
                    continue
        if filters.get("config") is not None:
            if filters["config"] not in e["config_indices"]:
                continue
        if filters.get("source"):
            src = filters["source"]
            if src == "exp1":
                if "Exp1" not in e["source"]:
                    continue
            elif src == "exp3":
                if "Exp3" not in e["source"]:
                    continue
            elif src == "erroneous":
                if not e["is_erroneous"]:
                    continue
            elif src == "no_erroneous":
                if e["is_erroneous"]:
                    continue
        if filters.get("experiment"):
            exp = filters["experiment"]
            if exp == 1:
                if "Exp1" not in e["source"] and "ErrBase" not in e["source"]:
                    continue
            elif exp == 3:
                if "Exp3" not in e["source"]:
                    continue
        if filters.get("condition"):
            if e["prompt_condition"] != filters["condition"]:
                continue
        result.append(e)
    return result


# ─── Output Formatting ──────────────────────────────────────────────────────

def condition_label(e):
    """Build a readable condition string from component flags."""
    parts = [e["prompt_style"]]
    if e["include_viz"]:
        parts.append("viz")
    if e["allow_hyp"]:
        parts.append("hyp")
    if e["enable_thinking"]:
        parts.append("think")
    return "+".join(parts)

def vot_label(e):
    """Describe VoT flags."""
    parts = []
    if e["vot_grid"]:
        parts.append("A(grid)")
    if e["vot_ray"]:
        parts.append("B(ray)")
    if e["vot_hyp"]:
        parts.append("C(hyp)")
    return ", ".join(parts) if parts else "none"

def format_table(entries):
    """Format entries as a readable table with file paths and summaries."""
    if not entries:
        print("No matching files found.")
        return

    print(f"\nFound {len(entries)} file(s):\n")

    # Table header
    rows = []
    for i, e in enumerate(entries, 1):
        source = e["source"]
        if e["is_erroneous"]:
            source = "\u26a0 " + source
        models_str = ", ".join(e["models"])
        if len(models_str) > 28:
            models_str = models_str[:25] + "..."
        cond = condition_label(e)
        vot = vot_label(e)
        if vot != "none":
            cond += f" VoT:{vot}"
        rows.append((str(i), source, e["mode"], models_str, cond, str(e["result_count"]), e["date"]))

    # Compute column widths
    headers = ("#", "Source", "Mode", "Models", "Condition", "Results", "Date")
    widths = [len(h) for h in headers]
    for row in rows:
        for j, cell in enumerate(row):
            widths[j] = max(widths[j], len(cell))

    # Print header
    header_line = " \u2502 ".join(h.ljust(widths[j]) for j, h in enumerate(headers))
    sep_line = "\u2500\u253c\u2500".join("\u2500" * widths[j] for j in range(len(headers)))
    print(f"  {header_line}")
    print(f"  {sep_line}")

    # Print rows
    for row in rows:
        line = " \u2502 ".join(cell.ljust(widths[j]) for j, cell in enumerate(row))
        print(f"  {line}")

    # File paths
    print("\nFile paths:")
    for i, e in enumerate(entries, 1):
        json_rel = os.path.relpath(e["json_path"], BASE_DIR)
        print(f"  {i}) JSON: {json_rel}")
        if e["html_path"]:
            html_rel = os.path.relpath(e["html_path"], BASE_DIR)
            print(f"     HTML: {html_rel}")

        # Model summaries
        if e["model_summaries"]:
            mode = e["mode"]
            print()
            for mn, s in sorted(e["model_summaries"].items()):
                if mode == "play":
                    print(f"     {mn}: {s['count']} games, avg atoms={s['avg_atoms']}, "
                          f"avg score={s['avg_score']}, avg rays={s['avg_rays']}")
                elif mode == "predict":
                    print(f"     {mn}: {s['count']} configs, {s['total_predictions']} predictions, "
                          f"accuracy={s.get('accuracy', 0)}%")
            print()

def format_json(entries):
    """Output entries as JSON."""
    output = []
    for e in entries:
        item = {
            "source": e["source"],
            "mode": e["mode"],
            "models": e["models"],
            "prompt_style": e["prompt_style"],
            "condition": condition_label(e),
            "vot": vot_label(e),
            "enable_thinking": e["enable_thinking"],
            "config_indices": e["config_indices"],
            "result_count": e["result_count"],
            "date": e["date"],
            "is_erroneous": e["is_erroneous"],
            "json_path": e["json_path"],
            "html_path": e["html_path"],
            "model_summaries": e["model_summaries"],
        }
        output.append(item)
    print(json.dumps(output, indent=2))

def format_files_only(entries):
    """Output one JSON path per line."""
    for e in entries:
        print(e["json_path"])

def open_html_files(entries):
    """Open matched HTML files in browser."""
    html_paths = [e["html_path"] for e in entries if e["html_path"]]
    if not html_paths:
        print("No HTML files to open.")
        return

    if len(html_paths) > 5:
        resp = input(f"Open {len(html_paths)} HTML files in browser? [y/N] ").strip().lower()
        if resp != "y":
            print("Cancelled.")
            return

    for p in html_paths:
        webbrowser.open(f"file://{p}")
    print(f"Opened {len(html_paths)} file(s) in browser.")


# ─── Interactive Mode ────────────────────────────────────────────────────────

def pick_one(prompt, options, allow_all=True):
    """Present a numbered menu and return the selected value."""
    print(f"\n{prompt}")
    for i, (label, value) in enumerate(options, 1):
        print(f"  {i}) {label}")
    if allow_all:
        print(f"  {len(options) + 1}) All")

    while True:
        try:
            choice = input("Choice: ").strip()
            if not choice:
                return None  # default = all
            n = int(choice)
            if 1 <= n <= len(options):
                return options[n - 1][1]
            if allow_all and n == len(options) + 1:
                return None
        except (ValueError, EOFError):
            pass
        print("  Invalid choice, try again.")

def pick_multi(prompt, options):
    """Present a numbered menu allowing multiple selections (comma-separated)."""
    print(f"\n{prompt}")
    for i, (label, value) in enumerate(options, 1):
        print(f"  {i}) {label}")
    print(f"  Enter numbers separated by commas, or press Enter for all.")

    while True:
        try:
            choice = input("Choice: ").strip()
            if not choice:
                return None  # all
            nums = [int(x.strip()) for x in choice.split(",")]
            selected = []
            for n in nums:
                if 1 <= n <= len(options):
                    selected.append(options[n - 1][1])
                else:
                    raise ValueError
            return selected if selected else None
        except (ValueError, EOFError):
            pass
        print("  Invalid choice, try again.")

def interactive_mode(entries):
    """Step-by-step interactive filtering."""
    filters = {}
    remaining = entries

    print(f"\n{'='*60}")
    print(f"  Black Box Experiment File Finder")
    print(f"  {len(entries)} experiment files indexed")
    print(f"{'='*60}")

    # Step 1: Mode
    mode = pick_one(
        f"Mode ({len(remaining)} files):",
        [("play", "play"), ("predict", "predict")]
    )
    if mode:
        filters["mode"] = mode
        remaining = apply_filters(entries, filters)
        print(f"  → {len(remaining)} files remaining")

    if not remaining:
        print("No matching files.")
        return []

    # Step 2: Source
    source = pick_one(
        f"Source ({len(remaining)} files):",
        [
            ("Experiment 1 (non-erroneous)", "exp1"),
            ("Experiment 3 (Multiple Runs Top Leaders)", "exp3"),
            ("Erroneous Baseline only", "erroneous"),
            ("Exclude Erroneous Baseline", "no_erroneous"),
        ]
    )
    if source:
        filters["source"] = source
        remaining = apply_filters(entries, filters)
        print(f"  → {len(remaining)} files remaining")

    if not remaining:
        print("No matching files.")
        return []

    # Step 3: Model (multi-select)
    all_models = sorted(set(m for e in remaining for m in e["models"]))
    if len(all_models) > 1:
        model_options = []
        for m in all_models:
            count = sum(1 for e in remaining if m in e["models"])
            model_options.append((f"{m} ({count} files)", m))
        selected_models = pick_multi(f"Models ({len(remaining)} files):", model_options)
        if selected_models:
            filters["models"] = selected_models
            remaining = apply_filters(entries, filters)
            print(f"  → {len(remaining)} files remaining")

    if not remaining:
        print("No matching files.")
        return []

    # Step 4: Prompt style
    styles = sorted(set(e["prompt_style"] for e in remaining))
    if len(styles) > 1:
        style = pick_one(
            f"Prompt style ({len(remaining)} files):",
            [(s, s) for s in styles]
        )
        if style:
            filters["prompt"] = style
            remaining = apply_filters(entries, filters)
            print(f"  → {len(remaining)} files remaining")

    if not remaining:
        print("No matching files.")
        return []

    # Step 5: Thinking
    thinking_vals = set(e["enable_thinking"] for e in remaining)
    if len(thinking_vals) > 1:
        thinking = pick_one(
            f"Extended thinking ({len(remaining)} files):",
            [("Enabled", True), ("Disabled", False)]
        )
        if thinking is not None:
            filters["thinking"] = thinking
            remaining = apply_filters(entries, filters)
            print(f"  → {len(remaining)} files remaining")

    if not remaining:
        print("No matching files.")
        return []

    # Step 6: VoT condition
    vot_vals = set()
    for e in remaining:
        if e["vot_grid"]:
            vot_vals.add("A")
        if e["vot_ray"]:
            vot_vals.add("B")
        if e["vot_hyp"]:
            vot_vals.add("C")
        if not (e["vot_grid"] or e["vot_ray"] or e["vot_hyp"]):
            vot_vals.add("none")
    if len(vot_vals) > 1:
        vot_options = []
        if "none" in vot_vals:
            count = sum(1 for e in remaining if not (e["vot_grid"] or e["vot_ray"] or e["vot_hyp"]))
            vot_options.append((f"None ({count} files)", "none"))
        if "A" in vot_vals:
            count = sum(1 for e in remaining if e["vot_grid"])
            vot_options.append((f"A - Grid State ({count} files)", "A"))
        if "B" in vot_vals:
            count = sum(1 for e in remaining if e["vot_ray"])
            vot_options.append((f"B - Ray Trace ({count} files)", "B"))
        if "C" in vot_vals:
            count = sum(1 for e in remaining if e["vot_hyp"])
            vot_options.append((f"C - Hypothesis ({count} files)", "C"))
        vot = pick_one(f"VoT condition ({len(remaining)} files):", vot_options)
        if vot:
            filters["vot"] = vot
            remaining = apply_filters(entries, filters)
            print(f"  → {len(remaining)} files remaining")

    if not remaining:
        print("No matching files.")
        return []

    # Step 7: Config index
    all_configs = sorted(set(c for e in remaining for c in e["config_indices"]))
    if len(all_configs) > 1:
        config = pick_one(
            f"Config index ({len(remaining)} files):",
            [(str(c), c) for c in all_configs]
        )
        if config is not None:
            filters["config"] = config
            remaining = apply_filters(entries, filters)
            print(f"  → {len(remaining)} files remaining")

    return remaining


# ─── CLI ─────────────────────────────────────────────────────────────────────

def build_parser():
    parser = argparse.ArgumentParser(
        description="Find Black Box experiment files by condition.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
examples:
  python find_experiment.py                                    # interactive mode
  python find_experiment.py --mode play --model "Opus 4.5"     # play files with Opus 4.5
  python find_experiment.py --mode predict --vot B             # predict + VoT ray trace
  python find_experiment.py --json --experiment 3              # Exp 3 files as JSON
  python find_experiment.py --files-only --prompt baseline     # just file paths
  python find_experiment.py --open --mode play --config 0      # open HTML in browser
"""
    )

    # Filters
    parser.add_argument("--mode", choices=["play", "predict"], help="Task mode")
    parser.add_argument("--model", action="append", dest="models",
                        help="Model name filter (repeatable, e.g. 'Opus 4.5')")
    parser.add_argument("--prompt", choices=["baseline", "augmented"], help="Prompt style")
    parser.add_argument("--thinking", action="store_true", default=None,
                        dest="thinking", help="Extended thinking enabled")
    parser.add_argument("--no-thinking", action="store_false", dest="thinking",
                        help="Extended thinking disabled")
    parser.add_argument("--vot", choices=["none", "A", "B", "C"], help="VoT condition")
    parser.add_argument("--config", type=int, choices=range(10), metavar="0-9",
                        help="Config index")
    parser.add_argument("--condition", help="Exact prompt condition string")
    parser.add_argument("--erroneous", action="store_true", default=None, dest="erroneous",
                        help="Erroneous Baseline files only")
    parser.add_argument("--no-erroneous", action="store_false", dest="erroneous",
                        help="Exclude Erroneous Baseline files")
    parser.add_argument("--experiment", type=int, choices=[1, 3],
                        help="Experiment number (1 or 3)")

    # Output
    parser.add_argument("--json", action="store_true", help="JSON output")
    parser.add_argument("--files-only", action="store_true", help="One JSON path per line")
    parser.add_argument("--open", action="store_true", help="Open HTML files in browser")

    # Cache
    parser.add_argument("--rebuild-cache", action="store_true", help="Force cache rebuild")
    parser.add_argument("--no-cache", action="store_true", help="Skip cache entirely")

    return parser

def has_filter_args(args):
    """Check if any filter flag was provided."""
    return any([
        args.mode, args.models, args.prompt, args.thinking is not None,
        args.vot, args.config is not None, args.condition,
        args.erroneous is not None, args.experiment,
    ])

def main():
    parser = build_parser()
    args = parser.parse_args()

    # Load entries
    use_cache = not args.no_cache
    entries = get_entries(use_cache=use_cache, rebuild_cache=args.rebuild_cache)

    if not entries:
        print("No experiment files found.", file=sys.stderr)
        sys.exit(1)

    # Decide mode: interactive vs command-line
    if has_filter_args(args) or args.json or args.files_only:
        # Command-line filtering
        filters = {}
        if args.mode:
            filters["mode"] = args.mode
        if args.models:
            filters["models"] = args.models
        if args.prompt:
            filters["prompt"] = args.prompt
        if args.thinking is not None:
            filters["thinking"] = args.thinking
        if args.vot:
            filters["vot"] = args.vot
        if args.config is not None:
            filters["config"] = args.config
        if args.condition:
            filters["condition"] = args.condition
        if args.erroneous is not None:
            if args.erroneous:
                filters["source"] = "erroneous"
            else:
                filters["source"] = "no_erroneous"
        if args.experiment:
            filters["experiment"] = args.experiment

        matched = apply_filters(entries, filters)
    else:
        # Interactive mode
        try:
            matched = interactive_mode(entries)
        except (KeyboardInterrupt, EOFError):
            print("\nCancelled.")
            sys.exit(0)

    if not matched:
        if not (args.json or args.files_only):
            print("No matching files found.")
        elif args.json:
            print("[]")
        sys.exit(0)

    # Output
    if args.json:
        format_json(matched)
    elif args.files_only:
        format_files_only(matched)
    else:
        format_table(matched)

    if args.open:
        open_html_files(matched)

if __name__ == "__main__":
    main()
