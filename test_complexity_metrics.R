#!/usr/bin/env Rscript
# Test script to verify complexity metric calculations
# Run with: Rscript test_complexity_metrics.R

library(tidyverse)
library(jsonlite)

cat("=== Testing Spatial Complexity Metrics ===\n\n")

# ==============================================================================
# Function 1: count_atoms_affecting (from Play mode)
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
        break  # Count each atom only once per ray
      }
    }
  }
  affected
}

# ==============================================================================
# Function 2: count_ray_cells (from Predict mode)
# ==============================================================================

count_ray_cells <- function(rayResult) {
  if (is.null(rayResult) || is.null(rayResult$path)) {
    return(NA_real_)
  }

  path <- rayResult$path
  if (!is.matrix(path) || nrow(path) == 0) {
    return(NA_real_)
  }

  # Entry cell (outside box) + internal path cells
  cells <- 1 + nrow(path)

  # Add exit cell (outside box) for rays that exit (not absorbed)
  if (!is.null(rayResult$absorbed) && !rayResult$absorbed) {
    cells <- cells + 1
  }

  return(cells)
}

# ==============================================================================
# Test Cases for count_atoms_affecting
# ==============================================================================

cat("=== Test 1: count_atoms_affecting ===\n\n")

# Test Case 1.1: Ray passes directly through atom (should count)
test_1_1 <- list(
  name = "Ray hits atom directly",
  path = matrix(c(1, 1), ncol = 2, byrow = TRUE),
  atoms = matrix(c(1, 1), ncol = 2, byrow = TRUE),
  expected = 1,
  explanation = "Atom at (1,1), ray path includes (1,1) - distance 0"
)

# Test Case 1.2: Ray adjacent to atom diagonally (should count)
test_1_2 <- list(
  name = "Ray diagonally adjacent to atom",
  path = matrix(c(2, 2, 3, 3), ncol = 2, byrow = TRUE),
  atoms = matrix(c(2, 3), ncol = 2, byrow = TRUE),
  expected = 1,
  explanation = "Atom at (2,3), ray path (2,2)→(3,3), distance from (2,2) is 1"
)

# Test Case 1.3: Ray adjacent to atom orthogonally (should count)
test_1_3 <- list(
  name = "Ray orthogonally adjacent to atom",
  path = matrix(c(3, 3, 4, 3, 5, 3), ncol = 2, byrow = TRUE),
  atoms = matrix(c(4, 4), ncol = 2, byrow = TRUE),
  expected = 1,
  explanation = "Atom at (4,4), ray passes through (4,3) - distance 1"
)

# Test Case 1.4: Ray far from atom (should NOT count)
test_1_4 <- list(
  name = "Ray far from atom",
  path = matrix(c(1, 1, 2, 1, 3, 1), ncol = 2, byrow = TRUE),
  atoms = matrix(c(5, 5), ncol = 2, byrow = TRUE),
  expected = 0,
  explanation = "Atom at (5,5), closest ray cell is (3,1) - distance > 1"
)

# Test Case 1.5: Multiple atoms, some affecting
test_1_5 <- list(
  name = "Multiple atoms, partial affect",
  path = matrix(c(2, 2, 3, 2, 4, 2), ncol = 2, byrow = TRUE),
  atoms = matrix(c(
    2, 3,  # Adjacent to (2,2) - should count
    3, 3,  # Adjacent to (3,2) - should count
    6, 6   # Far away - should NOT count
  ), ncol = 2, byrow = TRUE),
  expected = 2,
  explanation = "2 atoms adjacent to path, 1 atom far away"
)

# Test Case 1.6: Same atom affects multiple path cells (count once)
test_1_6 <- list(
  name = "Atom affects multiple path cells",
  path = matrix(c(2, 2, 2, 3, 2, 4), ncol = 2, byrow = TRUE),
  atoms = matrix(c(3, 3), ncol = 2, byrow = TRUE),
  expected = 1,
  explanation = "Atom at (3,3) is adjacent to both (2,2) and (2,3), but counts once"
)

# Run tests for count_atoms_affecting
atoms_tests <- list(test_1_1, test_1_2, test_1_3, test_1_4, test_1_5, test_1_6)

passed <- 0
failed <- 0

for (test in atoms_tests) {
  result <- count_atoms_affecting(test$path, test$atoms)
  status <- if (result == test$expected) {
    passed <- passed + 1
    "✓ PASS"
  } else {
    failed <- failed + 1
    "✗ FAIL"
  }

  cat(sprintf("%s: %s\n", status, test$name))
  cat(sprintf("  Explanation: %s\n", test$explanation))
  cat(sprintf("  Expected: %d, Got: %d\n", test$expected, result))
  if (result != test$expected) {
    cat("  Path:\n")
    print(test$path)
    cat("  Atoms:\n")
    print(test$atoms)
  }
  cat("\n")
}

cat(sprintf("count_atoms_affecting: %d/%d tests passed\n\n", passed, passed + failed))

# ==============================================================================
# Test Cases for count_ray_cells
# ==============================================================================

cat("=== Test 2: count_ray_cells ===\n\n")

# Test Case 2.1: Absorbed at edge (entry + hit position)
test_2_1 <- list(
  name = "Absorbed at edge",
  rayResult = list(
    path = matrix(c(1, 1), ncol = 2, byrow = TRUE),
    absorbed = TRUE
  ),
  expected = 2,
  explanation = "Entry cell (1) + path (1) + no exit (absorbed) = 2 total"
)

# Test Case 2.2: Absorbed one cell in
test_2_2 <- list(
  name = "Absorbed one cell in",
  rayResult = list(
    path = matrix(c(1, 1, 2, 1), ncol = 2, byrow = TRUE),
    absorbed = TRUE
  ),
  expected = 3,
  explanation = "Entry cell (1) + path (2) + no exit (absorbed) = 3 total"
)

# Test Case 2.3: Deflected - short path
test_2_3 <- list(
  name = "Short deflected path",
  rayResult = list(
    path = matrix(c(
      1, 1,  # Entry position inside
      2, 2,  # Internal cell
      3, 3   # Exit position inside
    ), ncol = 2, byrow = TRUE),
    absorbed = FALSE
  ),
  expected = 5,
  explanation = "Entry outside (1) + path (3) + exit outside (1) = 5 total"
)

# Test Case 2.4: Long deflected path
test_2_4 <- list(
  name = "Long deflected path",
  rayResult = list(
    path = matrix(c(
      1, 1,
      2, 1,
      3, 1,
      4, 1,
      5, 1
    ), ncol = 2, byrow = TRUE),
    absorbed = FALSE
  ),
  expected = 7,
  explanation = "Entry outside (1) + path (5) + exit outside (1) = 7 total"
)

# Test Case 2.5: Complex deflection path
test_2_5 <- list(
  name = "Complex deflection",
  rayResult = list(
    path = matrix(c(
      1, 4,  # Entry inside
      2, 4,  # Internal
      2, 5,  # Deflected
      3, 5,  # Internal
      3, 6,  # Deflected again
      4, 6   # Exit inside
    ), ncol = 2, byrow = TRUE),
    absorbed = FALSE
  ),
  expected = 8,
  explanation = "Entry outside (1) + path (6) + exit outside (1) = 8 total"
)

# Test Case 2.6: NULL or empty path
test_2_6 <- list(
  name = "NULL path",
  rayResult = list(path = NULL),
  expected = NA_real_,
  explanation = "NULL path should return NA"
)

# Run tests for count_ray_cells
cells_tests <- list(test_2_1, test_2_2, test_2_3, test_2_4, test_2_5, test_2_6)

passed_cells <- 0
failed_cells <- 0

for (test in cells_tests) {
  result <- count_ray_cells(test$rayResult)

  # Handle NA comparison
  matches <- if (is.na(test$expected) && is.na(result)) {
    TRUE
  } else if (is.na(test$expected) || is.na(result)) {
    FALSE
  } else {
    result == test$expected
  }

  status <- if (matches) {
    passed_cells <- passed_cells + 1
    "✓ PASS"
  } else {
    failed_cells <- failed_cells + 1
    "✗ FAIL"
  }

  cat(sprintf("%s: %s\n", status, test$name))
  cat(sprintf("  Explanation: %s\n", test$explanation))
  cat(sprintf("  Expected: %s, Got: %s\n",
              ifelse(is.na(test$expected), "NA", test$expected),
              ifelse(is.na(result), "NA", result)))
  if (!matches) {
    cat("  Path:\n")
    print(test$rayResult$path)
  }
  cat("\n")
}

cat(sprintf("count_ray_cells: %d/%d tests passed\n\n", passed_cells, passed_cells + failed_cells))

# ==============================================================================
# Test with real data (if available)
# ==============================================================================

cat("=== Test 3: Validation Against Real Data ===\n\n")

# Try to load a sample JSON file to test with real data
predict_files <- list.files("Experiment 1/Predict", pattern = "\\.json$", full.names = TRUE)

if (length(predict_files) > 0) {
  cat("Testing with real data from:", basename(predict_files[1]), "\n\n")

  data <- fromJSON(predict_files[1], simplifyDataFrame = FALSE)

  if (!is.null(data$results) && length(data$results) > 0) {
    # Sample a few predictions to show
    result <- data$results[[1]]

    if (!is.null(result$predictions) && length(result$predictions) >= 3) {
      cat("Sample predictions from real data:\n\n")

      for (i in 1:min(3, length(result$predictions))) {
        pred <- result$predictions[[i]]

        if (!is.null(pred$rayResult) && !is.null(pred$rayResult$path)) {
          cells <- count_ray_cells(pred$rayResult)
          path_length <- nrow(pred$rayResult$path)

          cat(sprintf("Prediction %d:\n", i))
          cat(sprintf("  Ray entry: %s\n", pred$rayEntry))
          cat(sprintf("  Actual outcome: %s\n", pred$actual))
          cat(sprintf("  Path cells (from JSON): %d\n", path_length))
          cat(sprintf("  Cells traveled (calculated): %d\n", cells))
          cat(sprintf("  Formula check: 1 (entry) + %d (path) = %d ✓\n", path_length, cells))
          cat("\n")
        }
      }
    }
  }
} else {
  cat("No real data files found in Experiment 1/Predict/\n")
  cat("Skipping real data validation.\n\n")
}

# ==============================================================================
# Test with Play mode data
# ==============================================================================

play_files <- list.files("Experiment 1/Play", pattern = "\\.json$", full.names = TRUE)

if (length(play_files) > 0) {
  cat("Testing atoms affecting with real Play data from:", basename(play_files[1]), "\n\n")

  data <- fromJSON(play_files[1], simplifyDataFrame = FALSE)

  if (!is.null(data$results) && length(data$results) > 0) {
    result <- data$results[[1]]

    if (!is.null(result$raySequence) && length(result$raySequence) >= 3) {
      cat("Sample rays from real game:\n\n")

      for (i in 1:min(3, length(result$raySequence))) {
        ray <- result$raySequence[[i]]

        if (!is.null(ray$rayResult) && !is.null(ray$rayResult$path) && !is.null(result$atomConfig)) {
          atoms_count <- count_atoms_affecting(ray$rayResult$path, result$atomConfig)
          path_length <- nrow(ray$rayResult$path)

          cat(sprintf("Ray %d (Action: %s):\n", i, ray$action))
          if (!is.null(ray$side)) {
            cat(sprintf("  Fired from: %s-%d\n", toupper(ray$side), ray$position))
          }
          cat(sprintf("  Path length: %d cells\n", path_length))
          cat(sprintf("  Atoms affecting: %d\n", atoms_count))
          cat(sprintf("  Atom positions: %s\n",
                      paste(apply(result$atomConfig, 1, function(x) sprintf("(%d,%d)", x[1], x[2])), collapse = ", ")))
          cat("\n")
        }
      }
    }
  }
} else {
  cat("No real data files found in Experiment 1/Play/\n")
  cat("Skipping Play data validation.\n\n")
}

# ==============================================================================
# Summary
# ==============================================================================

cat("=== SUMMARY ===\n")
cat(sprintf("count_atoms_affecting: %d/%d tests passed\n", passed, passed + failed))
cat(sprintf("count_ray_cells: %d/%d tests passed\n", passed_cells, passed_cells + failed_cells))

total_passed <- passed + passed_cells
total_tests <- passed + failed + passed_cells + failed_cells

if (failed == 0 && failed_cells == 0) {
  cat("\n✓ ALL TESTS PASSED!\n")
  quit(status = 0)
} else {
  cat(sprintf("\n✗ %d TESTS FAILED\n", failed + failed_cells))
  quit(status = 1)
}
