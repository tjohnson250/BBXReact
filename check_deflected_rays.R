#!/usr/bin/env Rscript
library(jsonlite)
library(tidyverse)

# Load a predict file
files <- list.files('Experiment 1/Predict', pattern = '\\.json$', full.names = TRUE)
data <- fromJSON(files[1], simplifyDataFrame = FALSE)

cat('Looking for deflected rays (detour outcomes)...\n\n')

examples_found <- 0

for (i in 1:min(5, length(data$results))) {
  result <- data$results[[i]]
  if (!is.null(result$predictions)) {
    for (j in 1:length(result$predictions)) {
      pred <- result$predictions[[j]]

      # Check if it's a detour (exits at different position, not absorbed/reflected)
      if (!grepl('absorbed|reflected', pred$actual, ignore.case=TRUE)) {
        cat('═══ DEFLECTED RAY EXAMPLE', examples_found + 1, '═══\n')
        cat('Entry:', pred$rayEntry$side, '-', pred$rayEntry$position, '\n')
        cat('Actual outcome:', pred$actual, '\n')

        if (!is.null(pred$rayResult)) {
          cat('\nrayResult fields:', paste(names(pred$rayResult), collapse=', '), '\n')

          if (!is.null(pred$rayResult$path)) {
            cat('\nPath length:', nrow(pred$rayResult$path), 'cells\n')
            cat('Path contents (row, col):\n')
            for (k in 1:nrow(pred$rayResult$path)) {
              cat(sprintf('  Cell %d: (%d, %d)\n', k,
                         pred$rayResult$path[k,1], pred$rayResult$path[k,2]))
            }
          }

          if (!is.null(pred$rayResult$exit)) {
            cat('\nExit field:\n')
            print(pred$rayResult$exit)
          }

          if (!is.null(pred$rayResult$outcome)) {
            cat('\nOutcome field:', pred$rayResult$outcome, '\n')
          }

          cat('\nFull rayResult structure:\n')
          str(pred$rayResult, max.level = 2)
        }

        cat('\n')
        examples_found <- examples_found + 1
        if (examples_found >= 3) break
      }
    }
    if (examples_found >= 3) break
  }
}

cat('\n\n═══ COMPARISON: OTHER RAY TYPES ═══\n\n')

# Check absorbed ray
result <- data$results[[1]]
for (p in result$predictions) {
  if (grepl('absorbed', p$actual, ignore.case = TRUE)) {
    cat('ABSORBED RAY:\n')
    cat('Actual:', p$actual, '\n')
    cat('Absorbed field:', p$rayResult$absorbed, '\n')
    cat('Path length:', nrow(p$rayResult$path), '\n')
    cat('Has exit field:', !is.null(p$rayResult$exit), '\n')
    if (!is.null(p$rayResult$exit)) {
      cat('  Exit side:', p$rayResult$exit$side, '\n')
    }
    cat('\n')
    break
  }
}

# Check reflected ray
for (p in result$predictions) {
  if (grepl('reflected', p$actual, ignore.case = TRUE)) {
    cat('REFLECTED RAY:\n')
    cat('Actual:', p$actual, '\n')
    cat('Absorbed field:', p$rayResult$absorbed, '\n')
    cat('Path length:', nrow(p$rayResult$path), '\n')
    cat('Has exit field:', !is.null(p$rayResult$exit), '\n')
    if (!is.null(p$rayResult$exit)) {
      cat('  Exit side:', p$rayResult$exit$side, '\n')
      cat('  Exit pos:', p$rayResult$exit$pos, '\n')
    }
    cat('\n')
    break
  }
}
