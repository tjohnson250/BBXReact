# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an LLM reasoning research project that uses the Black Box game as a diagnostic benchmark to assess LLM capabilities in constraint satisfaction, spatial reasoning, and abductive inference. The project consists of:

1. **React Application** (`blackbox.jsx`) - A single-file React component implementing the Black Box game with multiple modes for human play and LLM experimentation
2. **Optimal Solver** (`blackbox_solver.py`) - Python script computing information-theoretically optimal ray sequences over the full C(64,4) = 635,376 candidate space
3. **Experiment Runner** (`blackbox_experiment.py`) - Python script for running experiments against non-Anthropic models (OpenAI, Google Gemini, DeepSeek) with YAML-based configuration
4. **Quarto Document** (`blackbox_llm_study.qmd`) - Academic paper documenting the research methodology and findings (R/tidyverse analysis)

## Running the Application

The React component (`blackbox.jsx`) is designed to run in a browser environment with direct API access to Claude. It requires:
- An Anthropic API key (entered via the UI)
- The `anthropic-dangerous-direct-browser-access` header for browser-based API calls

## Rendering the Quarto Document

```bash
quarto render blackbox_llm_study.qmd
```

Requires R with `tidyverse`, `knitr`, and `kableExtra` packages installed.

## Architecture

### blackbox.jsx Structure (~4800 lines)

**Core Game Logic (lines 1-320)**
- `EXPERIMENT_CONFIGS` - 10 fixed atom configurations for reproducible experiments
- `traceRay()` - Core ray tracing algorithm implementing deflection/absorption/reflection physics
- `generateTextBoard()` - ASCII visualization of game state

**Prompt Definitions (lines 45-620)**
- `BASELINE_PLAY_PROMPT` / `BASELINE_PREDICT_PROMPT` - Human-equivalent instructions
- `DEFAULT_SYSTEM_PROMPT` / `DEFAULT_PREDICT_SYSTEM_PROMPT` - Augmented prompts with detailed strategy
- `VOT_PROMPTS` - Visualization of Thought prompt additions (grid state, ray trace, hypothesis)
- `PROMPT_STYLES` / `PROMPT_CONDITIONS` - Factorial design configuration

**Experiment Infrastructure (lines 640-2300)**
- `createExperimentResult()` - Data structure for experiment results
- `runPredictExperiment()` - Forward reasoning test (given atoms, predict ray exit)
- `runPlayExperiment()` - Inverse reasoning test (LLM plays full game)
- `callClaude()` - API wrapper with extended thinking support

**React Component (lines 2300-4863)**
- Multiple game modes: Play, Sandbox, LLM, Predict, Experiment
- Real-time visualization of ray paths and game state
- Export functionality for JSON and HTML reports

### blackbox_solver.py Structure

**Ray Tracing** — `trace_ray()` implements the same physics as the JSX version. Ray tracing must match the JSX exactly for `play` mode to work correctly.

**Information-Theoretic Evaluation** — `partition_by_ray()` partitions candidates by outcome; `score_partition()` computes E[remaining] = Σ(nᵢ²/N); `find_best_ray()` selects the ray minimizing this score.

**Modes:**
- `cmd_first()` — Analyzes optimal first shot using D₄ symmetry (4 equivalence classes)
- `cmd_sim()` — Simulates games with greedy optimal strategy
- `cmd_play()` — Interactive mode for use alongside the JSX game
- `cmd_tree()` — Builds optimal decision tree to a given depth
- `cmd_benchmark()` — Solves all 10 `EXPERIMENT_CONFIGS` with greedy optimal strategy, writes `optimal_solver_results.json`
- `cmd_analyze()` — Deterministic error analysis of LLM play experiments: replays ray sequences through the candidate space to detect suboptimal ray selection, constraint violations, and excess rays

**Running:**
```bash
python blackbox_solver.py first            # Optimal first shot analysis
python blackbox_solver.py sim [N]          # Simulate N games (default 20)
python blackbox_solver.py play             # Interactive solver
python blackbox_solver.py tree [DEPTH]     # Decision tree (default depth 2)
python blackbox_solver.py benchmark        # Solve all 10 experiment configs → optimal_solver_results.json
python blackbox_solver.py analyze <file>   # Deterministic error analysis of LLM play
                         [--output out.json]
                         [--workers N]       # parallel workers (default 1)
```

### blackbox_experiment.py Structure (~1590 lines)

**Game Logic (lines 34-560)** — Ports core game constants, ray tracing, board generation, and scoring from `blackbox.jsx`. The `trace_ray()`, `generate_text_board()`, and `calculate_score()` functions must stay in sync with their JSX counterparts.

**Prompts (lines 55-404)** — Contains identical copies of the baseline and augmented prompts (play and predict) plus VoT prompt additions from the JSX. `PROMPT_STYLES` and `VOT_PROMPTS` dicts mirror the JS structure.

**LLM Providers (lines 647-798)** — Abstraction layer for multi-provider support:
- `OpenAIProvider` — Handles both standard and o-series (reasoning) models. o-series uses `developer` role and `reasoning_effort` instead of system messages.
- `GoogleProvider` — Uses `google-genai` SDK with `thinking_config` for reasoning.
- `DeepSeekProvider` — Uses OpenAI-compatible API with custom base URL. R1 exposes reasoning via `reasoning_content`.
- `create_provider()` — Factory that resolves API keys from config or environment variables.

**Response Parsing (lines 805-851)** — `parse_response()` and `parse_play_response()` extract JSON from LLM responses with fallback heuristics for malformed output.

**Experiment Runners (lines 857-1410)**
- `run_predict_experiment()` — Tests all 32 ray positions per config, skipping reverse-direction duplicates. Each ray is an independent API call.
- `run_play_experiment()` — Multi-turn conversational game loop with the same action handling as the JSX (fire/mark/unmark/guess/check). Includes rate limit retry with exponential backoff.

**Configuration** — Driven by `experiment_config.yaml` which controls task mode, prompt style, visualization, thinking, VoT options, config indices, model list, rate limiting, and output settings.

**Running:**
```bash
python blackbox_experiment.py                          # uses experiment_config.yaml
python blackbox_experiment.py --config my_config.yaml  # custom config file
python blackbox_experiment.py --dry-run                # validate config and API keys only
python blackbox_experiment.py -v                       # verbose debug logging
```

**Requirements:** `pip install openai google-genai pyyaml`

### Key Concepts

**Game Modes**
- **Play**: Human plays, atoms hidden
- **Sandbox**: Human plays, atoms visible (for learning)
- **LLM**: Claude plays the game autonomously
- **Predict**: Test forward reasoning (atoms visible, predict ray behavior)
- **Experiment**: Run systematic experiments across configurations

**Experiment Factors**
- Model: Haiku 4.5, Sonnet 4.5, Opus 4.5 (via React app); o3, o4-mini, Gemini 2.5 Pro, DeepSeek R1 (via Python runner)
- Prompt Style: Baseline vs Augmented
- Include Visualization: Text board in prompt
- Allow Hypotheses: mark/unmark actions (Play mode)
- Extended Thinking: Enable with configurable token budget
- VoT Options: Grid state, ray trace, hypothesis visualization prompts

**Ray Physics**
- Rays enter from edge positions (NORTH/SOUTH use columns 1-8, EAST/WEST use rows 1-8)
- Absorption: Ray hits atom directly
- Reflection: Atom diagonally adjacent to entry, or atoms on both sides reverse direction
- Deflection: Single adjacent atom deflects ray 90° away
