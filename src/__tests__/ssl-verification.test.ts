/**
 * SSL Verification Tests for CyborgDB Client
 * 
 * This test suite focuses specifically on SSL verification functionality
 * and can be run independently of the main integration tests.
 * 
 * To run only these tests:
 * npm test -- ssl-verification.test.ts
 */

import { CyborgDB } from '../client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Test constants
const CYBORGDB_API_KEY = process.env.CYBORGDB_API_KEY || 'test-key-for-ssl-tests';
const TEST_LOCALHOST_URL = 'http://localhost:8000';
const TEST_PRODUCTION_URL = 'https://api.cyborgdb.com';

describe('CyborgDB SSL Verification', () => {
  let originalConsoleInfo: jest.SpyInstance;
  let originalConsoleWarn: jest.SpyInstance;
  let originalAxiosDefaults: any;

  beforeEach(() => {
    // Mock console methods to capture SSL-related messages
    originalConsoleInfo = jest.spyOn(console, 'info').mockImplementation();
    originalConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    
    // Store original axios defaults to restore later
    if (typeof require !== 'undefined') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const axios = require('axios');
        originalAxiosDefaults = { ...axios.defaults };
      } catch (e) {
        // axios not available in this environment
      }
    }
  });

  afterEach(() => {
    // Restore console methods
    originalConsoleInfo.mockRestore();
    originalConsoleWarn.mockRestore();
    
    // Restore axios defaults if they were modified
    if (originalAxiosDefaults && typeof require !== 'undefined') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const axios = require('axios');
        Object.assign(axios.defaults, originalAxiosDefaults);
      } catch (e) {
        // axios not available
      }
    }
  });

  describe('Constructor SSL Auto-Detection', () => {
    test('should auto-detect and disable SSL verification for HTTP localhost URLs', () => {
      const client = new CyborgDB({ baseUrl: 'http://localhost:8000', apiKey: CYBORGDB_API_KEY });
      
      expect(client).toBeDefined();
      // HTTP URLs automatically set verifySsl=false, which triggers the warning
      expect(originalConsoleWarn).toHaveBeenCalledWith(
        'SSL verification is disabled. Not recommended for production.'
      );
      // In Node.js, this also triggers the Node.js-specific warning
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        expect(originalConsoleWarn).toHaveBeenCalledWith(
          'SSL verification disabled in Node.js environment'
        );
      }
    });

    test('should auto-detect and disable SSL verification for HTTPS localhost URLs', () => {
      const client = new CyborgDB({ baseUrl: 'https://localhost:8000', apiKey: CYBORGDB_API_KEY });
      
      expect(client).toBeDefined();
      expect(originalConsoleInfo).toHaveBeenCalledWith(
        'SSL verification disabled for localhost (development mode)'
      );
    });

    test('should auto-detect and disable SSL verification for 127.0.0.1 URLs', () => {
      const client = new CyborgDB({ baseUrl: 'https://127.0.0.1:8000', apiKey: CYBORGDB_API_KEY });
      
      expect(client).toBeDefined();
      expect(originalConsoleInfo).toHaveBeenCalledWith(
        'SSL verification disabled for localhost (development mode)'
      );
    });

    test('should enable SSL verification by default for production URLs', () => {
      const client = new CyborgDB({ baseUrl: TEST_PRODUCTION_URL, apiKey: CYBORGDB_API_KEY });
      
      expect(client).toBeDefined();
      // Should not log any SSL-related messages for production URLs with default SSL
      expect(originalConsoleInfo).not.toHaveBeenCalled();
      expect(originalConsoleWarn).not.toHaveBeenCalled();
    });
  });

  describe('Explicit SSL Configuration', () => {
    test('should explicitly disable SSL verification when verifySsl=false', () => {
      const client = new CyborgDB({ baseUrl: TEST_PRODUCTION_URL, apiKey: CYBORGDB_API_KEY, verifySsl: false });
      
      expect(client).toBeDefined();
      expect(originalConsoleWarn).toHaveBeenCalledWith(
        'SSL verification is disabled. Not recommended for production.'
      );
    });

    test('should explicitly enable SSL verification when verifySsl=true', () => {
      const client = new CyborgDB({ baseUrl: 'https://localhost:8000', apiKey: CYBORGDB_API_KEY, verifySsl: true });
      
      expect(client).toBeDefined();
      // Should not log the localhost auto-detection message since SSL is explicitly enabled
      expect(originalConsoleInfo).not.toHaveBeenCalledWith(
        'SSL verification disabled for localhost (development mode)'
      );
      expect(originalConsoleWarn).not.toHaveBeenCalled();
    });

    test('should override auto-detection with explicit verifySsl=false for production URLs', () => {
      const client = new CyborgDB({ baseUrl: TEST_PRODUCTION_URL, apiKey: CYBORGDB_API_KEY, verifySsl: false });
      
      expect(client).toBeDefined();
      expect(originalConsoleWarn).toHaveBeenCalledWith(
        'SSL verification is disabled. Not recommended for production.'
      );
    });

    test('should override auto-detection with explicit verifySsl=true for localhost URLs', () => {
      const client = new CyborgDB({ baseUrl: 'https://localhost:8000', apiKey: CYBORGDB_API_KEY, verifySsl: true });
      
      expect(client).toBeDefined();
      // Should not show auto-detection message when explicitly enabled
      expect(originalConsoleInfo).not.toHaveBeenCalled();
      expect(originalConsoleWarn).not.toHaveBeenCalled();
    });
  });

  describe('Node.js HTTPS Agent Configuration', () => {
    // These tests only run in Node.js environments
    const isNodeJS = typeof process !== 'undefined' && process.versions && process.versions.node;

    test('should configure axios HTTPS agent in Node.js when SSL verification is disabled', () => {
      if (!isNodeJS) {
        console.log('Skipping Node.js specific test in browser environment');
        return;
      }

      const client = new CyborgDB({ baseUrl: 'https://localhost:8000', apiKey: CYBORGDB_API_KEY, verifySsl: false });
      
      expect(client).toBeDefined();
      expect(originalConsoleWarn).toHaveBeenCalledWith(
        'SSL verification disabled in Node.js environment'
      );

      // Verify axios defaults were modified (if axios is available)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const axios = require('axios');
        expect(axios.defaults.httpsAgent).toBeDefined();
        expect(axios.defaults.httpsAgent.options.rejectUnauthorized).toBe(false);
      } catch (e) {
        console.log('Axios not available for HTTPS agent verification');
      }
    });

    test('should not configure axios HTTPS agent when SSL verification is enabled', () => {
      if (!isNodeJS) {
        console.log('Skipping Node.js specific test in browser environment');
        return;
      }

      const client = new CyborgDB({ baseUrl: TEST_PRODUCTION_URL, apiKey: CYBORGDB_API_KEY, verifySsl: true });
      
      expect(client).toBeDefined();
      expect(originalConsoleWarn).not.toHaveBeenCalledWith(
        'SSL verification disabled in Node.js environment'
      );
    });
  });

  describe('URL Format Auto-Detection', () => {
    const testCases = [
      {
        url: 'http://localhost:8000',
        shouldDisableSSL: true,
        expectedLog: 'warn',
        description: 'HTTP localhost should disable SSL with warning'
      },
      {
        url: 'https://localhost:8000',
        shouldDisableSSL: true,
        expectedLog: 'info',
        description: 'HTTPS localhost should disable SSL with info message'
      },
      {
        url: 'https://127.0.0.1:8000',
        shouldDisableSSL: true,
        expectedLog: 'info',
        description: '127.0.0.1 should disable SSL with info message'
      },
      {
        url: 'https://localhost',
        shouldDisableSSL: true,
        expectedLog: 'info',
        description: 'localhost without port should disable SSL'
      },
      {
        url: 'https://127.0.0.1',
        shouldDisableSSL: true,
        expectedLog: 'info',
        description: '127.0.0.1 without port should disable SSL'
      },
      {
        url: 'https://api.cyborgdb.com',
        shouldDisableSSL: false,
        expectedLog: null,
        description: 'Production URL should enable SSL'
      },
      {
        url: 'https://staging.cyborgdb.com',
        shouldDisableSSL: false,
        expectedLog: null,
        description: 'Staging URL should enable SSL'
      },
      {
        url: 'https://my-server.com',
        shouldDisableSSL: false,
        expectedLog: null,
        description: 'Custom domain should enable SSL'
      },
      {
        url: 'https://192.168.1.100',
        shouldDisableSSL: false,
        expectedLog: null,
        description: 'LAN IP should enable SSL by default'
      }
    ];

    test.each(testCases)('$description', ({ url, shouldDisableSSL, expectedLog }) => {
      const client = new CyborgDB({ baseUrl: url, apiKey: CYBORGDB_API_KEY });
      
      expect(client).toBeDefined();
      
      if (expectedLog === 'info') {
        expect(originalConsoleInfo).toHaveBeenCalledWith(
          'SSL verification disabled for localhost (development mode)'
        );
      } else if (expectedLog === 'warn') {
        expect(originalConsoleWarn).toHaveBeenCalledWith(
          'SSL verification is disabled. Not recommended for production.'
        );
      } else if (expectedLog === null) {
        expect(originalConsoleInfo).not.toHaveBeenCalled();
        expect(originalConsoleWarn).not.toHaveBeenCalled();
      }
    });
  });

  describe('Parameter Combinations', () => {
    const combinations = [
      {
        url: 'https://localhost:8000',
        verifySsl: undefined,
        expectedLogType: 'info',
        expectedMessage: 'SSL verification disabled for localhost (development mode)'
      },
      {
        url: 'https://localhost:8000',
        verifySsl: false,
        expectedLogType: 'warn',
        expectedMessage: 'SSL verification is disabled. Not recommended for production.'
      },
      {
        url: 'https://localhost:8000',
        verifySsl: true,
        expectedLogType: null,
        expectedMessage: null
      },
      {
        url: TEST_PRODUCTION_URL,
        verifySsl: undefined,
        expectedLogType: null,
        expectedMessage: null
      },
      {
        url: TEST_PRODUCTION_URL,
        verifySsl: false,
        expectedLogType: 'warn',
        expectedMessage: 'SSL verification is disabled. Not recommended for production.'
      },
      {
        url: TEST_PRODUCTION_URL,
        verifySsl: true,
        expectedLogType: null,
        expectedMessage: null
      },
      {
        url: 'http://localhost:8000',
        verifySsl: undefined,
        expectedLogType: 'warn',
        expectedMessage: 'SSL verification is disabled. Not recommended for production.'
      },
      {
        url: 'http://localhost:8000',
        verifySsl: false,
        expectedLogType: 'warn',
        expectedMessage: 'SSL verification is disabled. Not recommended for production.'
      },
      {
        url: 'http://localhost:8000',
        verifySsl: true,
        expectedLogType: 'warn',
        expectedMessage: 'SSL verification is disabled. Not recommended for production.'
      }
    ];

    test.each(combinations)(
      'URL: $url, verifySsl: $verifySsl should log $expectedLogType',
      ({ url, verifySsl, expectedLogType, expectedMessage }) => {
        const client = new CyborgDB({ baseUrl: url, apiKey: CYBORGDB_API_KEY, verifySsl });
        
        expect(client).toBeDefined();
        
        if (expectedLogType === 'info' && expectedMessage) {
          expect(originalConsoleInfo).toHaveBeenCalledWith(expectedMessage);
        } else if (expectedLogType === 'warn' && expectedMessage) {
          expect(originalConsoleWarn).toHaveBeenCalledWith(expectedMessage);
        } else {
          expect(originalConsoleInfo).not.toHaveBeenCalled();
          expect(originalConsoleWarn).not.toHaveBeenCalled();
        }
      }
    );
  });

  describe('Functionality Preservation', () => {
    test('should preserve API key and other settings when configuring SSL', () => {
      const testApiKey = 'test-api-key-12345';
      const client = new CyborgDB({ baseUrl: 'https://localhost:8000', apiKey: testApiKey, verifySsl: false });
      
      expect(client).toBeDefined();
      
      // Verify that the client still has all expected methods
      expect(client.generateKey).toBeDefined();
      expect(client.listIndexes).toBeDefined();
      expect(client.createIndex).toBeDefined();
      expect(client.loadIndex).toBeDefined();
      expect(client.getHealth).toBeDefined();
    });

    test('should generate cryptographically secure keys regardless of SSL settings', () => {
      const sslEnabledClient = new CyborgDB({ baseUrl: TEST_PRODUCTION_URL, apiKey: CYBORGDB_API_KEY, verifySsl: true });
      const sslDisabledClient = new CyborgDB({ baseUrl: 'https://localhost:8000', apiKey: CYBORGDB_API_KEY, verifySsl: false });
      
      const key1 = sslEnabledClient.generateKey();
      const key2 = sslDisabledClient.generateKey();
      
      expect(key1).toBeDefined();
      expect(key1.length).toBe(32);
      expect(key2).toBeDefined();
      expect(key2.length).toBe(32);
      
      // Keys should be different
      expect(key1).not.toEqual(key2);
    });

    test('should handle different API key formats with SSL settings', () => {
      const testCases = [
        { apiKey: undefined, ssl: true },
        { apiKey: undefined, ssl: false },
        { apiKey: '', ssl: true },
        { apiKey: 'short-key', ssl: false },
        { apiKey: 'very-long-api-key-with-many-characters-123456789', ssl: true }
      ];

      testCases.forEach(({ apiKey, ssl }) => {
        expect(() => {
          new CyborgDB({ baseUrl: 'https://localhost:8000', apiKey, verifySsl: ssl });
        }).not.toThrow();
      });
    });
  });

  describe('Integration Tests', () => {
    // These tests only run if CYBORGDB_API_KEY is properly set
    const hasValidApiKey = process.env.CYBORGDB_API_KEY && process.env.CYBORGDB_API_KEY !== 'test-key-for-ssl-tests';

    test('should successfully make API calls with SSL verification disabled on localhost', async () => {
      if (!hasValidApiKey) {
        console.log('Skipping integration test - CYBORGDB_API_KEY not set');
        return;
      }

      const client = new CyborgDB({ baseUrl: TEST_LOCALHOST_URL, apiKey: process.env.CYBORGDB_API_KEY, verifySsl: false });
      
      try {
        const health = await client.getHealth();
        expect(health).toBeDefined();
        expect(typeof health).toBe('object');
      } catch (error: any) {
        // If the server is not running, we expect a connection error, not an SSL error
        expect(error.message).not.toContain('certificate');
        expect(error.message).not.toContain('SSL');
        expect(error.message).not.toContain('TLS');
        
        // Common connection errors when server is not running
        const isConnectionError = 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('Network Error') ||
          error.message.includes('connect') ||
          error.message.includes('ENOTFOUND') ||
          error.message.includes('timeout');
          
        expect(isConnectionError).toBe(true);
      }
    });

    test('should handle network errors gracefully with different SSL settings', async () => {
      const invalidUrl = 'https://non-existent-cyborgdb-server.invalid';
      
      const sslEnabledClient = new CyborgDB({ baseUrl: invalidUrl, apiKey: 'fake-key', verifySsl: true });
      const sslDisabledClient = new CyborgDB({ baseUrl: invalidUrl, apiKey: 'fake-key', verifySsl: false });
      
      // Both should fail with network errors, not SSL errors
      for (const client of [sslEnabledClient, sslDisabledClient]) {
        try {
          await client.getHealth();
          // Should not reach here
          expect(true).toBe(false);
        } catch (error: any) {
          expect(error).toBeDefined();
          // Should be a network error, not SSL
          const isNetworkError = 
            error.message.includes('ENOTFOUND') ||
            error.message.includes('Network Error') ||
            error.message.includes('getaddrinfo') ||
            error.code === 'ENOTFOUND';
          expect(isNetworkError).toBe(true);
        }
      }
    });
  });
});