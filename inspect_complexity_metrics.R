#!/usr/bin/env Rscript
# Manual inspection tool for complexity metrics
# This shows the raw data so you can verify the calculations yourself

library(tidyverse)
library(jsonlite)

cat("=== Manual Inspection Tool for Complexity Metrics ===\n\n")
cat("This tool shows the raw data so YOU can verify the calculations.\n")
cat("Compare what you see with what the functions calculate.\n\n")

# ==============================================================================
# Load functions
# ==============================================================================

count_atoms_affecting <- function(path, atom_config) {
  if (is.null(path) || length(path) == 0) return(0)
  if (!is.matrix(path)) return(0)

  affected <- 0
  n_atoms <- nrow(atom_config)
  n_cells <- nrow(path)

  for (i in seq_len(n_atoms)) {
    atom_row <- atom_config[i, 1]
    atom_col <- atom_config[i, 2]
    for (j in seq_len(n_cells)) {
      cell_row <- path[j, 1]
      cell_col <- path[j, 2]
      if (abs(atom_row - cell_row) <= 1 && abs(atom_col - cell_col) <= 1) {
        affected <- affected + 1
        break
      }
    }
  }
  affected
}

count_ray_cells <- function(rayResult) {
  if (is.null(rayResult) || is.null(rayResult$path)) {
    return(NA_real_)
  }
  path <- rayResult$path
  if (!is.matrix(path) || nrow(path) == 0) {
    return(NA_real_)
  }
  return(1 + nrow(path))
}

# ==============================================================================
# Helper function to visualize a path on a grid
# ==============================================================================

visualize_ray <- function(path, atoms = NULL, grid_size = 8) {
  # Create empty grid
  grid <- matrix(".", nrow = grid_size, ncol = grid_size)

  # Mark atoms with 'A'
  if (!is.null(atoms)) {
    for (i in 1:nrow(atoms)) {
      row <- atoms[i, 1]
      col <- atoms[i, 2]
      if (row >= 1 && row <= grid_size && col >= 1 && col <= grid_size) {
        grid[row, col] <- "A"
      }
    }
  }

  # Mark path with numbers (order)
  if (!is.null(path) && is.matrix(path)) {
    for (i in 1:nrow(path)) {
      row <- path[i, 1]
      col <- path[i, 2]
      if (row >= 1 && row <= grid_size && col >= 1 && col <= grid_size) {
        # If there's already an atom, mark it as 'X' (hit)
        if (grid[row, col] == "A") {
          grid[row, col] <- "X"
        } else {
          # Use numbers for path order, wrap after 9
          grid[row, col] <- as.character(i %% 10)
        }
      }
    }
  }

  # Print grid with row/col labels
  cat("    ", paste(1:grid_size, collapse = " "), "\n")
  cat("   ", paste(rep("-", grid_size * 2), collapse = ""), "\n")
  for (i in 1:grid_size) {
    cat(sprintf("%2d | %s\n", i, paste(grid[i, ], collapse = " ")))
  }
  cat("\n")
  cat("Legend: . = empty, A = atom, X = atom hit, 0-9 = path order\n")
}

# ==============================================================================
# Inspect Predict Mode Data
# ==============================================================================

cat("\n========================================\n")
cat("PART 1: PREDICT MODE - Cells Traveled\n")
cat("========================================\n\n")

cat("YOUR REQUIREMENT:\n")
cat("- Entry cell (outside box) = 1 cell\n")
cat("- Internal path cells = N cells\n")
cat("- Exit cell = 1 cell (already counted in path)\n")
cat("- Total = 1 + path.length\n\n")

cat("EXAMPLES TO VERIFY:\n")
cat("1. Ray absorbed at edge: entry(1) + hit position in path(1) = 2 cells\n")
cat("2. Ray travels 2 internal then exits: entry(1) + path of 3 cells = 4 cells\n\n")

predict_files <- list.files("Experiment 1/Predict", pattern = "\\.json$", full.names = TRUE)

if (length(predict_files) > 0) {
  cat("Loading real data from:", basename(predict_files[1]), "\n\n")

  data <- fromJSON(predict_files[1], simplifyDataFrame = FALSE)

  if (!is.null(data$results) && length(data$results) > 0) {
    # Show first 5 predictions from potentially different configs
    configs_shown <- 0
    max_configs <- 3  # Show examples from up to 3 different configurations

    for (res_idx in 1:min(length(data$results), 10)) {
      result <- data$results[[res_idx]]

      if (!is.null(result$predictions) && !is.null(result$atomConfig)) {
        # Show atom config for this result
        if (configs_shown == 0 || res_idx == 1) {
          cat(sprintf("\n═══════════════════════════════════════\n"))
          cat(sprintf("CONFIGURATION %d (Config Index: %s)\n", configs_shown + 1, result$configIndex))
          cat(sprintf("═══════════════════════════════════════\n\n"))

          cat("Atom Configuration:\n")
          atom_config <- result$atomConfig
          for (a in 1:nrow(atom_config)) {
            cat(sprintf("  Atom %d: (%d, %d)\n", a, atom_config[a, 1], atom_config[a, 2]))
          }
          cat("\n")
        }

        # Show first 2 valid predictions from this config
        preds_shown <- 0
        for (i in 1:length(result$predictions)) {
          if (preds_shown >= 2) break

          pred <- result$predictions[[i]]

          if (!is.null(pred$rayResult) && !is.null(pred$rayResult$path)) {
            path <- pred$rayResult$path

            # Skip if path is empty
            if (!is.matrix(path) || nrow(path) == 0) {
              next
            }

            preds_shown <- preds_shown + 1

            cat(sprintf("--- Prediction %d ---\n", i))
            cat(sprintf("Ray Entry: %s-%s\n", pred$rayEntry$side, pred$rayEntry$position))
            cat(sprintf("Actual Outcome: %s\n", pred$actual))

            cat(sprintf("\nRaw Path Data (row, col):\n"))
            for (j in 1:nrow(path)) {
              cat(sprintf("  Cell %d: (%d, %d)\n", j, path[j, 1], path[j, 2]))
            }

            cat("\nVisual Grid:\n")
            visualize_ray(path, result$atomConfig)

            cat(sprintf("Path length from JSON: %d cells\n", nrow(path)))

            cells_calc <- count_ray_cells(pred$rayResult)
            cat(sprintf("Cells traveled (calculated): %d cells\n", cells_calc))
            cat(sprintf("Formula: 1 (entry) + %d (path) = %d\n", nrow(path), cells_calc))

            cat("\n** YOUR VERIFICATION **\n")
            cat("Look at the visual grid above:\n")
            cat("- A = atom position\n")
            cat("- X = ray hit an atom\n")
            cat("- 0-9 = path order (entry is outside grid, not shown)\n")
            cat(sprintf("Count the numbered cells (path): %d cells\n", nrow(path)))
            cat(sprintf("Add 1 for entry (outside box): total = %d cells\n", cells_calc))
            cat(sprintf("Does this match the calculated value? (Y/N)\n"))
            cat("─────────────────────────────\n\n")
          }
        }

        configs_shown <- configs_shown + 1
        if (configs_shown >= max_configs) break
      }
    }
  }
} else {
  cat("No Predict data found. Using manual example:\n\n")

  # Manual example
  cat("Example: Ray absorbed at edge\n")
  example_path <- matrix(c(1, 4), ncol = 2, byrow = TRUE)
  cat("Path: (1, 4)\n")
  cat("This is the entry/hit position.\n")
  cat("Calculation: 1 (entry outside) + 1 (this position) = 2 cells\n")
  cat(sprintf("Function returns: %d\n\n", count_ray_cells(list(path = example_path))))
}

# ==============================================================================
# Inspect Play Mode Data
# ==============================================================================

cat("\n========================================\n")
cat("PART 2: PLAY MODE - Atoms Affecting Ray\n")
cat("========================================\n\n")

cat("YOUR REQUIREMENT:\n")
cat("- Count atoms that are adjacent to ANY cell in the ray path\n")
cat("- Adjacent = within 1 cell distance (including diagonal)\n")
cat("- Each atom counts only once, even if adjacent to multiple path cells\n\n")

cat("DISTANCE RULES:\n")
cat("- Distance 0 (same cell): COUNTS\n")
cat("- Distance 1 (orthogonal or diagonal): COUNTS\n")
cat("- Distance > 1: DOES NOT COUNT\n\n")

play_files <- list.files("Experiment 1/Play", pattern = "\\.json$", full.names = TRUE)

if (length(play_files) > 0) {
  cat("Loading real data from:", basename(play_files[1]), "\n\n")

  data <- fromJSON(play_files[1], simplifyDataFrame = FALSE)

  if (!is.null(data$results) && length(data$results) > 0) {
    result <- data$results[[1]]

    if (!is.null(result$atomConfig) && !is.null(result$raySequence)) {
      atom_config <- result$atomConfig

      cat("Atom Configuration for this game:\n")
      for (i in 1:nrow(atom_config)) {
        cat(sprintf("  Atom %d: (%d, %d)\n", i, atom_config[i, 1], atom_config[i, 2]))
      }
      cat("\n")

      # Show first 3 rays
      for (i in 1:min(3, length(result$raySequence))) {
        ray <- result$raySequence[[i]]

        if (!is.null(ray$action) && ray$action == "fire" &&
            !is.null(ray$rayResult) && !is.null(ray$rayResult$path)) {

          cat(sprintf("═══ RAY %d ═══\n", i))
          if (!is.null(ray$side) && !is.null(ray$position)) {
            cat(sprintf("Fired from: %s-%d\n", toupper(ray$side), ray$position))
          }

          path <- ray$rayResult$path
          cat(sprintf("\nPath through %d cells:\n", nrow(path)))
          for (j in 1:nrow(path)) {
            cat(sprintf("  Cell %d: (%d, %d)\n", j, path[j, 1], path[j, 2]))
          }

          cat("\nVisual representation:\n")
          visualize_ray(path, atom_config)

          # Calculate distances
          cat("Distance from each atom to NEAREST path cell:\n")
          for (a in 1:nrow(atom_config)) {
            atom_row <- atom_config[a, 1]
            atom_col <- atom_config[a, 2]

            min_dist <- Inf
            closest_cell <- c(NA, NA)

            for (p in 1:nrow(path)) {
              path_row <- path[p, 1]
              path_col <- path[p, 2]
              dist <- max(abs(atom_row - path_row), abs(atom_col - path_col))
              if (dist < min_dist) {
                min_dist <- dist
                closest_cell <- c(path_row, path_col)
              }
            }

            affects <- if (min_dist <= 1) "YES" else "NO"
            cat(sprintf("  Atom %d at (%d,%d): distance %d to (%d,%d) -> %s\n",
                       a, atom_row, atom_col, min_dist,
                       closest_cell[1], closest_cell[2], affects))
          }

          atoms_calc <- count_atoms_affecting(path, atom_config)
          cat(sprintf("\nAtoms affecting (calculated): %d\n", atoms_calc))

          cat("\n** YOUR VERIFICATION **\n")
          cat("Look at the grid above. Count atoms (A or X) that are:\n")
          cat("- On a path cell (marked 0-9), OR\n")
          cat("- Adjacent (including diagonal) to a path cell\n")
          cat(sprintf("Does the count of %d match what you see? (Y/N)\n", atoms_calc))
          cat("═════════════════════════════\n\n")
        }
      }
    }
  }
} else {
  cat("No Play data found. Using manual example:\n\n")

  # Manual example
  cat("Example: Ray passes near atoms\n")
  example_path <- matrix(c(2, 2, 3, 2, 4, 2), ncol = 2, byrow = TRUE)
  example_atoms <- matrix(c(2, 3, 5, 5), ncol = 2, byrow = TRUE)

  cat("Path: (2,2) -> (3,2) -> (4,2)\n")
  cat("Atoms: (2,3) and (5,5)\n\n")
  visualize_ray(example_path, example_atoms)

  cat("\nAtom (2,3): distance 1 from (2,2) -> COUNTS\n")
  cat("Atom (5,5): distance > 1 from all path cells -> DOES NOT COUNT\n")
  cat(sprintf("Function returns: %d (should be 1)\n\n",
              count_atoms_affecting(example_path, example_atoms)))
}

cat("\n========================================\n")
cat("INSTRUCTIONS FOR MANUAL VERIFICATION\n")
cat("========================================\n\n")

cat("For CELLS TRAVELED (Predict mode):\n")
cat("1. Look at the 'Raw Path Data' for each prediction\n")
cat("2. Count the number of cells listed\n")
cat("3. Add 1 for the entry cell (outside the box)\n")
cat("4. Verify this matches the 'Cells traveled (calculated)'\n\n")

cat("For ATOMS AFFECTING (Play mode):\n")
cat("1. Look at the visual grid\n")
cat("2. For each atom (A or X), check if it's:\n")
cat("   - ON a numbered path cell, OR\n")
cat("   - ADJACENT (including diagonal) to a numbered cell\n")
cat("3. Count how many atoms meet this criteria\n")
cat("4. Verify this matches 'Atoms affecting (calculated)'\n\n")

cat("If ANY of these don't match what you expect, the functions are WRONG.\n")
cat("Please report any mismatches!\n\n")
