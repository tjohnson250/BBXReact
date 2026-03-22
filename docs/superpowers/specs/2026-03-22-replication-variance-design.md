# Replication & Performance Variance: Design Spec

## Context

Experiment 1 Play mode ran 80 model configurations × 10 games each (800 total games). The top two configs (Opus 4.6 and Sonnet 4.6, both augmented/thinking/VoT-ray-trace) scored 3.10 and 3.00 atoms correct respectively. Four replication runs of these two configs on the same 10 game boards showed regression to the mean: Opus dropped to 2.40 avg, Sonnet to 2.70. The original result sits above all 4 replication runs for both models.

Statistical analysis shows:
- n=10 gives only 39% power to detect a 1-atom difference (SD ≈ 1.33)
- 95% CI at n=10 spans ±0.82 atoms — nearly half the 0–4 range
- Winner's curse: with 80 configs, the best-of-80 by pure chance would score ~2.50
- Performance is bimodal: some configs (2, 6) are reliably solved (4/4 every run), others swing 0–4
- The original top score had ~6% probability of occurring from the replication distribution

## Goals

1. **Pool original + replication data** for the two replicated configs (n=50 each) as authoritative results
2. **Frame the variance as a finding** — bimodal performance, stochastic reasoning access, config-dependent reliability
3. **Add CI overlap tiers** to the leaderboard so readers see that most configs are statistically indistinguishable
4. **Dynamic data loading** — new JSON files in `Experiment 3 Multiple Runs Top Leaders/` are picked up on re-render

## Changes: `blackbox_llm_study.qmd`

### 1. Data Loading (new chunk after existing play data load)

Add R code chunk that:
- Scans `Experiment 3 Multiple Runs Top Leaders/` for `*.json` files
- Parses each, extracts results with fields matching the existing play data frame
- Tags each row with `source = "replication"` and `run_id` (timestamp from filename)
- Tags existing original data with `source = "original"`, `run_id = "original"`
- Merges on `(model, prompt_style, enable_thinking, vot_grid_state, vot_ray_trace, vot_hypothesis, config_index)`
- Creates `play_pooled` data frame with all games, plus `n` per config computed

### 2. Original Leaderboard (keep as-is)

No changes to the existing top-10 leaderboard table. It stays exactly as it was.

### 3. New Subsection: "Play Mode: Replication and Performance Variance"

Placed immediately after the original leaderboard. Contains:

#### 3a. Introduction paragraph
- Top two configs replicated 4× (dynamically report actual count of replication files)
- Motivation: assess reliability of n=10 rankings

#### 3b. Pooled Leaderboard Table
- All configs ranked by pooled atoms correct
- Columns: Rank, Config (model/prompt/thinking/VoT), n, M ± SE, 95% CI, Score, Perfect %, Tier
- Tier assignment: configs whose CIs overlap are grouped into the same tier (letter A, B, C...)
- Footnote explaining tier methodology

#### 3c. Before/After Comparison
- Table or visualization showing original mean vs pooled mean for the two replicated configs
- Per-run breakdown showing the 4 replication runs individually

#### 3d. Variance Analysis
- Per-config reliability: configs 2 and 6 always solved, others erratic
- Distribution plot: histogram of atoms correct for replicated configs showing bimodality
- Run-to-run variance: std dev across the replication runs

#### 3e. Statistical Tests
- Welch's t-test, Mann-Whitney U, permutation test (original vs replication)
- Bootstrap 95% CI for the difference
- Power analysis table: what n is needed to detect various effect sizes
- "Lucky draw" probability: P(sample mean ≥ original | replication distribution)

#### 3f. Narrative Interpretation
- Bimodal pattern = "stochastic access to reasoning strategy" not "consistent partial competence"
- Factor-level conclusions (model, prompt, thinking) remain robust (aggregate over 40-80+ games)
- Config-level rankings should be interpreted with wide CIs

### 4. Update Downstream Analyses

- **ANOVA / mixed-effects models**: Use `play_pooled` data frame. The models should handle unequal n naturally.
- **Cross-mode comparison**: Use pooled play means when computing predict-vs-play gap
- **Performance corridor / LLM vs optimal slides**: Use pooled "best LLM" numbers

## Changes: `blackbox_presentation.qmd`

### 1. Existing Leaderboard Slide (line ~1025)
- Retitle to "Play: Initial Results (n = 10 per condition)"
- Keep forest plot as-is

### 2. New Slide: "Replication: What Happens With More Data?"
- Insert after the leaderboard slide
- Forest plot overlaying original means (hollow points) vs pooled means (filled points) for the two replicated configs, with other configs shown at their n=10 values
- Key stats in text: original vs pooled means, lucky-draw probability
- Speaker note with the full narrative

### 3. New Slide: "Performance Variance as a Finding"
- Bimodal distribution visualization (histogram or dot plot)
- Per-config reliability heatmap: configs × runs, colored by atoms correct
- Key message: "some boards reliably solved, others stochastic"

### 4. Update Existing Slides
- **Factor Effects** (line ~1075): use pooled data
- **Performance Corridor** (line ~1130): update best-LLM reference point
- **LLM vs Optimal** (lines ~1184, 1244): update if referencing top config
- **Cross-Mode Comparison** (line ~1278): use pooled play numbers

## Data Flow

```
Experiment 3 Multiple Runs Top Leaders/*.json
         │
         ▼
    R: load + tag as "replication"
         │
    Experiment 1/Play/*.json (existing load)
         │  tagged as "original"
         ▼
    play_pooled (merged data frame)
         │
         ├─► Original leaderboard (original data only, unchanged)
         ├─► Pooled leaderboard (all data, with n column)
         ├─► Variance analysis (replication data, focused)
         ├─► ANOVA / mixed models (pooled)
         ├─► Cross-mode comparison (pooled)
         └─► Presentation slides (pooled)
```

## Not In Scope

- Changes to error analysis sections (they analyze error types, not absolute performance)
- Changes to `intro_slides.qmd` (no play results there)
- Changes to `blackbox_solver.py` or `blackbox_experiment.py`
- Re-running the deterministic error analysis on replication data (separate task)
