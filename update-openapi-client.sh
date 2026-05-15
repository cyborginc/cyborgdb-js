#!/bin/bash

set -e

echo "Generating TypeScript client from openapi.json..."

# Check if OpenAPI spec exists
if [ ! -f "openapi.json" ]; then
    echo "Error: openapi.json not found!"
    exit 1
fi

# Clean existing generated files
echo "Cleaning old generated files..."
rm -rf src/models src/apis

# Generate TypeScript client using typescript-fetch generator
# Using OpenAPI Generator version 7.12.0
echo "Generating TypeScript client with OpenAPI Generator 7.12.0..."

# Check if openapi-generator-cli is installed
if ! command -v openapi-generator-cli &> /dev/null; then
    echo "Installing openapi-generator-cli..."
    npm install -g @openapitools/openapi-generator-cli
fi

# Set the specific version
export OPENAPI_GENERATOR_VERSION=7.12.0

# Generate the client
openapi-generator-cli generate \
    -i openapi.json \
    -g typescript-fetch \
    -o src \
    --skip-validate-spec

echo "Generated TypeScript client"

# Verify the result actually builds and typechecks. Errors here usually mean
# the hand-written SDK surface (client.ts, encryptedIndex.ts) needs to be
# adapted to model/API changes in the new spec.
echo ""
echo "Running build (bundles + type declarations)..."
npm run build

echo ""
echo "Code generation complete!"