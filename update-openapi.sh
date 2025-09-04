#!/bin/bash

# Script to update OpenAPI generated code while preserving camelCase naming

echo "=========================================="
echo "OpenAPI Code Update Script for CyborgDB"
echo "=========================================="

# Create a temp directory for generation
TEMP_DIR="/tmp/openapi-gen-$(date +%s)"
mkdir -p $TEMP_DIR

echo "Step 1: Generating OpenAPI code to temp directory..."

# Generate with standard options
openapi-generator generate \
    -i openapi.json \
    -g typescript-axios \
    -o $TEMP_DIR \
    --additional-properties=supportsES6=true,withSeparateModelsAndApi=true,apiPackage=api,modelPackage=model \
    --generator-name typescript-axios \
    --global-property apis,models,supportingFiles \
    --skip-validate-spec > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "Error: OpenAPI generation failed"
    echo "Running with verbose output to see the error:"
    openapi-generator generate \
        -i openapi.json \
        -g typescript-axios \
        -o $TEMP_DIR \
        --additional-properties=supportsES6=true,withSeparateModelsAndApi=true,apiPackage=api,modelPackage=model \
        --generator-name typescript-axios \
        --global-property apis,models,supportingFiles \
        --skip-validate-spec
    exit 1
fi

echo "Step 2: Processing and copying files..."

# Function to convert kebab-case to camelCase
kebab_to_camel() {
    local filename="$1"
    # Remove .ts extension for processing
    local base="${filename%.ts}"
    
    # Special cases
    case "$base" in
        "httpvalidation-error")
            echo "hTTPValidationError.ts"
            ;;
        *)
            # Convert kebab-case to camelCase using awk
            echo "$base" | awk -F'-' '{
                for(i=1; i<=NF; i++) {
                    if(i==1) {
                        printf "%s", $i
                    } else {
                        printf "%s", toupper(substr($i,1,1)) substr($i,2)
                    }
                }
            }' | sed 's/$/.ts/'
            ;;
    esac
}

# Function to fix imports in a file
fix_imports() {
    local file="$1"
    local temp_file="/tmp/fix_imports_$$.ts"
    
    # Start with the original file
    cp "$file" "$temp_file"
    
    # Fix all imports by converting kebab-case references to camelCase
    # This will handle any import pattern
    for kebab_file in $TEMP_DIR/model/*.ts; do
        if [ -f "$kebab_file" ]; then
            kebab_name=$(basename "$kebab_file" .ts)
            camel_name=$(kebab_to_camel "$(basename "$kebab_file")" | sed 's/.ts$//')
            
            # Fix various import patterns
            sed -i.bak "s|from '\./model/${kebab_name}'|from './model/${camel_name}'|g" "$temp_file"
            sed -i.bak "s|from '\.\./model/${kebab_name}'|from '../model/${camel_name}'|g" "$temp_file"
            sed -i.bak "s|from '\./${kebab_name}'|from './${camel_name}'|g" "$temp_file"
        fi
    done
    
    # Remove backup files created by sed
    rm -f "$temp_file.bak"
    
    echo "$temp_file"
}

# Process model files
echo "  Updating model files..."
updated_count=0
new_count=0

if [ -d "$TEMP_DIR/model" ]; then
    for file in $TEMP_DIR/model/*.ts; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            camel_name=$(kebab_to_camel "$filename")
            
            # Fix imports in the file
            fixed_file=$(fix_imports "$file")
            
            # Copy with camelCase name
            cp "$fixed_file" "src/model/$camel_name"
            rm "$fixed_file"
            
            if [ -f "src/model/$camel_name" ]; then
                echo "    ✓ Updated src/model/$camel_name"
                ((updated_count++))
            else
                echo "    + Created src/model/$camel_name (new)"
                ((new_count++))
            fi
        fi
    done
fi

echo "    Total model files updated: $updated_count"
if [ $new_count -gt 0 ]; then
    echo "    New model files created: $new_count"
fi

# Update API files
echo "  Updating API files..."
api_count=0

if [ -f "$TEMP_DIR/api/default-api.ts" ]; then
    # Fix imports in the API file
    fixed_api=$(fix_imports "$TEMP_DIR/api/default-api.ts")
    cp "$fixed_api" "src/api/defaultApi.ts"
    rm "$fixed_api"
    echo "    ✓ Updated src/api/defaultApi.ts"
    ((api_count++))
fi

# Copy other API files if they exist
for file in apis.ts api.ts; do
    if [ -f "$TEMP_DIR/api/$file" ]; then
        fixed_file=$(fix_imports "$TEMP_DIR/api/$file")
        cp "$fixed_file" "src/api/$file"
        rm "$fixed_file"
        echo "    ✓ Updated src/api/$file"
        ((api_count++))
    fi
done

echo "    Total API files updated: $api_count"

# Update support files
echo "  Updating support files..."
support_count=0
for file in base.ts common.ts configuration.ts api.ts; do
    if [ -f "$TEMP_DIR/$file" ]; then
        fixed_file=$(fix_imports "$TEMP_DIR/$file")
        cp "$fixed_file" "src/$file"
        rm "$fixed_file"
        echo "    ✓ Updated src/$file"
        ((support_count++))
    fi
done
echo "    Total support files updated: $support_count"

# Update model/index.ts if it exists
if [ -f "$TEMP_DIR/model/index.ts" ]; then
    echo "  Updating model/index.ts..."
    fixed_index=$(fix_imports "$TEMP_DIR/model/index.ts")
    cp "$fixed_index" "src/model/index.ts"
    rm "$fixed_index"
    echo "    ✓ Fixed imports in model/index.ts"
fi

# Update main index.ts if generated
if [ -f "$TEMP_DIR/index.ts" ]; then
    fixed_main=$(fix_imports "$TEMP_DIR/index.ts")
    cp "$fixed_main" "src/index.ts"
    rm "$fixed_main"
    echo "    ✓ Updated src/index.ts"
fi

# Step 3: Clean up any kebab-case files that might have been created
echo "Step 3: Cleaning up any kebab-case files..."
cleaned=0

# Clean up any kebab-case files in model directory
if [ -d "src/model" ]; then
    for file in src/model/*-*.ts; do
        if [ -f "$file" ]; then
            rm "$file"
            echo "    ✓ Removed $file"
            ((cleaned++))
        fi
    done
fi

# Clean up kebab-case API file
if [ -f "src/api/default-api.ts" ]; then
    rm "src/api/default-api.ts"
    echo "    ✓ Removed src/api/default-api.ts"
    ((cleaned++))
fi

if [ $cleaned -eq 0 ]; then
    echo "    ✓ No kebab-case files to clean"
fi

# Clean up temp directory
rm -rf $TEMP_DIR

echo ""
echo "=========================================="
echo "✅ OpenAPI update complete!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - Model files updated: $updated_count"
if [ $new_count -gt 0 ]; then
    echo "  - New model files created: $new_count"
fi
echo "  - API files updated: $api_count"
echo "  - Support files updated: $support_count"
echo "  - Kebab-case files cleaned: $cleaned"
echo ""
echo "Important Notes:"
echo "  - All files from openapi.json have been processed"
echo "  - File names converted from kebab-case to camelCase"
echo "  - All import paths have been fixed"
echo "  - Custom files (client.ts, encryptedIndex.ts) are preserved"
echo ""
echo "Next steps:"
echo "  1. Review the changes with: git diff"
echo "  2. Check for type compatibility issues"
echo "  3. Run tests: npm test"
echo "  4. Build project: npm run build"
echo ""