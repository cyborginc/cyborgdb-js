#!/bin/bash

# Script to update OpenAPI generated code while preserving camelCase naming and handling mixed formats

echo "=========================================="
echo "OpenAPI Code Update Script for CyborgDB"
echo "=========================================="

# Create a temp directory for generation
TEMP_DIR="/tmp/openapi-gen-$(date +%s)"
mkdir -p $TEMP_DIR

echo "Step 1: Generating OpenAPI code to temp directory..."

# Generate with standard options (will create interface-based models with newer generator)
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

# Complete mapping of all kebab-case to camelCase filenames
declare -A FILE_MAP=(
    # Request/Response models
    ["batch-query-request.ts"]="batchQueryRequest.ts"
    ["create-index-request.ts"]="createIndexRequest.ts"
    ["delete-request.ts"]="deleteRequest.ts"
    ["get-request.ts"]="getRequest.ts"
    ["get-response-model.ts"]="getResponseModel.ts"
    ["get-result-item-model.ts"]="getResultItemModel.ts"
    ["query-request.ts"]="queryRequest.ts"
    ["query-response.ts"]="queryResponse.ts"
    ["query-result-item.ts"]="queryResultItem.ts"
    ["train-request.ts"]="trainRequest.ts"
    ["upsert-request.ts"]="upsertRequest.ts"
    ["list-ids-request.ts"]="listIDsRequest.ts"
    ["list-ids-response.ts"]="listIDsResponse.ts"
    
    # Index models
    ["index-config.ts"]="indexConfig.ts"
    ["index-info-response-model.ts"]="indexInfoResponseModel.ts"
    ["index-list-response-model.ts"]="indexListResponseModel.ts"
    ["index-operation-request.ts"]="indexOperationRequest.ts"
    ["index-ivfflat-model.ts"]="indexIVFFlatModel.ts"
    ["index-ivfmodel.ts"]="indexIVFModel.ts"
    ["index-ivfpqmodel.ts"]="indexIVFPQModel.ts"
    
    # Error models
    ["error-response-model.ts"]="errorResponseModel.ts"
    ["httpvalidation-error.ts"]="hTTPValidationError.ts"
    ["validation-error.ts"]="validationError.ts"
    ["validation-error-loc-inner.ts"]="validationErrorLocInner.ts"
    
    # Other models
    ["vector-item.ts"]="vectorItem.ts"
    ["request.ts"]="request.ts"
    ["cyborgdb-service-api-schemas-index-success-response-model.ts"]="cyborgdbServiceApiSchemasIndexSuccessResponseModel.ts"
    ["cyborgdb-service-api-schemas-vectors-success-response-model.ts"]="cyborgdbServiceApiSchemasVectorsSuccessResponseModel.ts"
)

# Process model files
echo "  Updating model files..."
updated_count=0
missing_count=0

# First, ensure all files from the map are copied
for kebab_file in "${!FILE_MAP[@]}"; do
    camel_file="${FILE_MAP[$kebab_file]}"
    if [ -f "$TEMP_DIR/model/$kebab_file" ]; then
        # Fix imports in the file before copying
        temp_file="/tmp/temp_model.ts"
        sed \
            -e "s|from '\./batch-query-request'|from './batchQueryRequest'|g" \
            -e "s|from '\./create-index-request'|from './createIndexRequest'|g" \
            -e "s|from '\./delete-request'|from './deleteRequest'|g" \
            -e "s|from '\./error-response-model'|from './errorResponseModel'|g" \
            -e "s|from '\./get-request'|from './getRequest'|g" \
            -e "s|from '\./get-response-model'|from './getResponseModel'|g" \
            -e "s|from '\./get-result-item-model'|from './getResultItemModel'|g" \
            -e "s|from '\./httpvalidation-error'|from './hTTPValidationError'|g" \
            -e "s|from '\./index-config'|from './indexConfig'|g" \
            -e "s|from '\./index-info-response-model'|from './indexInfoResponseModel'|g" \
            -e "s|from '\./index-ivfflat-model'|from './indexIVFFlatModel'|g" \
            -e "s|from '\./index-ivfmodel'|from './indexIVFModel'|g" \
            -e "s|from '\./index-ivfpqmodel'|from './indexIVFPQModel'|g" \
            -e "s|from '\./index-list-response-model'|from './indexListResponseModel'|g" \
            -e "s|from '\./index-operation-request'|from './indexOperationRequest'|g" \
            -e "s|from '\./list-ids-request'|from './listIDsRequest'|g" \
            -e "s|from '\./list-ids-response'|from './listIDsResponse'|g" \
            -e "s|from '\./query-request'|from './queryRequest'|g" \
            -e "s|from '\./query-response'|from './queryResponse'|g" \
            -e "s|from '\./query-result-item'|from './queryResultItem'|g" \
            -e "s|from '\./train-request'|from './trainRequest'|g" \
            -e "s|from '\./upsert-request'|from './upsertRequest'|g" \
            -e "s|from '\./validation-error'|from './validationError'|g" \
            -e "s|from '\./validation-error-loc-inner'|from './validationErrorLocInner'|g" \
            -e "s|from '\./vector-item'|from './vectorItem'|g" \
            -e "s|from '\./cyborgdb-service-api-schemas-index-success-response-model'|from './cyborgdbServiceApiSchemasIndexSuccessResponseModel'|g" \
            -e "s|from '\./cyborgdb-service-api-schemas-vectors-success-response-model'|from './cyborgdbServiceApiSchemasVectorsSuccessResponseModel'|g" \
            "$TEMP_DIR/model/$kebab_file" > "$temp_file"
        
        cp "$temp_file" "src/model/$camel_file"
        rm "$temp_file"
        echo "    ✓ Updated src/model/$camel_file"
        ((updated_count++))
    else
        if [ ! -f "src/model/$camel_file" ]; then
            echo "    ⚠ Missing: $camel_file (kebab file $kebab_file not generated)"
            ((missing_count++))
        fi
    fi
done

# Handle any new model files not in the map
if [ -d "$TEMP_DIR/model" ]; then
    for file in $TEMP_DIR/model/*.ts; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            # Skip if already processed
            if [[ -z "${FILE_MAP[$filename]}" ]]; then
                # Check for special files that should be copied as-is
                case "$filename" in
                    "models.ts"|"index.ts"|"contents.ts"|"results.ts")
                        cp "$file" "src/model/$filename"
                        echo "    ✓ Updated src/model/$filename"
                        ((updated_count++))
                        ;;
                    *)
                        # For new files not in map, try to convert name and copy
                        camel_name=$(echo "$filename" | sed -E 's/-([a-z])/\U\1/g')
                        echo "    ⚠ New file detected: $filename -> $camel_name"
                        cp "$file" "src/model/$camel_name"
                        ((updated_count++))
                        ;;
                esac
            fi
        fi
    done
fi

echo "    Total model files updated: $updated_count"
if [ $missing_count -gt 0 ]; then
    echo "    ⚠ Warning: $missing_count expected files were not generated"
fi

# Update API files
echo "  Updating API files..."
api_count=0
if [ -f "$TEMP_DIR/api/default-api.ts" ]; then
    # Fix imports in the API file
    temp_api="/tmp/temp_api.ts"
    sed \
        -e "s|from '\.\./model/batch-query-request'|from '../model/batchQueryRequest'|g" \
        -e "s|from '\.\./model/create-index-request'|from '../model/createIndexRequest'|g" \
        -e "s|from '\.\./model/delete-request'|from '../model/deleteRequest'|g" \
        -e "s|from '\.\./model/error-response-model'|from '../model/errorResponseModel'|g" \
        -e "s|from '\.\./model/get-request'|from '../model/getRequest'|g" \
        -e "s|from '\.\./model/get-response-model'|from '../model/getResponseModel'|g" \
        -e "s|from '\.\./model/get-result-item-model'|from '../model/getResultItemModel'|g" \
        -e "s|from '\.\./model/httpvalidation-error'|from '../model/hTTPValidationError'|g" \
        -e "s|from '\.\./model/list-ids-request'|from '../model/listIDsRequest'|g" \
        -e "s|from '\.\./model/list-ids-response'|from '../model/listIDsResponse'|g" \
        -e "s|from '\.\./model/query-request'|from '../model/queryRequest'|g" \
        -e "s|from '\.\./model/query-response'|from '../model/queryResponse'|g" \
        -e "s|from '\.\./model/query-result-item'|from '../model/queryResultItem'|g" \
        -e "s|from '\.\./model/train-request'|from '../model/trainRequest'|g" \
        -e "s|from '\.\./model/upsert-request'|from '../model/upsertRequest'|g" \
        -e "s|from '\.\./model/cyborgdb-service-api-schemas-index-success-response-model'|from '../model/cyborgdbServiceApiSchemasIndexSuccessResponseModel'|g" \
        -e "s|from '\.\./model/cyborgdb-service-api-schemas-vectors-success-response-model'|from '../model/cyborgdbServiceApiSchemasVectorsSuccessResponseModel'|g" \
        -e "s|from '\.\./model/index-info-response-model'|from '../model/indexInfoResponseModel'|g" \
        -e "s|from '\.\./model/index-list-response-model'|from '../model/indexListResponseModel'|g" \
        -e "s|from '\.\./model/index-operation-request'|from '../model/indexOperationRequest'|g" \
        -e "s|from '\.\./model/request'|from '../model/request'|g" \
        -e "s|from '\.\./model/validation-error'|from '../model/validationError'|g" \
        -e "s|from '\.\./model/validation-error-loc-inner'|from '../model/validationErrorLocInner'|g" \
        -e "s|from '\.\./model/vector-item'|from '../model/vectorItem'|g" \
        "$TEMP_DIR/api/default-api.ts" > "$temp_api"
    
    cp "$temp_api" "src/api/defaultApi.ts"
    rm "$temp_api"
    echo "    ✓ Updated src/api/defaultApi.ts"
    ((api_count++))
fi

# Keep apis.ts if it exists in generated output
if [ -f "$TEMP_DIR/api/apis.ts" ]; then
    cp "$TEMP_DIR/api/apis.ts" "src/api/apis.ts"
    echo "    ✓ Updated src/api/apis.ts"
    ((api_count++))
fi

echo "    Total API files updated: $api_count"

# Update support files (base, common, configuration, api)
echo "  Updating support files..."
support_count=0
for file in base.ts common.ts configuration.ts api.ts; do
    if [ -f "$TEMP_DIR/$file" ]; then
        cp "$TEMP_DIR/$file" "src/$file"
        echo "    ✓ Updated src/$file"
        ((support_count++))
    fi
done
echo "    Total support files updated: $support_count"

# Update or create model/index.ts
if [ -f "$TEMP_DIR/model/index.ts" ]; then
    echo "  Updating model/index.ts..."
    # Create a temporary file for the fixed imports
    temp_index="/tmp/index_fixed.ts"
    
    # Use sed to fix all import paths
    sed \
        -e "s|from '\./batch-query-request'|from './batchQueryRequest'|g" \
        -e "s|from '\./create-index-request'|from './createIndexRequest'|g" \
        -e "s|from '\./delete-request'|from './deleteRequest'|g" \
        -e "s|from '\./error-response-model'|from './errorResponseModel'|g" \
        -e "s|from '\./get-request'|from './getRequest'|g" \
        -e "s|from '\./get-response-model'|from './getResponseModel'|g" \
        -e "s|from '\./get-result-item-model'|from './getResultItemModel'|g" \
        -e "s|from '\./httpvalidation-error'|from './hTTPValidationError'|g" \
        -e "s|from '\./index-config'|from './indexConfig'|g" \
        -e "s|from '\./index-info-response-model'|from './indexInfoResponseModel'|g" \
        -e "s|from '\./index-ivfflat-model'|from './indexIVFFlatModel'|g" \
        -e "s|from '\./index-ivfmodel'|from './indexIVFModel'|g" \
        -e "s|from '\./index-ivfpqmodel'|from './indexIVFPQModel'|g" \
        -e "s|from '\./index-list-response-model'|from './indexListResponseModel'|g" \
        -e "s|from '\./index-operation-request'|from './indexOperationRequest'|g" \
        -e "s|from '\./list-ids-request'|from './listIDsRequest'|g" \
        -e "s|from '\./list-ids-response'|from './listIDsResponse'|g" \
        -e "s|from '\./query-request'|from './queryRequest'|g" \
        -e "s|from '\./query-response'|from './queryResponse'|g" \
        -e "s|from '\./query-result-item'|from './queryResultItem'|g" \
        -e "s|from '\./train-request'|from './trainRequest'|g" \
        -e "s|from '\./upsert-request'|from './upsertRequest'|g" \
        -e "s|from '\./validation-error'|from './validationError'|g" \
        -e "s|from '\./validation-error-loc-inner'|from './validationErrorLocInner'|g" \
        -e "s|from '\./vector-item'|from './vectorItem'|g" \
        -e "s|from '\./cyborgdb-service-api-schemas-index-success-response-model'|from './cyborgdbServiceApiSchemasIndexSuccessResponseModel'|g" \
        -e "s|from '\./cyborgdb-service-api-schemas-vectors-success-response-model'|from './cyborgdbServiceApiSchemasVectorsSuccessResponseModel'|g" \
        -e "s|from '\./contents'|from './contents'|g" \
        -e "s|from '\./results'|from './results'|g" \
        "$TEMP_DIR/model/index.ts" > "$temp_index"
    
    cp "$temp_index" "src/model/index.ts"
    rm "$temp_index"
    echo "    ✓ Fixed imports in model/index.ts"
fi

# Update main index.ts if generated
if [ -f "$TEMP_DIR/index.ts" ]; then
    cp "$TEMP_DIR/index.ts" "src/index.ts"
    echo "    ✓ Updated src/index.ts"
fi

# Step 3: Clean up kebab-case files that might have been accidentally created
echo "Step 3: Cleaning up any kebab-case files..."
cleaned=0
for kebab_file in "${!FILE_MAP[@]}"; do
    if [ -f "src/model/$kebab_file" ]; then
        rm "src/model/$kebab_file"
        echo "    ✓ Removed src/model/$kebab_file"
        ((cleaned++))
    fi
done

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
if [ $missing_count -gt 0 ]; then
    echo "  - Missing files: $missing_count (may need manual creation)"
fi
echo "  - API files updated: $api_count"
echo "  - Support files updated: $support_count"
echo "  - Kebab-case files cleaned: $cleaned"
echo ""
echo "Important Notes:"
echo "  - The newer OpenAPI generator creates interface-based models"
echo "  - Your existing code may use class-based models"
echo "  - Support files (base.ts, common.ts, configuration.ts, api.ts) have been updated"
echo "  - Custom files (client.ts, encryptedIndex.ts) are preserved"
echo ""
echo "Next steps:"
echo "  1. Review the changes with: git diff"
echo "  2. Check for type compatibility issues"
echo "  3. Run tests: npm test"
echo "  4. Build project: npm run build"
echo ""