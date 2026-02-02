#!/bin/bash
# Run the seed script from the podsie project directory
# so that node_modules are resolved correctly

PROJECT_DIR="$HOME/Documents/GitHub/podsie"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Error: Project directory not found at $PROJECT_DIR"
  exit 1
fi

cd "$PROJECT_DIR"

# Set NODE_PATH so tsx can find node_modules when running external scripts
export NODE_PATH="$PROJECT_DIR/node_modules"

exec npx tsx --tsconfig "$PROJECT_DIR/tsconfig.json" ~/.claude/skills/seed-sandbox-data/seedSandboxData.ts "$@"
