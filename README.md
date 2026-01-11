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

**Requirements:**
- Claude.ai account
- Modern browser with JavaScript enabled

### Research Paper (`blackbox_llm_study.qmd`)

Draft (currently incomplete) Quarto document containing the academic paper with methodology, results, and analysis.

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
