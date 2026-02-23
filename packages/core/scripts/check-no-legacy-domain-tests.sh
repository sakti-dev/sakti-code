#!/usr/bin/env bash
set -euo pipefail

# Check for legacy domain test files
# This script prevents reintroduction of tests under tests/{agent,memory,session,spec,tools}

FOUND=0
for dir in packages/core/tests/agent packages/core/tests/memory packages/core/tests/session packages/core/tests/spec packages/core/tests/tools; do
  if [ -d "$dir" ]; then
    if rg --files "$dir" -g "*.test.ts" | grep -q .; then
      echo "Found forbidden legacy domain test files under $dir"
      FOUND=1
    fi
  fi
done

if [ $FOUND -eq 1 ]; then
  exit 1
fi

echo "No legacy domain tests found - layout guardrail passed"
