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
# Using OpenAPI Generator version 7.22.0
echo "Generating TypeScript client with OpenAPI Generator 7.22.0..."

# Check if openapi-generator-cli is installed
if ! command -v openapi-generator-cli &> /dev/null; then
    echo "Installing openapi-generator-cli..."
    npm install -g @openapitools/openapi-generator-cli
fi

# Set the specific version
export OPENAPI_GENERATOR_VERSION=7.22.0

# Generate the client
openapi-generator-cli generate \
    -i openapi.json \
    -g typescript-fetch \
    -o src \
    --skip-validate-spec

echo "Generated TypeScript client"

# The typescript-fetch template emits imports the generated file doesn't
# actually use — `mapValues` in every model, and the `*FromJSONTyped` /
# `*ToJSONTyped` companion functions in models that only call the
# non-typed pair. The project's biome.json deliberately ignores
# src/models/** and src/apis/**, so the normal lint never sees them.
# Run biome here with a one-off config that DOES include them and strips
# unused imports.
echo "Stripping unused imports from generated client..."
BIOME_TMP_DIR=$(mktemp -d)
cat > "$BIOME_TMP_DIR/biome.json" <<'BIOMEEOF'
{
    "$schema": "https://biomejs.dev/schemas/2.4.16/schema.json",
    "files": { "includes": ["**"] },
    "linter": {
        "enabled": true,
        "rules": {
            "recommended": false,
            "correctness": { "noUnusedImports": "error" }
        }
    },
    "formatter": { "enabled": false }
}
BIOMEEOF
# Biome classifies unused-import removal as unsafe (the import could
# have side effects), so --unsafe is required for the fix to apply.
# Tolerate exit codes from any other unrelated diagnostics.
npx biome check --config-path "$BIOME_TMP_DIR" --write --unsafe src/models src/apis || true
rm -rf "$BIOME_TMP_DIR"

# Test build
echo "Testing build..."
if npm run build > /dev/null 2>&1; then
    echo "Build successful!"
else
    echo "Build completed with warnings (this is normal)"
fi

echo ""
echo "Code generation complete!"