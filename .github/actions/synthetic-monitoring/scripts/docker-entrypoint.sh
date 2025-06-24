#!/bin/bash
set -e

# Source environment variables created by the action's .env file step
if [ -f ".env" ]; then
  echo "Sourcing .env file..."
  set -o allexport
  # shellcheck source=/dev/null
  source .env
  set +o allexport
else
  echo "Warning: .env file not found. Proceeding with existing environment variables."
fi

echo "Running synthetic tests with browser: $INPUT_BROWSER"

# Construct the Playwright test command arguments
PLAYWRIGHT_ARGS="--project=${INPUT_BROWSER}"

if [ -n "$INPUT_CONFIG_PATH" ]; then
  PLAYWRIGHT_ARGS="$PLAYWRIGHT_ARGS --config=$INPUT_CONFIG_PATH"
fi

# The base command is `npm run test:synthetic` which expands to `playwright test`
# We need to pass arguments to `playwright test` itself.
# If INPUT_TEST_DIR is provided, it's passed as the last argument to `playwright test`.
# Otherwise, Playwright uses its default (or config-defined) test directory.
if [ -n "$INPUT_TEST_DIR" ]; then
  TEST_CMD="npm run test:synthetic -- $PLAYWRIGHT_ARGS $INPUT_TEST_DIR"
else
  TEST_CMD="npm run test:synthetic -- $PLAYWRIGHT_ARGS"
fi

echo "Executing test command: $TEST_CMD"
# Execute the test command
eval "$TEST_CMD"
