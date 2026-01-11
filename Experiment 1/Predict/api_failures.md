# Predict Mode API Failures

These predictions failed due to transient API errors and need to be rerun.

## Summary

| File | Errors | Primary Issue |
|------|--------|---------------|
| `predict_augmented_viz_2026-01-09T23-12-07.json` | 8 | 500/Internal server error |
| `predict_augmented_viz_2026-01-10T07-50-15.json` | 3 | Internal server error/No response |
| `predict_baseline_viz_2026-01-04T22-36-03.json` | 1 | 502 |
| `predict_baseline_viz_2026-01-11T05-06-18.json` | 4 | 502 |

**Total: 16 failed predictions**

---

## Detailed Failures

### predict_augmented_viz_2026-01-09T23-12-07.json (8 errors)

| Config | Model | Ray | Error |
|--------|-------|-----|-------|
| 0 | Sonnet 4.5 | SOUTH-5 | API 500 |
| 0 | Haiku 4.5 | NORTH-7 | API 500 |
| 0 | Haiku 4.5 | SOUTH-5 | API 500 |
| 1 | Haiku 4.5 | SOUTH-5 | Internal server error |
| 1 | Haiku 4.5 | SOUTH-6 | Internal server error |
| 1 | Haiku 4.5 | SOUTH-7 | Internal server error |
| 9 | Opus 4.5 | NORTH-8 | Internal server error |
| 9 | Opus 4.5 | SOUTH-2 | Internal server error |

### predict_augmented_viz_2026-01-10T07-50-15.json (3 errors)

| Config | Model | Ray | Error |
|--------|-------|-----|-------|
| 3 | Sonnet 4.5 | SOUTH-3 | No response content |
| 6 | Sonnet 4.5 | EAST-1 | Internal server error |
| 7 | Haiku 4.5 | NORTH-6 | No response content |

### predict_baseline_viz_2026-01-04T22-36-03.json (1 error)

| Config | Model | Ray | Error |
|--------|-------|-----|-------|
| 8 | Sonnet 4.5 | EAST-8 | API 502 |

### predict_baseline_viz_2026-01-11T05-06-18.json (4 errors)

| Config | Model | Ray | Error |
|--------|-------|-----|-------|
| 3 | Sonnet 4.5 | EAST-4 | API 502 |
| 9 | Sonnet 4.5 | NORTH-3 | API 502 |
| 9 | Sonnet 4.5 | EAST-5 | API 502 |
| 9 | Sonnet 4.5 | WEST-1 | API 502 |

---

## Options for Rerunning

### Option 1: Rerun Entire Files
- Simplest approach
- Will generate new file with all predictions
- Replace old file with new one

### Option 2: Rerun Only Failed Rays
- More efficient (fewer API calls)
- Requires code to:
  1. Run specific (config, model, ray) combinations
  2. Merge new results into existing JSON
  3. Replace failed predictions with successful ones

### Option 3: Add "Rerun Failures" Feature to App
- Add UI to load a JSON file and rerun only failed predictions
- Automatically merge results and export updated file
