# Black Box LLM Reasoning Benchmark

A diagnostic benchmark for assessing LLM capabilities in diagnostic reasoning, using the classic Black Box game to test hidden state identification through test selection, constraint tracking, and belief updating.

## Overview

This project uses the [Black Box game](https://en.wikipedia.org/wiki/Black_Box_(game)) (Eric Solomon, 1978) as a controlled environment for evaluating whether LLMs can perform genuine diagnostic reasoning or rely on pattern matching. The game requires:

- **Hypothesis generation** about hidden atom locations
- **Test selection** (choosing which rays to fire)
- **Constraint tracking** as evidence accumulates
- **Belief updating** based on observations

Unlike medical benchmarks that may reward pattern matching to training data, Black Box provides out-of-distribution problems with verifiable ground truth.

## Components

### React Application (`blackbox.jsx`)

To run as a Claude Artifact with your Claude.ai account visit:
https://claude.ai/public/artifacts/31d93658-cd9d-4ad4-ade0-060a2d96b87d

A browser-based implementation of Black Box with multiple modes:

| Mode | Description |
|------|-------------|
| **Play** | Human plays with atoms hidden |
| **Sandbox** | Human plays with atoms visible (learning mode) |
| **LLM** | Claude plays the game autonomously |
| **Predict** | Forward reasoning test (given atoms, predict ray behavior) |
| **Experiment** | Run systematic experiments across configurations |

Instructions for using the application are included within the artifact.

**Requirements:**
- Claude.ai account
- Modern browser with JavaScript enabled

### Optimal Solver (`blackbox_solver.py`)

A Python script that computes the information-theoretically optimal strategy for solving Black Box puzzles. It operates over the full C(64,4) = 635,376 candidate space and uses a greedy strategy that minimizes expected remaining candidates (equivalent to maximizing Shannon entropy) at each step.

**Modes:**

| Mode | Command | Description |
|------|---------|-------------|
| **First** | `python blackbox_solver.py first` | Analyzes the optimal first shot using D₄ symmetry of the grid |
| **Simulate** | `python blackbox_solver.py sim [N]` | Simulates N games (default 20) with play-by-play output |
| **Play** | `python blackbox_solver.py play` | Interactive mode — fire recommended rays in the JSX game and enter observed outcomes |
| **Tree** | `python blackbox_solver.py tree [DEPTH]` | Builds the optimal decision tree to a given depth (default 2) |

The `play` mode is designed to work alongside the React application: the solver recommends the optimal ray, the user fires it in the JSX game, and enters the observed outcome (e.g., `SOUTH-3`, `ABSORBED`, `REFLECTED`). The solver then narrows the candidate space and recommends the next ray.

**Key results:** The greedy optimal solver averages ~7 rays to uniquely identify atom configurations, with a 100% solve rate and a range of 5–9 rays.

**Requirements:**
- Python 3 (standard library only, no external dependencies)

### Research Paper (`blackbox_llm_study.qmd`)

Draft (currently incomplete) Quarto document containing the academic paper with methodology, results, and analysis. The rendered document is available at: https://tjohnson250.github.io/BBXReact/

**Rendering:**
```bash
quarto render blackbox_llm_study.qmd
```

**Requirements:**
- [Quarto](https://quarto.org/)
- R with `tidyverse`, `jsonlite`, `car`, `knitr`, and `kableExtra` packages

## Game Rules

Players fire rays into an 8×8 grid containing 4 hidden atoms and observe the results:

- **Hit (H)**: Ray absorbed by striking an atom directly
- **Reflection (R)**: Ray returns to entry point
- **Detour**: Ray exits at a different position (deflected by adjacent atoms)

The goal is to deduce atom locations from ray observations.

## Experiment Data

The `Experiment 1/` directory contains JSON results from systematic experiments testing Claude models (Haiku, Sonnet, Opus) across prompt conditions.

## License

Research project - see paper for citation information.

## Author

Todd R. Johnson, University of Texas Health Science Center at Houston
