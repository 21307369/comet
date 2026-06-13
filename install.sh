#!/bin/bash
set -e

echo "Building Comet..."
pnpm build

echo "Linking globally..."
pnpm link --global

echo "Verifying installation..."
comet --version || echo "Warning: comet not found in PATH"

echo "Done!"
