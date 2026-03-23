#!/usr/bin/env Rscript
# Test trace_ray_r against known ray physics properties and existing JSON data

library(tidyverse)
library(jsonlite)

# ── Copy of trace_ray_r and helpers from blackbox_llm_study.qmd ──

trace_ray_r <- function(atom_config, entry_side, entry_pos) {
  GRID_SIZE <- 8
  atom_set <- paste(atom_config[, 1], atom_config[, 2], sep = ",")
  has_atom <- function(r, c) paste(r, c, sep = ",") %in% atom_set

  if (entry_side == "north") { row <- 0; col <- entry_pos; dr <- 1;  dc <- 0  }
  else if (entry_side == "south") { row <- 9; col <- entry_pos; dr <- -1; dc <- 0  }
  else if (entry_side == "west")  { row <- entry_pos; col <- 0; dr <- 0;  dc <- 1  }
  else { row <- entry_pos; col <- 9; dr <- 0; dc <- -1 }

  entry_row <- row + dr
  entry_col <- col + dc

  if (has_atom(entry_row, entry_col)) {
    return(list(path = matrix(c(entry_row, entry_col), ncol = 2),
                absorbed = TRUE, reflected = FALSE))
  }

  get_diags <- function(r, c, vr, vc) {
    if (vr ==  1) list(left = c(r+1, c+1), right = c(r+1, c-1))
    else if (vr == -1) list(left = c(r-1, c-1), right = c(r-1, c+1))
    else if (vc ==  1) list(left = c(r-1, c+1), right = c(r+1, c+1))
    else                list(left = c(r+1, c-1), right = c(r-1, c-1))
  }
  init_diags <- get_diags(row, col, dr, dc)
  if (has_atom(init_diags$left[1], init_diags$left[2]) ||
      has_atom(init_diags$right[1], init_diags$right[2])) {
    return(list(path = matrix(nrow = 0, ncol = 2),
                entry_cell = c(entry_row, entry_col),
                absorbed = FALSE, reflected = TRUE))
  }

  path_rows <- integer(0)
  path_cols <- integer(0)

  for (step in seq_len(100)) {
    row <- row + dr
    col <- col + dc

    if (row < 1 || row > GRID_SIZE || col < 1 || col > GRID_SIZE) {
      path_mat <- if (length(path_rows) > 0) {
        matrix(c(path_rows, path_cols), ncol = 2)
      } else {
        matrix(nrow = 0, ncol = 2)
      }
      if (row < 1) { exit_side <- "north"; exit_pos <- col }
      else if (row > GRID_SIZE) { exit_side <- "south"; exit_pos <- col }
      else if (col < 1) { exit_side <- "west"; exit_pos <- row }
      else { exit_side <- "east"; exit_pos <- row }
      is_reflect <- (exit_side == entry_side && exit_pos == entry_pos)
      return(list(path = path_mat, absorbed = FALSE, reflected = is_reflect))
    }

    path_rows <- c(path_rows, row)
    path_cols <- c(path_cols, col)

    if (has_atom(row, col)) {
      return(list(path = matrix(c(path_rows, path_cols), ncol = 2),
                  absorbed = TRUE, reflected = FALSE))
    }

    ahead_r <- row + dr
    ahead_c <- col + dc
    if (!has_atom(ahead_r, ahead_c)) {
      diags <- get_diags(row, col, dr, dc)
      left_atom  <- has_atom(diags$left[1], diags$left[2])
      right_atom <- has_atom(diags$right[1], diags$right[2])

      if (left_atom && right_atom) {
        dr <- -dr; dc <- -dc
      } else if (left_atom) {
        tmp <- dr; dr <- dc; dc <- -tmp
      } else if (right_atom) {
        tmp <- dr; dr <- -dc; dc <- tmp
      }
    }
  }

  path_mat <- if (length(path_rows) > 0) {
    matrix(c(path_rows, path_cols), ncol = 2)
  } else {
    matrix(nrow = 0, ncol = 2)
  }
  list(path = path_mat, absorbed = TRUE, reflected = FALSE)
}

count_ray_cells <- function(atom_config, entry_side, entry_pos) {
  nrow(trace_ray_r(atom_config, entry_side, entry_pos)$path)
}

count_atoms_affecting <- function(atom_config, entry_side, entry_pos) {
  result <- trace_ray_r(atom_config, entry_side, entry_pos)
  path <- result$path

  if (nrow(path) == 0 && !is.null(result$entry_cell)) {
    ec <- result$entry_cell
    affected <- 0L
    for (i in seq_len(nrow(atom_config))) {
      if (abs(atom_config[i, 1] - ec[1]) <= 1 &&
          abs(atom_config[i, 2] - ec[2]) <= 1) {
        affected <- affected + 1L
      }
    }
    return(affected)
  }
  if (nrow(path) == 0) return(0L)

  affected <- 0L
  for (i in seq_len(nrow(atom_config))) {
    atom_row <- atom_config[i, 1]
    atom_col <- atom_config[i, 2]
    for (j in seq_len(nrow(path))) {
      if (abs(atom_row - path[j, 1]) <= 1 && abs(atom_col - path[j, 2]) <= 1) {
        affected <- affected + 1L
        break
      }
    }
  }
  affected
}

# ── 10 experiment configs (matching blackbox.jsx EXPERIMENT_CONFIGS) ──

CONFIGS <- list(
  matrix(c(2,3, 3,6, 6,2, 7,7), ncol = 2, byrow = TRUE),  # 0
  matrix(c(1,1, 1,3, 2,2, 5,6), ncol = 2, byrow = TRUE),  # 1
  matrix(c(2,2, 4,4, 6,6, 8,8), ncol = 2, byrow = TRUE),  # 2
  matrix(c(1,4, 4,8, 8,5, 5,1), ncol = 2, byrow = TRUE),  # 3
  matrix(c(3,4, 4,3, 4,5, 5,4), ncol = 2, byrow = TRUE),  # 4
  matrix(c(2,2, 2,3, 2,4, 4,2), ncol = 2, byrow = TRUE),  # 5
  matrix(c(1,1, 1,8, 8,1, 8,8), ncol = 2, byrow = TRUE),  # 6
  matrix(c(2,7, 3,2, 6,5, 7,3), ncol = 2, byrow = TRUE),  # 7
  matrix(c(4,2, 4,4, 4,6, 4,8), ncol = 2, byrow = TRUE),  # 8
  matrix(c(1,5, 3,3, 5,7, 8,2), ncol = 2, byrow = TRUE)   # 9
)

SIDES <- c("north", "south", "east", "west")

# ── Test 1: Trace all 320 rays, check basic properties ──

cat("=== Test 1: Basic properties for all 320 rays ===\n\n")

all_results <- list()
for (ci in seq_along(CONFIGS)) {
  config <- CONFIGS[[ci]]
  for (side in SIDES) {
    for (pos in 1:8) {
      result <- trace_ray_r(config, side, pos)
      cells <- count_ray_cells(config, side, pos)
      atoms <- count_atoms_affecting(config, side, pos)

      outcome <- if (result$absorbed) "absorbed"
                 else if (result$reflected) "reflected"
                 else "detour"

      all_results <- c(all_results, list(tibble(
        config = ci - 1, side = side, pos = pos,
        outcome = outcome, cells = cells, atoms = atoms,
        is_edge_reflect = result$reflected && nrow(result$path) == 0
      )))
    }
  }
}

results_df <- bind_rows(all_results)

# Property checks
failures <- 0

# 1a: Every reflection must have atoms_affecting >= 1
bad_reflects <- results_df |> filter(outcome == "reflected", atoms == 0)
if (nrow(bad_reflects) > 0) {
  cat("FAIL: Reflections with atoms_affecting = 0:\n")
  print(bad_reflects)
  failures <- failures + 1
} else {
  cat("PASS: All reflections have atoms_affecting >= 1\n")
}

# 1b: Every absorption must have atoms_affecting >= 1
bad_absorbs <- results_df |> filter(outcome == "absorbed", atoms == 0)
if (nrow(bad_absorbs) > 0) {
  cat("FAIL: Absorptions with atoms_affecting = 0:\n")
  print(bad_absorbs)
  failures <- failures + 1
} else {
  cat("PASS: All absorptions have atoms_affecting >= 1\n")
}

# 1c: No NA cells_traveled
na_cells <- results_df |> filter(is.na(cells))
if (nrow(na_cells) > 0) {
  cat("FAIL: Rays with NA cells_traveled:\n")
  print(na_cells)
  failures <- failures + 1
} else {
  cat("PASS: No NA cells_traveled values\n")
}

# 1d: cells_traveled >= 0 for all rays
neg_cells <- results_df |> filter(cells < 0)
if (nrow(neg_cells) > 0) {
  cat("FAIL: Rays with negative cells_traveled:\n")
  print(neg_cells)
  failures <- failures + 1
} else {
  cat("PASS: All cells_traveled >= 0\n")
}

# 1e: Edge reflections should have 0 cells
bad_edge <- results_df |> filter(is_edge_reflect, cells != 0)
if (nrow(bad_edge) > 0) {
  cat("FAIL: Edge reflections with non-zero cells:\n")
  print(bad_edge)
  failures <- failures + 1
} else {
  cat("PASS: All edge reflections have 0 cells_traveled\n")
}

# 1f: Non-edge-reflection rays that enter the grid should have cells >= 1
bad_interior <- results_df |> filter(!is_edge_reflect, cells == 0)
if (nrow(bad_interior) > 0) {
  cat("FAIL: Non-edge-reflection rays with 0 cells:\n")
  print(bad_interior)
  failures <- failures + 1
} else {
  cat("PASS: All non-edge-reflection rays have cells >= 1\n")
}

cat("\n=== Summary by outcome ===\n")
results_df |>
  group_by(outcome) |>
  summarise(
    count = n(),
    min_cells = min(cells),
    max_cells = max(cells),
    mean_cells = round(mean(cells), 1),
    min_atoms = min(atoms),
    max_atoms = max(atoms),
    mean_atoms = round(mean(atoms), 1),
    .groups = "drop"
  ) |>
  print()

cat("\n=== Reflections detail ===\n")
reflect_detail <- results_df |>
  filter(outcome == "reflected") |>
  select(config, side, pos, cells, atoms, is_edge_reflect)
print(reflect_detail, n = 50)

# ── Test 2: Compare outcomes against JSON data ──

cat("\n=== Test 2: Compare against JSON predict data ===\n\n")

predict_json_files <- list.files(
  path = "Experiment 1/Predict",
  pattern = "\\.json$",
  full.names = TRUE
)

if (length(predict_json_files) > 0) {
  # Load one file to compare outcomes
  json_data <- fromJSON(predict_json_files[1], simplifyDataFrame = FALSE)

  mismatches <- 0
  total <- 0

  for (r in json_data$results) {
    config <- if (is.matrix(r$atomConfig)) r$atomConfig
              else do.call(rbind, lapply(r$atomConfig, unlist))
    for (p in r$predictions) {
      total <- total + 1
      result <- trace_ray_r(config, p$rayEntry$side, p$rayEntry$pos)

      r_outcome <- if (result$absorbed) "absorbed"
                   else if (result$reflected) "reflected"
                   else "detour"

      # Parse the actual outcome from JSON
      actual <- tolower(p$actual)
      j_outcome <- if (grepl("absorbed|hit", actual)) "absorbed"
                   else if (grepl("reflected", actual)) "reflected"
                   else "detour"

      if (r_outcome != j_outcome) {
        mismatches <- mismatches + 1
        cat(sprintf("MISMATCH config %d %s-%d: R=%s JSON=%s (actual='%s')\n",
                    r$configIndex, p$rayEntry$side, p$rayEntry$pos,
                    r_outcome, j_outcome, p$actual))
      }
    }
  }

  if (mismatches == 0) {
    cat(sprintf("PASS: All %d ray outcomes match JSON data\n", total))
  } else {
    cat(sprintf("FAIL: %d/%d mismatches\n", mismatches, total))
    failures <- failures + 1
  }
} else {
  cat("SKIP: No predict JSON files found\n")
}

# ── Test 3: Config 9 specifically (user highlighted loop-back reflections) ──

cat("\n=== Test 3: Config 9 detail (atoms at (1,5), (3,3), (5,7), (8,2)) ===\n\n")

config9 <- CONFIGS[[10]]  # 0-indexed config 9 = index 10
config9_results <- results_df |> filter(config == 9)

cat("All reflections in config 9:\n")
config9_results |>
  filter(outcome == "reflected") |>
  print()

cat("\nAll rays in config 9:\n")
config9_results |>
  arrange(side, pos) |>
  print(n = 32)

# ── Final result ──

cat(sprintf("\n=== %d failures ===\n", failures))
if (failures == 0) cat("All tests passed!\n")
quit(status = failures > 0)
