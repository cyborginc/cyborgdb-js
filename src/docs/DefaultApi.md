# DefaultApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**createIndexV1IndexesCreatePost**](DefaultApi.md#createindexv1indexescreatepost) | **POST** /v1/indexes/create | Create Encrypted Index |
| [**createUserV1IndexesIndexNameUsersPost**](DefaultApi.md#createuserv1indexesindexnameuserspost) | **POST** /v1/indexes/{index_name}/users | Create a user for an index |
| [**deleteIndexV1IndexesDeletePost**](DefaultApi.md#deleteindexv1indexesdeletepost) | **POST** /v1/indexes/delete | Delete Encrypted Index |
| [**deleteUserV1IndexesIndexNameUsersUserIdDelete**](DefaultApi.md#deleteuserv1indexesindexnameusersuseriddelete) | **DELETE** /v1/indexes/{index_name}/users/{user_id} | Delete (revoke) a user |
| [**deleteVectorsV1VectorsDeletePost**](DefaultApi.md#deletevectorsv1vectorsdeletepost) | **POST** /v1/vectors/delete | Delete Items from Encrypted Index |
| [**getIndexInfoV1IndexesDescribePost**](DefaultApi.md#getindexinfov1indexesdescribepost) | **POST** /v1/indexes/describe | Describe Encrypted Index |
| [**getIndexSizeV1VectorsNumVectorsPost**](DefaultApi.md#getindexsizev1vectorsnumvectorspost) | **POST** /v1/vectors/num_vectors | Get the number of vectors in an index |
| [**getTrainingStatusV1IndexesTrainingStatusGet**](DefaultApi.md#gettrainingstatusv1indexestrainingstatusget) | **GET** /v1/indexes/training-status | Get Training Status |
| [**getVectorsV1VectorsGetPost**](DefaultApi.md#getvectorsv1vectorsgetpost) | **POST** /v1/vectors/get | Get Items from Encrypted Index |
| [**healthCheckV1HealthGet**](DefaultApi.md#healthcheckv1healthget) | **GET** /v1/health | Health check endpoint |
| [**listIdsV1VectorsListIdsPost**](DefaultApi.md#listidsv1vectorslistidspost) | **POST** /v1/vectors/list_ids | List all IDs in an index |
| [**listIndexesV1IndexesListGet**](DefaultApi.md#listindexesv1indexeslistget) | **GET** /v1/indexes/list | List Encrypted Indexes |
| [**listUsersV1IndexesIndexNameUsersGet**](DefaultApi.md#listusersv1indexesindexnameusersget) | **GET** /v1/indexes/{index_name}/users | List an index\&#39;s users |
| [**queryMetadataV1VectorsQueryMetadataPost**](DefaultApi.md#querymetadatav1vectorsquerymetadatapost) | **POST** /v1/vectors/query_metadata | Query an Encrypted Index by Metadata Only |
| [**queryVectorsBinaryV1VectorsQueryBinaryPost**](DefaultApi.md#queryvectorsbinaryv1vectorsquerybinarypost) | **POST** /v1/vectors/query_binary | Query Encrypted Index (Binary Format) |
| [**queryVectorsV1VectorsQueryPost**](DefaultApi.md#queryvectorsv1vectorsquerypost) | **POST** /v1/vectors/query | Query Encrypted Index |
| [**trainIndexV1IndexesTrainPost**](DefaultApi.md#trainindexv1indexestrainpost) | **POST** /v1/indexes/train | Train Encrypted index |
| [**upsertVectorsBinaryV1VectorsUpsertBinaryPost**](DefaultApi.md#upsertvectorsbinaryv1vectorsupsertbinarypost) | **POST** /v1/vectors/upsert_binary | Add Items to Encrypted Index (Binary Format) |
| [**upsertVectorsV1VectorsUpsertPost**](DefaultApi.md#upsertvectorsv1vectorsupsertpost) | **POST** /v1/vectors/upsert | Add Items to Encrypted Index |



## createIndexV1IndexesCreatePost

> CyborgdbServiceApiSchemasIndexSuccessResponseModel createIndexV1IndexesCreatePost(createIndexRequest)

Create Encrypted Index

Create a new encrypted index with the provided configuration.  Exactly one of &#x60;kms_name&#x60; / &#x60;index_key&#x60; must be set; supplying both is rejected with 400.    * &#x60;kms_name&#x60; set — service generates a random KEK, wraps it via     the named registry slot\&#39;s KMS, persists the envelope, and uses     the plaintext KEK as &#x60;index_key&#x60; on the core call.  CEI     generates the DEK and wraps it under that KEK internally.   * &#x60;index_key&#x60; set — SDK-supplied KEK; envelope persisted with     &#x60;provider&#x3D;\&quot;none\&quot;&#x60;.  The SDK must re-supply &#x60;index_key&#x60; on     every subsequent request for this index.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { CreateIndexV1IndexesCreatePostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // CreateIndexRequest
    createIndexRequest: ...,
  } satisfies CreateIndexV1IndexesCreatePostRequest;

  try {
    const data = await api.createIndexV1IndexesCreatePost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **createIndexRequest** | [CreateIndexRequest](CreateIndexRequest.md) |  | |

### Return type

[**CyborgdbServiceApiSchemasIndexSuccessResponseModel**](CyborgdbServiceApiSchemasIndexSuccessResponseModel.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **409** | Conflict for index name |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## createUserV1IndexesIndexNameUsersPost

> CreateUserResponse createUserV1IndexesIndexNameUsersPost(indexName, createUserRequest)

Create a user for an index

Mint a user API key with the given permissions, scoped to this index.  The api_key is returned once and never stored — only the user holds it.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { CreateUserV1IndexesIndexNameUsersPostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // string
    indexName: indexName_example,
    // CreateUserRequest
    createUserRequest: ...,
  } satisfies CreateUserV1IndexesIndexNameUsersPostRequest;

  try {
    const data = await api.createUserV1IndexesIndexNameUsersPost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **indexName** | `string` |  | [Defaults to `undefined`] |
| **createUserRequest** | [CreateUserRequest](CreateUserRequest.md) |  | |

### Return type

[**CreateUserResponse**](CreateUserResponse.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **400** | Invalid request |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## deleteIndexV1IndexesDeletePost

> CyborgdbServiceApiSchemasIndexSuccessResponseModel deleteIndexV1IndexesDeletePost(indexOperationRequest)

Delete Encrypted Index

Delete a specific index.  Admin-only: deleting an index drops the KMS envelope and every user\&#39;s wrapped DEK, so it sits alongside create/train as a root operation rather than a per-user write op.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { DeleteIndexV1IndexesDeletePostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // IndexOperationRequest
    indexOperationRequest: ...,
  } satisfies DeleteIndexV1IndexesDeletePostRequest;

  try {
    const data = await api.deleteIndexV1IndexesDeletePost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **indexOperationRequest** | [IndexOperationRequest](IndexOperationRequest.md) |  | |

### Return type

[**CyborgdbServiceApiSchemasIndexSuccessResponseModel**](CyborgdbServiceApiSchemasIndexSuccessResponseModel.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **404** | Not able to find index |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## deleteUserV1IndexesIndexNameUsersUserIdDelete

> deleteUserV1IndexesIndexNameUsersUserIdDelete(indexName, userId, xIndexKey)

Delete (revoke) a user

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { DeleteUserV1IndexesIndexNameUsersUserIdDeleteRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // string
    indexName: indexName_example,
    // string
    userId: userId_example,
    // string | Index KEK (hex) for SDK-supplied indexes; omit for KMS-backed. (optional)
    xIndexKey: xIndexKey_example,
  } satisfies DeleteUserV1IndexesIndexNameUsersUserIdDeleteRequest;

  try {
    const data = await api.deleteUserV1IndexesIndexNameUsersUserIdDelete(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **indexName** | `string` |  | [Defaults to `undefined`] |
| **userId** | `string` |  | [Defaults to `undefined`] |
| **xIndexKey** | `string` | Index KEK (hex) for SDK-supplied indexes; omit for KMS-backed. | [Optional] [Defaults to `undefined`] |

### Return type

`void` (Empty response body)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **204** | User revoked |  -  |
| **400** | Invalid request |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## deleteVectorsV1VectorsDeletePost

> CyborgdbServiceApiSchemasVectorsSuccessResponseModel deleteVectorsV1VectorsDeletePost(deleteRequest)

Delete Items from Encrypted Index

Delete vectors by their IDs.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { DeleteVectorsV1VectorsDeletePostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // DeleteRequest
    deleteRequest: ...,
  } satisfies DeleteVectorsV1VectorsDeletePostRequest;

  try {
    const data = await api.deleteVectorsV1VectorsDeletePost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **deleteRequest** | [DeleteRequest](DeleteRequest.md) |  | |

### Return type

[**CyborgdbServiceApiSchemasVectorsSuccessResponseModel**](CyborgdbServiceApiSchemasVectorsSuccessResponseModel.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Unable to find item to delete |  -  |
| **500** | Unexpected server error |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## getIndexInfoV1IndexesDescribePost

> IndexInfoResponseModel getIndexInfoV1IndexesDescribePost(indexOperationRequest)

Describe Encrypted Index

Get information about a specific index.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { GetIndexInfoV1IndexesDescribePostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // IndexOperationRequest
    indexOperationRequest: ...,
  } satisfies GetIndexInfoV1IndexesDescribePostRequest;

  try {
    const data = await api.getIndexInfoV1IndexesDescribePost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **indexOperationRequest** | [IndexOperationRequest](IndexOperationRequest.md) |  | |

### Return type

[**IndexInfoResponseModel**](IndexInfoResponseModel.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **404** | Not able to find index |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## getIndexSizeV1VectorsNumVectorsPost

> CyborgdbServiceApiSchemasVectorsSuccessResponseModel getIndexSizeV1VectorsNumVectorsPost(indexOperationRequest)

Get the number of vectors in an index

Get the number of vectors stored in an index

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { GetIndexSizeV1VectorsNumVectorsPostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // IndexOperationRequest
    indexOperationRequest: ...,
  } satisfies GetIndexSizeV1VectorsNumVectorsPostRequest;

  try {
    const data = await api.getIndexSizeV1VectorsNumVectorsPost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **indexOperationRequest** | [IndexOperationRequest](IndexOperationRequest.md) |  | |

### Return type

[**CyborgdbServiceApiSchemasVectorsSuccessResponseModel**](CyborgdbServiceApiSchemasVectorsSuccessResponseModel.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## getTrainingStatusV1IndexesTrainingStatusGet

> IndexTrainingStatusResponseModel getTrainingStatusV1IndexesTrainingStatusGet()

Get Training Status

Get the current training status including indexes being trained and the auto-train configuration.  Returns:     dict: Training status information including:         - training_indexes: List of index names currently being trained         - retrain_threshold: Vector-count floor before the first training

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { GetTrainingStatusV1IndexesTrainingStatusGetRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new DefaultApi();

  try {
    const data = await api.getTrainingStatusV1IndexesTrainingStatusGet();
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters

This endpoint does not need any parameter.

### Return type

[**IndexTrainingStatusResponseModel**](IndexTrainingStatusResponseModel.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## getVectorsV1VectorsGetPost

> GetResponseModel getVectorsV1VectorsGetPost(getRequest)

Get Items from Encrypted Index

Retrieve vectors by their IDs.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { GetVectorsV1VectorsGetPostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // GetRequest
    getRequest: ...,
  } satisfies GetVectorsV1VectorsGetPostRequest;

  try {
    const data = await api.getVectorsV1VectorsGetPost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **getRequest** | [GetRequest](GetRequest.md) |  | |

### Return type

[**GetResponseModel**](GetResponseModel.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## healthCheckV1HealthGet

> { [key: string]: string; } healthCheckV1HealthGet()

Health check endpoint

Check if the API is running.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { HealthCheckV1HealthGetRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new DefaultApi();

  try {
    const data = await api.healthCheckV1HealthGet();
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters

This endpoint does not need any parameter.

### Return type

**{ [key: string]: string; }**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful Response |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## listIdsV1VectorsListIdsPost

> ListIDsResponse listIdsV1VectorsListIdsPost(listIDsRequest)

List all IDs in an index

List all item IDs currently stored in the index.  Returns a list of all IDs and the total count.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { ListIdsV1VectorsListIdsPostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // ListIDsRequest
    listIDsRequest: ...,
  } satisfies ListIdsV1VectorsListIdsPostRequest;

  try {
    const data = await api.listIdsV1VectorsListIdsPost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **listIDsRequest** | [ListIDsRequest](ListIDsRequest.md) |  | |

### Return type

[**ListIDsResponse**](ListIDsResponse.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful Response |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## listIndexesV1IndexesListGet

> IndexListResponseModel listIndexesV1IndexesListGet()

List Encrypted Indexes

List all available indexes.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { ListIndexesV1IndexesListGetRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  try {
    const data = await api.listIndexesV1IndexesListGet();
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters

This endpoint does not need any parameter.

### Return type

[**IndexListResponseModel**](IndexListResponseModel.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## listUsersV1IndexesIndexNameUsersGet

> ListUsersResponse listUsersV1IndexesIndexNameUsersGet(indexName, xIndexKey)

List an index\&#39;s users

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { ListUsersV1IndexesIndexNameUsersGetRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // string
    indexName: indexName_example,
    // string | Index KEK (hex) for SDK-supplied indexes; omit for KMS-backed. (optional)
    xIndexKey: xIndexKey_example,
  } satisfies ListUsersV1IndexesIndexNameUsersGetRequest;

  try {
    const data = await api.listUsersV1IndexesIndexNameUsersGet(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **indexName** | `string` |  | [Defaults to `undefined`] |
| **xIndexKey** | `string` | Index KEK (hex) for SDK-supplied indexes; omit for KMS-backed. | [Optional] [Defaults to `undefined`] |

### Return type

[**ListUsersResponse**](ListUsersResponse.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **400** | Invalid request |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## queryMetadataV1VectorsQueryMetadataPost

> QueryMetadataResponse queryMetadataV1VectorsQueryMetadataPost(queryMetadataRequest)

Query an Encrypted Index by Metadata Only

Find items by metadata alone — no query vector.  With no &#x60;text&#x60;, resolves the filter entirely from the encrypted metadata index and returns the matching items, unscored. With &#x60;text&#x60;, runs BM25 over the index\&#39;s full_text fields and returns the top matches ranked by score; a filter given alongside acts as a pre-filter. Works on untrained indexes.  Because there is no post-filter stage to fall back on, the index\&#39;s &#x60;metadata_schema&#x60; is enforced here: &#x60;$regex&#x60; / &#x60;$contains&#x60; need a &#x60;pattern&#x60; field, and a &#x60;filterable: false&#x60; field cannot be filtered on. Both come back as 400 with the reason. &#x60;/query&#x60; with a vector has no such restriction.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { QueryMetadataV1VectorsQueryMetadataPostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // QueryMetadataRequest
    queryMetadataRequest: ...,
  } satisfies QueryMetadataV1VectorsQueryMetadataPostRequest;

  try {
    const data = await api.queryMetadataV1VectorsQueryMetadataPost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **queryMetadataRequest** | [QueryMetadataRequest](QueryMetadataRequest.md) |  | |

### Return type

[**QueryMetadataResponse**](QueryMetadataResponse.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **400** | Filter references a field the metadata index cannot resolve — a &#x60;$regex&#x60;/&#x60;$contains&#x60; on a non-&#x60;pattern&#x60; field, a &#x60;filterable: false&#x60; field, or an unsupported operator |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## queryVectorsBinaryV1VectorsQueryBinaryPost

> QueryResponse queryVectorsBinaryV1VectorsQueryBinaryPost(binaryQueryRequest)

Query Encrypted Index (Binary Format)

Search for nearest neighbors using binary format for query vectors.  This endpoint is optimized for large batch queries. Query vectors are sent as base64-encoded float32 numpy arrays, which is more efficient than JSON arrays for large batches.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { QueryVectorsBinaryV1VectorsQueryBinaryPostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // BinaryQueryRequest
    binaryQueryRequest: ...,
  } satisfies QueryVectorsBinaryV1VectorsQueryBinaryPostRequest;

  try {
    const data = await api.queryVectorsBinaryV1VectorsQueryBinaryPost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **binaryQueryRequest** | [BinaryQueryRequest](BinaryQueryRequest.md) |  | |

### Return type

[**QueryResponse**](QueryResponse.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## queryVectorsV1VectorsQueryPost

> QueryResponse queryVectorsV1VectorsQueryPost(request)

Query Encrypted Index

Search for nearest neighbors in the index.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { QueryVectorsV1VectorsQueryPostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // Request
    request: ...,
  } satisfies QueryVectorsV1VectorsQueryPostRequest;

  try {
    const data = await api.queryVectorsV1VectorsQueryPost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **request** | [Request](Request.md) |  | |

### Return type

[**QueryResponse**](QueryResponse.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## trainIndexV1IndexesTrainPost

> CyborgdbServiceApiSchemasIndexSuccessResponseModel trainIndexV1IndexesTrainPost(trainRequest)

Train Encrypted index

Train the index for efficient querying.  Training is queued and processed asynchronously. If the index is already being trained or queued, returns the current status.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { TrainIndexV1IndexesTrainPostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // TrainRequest
    trainRequest: ...,
  } satisfies TrainIndexV1IndexesTrainPostRequest;

  try {
    const data = await api.trainIndexV1IndexesTrainPost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **trainRequest** | [TrainRequest](TrainRequest.md) |  | |

### Return type

[**CyborgdbServiceApiSchemasIndexSuccessResponseModel**](CyborgdbServiceApiSchemasIndexSuccessResponseModel.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## upsertVectorsBinaryV1VectorsUpsertBinaryPost

> CyborgdbServiceApiSchemasVectorsSuccessResponseModel upsertVectorsBinaryV1VectorsUpsertBinaryPost(binaryUpsertRequest)

Add Items to Encrypted Index (Binary Format)

Add or update vectors in the index using binary format.  This endpoint is optimized for large batches of vectors. Vectors are sent as base64-encoded float32 numpy arrays, which is much more efficient than JSON arrays for large datasets.  After upserting, checks if the index needs training/retraining based on the number of vectors and triggers automatic training if needed.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { UpsertVectorsBinaryV1VectorsUpsertBinaryPostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // BinaryUpsertRequest
    binaryUpsertRequest: ...,
  } satisfies UpsertVectorsBinaryV1VectorsUpsertBinaryPostRequest;

  try {
    const data = await api.upsertVectorsBinaryV1VectorsUpsertBinaryPost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **binaryUpsertRequest** | [BinaryUpsertRequest](BinaryUpsertRequest.md) |  | |

### Return type

[**CyborgdbServiceApiSchemasVectorsSuccessResponseModel**](CyborgdbServiceApiSchemasVectorsSuccessResponseModel.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## upsertVectorsV1VectorsUpsertPost

> CyborgdbServiceApiSchemasVectorsSuccessResponseModel upsertVectorsV1VectorsUpsertPost(upsertRequest)

Add Items to Encrypted Index

Add or update vectors in the index.  After upserting, checks if the index needs training/retraining based on the number of vectors and triggers automatic training if needed.

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { UpsertVectorsV1VectorsUpsertPostRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // To configure API key authorization: APIKeyHeader
    apiKey: "YOUR API KEY",
  });
  const api = new DefaultApi(config);

  const body = {
    // UpsertRequest
    upsertRequest: ...,
  } satisfies UpsertVectorsV1VectorsUpsertPostRequest;

  try {
    const data = await api.upsertVectorsV1VectorsUpsertPost(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **upsertRequest** | [UpsertRequest](UpsertRequest.md) |  | |

### Return type

[**CyborgdbServiceApiSchemasVectorsSuccessResponseModel**](CyborgdbServiceApiSchemasVectorsSuccessResponseModel.md)

### Authorization

[APIKeyHeader](../README.md#APIKeyHeader)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successful response |  -  |
| **401** | Permission denied from license issue |  -  |
| **500** | Unexpected server error |  -  |
| **422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

