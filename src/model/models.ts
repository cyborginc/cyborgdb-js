// Export all model files
export * from './batchQueryRequest';
export * from './contents';
export * from './createIndexRequest';
export * from './cyborgdbServiceApiSchemasIndexSuccessResponseModel';
export * from './cyborgdbServiceApiSchemasVectorsSuccessResponseModel';
export * from './deleteRequest';
export * from './errorResponseModel';
export * from './getRequest';
export * from './getResponseModel';
export * from './getResultItemModel';
export * from './hTTPValidationError';
export * from './indexConfig';
export * from './indexInfoResponseModel';
export * from './indexIVFFlatModel';
export * from './indexIVFModel';
export * from './indexIVFPQModel';
export * from './indexListResponseModel';
export * from './indexOperationRequest';
export * from './listIDsRequest';
export * from './listIDsResponse';
export * from './queryRequest';
export * from './queryResponse';
export * from './queryResultItem';
export * from './request';
export * from './results';
export * from './trainRequest';
export * from './upsertRequest';
export * from './validationError';
export * from './validationErrorLocInner';
export * from './vectorItem';

// Import model classes for ObjectSerializer
import { BatchQueryRequest } from './batchQueryRequest';
import { Contents } from './contents';
import { CreateIndexRequest } from './createIndexRequest';
import { CyborgdbServiceApiSchemasIndexSuccessResponseModel } from './cyborgdbServiceApiSchemasIndexSuccessResponseModel';
import { CyborgdbServiceApiSchemasVectorsSuccessResponseModel } from './cyborgdbServiceApiSchemasVectorsSuccessResponseModel';
import { DeleteRequest } from './deleteRequest';
import { ErrorResponseModel } from './errorResponseModel';
import { GetRequest } from './getRequest';
import { GetResponseModel } from './getResponseModel';
import { GetResultItemModel } from './getResultItemModel';
import { HTTPValidationError } from './hTTPValidationError';
import { IndexConfig } from './indexConfig';
import { IndexInfoResponseModel } from './indexInfoResponseModel';
import { IndexIVFFlatModel } from './indexIVFFlatModel';
import { IndexIVFModel } from './indexIVFModel';
import { IndexIVFPQModel } from './indexIVFPQModel';
import { IndexListResponseModel } from './indexListResponseModel';
import { IndexOperationRequest } from './indexOperationRequest';
import { ListIDsRequest } from './listIDsRequest';
import { ListIDsResponse } from './listIDsResponse';
import { QueryRequest } from './queryRequest';
import { QueryResponse } from './queryResponse';
import { QueryResultItem } from './queryResultItem';
import { Request } from './request';
// Results is now a type alias, not a class
import { TrainRequest } from './trainRequest';
import { UpsertRequest } from './upsertRequest';
import { ValidationError } from './validationError';
import { ValidationErrorLocInner } from './validationErrorLocInner';
import { VectorItem } from './vectorItem';

// Model mapping for ObjectSerializer
const models: { [key: string]: any } = {
    BatchQueryRequest,
    Contents,
    CreateIndexRequest,
    CyborgdbServiceApiSchemasIndexSuccessResponseModel,
    CyborgdbServiceApiSchemasVectorsSuccessResponseModel,
    DeleteRequest,
    ErrorResponseModel,
    GetRequest,
    GetResponseModel,
    GetResultItemModel,
    HTTPValidationError,
    IndexConfig,
    IndexInfoResponseModel,
    IndexIVFFlatModel,
    IndexIVFModel,
    IndexIVFPQModel,
    IndexListResponseModel,
    IndexOperationRequest,
    ListIDsRequest,
    ListIDsResponse,
    QueryRequest,
    QueryResponse,
    QueryResultItem,
    Request,
    TrainRequest,
    UpsertRequest,
    ValidationError,
    ValidationErrorLocInner,
    VectorItem
};

// Authentication classes
export interface Authentication {
    applyToRequest(requestOptions: any): void;
}

export class VoidAuth implements Authentication {
    applyToRequest(_requestOptions: any): void {
        // Do nothing
    }
}

export class ApiKeyAuth implements Authentication {
    public apiKey?: string;
    constructor(public location: string, public paramName: string) {}
    applyToRequest(requestOptions: any): void {
        if (this.apiKey && this.location === 'header') {
            requestOptions.headers = requestOptions.headers || {};
            requestOptions.headers[this.paramName] = this.apiKey;
        }
    }
}

export class HttpBasicAuth implements Authentication {
    applyToRequest(_requestOptions: any): void {}
}

export class HttpBearerAuth implements Authentication {
    applyToRequest(_requestOptions: any): void {}
}

export class OAuth implements Authentication {
    applyToRequest(_requestOptions: any): void {}
}

export class ObjectSerializer {
    static serialize(obj: any, type: string): any {
        if (!obj) return obj;
        
        const modelClass = models[type];
        if (!modelClass || !modelClass.getAttributeTypeMap) {
            return obj;
        }
        
        const attributeTypeMap = modelClass.getAttributeTypeMap();
        const serialized: any = {};
        
        for (const mapping of attributeTypeMap) {
            if (obj.hasOwnProperty(mapping.name)) {
                const value = obj[mapping.name];
                // Recursively serialize nested objects
                if (mapping.type === 'IndexConfig' && value) {
                    serialized[mapping.baseName] = ObjectSerializer.serialize(value, 'IndexConfig');
                } else {
                    serialized[mapping.baseName] = value;
                }
            }
        }
        
        console.log(`ObjectSerializer.serialize(${type}):`, JSON.stringify(serialized, null, 2));
        return serialized;
    }
    
    static deserialize(obj: any, type: string): any {
        if (!obj) return obj;
        
        const modelClass = models[type];
        if (!modelClass || !modelClass.getAttributeTypeMap) {
            return obj;
        }
        
        const attributeTypeMap = modelClass.getAttributeTypeMap();
        const deserialized: any = {};
        
        for (const mapping of attributeTypeMap) {
            if (obj.hasOwnProperty(mapping.baseName)) {
                deserialized[mapping.name] = obj[mapping.baseName];
            }
        }
        
        return deserialized;
    }
}

export interface Interceptor {
    (requestOptions: any): void;
}

export type RequestFile = {
    data: Buffer;
    name: string;
};
