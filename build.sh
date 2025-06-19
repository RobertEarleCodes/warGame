#!/bin/bash
set -e

echo "Starting build process..."

# Clean everything
rm -rf node_modules
rm -f package-lock.json

# Clear npm cache
npm cache clean --force

# Install with specific flags
npm install --no-optional --force --legacy-peer-deps

# Build the project
npm run build

echo "Build completed successfully!"
