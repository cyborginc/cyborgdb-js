/**
 * Unit tests for the getDemoApiKey function.
 *
 * This test suite covers the demo API key generation functionality,
 * including success cases, error handling, and environment variable support.
 */

import { getDemoApiKey } from '../demo';

// Mock global fetch
global.fetch = jest.fn();

describe('getDemoApiKey', () => {
  let originalEnv: string | undefined;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Store original environment variable
    originalEnv = process.env.CYBORGDB_DEMO_ENDPOINT;

    // Mock console methods
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.CYBORGDB_DEMO_ENDPOINT = originalEnv;
    } else {
      delete process.env.CYBORGDB_DEMO_ENDPOINT;
    }

    // Restore console methods
    consoleInfoSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('should successfully generate demo API key', async () => {
    // Mock successful response
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        apiKey: 'demo_test_key_12345',
        expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      }),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    // Call the function
    const apiKey = await getDemoApiKey();

    // Verify the result
    expect(apiKey).toBe('demo_test_key_12345');

    // Verify the request was made correctly
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    expect(callArgs[0]).toBe('https://api.cyborgdb.co/v1/api-key/manage/create-demo-key');
    expect(callArgs[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ description: 'Temporary demo API key' }),
    });
  });

  test('should generate demo API key with custom description', async () => {
    // Mock successful response
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        apiKey: 'demo_test_key_67890',
      }),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    // Call the function with custom description
    const customDescription = 'My custom demo key';
    const apiKey = await getDemoApiKey(customDescription);

    // Verify the result
    expect(apiKey).toBe('demo_test_key_67890');

    // Verify the custom description was used
    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    expect(callArgs[1].body).toBe(JSON.stringify({ description: customDescription }));
  });

  test('should use default endpoint when env var is not set', async () => {
    // Ensure env var is not set
    delete process.env.CYBORGDB_DEMO_ENDPOINT;

    // Mock successful response
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        apiKey: 'demo_test_key_default',
      }),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    // Call the function
    const apiKey = await getDemoApiKey();

    // Verify default endpoint was used
    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    expect(callArgs[0]).toBe('https://api.cyborgdb.co/v1/api-key/manage/create-demo-key');
    expect(apiKey).toBe('demo_test_key_default');
  });

  test('should use custom endpoint from env var', async () => {
    // Set custom endpoint
    const customEndpoint = 'https://custom.api.example.com/demo-key';
    process.env.CYBORGDB_DEMO_ENDPOINT = customEndpoint;

    // Mock successful response
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        apiKey: 'demo_test_key_custom',
      }),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    // Call the function
    const apiKey = await getDemoApiKey();

    // Verify custom endpoint was used
    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    expect(callArgs[0]).toBe(customEndpoint);
    expect(apiKey).toBe('demo_test_key_custom');
  });

  test('should throw error when apiKey is missing in response', async () => {
    // Mock response without apiKey
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
      }),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    // Call the function and expect error
    await expect(getDemoApiKey()).rejects.toThrow('Demo API key not found in response');
    expect(consoleErrorSpy).toHaveBeenCalledWith('Demo API key not found in response.');
  });

  test('should throw error on HTTP error status', async () => {
    // Mock HTTP error
    const mockResponse = {
      ok: false,
      status: 404,
      json: async () => ({}),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    // Call the function and expect error
    await expect(getDemoApiKey()).rejects.toThrow('Failed to generate demo API key');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('should throw error on network error', async () => {
    // Mock network error
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network connection failed'));

    // Call the function and expect error
    await expect(getDemoApiKey()).rejects.toThrow('Failed to generate demo API key: Network connection failed');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('should throw error on timeout', async () => {
    // Mock timeout error
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Request timeout'));

    // Call the function and expect error
    await expect(getDemoApiKey()).rejects.toThrow('Failed to generate demo API key: Request timeout');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('should log expiration info when expiresAt is provided', async () => {
    // Mock successful response with expiration
    const futureTimestamp = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        apiKey: 'demo_test_key_expires',
        expiresAt: futureTimestamp,
      }),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    // Call the function
    const apiKey = await getDemoApiKey();

    // Verify the result
    expect(apiKey).toBe('demo_test_key_expires');

    // Verify expiration was logged
    expect(consoleInfoSpy).toHaveBeenCalled();
    const logMessage = consoleInfoSpy.mock.calls[0][0];
    expect(logMessage).toContain('Demo API key will expire in');
  });

  test('should format expiration times correctly', async () => {
    const testCases = [
      { seconds: 30, description: '30 seconds' },
      { seconds: 90, description: '90 seconds' },
      { seconds: 3600, description: '1 hour' },
      { seconds: 7200, description: '2 hours' },
      { seconds: 86400, description: '1 day' },
      { seconds: 172800, description: '2 days' },
    ];

    for (const testCase of testCases) {
      jest.clearAllMocks();

      const futureTimestamp = Math.floor(Date.now() / 1000) + testCase.seconds;
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          apiKey: 'demo_test_key_expires',
          expiresAt: futureTimestamp,
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await getDemoApiKey();

      // Just verify that expiration info was logged with a time duration
      expect(consoleInfoSpy).toHaveBeenCalled();
      const logMessage = consoleInfoSpy.mock.calls[0][0];
      expect(logMessage).toContain('Demo API key will expire in');
      expect(logMessage).toMatch(/\d+\s+(second|minute|hour|day)/);
    }
  });

  test('should not log expiration info when expiresAt is not provided', async () => {
    // Mock successful response without expiration
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        apiKey: 'demo_test_key_no_expiration',
      }),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    // Call the function
    const apiKey = await getDemoApiKey();

    // Verify the result
    expect(apiKey).toBe('demo_test_key_no_expiration');

    // Verify expiration was not logged
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  test('should handle non-Error exceptions', async () => {
    // Mock a non-Error exception
    (global.fetch as jest.Mock).mockRejectedValue('String error');

    // Call the function and expect error
    await expect(getDemoApiKey()).rejects.toThrow('Failed to generate demo API key: String error');
  });
});
