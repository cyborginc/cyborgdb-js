/**
 * LangChain integration for CyborgDB JavaScript SDK.
 * 
 * This module provides a LangChain VectorStore implementation for CyborgDB,
 * enabling seamless integration with LangChain applications.
 * 
 * Requirements:
 *   npm install @langchain/core
 */

import { CyborgDB } from '../../client';
import { EncryptedIndex } from '../../encryptedIndex';
import { VectorItem, QueryResultItem } from '../../models';
import { VectorStore } from "@langchain/core/vectorstores";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { Document, DocumentInterface } from "@langchain/core/documents";

export interface CyborgVectorStoreConfig {
  indexName: string;
  indexKey: string | Uint8Array;
  apiKey: string;
  baseUrl: string;
  embedding: EmbeddingsInterface;
  indexType?: 'ivfflat' | 'ivf' | 'ivfpq';
  indexConfigParams?: Record<string, any>;
  dimension?: number;
  metric?: 'cosine' | 'euclidean' | 'squared_euclidean';
  verifySsl?: boolean;
}

export class CyborgVectorStore extends VectorStore {
  declare FilterType: Record<string, any>;
  
  private client: CyborgDB;
  private index?: EncryptedIndex;
  private indexName: string;
  private indexKey: Uint8Array;
  private dimension?: number;
  private metric: string;
  
  _vectorstoreType(): string {
    return 'cyborgdb';
  }

  constructor(
    embeddings: EmbeddingsInterface,
    config: CyborgVectorStoreConfig
  ) {
    super(embeddings, config);
    
    this.indexName = config.indexName;
    // Convert string to Uint8Array if necessary
    if (typeof config.indexKey === 'string') {
      // Handle base64 encoded string
      const base64 = config.indexKey;
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      this.indexKey = bytes;
    } else {
      this.indexKey = config.indexKey;
    }
    this.dimension = config.dimension;
    this.metric = config.metric || 'cosine';
    
    // Create client
    this.client = new CyborgDB({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      verifySsl: config.verifySsl
    });
    
    // Initialize index will be done lazily
  }

  /**
   * Generate a secure 32-byte key for use with CyborgDB indexes.
   */
  static generateKey(): Uint8Array {
    // Generate a random 32-byte key
    if (typeof window !== 'undefined' && window.crypto) {
      const key = new Uint8Array(32);
      window.crypto.getRandomValues(key);
      return key;
    } else {
      // Node.js environment
      try {
        const g = (typeof globalThis !== 'undefined' ? globalThis : 
                  typeof window !== 'undefined' ? window : 
                  typeof self !== 'undefined' ? self : {}) as any;
        const crypto = g.crypto || g.require?.('crypto');
        if (crypto && crypto.randomBytes) {
          return new Uint8Array(crypto.randomBytes(32));
        }
      } catch (e) {
        // Fallback
      }
      // Fallback to Math.random (less secure)
      const key = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        key[i] = Math.floor(Math.random() * 256);
      }
      return key;
    }
  }

  /**
   * Generate a unique ID for documents.
   */
  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Initialize or load the CyborgDB index.
   */
  private async initializeIndex(): Promise<void> {
    if (this.index) {
      return;
    }

    try {
      // Check if index already exists
      const existingIndexes = await this.client.listIndexes();
      const indexExists = Array.isArray(existingIndexes) 
        ? existingIndexes.includes(this.indexName)
        : (existingIndexes as any).indices?.includes(this.indexName) || false;

      if (indexExists) {
        // Load existing index using loadIndex method
        this.index = await this.client.loadIndex({
          indexName: this.indexName,
          indexKey: this.indexKey
        });
      } else {
        // Detect dimension if not provided
        if (!this.dimension) {
          const dummy = await this.embeddings.embedQuery('dimension check');
          this.dimension = Array.isArray(dummy) ? dummy.length : 0;
        }

        // Create new index
        this.index = await this.client.createIndex({
          indexName: this.indexName,
          indexKey: this.indexKey,
          metric: this.metric as any
        });
      }
    } catch (error) {
      console.error('Error initializing index:', error);
      throw error;
    }
  }

  /**
   * Add texts to the vector store.
   */
  async addTexts(
    texts: string[],
    metadatas?: object[] | object,
    options?: { ids?: string[] }
  ): Promise<string[]> {
    await this.initializeIndex();
    
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    const ids = options?.ids || texts.map(() => this.generateId());
    
    // Generate embeddings
    const vectors = await this.embeddings.embedDocuments(texts);
    
    // Build items for upsert
    const items: VectorItem[] = texts.map((text, i) => {
      const metadata = Array.isArray(metadatas) ? metadatas[i] : metadatas || {};
      
      return {
        id: ids[i],
        vector: vectors[i],
        metadata: {
          ...metadata,
          _content: text
        }
      };
    });

    // Upsert to index
    await this.index.upsert({ items });
    
    return ids;
  }

  /**
   * Add documents to the vector store.
   */
  async addDocuments(
    documents: DocumentInterface[],
    options?: { ids?: string[] }
  ): Promise<string[]> {
    const texts = documents.map(doc => doc.pageContent);
    const metadatas = documents.map(doc => doc.metadata);
    return this.addTexts(texts, metadatas, options);
  }

  /**
   * Add vectors directly to the vector store.
   */
  async addVectors(
    vectors: number[][],
    documents: DocumentInterface[],
    options?: { ids?: string[] }
  ): Promise<string[]> {
    await this.initializeIndex();
    
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    const ids = options?.ids || documents.map(() => this.generateId());
    
    // Build items for upsert
    const items: VectorItem[] = vectors.map((vector, i) => ({
      id: ids[i],
      vector,
      metadata: {
        ...documents[i].metadata,
        _content: documents[i].pageContent
      }
    }));

    // Upsert to index
    await this.index.upsert({ items });
    
    return ids;
  }

  /**
   * Delete documents from the vector store.
   */
  async delete(params: { ids?: string[] }): Promise<void> {
    await this.initializeIndex();
    
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    if (params.ids && params.ids.length > 0) {
      await this.index.delete({ ids: params.ids });
    }
  }

  /**
   * Retrieve documents by their IDs.
   */
  async get(ids: string[]): Promise<Document[]> {
    await this.initializeIndex();
    
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    const response = await this.index.get({ ids, include: ['metadata'] });
    
    if (!response || !Array.isArray(response) || response.length === 0) {
      return [];
    }

    return response.map((item: any) => {
      const metadata = { ...(item.metadata || {}) };
      const content = metadata._content || '';
      delete metadata._content;
      
      return {
        pageContent: content,
        metadata
      };
    });
  }

  /**
   * List all document IDs in the vector store.
   */
  async listIds(filter?: Record<string, any>): Promise<string[]> {
    await this.initializeIndex();
    
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    // Note: The current CyborgDB API doesn't support filtering in listIds
    // This is here for future compatibility when the API supports it
    if (filter) {
      console.warn('Filter parameter is not yet supported by CyborgDB listIds');
    }
    
    const response = await this.index.listIds();
    return Array.isArray(response) ? response : (response.ids || []);
  }

  /**
   * Search for documents similar to the query.
   */
  async similaritySearch(
    query: string,
    k = 4,
    filter?: this['FilterType'],
    _callbacks?: any
  ): Promise<DocumentInterface[]> {
    await this.initializeIndex();
    
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    // Generate embedding for query
    const embedding = await this.embeddings.embedQuery(query);
    
    // Query the index
    const results = await this.index.query({
      queryVectors: embedding,
      topK: k,
      filters: filter,
      include: ['distance', 'metadata']
    });

    if (!results || !results.results) {
      return [];
    }

    // Handle batch query results - results.results is of type Results
    let queryResults: QueryResultItem[];
    if (Array.isArray(results.results)) {
      queryResults = results.results as QueryResultItem[];
    } else if (results.results && typeof results.results === 'object') {
      // If results.results is an object with a results property
      const innerResults = (results.results as any).results;
      queryResults = Array.isArray(innerResults) ? innerResults : [];
    } else {
      queryResults = [];
    }

    return queryResults.map((item: QueryResultItem) => {
      const metadata = { ...(item.metadata || {}) };
      const content = metadata._content || '';
      delete metadata._content;
      
      return {
        pageContent: content,
        metadata: {
          ...metadata,
          id: item.id
        }
      };
    });
  }

  /**
   * Search for documents with similarity scores.
   */
  async similaritySearchWithScore(
    query: string,
    k = 4,
    filter?: this['FilterType'],
    _callbacks?: any
  ): Promise<[DocumentInterface, number][]> {
    await this.initializeIndex();
    
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    // Generate embedding for query
    const embedding = await this.embeddings.embedQuery(query);
    
    // Query the index
    const results = await this.index.query({
      queryVectors: embedding,
      topK: k,
      filters: filter,
      include: ['distance', 'metadata']
    });

    if (!results || !results.results) {
      return [];
    }

    // Handle batch query results - results.results is of type Results
    let queryResults: QueryResultItem[];
    if (Array.isArray(results.results)) {
      queryResults = results.results as QueryResultItem[];
    } else if (results.results && typeof results.results === 'object') {
      // If results.results is an object with a results property
      const innerResults = (results.results as any).results;
      queryResults = Array.isArray(innerResults) ? innerResults : [];
    } else {
      queryResults = [];
    }

    return queryResults.map((item: QueryResultItem) => {
      const metadata = { ...(item.metadata || {}) };
      const content = metadata._content || '';
      delete metadata._content;
      
      const doc: Document = {
        pageContent: content,
        metadata: {
          ...metadata,
          id: item.id
        }
      };
      
      // Convert distance to similarity score
      const similarity = this.normalizeScore(item.distance || 0);
      
      return [doc, similarity];
    });
  }

  /**
   * Search for documents similar to an embedding vector.
   */
  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: this['FilterType']
  ): Promise<[DocumentInterface, number][]> {
    await this.initializeIndex();
    
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    // Query the index
    const results = await this.index.query({
      queryVectors: query,
      topK: k,
      filters: filter,
      include: ['distance', 'metadata']
    });

    if (!results || !results.results) {
      return [];
    }

    // Handle batch query results - results.results is of type Results
    let queryResults: QueryResultItem[];
    if (Array.isArray(results.results)) {
      queryResults = results.results as QueryResultItem[];
    } else if (results.results && typeof results.results === 'object') {
      // If results.results is an object with a results property
      const innerResults = (results.results as any).results;
      queryResults = Array.isArray(innerResults) ? innerResults : [];
    } else {
      queryResults = [];
    }

    return queryResults.map((item: QueryResultItem) => {
      const metadata = { ...(item.metadata || {}) };
      const content = metadata._content || '';
      delete metadata._content;
      
      const doc: Document = {
        pageContent: content,
        metadata: {
          ...metadata,
          id: item.id
        }
      };
      
      // Convert distance to similarity score
      const similarity = this.normalizeScore(item.distance || 0);
      
      return [doc, similarity];
    });
  }

  /**
   * Convert distance to similarity score [0, 1].
   */
  private normalizeScore(distance: number): number {
    if (this.metric === 'cosine') {
      // Cosine distance: 0 (identical) to 2 (opposite)
      return Math.max(0.0, 1.0 - (distance / 2.0));
    } else if (this.metric === 'euclidean') {
      // Euclidean: exponential decay
      return Math.exp(-distance);
    } else if (this.metric === 'squared_euclidean') {
      // Squared Euclidean: exponential decay with sqrt
      return Math.exp(-Math.sqrt(distance));
    } else {
      // Default: inverse distance
      return 1.0 / (1.0 + distance);
    }
  }

  /**
   * Maximal Marginal Relevance search - balances similarity with diversity.
   * 
   * @param query - The query string
   * @param options - MMR search options including k, fetchK, lambda, and filter
   * @returns Promise of documents selected by maximal marginal relevance
   */
  async maxMarginalRelevanceSearch(
    query: string,
    options: {
      k: number;
      fetchK?: number;
      lambda?: number;
      filter?: Record<string, any>;
    }
  ): Promise<DocumentInterface[]> {
    const { k, fetchK = k * 2, lambda = 0.5, filter } = options;
    
    // Step 1: Get query embedding
    const queryEmbedding = await this.embeddings.embedQuery(query);
    
    // Step 2: Fetch more candidates than we need
    const candidates = await this.similaritySearchVectorWithScore(
      queryEmbedding,
      fetchK,
      filter
    );
    
    if (candidates.length === 0) {
      return [];
    }
    
    // Step 3: Get embeddings for all candidate documents
    const candidateEmbeddings = await Promise.all(
      candidates.map(([doc]) => 
        this.embeddings.embedQuery(doc.pageContent)
      )
    );
    
    // Step 4: Implement MMR algorithm
    const selected: number[] = [];
    const selectedDocs: DocumentInterface[] = [];
    
    // Start with the most similar document
    let bestIdx = 0;
    let bestScore = candidates[0][1];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i][1] > bestScore) {
        bestScore = candidates[i][1];
        bestIdx = i;
      }
    }
    selected.push(bestIdx);
    selectedDocs.push(candidates[bestIdx][0]);
    
    // Iteratively select documents that maximize MMR
    while (selected.length < k && selected.length < candidates.length) {
      let bestMmrScore = -Infinity;
      let bestMmrIdx = -1;
      
      for (let i = 0; i < candidates.length; i++) {
        if (selected.includes(i)) continue;
        
        // Calculate similarity to query (already have this from the search)
        const querySimScore = candidates[i][1];
        
        // Calculate maximum similarity to already selected documents
        let maxSelectedSim = 0;
        for (const selectedIdx of selected) {
          const sim = this.cosineSimilarity(
            candidateEmbeddings[i],
            candidateEmbeddings[selectedIdx]
          );
          maxSelectedSim = Math.max(maxSelectedSim, sim);
        }
        
        // Calculate MMR score
        const mmrScore = lambda * querySimScore - (1 - lambda) * maxSelectedSim;
        
        if (mmrScore > bestMmrScore) {
          bestMmrScore = mmrScore;
          bestMmrIdx = i;
        }
      }
      
      if (bestMmrIdx === -1) break;
      
      selected.push(bestMmrIdx);
      selectedDocs.push(candidates[bestMmrIdx][0]);
    }
    
    return selectedDocs;
  }
  
  /**
   * Calculate cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (normA * normB);
  }

  /**
   * Create a vector store from texts.
   */
  static async fromTexts(
    texts: string[],
    metadatas: object[] | object,
    embeddings: EmbeddingsInterface,
    config: CyborgVectorStoreConfig
  ): Promise<CyborgVectorStore> {
    const store = new CyborgVectorStore(embeddings, config);
    await store.addTexts(texts, metadatas);
    return store;
  }

  /**
   * Create a vector store from documents.
   */
  static async fromDocuments(
    docs: DocumentInterface[],
    embeddings: EmbeddingsInterface,
    config: CyborgVectorStoreConfig
  ): Promise<CyborgVectorStore> {
    const store = new CyborgVectorStore(embeddings, config);
    await store.addDocuments(docs);
    return store;
  }

  /**
   * Create a vector store from an existing index.
   */
  static async fromExistingIndex(
    embeddings: EmbeddingsInterface,
    config: CyborgVectorStoreConfig
  ): Promise<CyborgVectorStore> {
    const store = new CyborgVectorStore(embeddings, config);
    await store.initializeIndex();
    return store;
  }
}