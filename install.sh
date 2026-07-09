#!/bin/bash
# Dev convenience script — hardcoded for local development.
# End users should run: npx @rpamis/comet init
set -e

echo "Building Comet..."
pnpm build

echo "Linking globally..."
pnpm link --global

echo "Verifying installation..."
comet --version || echo "Warning: comet not found in PATH"

echo "comet init "
comet init --language zh --scope global --overwrite --platform opencode

echo "Done!"
