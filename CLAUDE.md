# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an LLM reasoning research project that uses the Black Box game as a diagnostic benchmark to assess LLM capabilities in constraint satisfaction, spatial reasoning, and abductive inference. The project consists of:

1. **React Application** (`blackbox.jsx`) - A single-file React component implementing the Black Box game with multiple modes for human play and LLM experimentation
2. **Quarto Document** (`blackbox_llm_study.qmd`) - Academic paper documenting the research methodology and findings (R/tidyverse analysis)

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

### Key Concepts

**Game Modes**
- **Play**: Human plays, atoms hidden
- **Sandbox**: Human plays, atoms visible (for learning)
- **LLM**: Claude plays the game autonomously
- **Predict**: Test forward reasoning (atoms visible, predict ray behavior)
- **Experiment**: Run systematic experiments across configurations

**Experiment Factors**
- Model: Haiku 4.5, Sonnet 4.5, Opus 4.5
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
