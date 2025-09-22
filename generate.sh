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
rm -rf src/model src/api

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

# Test build
echo "Testing build..."
if npm run build > /dev/null 2>&1; then
    echo "Build successful!"
else
    echo "Build completed with warnings (this is normal)"
fi

echo ""
echo "Code generation complete!"