# Baseline Data Reorganization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace erroneous baseline experiment data (prompt said "ball" instead of "atom") with corrected reruns, while archiving the erroneous data for the Experiment 2 comparison analysis.

**Architecture:** Move erroneous baseline files from `Experiment 1/{Play,Predict}/` into an `Experiment 1/Erroneous Baseline/` archive. Move corrected rerun files from `Experiment 1 Baseline Rerun/` into the main directories. Update the quarto document's Experiment 2 section to load "Original" (erroneous) data from the archive and "Corrected" data from the main dataset.

**Tech Stack:** `git mv` for tracked JSON files, plain `mv` for untracked HTML reports (`.gitignore` excludes `*.html`), R/tidyverse in `blackbox_llm_study.qmd`

---

## Current State

### File Inventory

**`Experiment 1/Predict/` — 12 baseline files to move:**
| # | Filename | Notes |
|---|----------|-------|
| 1 | `blackbox_experiment_predict_baseline_viz_2026-01-13T03-01-26.json` | |
| 2 | `blackbox_experiment_predict_baseline_viz_2026-02-23T21-12-05.json` | |
| 3 | `blackbox_experiment_predict_baseline_viz_2026-02-23T22-17-16.json` | |
| 4 | `blackbox_experiment_predict_baseline_viz_2026-02-24T02-40-47.json` | |
| 5 | `blackbox_experiment_predict_baseline_viz_2026-02-24T14-45-19.json` | |
| 6 | `blackbox_experiment_predict_baseline_viz_2026-03-01T22-59-03.json` | |
| 7 | `blackbox_experiment_predict_baseline_viz_2026-03-01T23-48-38.json` | |
| 8 | `blackbox_experiment_predict_baseline_viz_2026-03-02T04-24-01.json` | |
| 9 | `blackbox_experiment_predict_baseline_viz_2026-03-02T14-32-46.json` | |
| 10 | `blackbox_experiment_predict_baseline_viz_2026-03-04T06-05-47.json` | |
| 11 | `blackbox_experiment_predict_baseline_viz_think_2026-01-05T15-58-21.json` | thinking enabled, no rerun |
| 12 | `blackbox_experiment_predict_baseline_viz_think_votTrace_2026-01-12T08-49-36.json` | thinking+VoT, no rerun |

Plus matching `.html` report files for each.

**`Experiment 1/Play/` — 17 baseline files to move:**
All 17 are `play_baseline_viz_hyp` pattern (dates from 2026-01-02 through 2026-03-05). Plus matching `.html` files.

**`Experiment 1 Baseline Rerun/` — 13 corrected files to distribute:**
- 8 play JSON + 8 play HTML → `Experiment 1/Play/`
- 5 predict JSON + 4 predict HTML → `Experiment 1/Predict/`

### Quarto Path Dependencies

| Section | Current Path | Reads |
|---------|-------------|-------|
| E1 Predict (line 1106) | `Experiment 1/Predict` glob `*.json` | All predict data |
| E1 Play (line 2300) | `Experiment 1/Play` glob `*.json` | All play data |
| E2 Predict Original (line 4407) | Filters `predict_data \|> filter(prompt_style == "baseline")` | From E1 loaded data |
| E2 Predict Corrected (line 4419) | `Experiment 1 Baseline Rerun` glob `*.json` | Rerun files |
| E2 Play Original (line 4965) | Filters `play_data \|> filter(prompt_style == "baseline")` | From E1 loaded data |
| E2 Play Corrected (line 4955) | `Experiment 1 Baseline Rerun/Play` dir check | Directory doesn't exist yet |
| Prerender (line 82-83) | `Experiment 1/Play`, `Experiment 1/Predict` | For derived files |

### Design Decision: think/votTrace Baseline Files

Predict files #11 and #12 above use `enable_thinking` and `vot_ray_trace` conditions with the erroneous baseline prompt. These have **no corrected reruns**. Moving them to the archive removes them from the E1 main analysis.

**Recommendation:** Move them anyway. They're compromised data (wrong terminology), and they're only 2 single-run files. This keeps the archive complete and the main data clean. They can be rerun later if needed.

---

## Task 1: Create Archive Directories and Move Erroneous Files

**Files:**
- Create: `Experiment 1/Erroneous Baseline/Predict/` (directory)
- Create: `Experiment 1/Erroneous Baseline/Play/` (directory)
- Modify: `Experiment 1/Predict/` (remove baseline files)
- Modify: `Experiment 1/Play/` (remove baseline files)

- [ ] **Step 1: Create archive directories**

```bash
mkdir -p "Experiment 1/Erroneous Baseline/Predict"
mkdir -p "Experiment 1/Erroneous Baseline/Play"
```

- [ ] **Step 2: Move erroneous predict baseline files (JSON + HTML) to archive**

HTML files are excluded by `.gitignore`, so use `git mv` for JSON (tracked) and plain `mv` for HTML (untracked).

```bash
cd "Experiment 1/Predict"
for f in blackbox_experiment_predict_baseline_*.json; do
  git mv "$f" "../Erroneous Baseline/Predict/"
done
for f in blackbox_experiment_predict_baseline_*.html; do
  mv "$f" "../Erroneous Baseline/Predict/"
done
cd ../..
```

Expected: 12 JSON moved via `git mv`, matching HTML files moved via `mv`.

- [ ] **Step 3: Move erroneous play baseline files (JSON + HTML) to archive**

```bash
cd "Experiment 1/Play"
for f in blackbox_experiment_play_baseline_*.json; do
  git mv "$f" "../Erroneous Baseline/Play/"
done
for f in blackbox_experiment_play_baseline_*.html; do
  mv "$f" "../Erroneous Baseline/Play/"
done
cd ../..
```

Expected: 17 JSON moved via `git mv`, matching HTML files moved via `mv`.

- [ ] **Step 4: Verify archive contents**

```bash
echo "=== Predict archive ==="
ls "Experiment 1/Erroneous Baseline/Predict/" | wc -l
echo "=== Play archive ==="
ls "Experiment 1/Erroneous Baseline/Play/" | wc -l
echo "=== Remaining in Predict (should be augmented only) ==="
ls "Experiment 1/Predict/"*.json | head -3
echo "=== Remaining in Play (should be augmented only) ==="
ls "Experiment 1/Play/"*.json | head -3
```

Expected: Archive has baseline files only; main directories have augmented files only.

---

## Task 2: Move Corrected Rerun Files into Main Directories

**Files:**
- Modify: `Experiment 1/Play/` (add corrected play files)
- Modify: `Experiment 1/Predict/` (add corrected predict files)
- Remove: `Experiment 1 Baseline Rerun/` (empty after move)

- [ ] **Step 1: Move corrected play files from rerun to main Play directory**

Rerun JSON files were committed in the prior commit (tracked), so use `git mv`. HTML files are untracked (`.gitignore`), so use plain `mv`.

```bash
cd "Experiment 1 Baseline Rerun"
for f in blackbox_experiment_play_*.json; do
  git mv "$f" "../Experiment 1/Play/"
done
for f in blackbox_experiment_play_*.html; do
  mv "$f" "../Experiment 1/Play/"
done
cd ..
```

Expected: 8 JSON moved via `git mv`, 8 HTML moved via `mv`.

- [ ] **Step 2: Move corrected predict files from rerun to main Predict directory**

```bash
cd "Experiment 1 Baseline Rerun"
for f in blackbox_experiment_predict_*.json; do
  git mv "$f" "../Experiment 1/Predict/"
done
for f in blackbox_experiment_predict_*.html; do
  mv "$f" "../Experiment 1/Predict/"
done
cd ..
```

Expected: 5 JSON moved via `git mv`, 4 HTML moved via `mv`.

- [ ] **Step 3: Remove the now-empty rerun directory**

```bash
rm -rf "Experiment 1 Baseline Rerun"
```

- [ ] **Step 4: Verify final directory state**

```bash
python3 -c "
import json, glob, os
for d in ['Experiment 1/Predict', 'Experiment 1/Play']:
    files = sorted(glob.glob(os.path.join(d, '*.json')))
    styles = {}
    for f in files:
        with open(f) as fh:
            ps = json.load(fh)['experimentConfig']['promptStyle']
        styles[ps] = styles.get(ps, 0) + 1
    print(f'{d}: {styles}  (total {len(files)} JSON)')
print()
for d in ['Experiment 1/Erroneous Baseline/Predict', 'Experiment 1/Erroneous Baseline/Play']:
    files = sorted(glob.glob(os.path.join(d, '*.json')))
    print(f'{d}: {len(files)} JSON')
print()
print(f'Rerun dir exists: {os.path.exists(\"Experiment 1 Baseline Rerun\")}')
"
```

Expected output:
```
Experiment 1/Predict: {'augmented': 12, 'baseline': 5}  (total 17 JSON)
Experiment 1/Play: {'augmented': 20, 'baseline': 8}  (total 28 JSON)

Experiment 1/Erroneous Baseline/Predict: 12 JSON
Experiment 1/Erroneous Baseline/Play: 17 JSON

Rerun dir exists: False
```

---

## Task 3: Update Quarto Document — Experiment 2 Predict Section

**Files:**
- Modify: `blackbox_llm_study.qmd:4402-4441` (E2 predict data loading)

- [ ] **Step 1: Replace E2 predict data loading code**

The sources swap: "Original" now loads from the erroneous archive, "Corrected" now comes from the main `predict_data`.

Replace the code block at label `e2-load-predict-data` (lines 4402-4442) with:

```r
#| label: e2-load-predict-data

# --- Original (erroneous "ball" prompt) from archive ---
e2_erroneous_predict_files <- list.files(
  path = "Experiment 1/Erroneous Baseline/Predict",
  pattern = "\\.json$",
  full.names = TRUE
)

e2_predict_original <- map_dfr(e2_erroneous_predict_files, extract_predict_results) |>
  mutate(prompt_version = "Original")

# Deduplicate in case of re-exported files
e2_predict_original <- e2_predict_original |>
  distinct(experiment_id, entry_side, entry_pos, .keep_all = TRUE)

# --- Corrected ("atom" prompt) from main Experiment 1 data ---
e2_predict_corrected <- predict_data |>
  filter(prompt_style == "baseline") |>
  mutate(
    prompt_version = "Corrected",
    config_index = as.integer(as.character(config_index)),
    model_name = as.character(model_name),
    prompt_style = as.character(prompt_style),
    enable_thinking = as.logical(as.character(enable_thinking)),
    vot_ray_trace = as.logical(as.character(vot_ray_trace))
  )

# Deduplicate corrected data for consistency
e2_predict_corrected <- e2_predict_corrected |>
  distinct(experiment_id, entry_side, entry_pos, .keep_all = TRUE)

# Combine
e2_predict_data <- bind_rows(e2_predict_original, e2_predict_corrected) |>
  mutate(
    prompt_version = factor(prompt_version, levels = c("Original", "Corrected")),
    model_name = factor(model_name, levels = order_model_names(model_name)),
    enable_thinking = as.logical(as.character(enable_thinking)),
    vot_ray_trace = as.logical(as.character(vot_ray_trace)),
    config_index = factor(config_index)
  )
```

- [ ] **Step 2: Verify no other references to `"Experiment 1 Baseline Rerun"` remain in predict section**

```bash
grep -n "Baseline Rerun" blackbox_llm_study.qmd
```

Expected: only the play section references should remain (updated in Task 4).

---

## Task 4: Update Quarto Document — Experiment 2 Play Section

**Files:**
- Modify: `blackbox_llm_study.qmd:4951-4993` (E2 play data loading)

- [ ] **Step 1: Replace E2 play availability check and data loading**

Replace the code block at label `e2-load-play-data` (lines 4951-4958) with:

```r
#| label: e2-load-play-data

# Check if erroneous baseline play data exists in archive
e2_play_dir <- "Experiment 1/Erroneous Baseline/Play"
e2_play_available <- dir.exists(e2_play_dir) &&
  length(list.files(e2_play_dir, pattern = "\\.json$")) > 0
```

- [ ] **Step 2: Replace E2 play data loading block**

Replace the code block at label `e2-play-data-load` (lines 4960-4993) with:

```r
#| label: e2-play-data-load
#| eval: !expr e2_play_available

# Original (erroneous "ball" prompt) from archive
e2_play_original <- map_dfr(
  list.files(e2_play_dir, pattern = "\\.json$", full.names = TRUE),
  extract_play_results
) |>
  mutate(prompt_version = "Original")

# Deduplicate
e2_play_original <- e2_play_original |>
  distinct(experiment_id, .keep_all = TRUE)

# Corrected ("atom" prompt) from main Experiment 1 data
e2_play_corrected <- play_data |>
  filter(prompt_style == "baseline") |>
  mutate(
    prompt_version = "Corrected",
    config_index = as.integer(as.character(config_index)),
    model_name = as.character(model_name),
    prompt_style = as.character(prompt_style),
    enable_thinking = as.logical(as.character(enable_thinking)),
    vot_ray_trace = as.logical(as.character(vot_ray_trace))
  )

# Deduplicate for consistency
e2_play_corrected <- e2_play_corrected |>
  distinct(experiment_id, .keep_all = TRUE)

# Combine
e2_play_data <- bind_rows(e2_play_original, e2_play_corrected) |>
  mutate(
    prompt_version = factor(prompt_version, levels = c("Original", "Corrected")),
    model_name = factor(model_name, levels = order_model_names(model_name)),
    enable_thinking = as.logical(as.character(enable_thinking)),
    vot_ray_trace = as.logical(as.character(vot_ray_trace)),
    config_index = factor(config_index)
  )
```

- [ ] **Step 3: Update the "not available" message**

The message at line ~4995 (`if (!e2_play_available)`) can be updated since play data should now exist:

```r
`r if (!e2_play_available) "**Erroneous baseline play data not found in archive.** Expected at: Experiment 1/Erroneous Baseline/Play/"`
```

- [ ] **Step 4: Verify no remaining references to `"Experiment 1 Baseline Rerun"`**

```bash
grep -n "Baseline Rerun" blackbox_llm_study.qmd
```

Expected: no matches.

---

## Task 5: Rebuild Derived Files

The file moves change what's in `Experiment 1/Play/*.json`, which invalidates these derived files:

| Derived File | Impact | Rebuild Command |
|-------------|--------|----------------|
| `experiment1_play_combined.json` | Play JSON files changed | `prerender.py` handles automatically |
| `experiment1_play_combined_analysis.json` | Depends on combined | `python blackbox_solver.py analyze ...` (slow, ~5+ hours) |
| `error_classifications.json` | Reads from `Experiment 1/{Play,Predict}/*.json` | Requires API key for play portion |

- [ ] **Step 1: Delete stale derived files so prerender rebuilds them**

```bash
rm -f experiment1_play_combined.json
rm -f experiment1_play_combined_analysis.json
# Note: error_classifications.json play portion needs API key
# It can be regenerated separately; delete if you want a clean rebuild
```

- [ ] **Step 2: Run prerender to rebuild**

```bash
python prerender.py
```

This will regenerate `experiment1_play_combined.json` and `experiment1_play_combined_analysis.json`. The latter takes ~5+ hours (full candidate space analysis across all games).

**Note:** `error_classifications.json` play portion requires an Anthropic API key and should be regenerated separately when ready. Do **not** delete `error_classifications.json` unless you are ready to rebuild it with an API key.

---

## Task 6: Commit

- [ ] **Step 1: Stage all changes**

All `git mv` operations from Tasks 1-2 are already staged. Stage the quarto edits and rebuilt derived files:

```bash
git add blackbox_llm_study.qmd
git add experiment1_play_combined.json
git add experiment1_play_combined_analysis.json
```

- [ ] **Step 2: Commit**

```bash
git commit -m "Reorganize baseline data: archive erroneous files, replace with corrected reruns

Move erroneous baseline files (prompt said 'ball' instead of 'atom') to
Experiment 1/Erroneous Baseline/{Play,Predict}/ and replace with corrected
reruns. Update Experiment 2 in quarto doc to load erroneous data from archive
for comparison analysis."
```

- [ ] **Step 3: Verify**

```bash
git status
git diff --stat HEAD~1
```
