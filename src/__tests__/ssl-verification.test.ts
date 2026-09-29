/**
 * SSL Verification Tests for CyborgDB Client
 *
 * This test suite focuses specifically on SSL verification functionality
 * and can be run independently of the main integration tests.
 *
 * To run only these tests:
 * npm test -- ssl-verification.test.ts
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dotenv from "dotenv";
import { CyborgDB } from "../client";
import { CyborgDBAuthenticationError, CyborgDBTransportError } from "../errors";
import { createInsecureFetch } from "../insecureFetch";

// Load environment variables
dotenv.config();

// Test constants
const CYBORGDB_API_KEY =
	process.env.CYBORGDB_API_KEY || "test-key-for-ssl-tests";
const TEST_LOCALHOST_URL = "http://localhost:8000";
const TEST_PRODUCTION_URL = "https://api.cyborgdb.com";

/** Every `code` along an error's `cause` chain, outermost first. */
function causeCodes(error: unknown): string[] {
	const codes: string[] = [];
	for (let e = error as { code?: unknown; cause?: unknown } | undefined; e; ) {
		if (typeof e.code === "string") codes.push(e.code);
		e = e.cause as typeof e;
	}
	return codes;
}

describe("CyborgDB SSL Verification", () => {
	let originalConsoleInfo: jest.SpyInstance;
	let originalConsoleWarn: jest.SpyInstance;

	beforeEach(() => {
		// Mock console methods to capture SSL-related messages
		originalConsoleInfo = jest.spyOn(console, "info").mockImplementation();
		originalConsoleWarn = jest.spyOn(console, "warn").mockImplementation();
	});

	afterEach(() => {
		// Restore console methods
		originalConsoleInfo.mockRestore();
		originalConsoleWarn.mockRestore();
	});

	describe("Constructor SSL Auto-Detection", () => {
		test("should auto-detect and disable SSL verification for HTTP localhost URLs", () => {
			const client = new CyborgDB({
				baseUrl: "http://localhost:8000",
				apiKey: CYBORGDB_API_KEY,
			});

			expect(client).toBeDefined();
			// HTTP URLs automatically set verifySsl=false, which triggers the warning
			expect(originalConsoleWarn).toHaveBeenCalledWith(
				"SSL verification is disabled. Not recommended for production.",
			);
			// Plain http has no certificate to skip, so no custom fetch is installed
			expect(originalConsoleWarn).not.toHaveBeenCalledWith(
				"SSL verification disabled in Node.js environment",
			);
		});

		test("should auto-detect and disable SSL verification for HTTPS localhost URLs", () => {
			const client = new CyborgDB({
				baseUrl: "https://localhost:8000",
				apiKey: CYBORGDB_API_KEY,
			});

			expect(client).toBeDefined();
			expect(originalConsoleInfo).toHaveBeenCalledWith(
				"SSL verification disabled for localhost (development mode)",
			);
		});

		test("should auto-detect and disable SSL verification for 127.0.0.1 URLs", () => {
			const client = new CyborgDB({
				baseUrl: "https://127.0.0.1:8000",
				apiKey: CYBORGDB_API_KEY,
			});

			expect(client).toBeDefined();
			expect(originalConsoleInfo).toHaveBeenCalledWith(
				"SSL verification disabled for localhost (development mode)",
			);
		});

		test("should enable SSL verification by default for production URLs", () => {
			const client = new CyborgDB({
				baseUrl: TEST_PRODUCTION_URL,
				apiKey: CYBORGDB_API_KEY,
			});

			expect(client).toBeDefined();
			// Should not log any SSL-related messages for production URLs with default SSL
			expect(originalConsoleInfo).not.toHaveBeenCalled();
			expect(originalConsoleWarn).not.toHaveBeenCalled();
		});

		test.each([
			"https://localhost.evil.com",
			"https://127.0.0.1.evil.com",
			"https://notlocalhost.example.com",
			"https://my-localhost-proxy.example.com",
			"https://api.example.com/?region=localhost",
		])("should keep SSL verification on for %s, which is not a local host", (baseUrl) => {
			// cyborgdb-core#2399
			new CyborgDB({ baseUrl, apiKey: CYBORGDB_API_KEY });

			expect(originalConsoleInfo).not.toHaveBeenCalledWith(
				"SSL verification disabled for localhost (development mode)",
			);
		});
	});

	describe("Explicit SSL Configuration", () => {
		test("should explicitly disable SSL verification when verifySsl=false", () => {
			const client = new CyborgDB({
				baseUrl: TEST_PRODUCTION_URL,
				apiKey: CYBORGDB_API_KEY,
				verifySsl: false,
			});

			expect(client).toBeDefined();
			expect(originalConsoleWarn).toHaveBeenCalledWith(
				"SSL verification is disabled. Not recommended for production.",
			);
		});

		test("should explicitly enable SSL verification when verifySsl=true", () => {
			const client = new CyborgDB({
				baseUrl: "https://localhost:8000",
				apiKey: CYBORGDB_API_KEY,
				verifySsl: true,
			});

			expect(client).toBeDefined();
			// Should not log the localhost auto-detection message since SSL is explicitly enabled
			expect(originalConsoleInfo).not.toHaveBeenCalledWith(
				"SSL verification disabled for localhost (development mode)",
			);
			expect(originalConsoleWarn).not.toHaveBeenCalled();
		});

		test("should override auto-detection with explicit verifySsl=false for production URLs", () => {
			const client = new CyborgDB({
				baseUrl: TEST_PRODUCTION_URL,
				apiKey: CYBORGDB_API_KEY,
				verifySsl: false,
			});

			expect(client).toBeDefined();
			expect(originalConsoleWarn).toHaveBeenCalledWith(
				"SSL verification is disabled. Not recommended for production.",
			);
		});

		test("should override auto-detection with explicit verifySsl=true for localhost URLs", () => {
			const client = new CyborgDB({
				baseUrl: "https://localhost:8000",
				apiKey: CYBORGDB_API_KEY,
				verifySsl: true,
			});

			expect(client).toBeDefined();
			// Should not show auto-detection message when explicitly enabled
			expect(originalConsoleInfo).not.toHaveBeenCalled();
			expect(originalConsoleWarn).not.toHaveBeenCalled();
		});
	});

	describe("Node.js HTTPS Agent Configuration", () => {
		// These tests only run in Node.js environments
		const isNodeJS =
			typeof process !== "undefined" &&
			process.versions &&
			process.versions.node;

		test("should install the insecure fetch in Node.js when SSL verification is disabled", () => {
			if (!isNodeJS) {
				console.log("Skipping Node.js specific test in browser environment");
				return;
			}

			const client = new CyborgDB({
				baseUrl: "https://localhost:8000",
				apiKey: CYBORGDB_API_KEY,
				verifySsl: false,
			});

			expect(client).toBeDefined();
			expect(originalConsoleWarn).toHaveBeenCalledWith(
				"SSL verification is disabled. Not recommended for production.",
			);

			// In Node.js, we should also get either a success or fallback warning
			const warnCalls = originalConsoleWarn.mock.calls.map(
				(call: any[]) => call[0],
			);
			const hasNodeWarning = warnCalls.includes(
				"SSL verification disabled in Node.js environment",
			);
			const hasFallbackWarning = warnCalls.includes(
				"Could not configure SSL verification - using default fetch",
			);
			expect(hasNodeWarning || hasFallbackWarning).toBe(true);
		});

		test("should not install the insecure fetch when SSL verification is enabled", () => {
			if (!isNodeJS) {
				console.log("Skipping Node.js specific test in browser environment");
				return;
			}

			const client = new CyborgDB({
				baseUrl: TEST_PRODUCTION_URL,
				apiKey: CYBORGDB_API_KEY,
				verifySsl: true,
			});

			expect(client).toBeDefined();
			expect(originalConsoleWarn).not.toHaveBeenCalledWith(
				"SSL verification disabled in Node.js environment",
			);
		});
	});

	describe("URL Format Auto-Detection", () => {
		const testCases = [
			{
				url: "http://localhost:8000",
				shouldDisableSSL: true,
				expectedLog: "warn",
				description: "HTTP localhost should disable SSL with warning",
			},
			{
				url: "https://localhost:8000",
				shouldDisableSSL: true,
				expectedLog: "info",
				description: "HTTPS localhost should disable SSL with info message",
			},
			{
				url: "https://127.0.0.1:8000",
				shouldDisableSSL: true,
				expectedLog: "info",
				description: "127.0.0.1 should disable SSL with info message",
			},
			{
				url: "https://localhost",
				shouldDisableSSL: true,
				expectedLog: "info",
				description: "localhost without port should disable SSL",
			},
			{
				url: "https://127.0.0.1",
				shouldDisableSSL: true,
				expectedLog: "info",
				description: "127.0.0.1 without port should disable SSL",
			},
			{
				url: "https://api.cyborgdb.com",
				shouldDisableSSL: false,
				expectedLog: null,
				description: "Production URL should enable SSL",
			},
			{
				url: "https://staging.cyborgdb.com",
				shouldDisableSSL: false,
				expectedLog: null,
				description: "Staging URL should enable SSL",
			},
			{
				url: "https://my-server.com",
				shouldDisableSSL: false,
				expectedLog: null,
				description: "Custom domain should enable SSL",
			},
			{
				url: "https://192.168.1.100",
				shouldDisableSSL: false,
				expectedLog: null,
				description: "LAN IP should enable SSL by default",
			},
			{
				url: "https://[::1]:8000",
				shouldDisableSSL: true,
				expectedLog: "info",
				description: "IPv6 loopback should disable SSL",
			},
			{
				url: "https://localhost.evil.com",
				shouldDisableSSL: false,
				expectedLog: null,
				description:
					"hostname merely starting with localhost should enable SSL",
			},
			{
				url: "https://127.0.0.1.nip.io",
				shouldDisableSSL: false,
				expectedLog: null,
				description:
					"hostname merely starting with 127.0.0.1 should enable SSL",
			},
			{
				url: "https://evil.com/localhost",
				shouldDisableSSL: false,
				expectedLog: null,
				description: "localhost in the path should enable SSL",
			},
		];

		test.each(testCases)("$description", ({ url, expectedLog }) => {
			const client = new CyborgDB({ baseUrl: url, apiKey: CYBORGDB_API_KEY });

			expect(client).toBeDefined();

			if (expectedLog === "info") {
				expect(originalConsoleInfo).toHaveBeenCalledWith(
					"SSL verification disabled for localhost (development mode)",
				);
			} else if (expectedLog === "warn") {
				expect(originalConsoleWarn).toHaveBeenCalledWith(
					"SSL verification is disabled. Not recommended for production.",
				);
			} else if (expectedLog === null) {
				expect(originalConsoleInfo).not.toHaveBeenCalled();
				expect(originalConsoleWarn).not.toHaveBeenCalled();
			}
		});
	});

	describe("Parameter Combinations", () => {
		const combinations = [
			{
				url: "https://localhost:8000",
				verifySsl: undefined,
				expectedLogType: "info",
				expectedMessage:
					"SSL verification disabled for localhost (development mode)",
			},
			{
				url: "https://localhost:8000",
				verifySsl: false,
				expectedLogType: "warn",
				expectedMessage:
					"SSL verification is disabled. Not recommended for production.",
			},
			{
				url: "https://localhost:8000",
				verifySsl: true,
				expectedLogType: null,
				expectedMessage: null,
			},
			{
				url: TEST_PRODUCTION_URL,
				verifySsl: undefined,
				expectedLogType: null,
				expectedMessage: null,
			},
			{
				url: TEST_PRODUCTION_URL,
				verifySsl: false,
				expectedLogType: "warn",
				expectedMessage:
					"SSL verification is disabled. Not recommended for production.",
			},
			{
				url: TEST_PRODUCTION_URL,
				verifySsl: true,
				expectedLogType: null,
				expectedMessage: null,
			},
			{
				url: "http://localhost:8000",
				verifySsl: undefined,
				expectedLogType: "warn",
				expectedMessage:
					"SSL verification is disabled. Not recommended for production.",
			},
			{
				url: "http://localhost:8000",
				verifySsl: false,
				expectedLogType: "warn",
				expectedMessage:
					"SSL verification is disabled. Not recommended for production.",
			},
			{
				url: "http://localhost:8000",
				verifySsl: true,
				expectedLogType: "warn",
				expectedMessage:
					"SSL verification is disabled. Not recommended for production.",
			},
		];

		test.each(
			combinations,
		)("URL: $url, verifySsl: $verifySsl should log $expectedLogType", ({
			url,
			verifySsl,
			expectedLogType,
			expectedMessage,
		}) => {
			const client = new CyborgDB({
				baseUrl: url,
				apiKey: CYBORGDB_API_KEY,
				verifySsl,
			});

			expect(client).toBeDefined();

			if (expectedLogType === "info" && expectedMessage) {
				expect(originalConsoleInfo).toHaveBeenCalledWith(expectedMessage);
			} else if (expectedLogType === "warn" && expectedMessage) {
				expect(originalConsoleWarn).toHaveBeenCalledWith(expectedMessage);
			} else {
				expect(originalConsoleInfo).not.toHaveBeenCalled();
				expect(originalConsoleWarn).not.toHaveBeenCalled();
			}
		});
	});

	describe("Functionality Preservation", () => {
		test("should preserve API key and other settings when configuring SSL", () => {
			const testApiKey = "test-api-key-12345";
			const client = new CyborgDB({
				baseUrl: "https://localhost:8000",
				apiKey: testApiKey,
				verifySsl: false,
			});

			expect(client).toBeDefined();

			// Verify that the client still has all expected methods
			expect(client.generateKey).toBeDefined();
			expect(client.listIndexes).toBeDefined();
			expect(client.createIndex).toBeDefined();
			expect(client.loadIndex).toBeDefined();
			expect(client.getHealth).toBeDefined();
		});

		test("should generate cryptographically secure keys regardless of SSL settings", () => {
			const sslEnabledClient = new CyborgDB({
				baseUrl: TEST_PRODUCTION_URL,
				apiKey: CYBORGDB_API_KEY,
				verifySsl: true,
			});
			const sslDisabledClient = new CyborgDB({
				baseUrl: "https://localhost:8000",
				apiKey: CYBORGDB_API_KEY,
				verifySsl: false,
			});

			const key1 = sslEnabledClient.generateKey();
			const key2 = sslDisabledClient.generateKey();

			expect(key1).toBeDefined();
			expect(key1.length).toBe(32);
			expect(key2).toBeDefined();
			expect(key2.length).toBe(32);

			// Keys should be different
			expect(key1).not.toEqual(key2);
		});

		test("should handle different API key formats with SSL settings", () => {
			const testCases = [
				{ apiKey: undefined, ssl: true },
				{ apiKey: undefined, ssl: false },
				{ apiKey: "", ssl: true },
				{ apiKey: "short-key", ssl: false },
				{
					apiKey: "very-long-api-key-with-many-characters-123456789",
					ssl: true,
				},
			];

			testCases.forEach(({ apiKey, ssl }) => {
				expect(() => {
					new CyborgDB({
						baseUrl: "https://localhost:8000",
						apiKey,
						verifySsl: ssl,
					});
				}).not.toThrow();
			});
		});
	});

	describe("Integration Tests", () => {
		// These tests only run if CYBORGDB_API_KEY is properly set
		const hasValidApiKey =
			process.env.CYBORGDB_API_KEY &&
			process.env.CYBORGDB_API_KEY !== "test-key-for-ssl-tests";

		test("should successfully make API calls with SSL verification disabled on localhost", async () => {
			if (!hasValidApiKey) {
				console.log("Skipping integration test - CYBORGDB_API_KEY not set");
				return;
			}

			const client = new CyborgDB({
				baseUrl: TEST_LOCALHOST_URL,
				apiKey: process.env.CYBORGDB_API_KEY,
				verifySsl: false,
			});

			try {
				const health = await client.getHealth();
				expect(health).toBeDefined();
				expect(typeof health).toBe("object");
			} catch (error: any) {
				// If the server is not running, we expect a connection error, not an SSL error
				expect(error.message).not.toContain("certificate");
				expect(error.message).not.toContain("SSL");
				expect(error.message).not.toContain("TLS");

				// Common connection errors when server is not running
				const isConnectionError =
					error.message.includes("ECONNREFUSED") ||
					error.message.includes("Network Error") ||
					error.message.includes("connect") ||
					error.message.includes("ENOTFOUND") ||
					error.message.includes("timeout");

				expect(isConnectionError).toBe(true);
			}
		});

		test("should handle network errors gracefully with different SSL settings", async () => {
			const invalidUrl = "https://non-existent-cyborgdb-server.invalid";

			const sslEnabledClient = new CyborgDB({
				baseUrl: invalidUrl,
				apiKey: "fake-key",
				verifySsl: true,
			});
			const sslDisabledClient = new CyborgDB({
				baseUrl: invalidUrl,
				apiKey: "fake-key",
				verifySsl: false,
			});

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
						error.message.includes("ENOTFOUND") ||
						error.message.includes("Network Error") ||
						error.message.includes("getaddrinfo") ||
						error.code === "ENOTFOUND";
					expect(isNetworkError).toBe(true);
				}
			}
		});
	});

	// Runs against a real self-signed server. With NODE_TLS_REJECT_UNAUTHORIZED
	// set, Node skips verification process-wide and every case passes whether
	// or not the SDK relaxed it. Jest sandboxes process.env, so it can't be
	// cleared from here; the suite refuses to run instead.
	describe("Self-signed HTTPS server", () => {
		let server: Server;
		let port: number;
		let certDir: string;

		beforeAll(async () => {
			if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined) {
				throw new Error(
					"Unset NODE_TLS_REJECT_UNAUTHORIZED to run the self-signed HTTPS tests",
				);
			}
			certDir = mkdtempSync(join(tmpdir(), "cyborgdb-tls-"));
			const keyPath = join(certDir, "key.pem");
			const certPath = join(certDir, "cert.pem");
			execFileSync(
				"openssl",
				[
					"req",
					"-x509",
					"-newkey",
					"rsa:2048",
					"-nodes",
					"-days",
					"1",
					"-subj",
					"/CN=localhost",
					"-addext",
					"subjectAltName=DNS:localhost,IP:127.0.0.1",
					"-keyout",
					keyPath,
					"-out",
					certPath,
				],
				{ stdio: "ignore" },
			);

			server = createServer(
				{ key: readFileSync(keyPath), cert: readFileSync(certPath) },
				(req, res) => {
					const chunks: Buffer[] = [];
					req.on("data", (c) => chunks.push(c));
					req.on("end", () => {
						if (req.url === "/v1/health") {
							res.writeHead(200, { "Content-Type": "application/json" });
							res.end(JSON.stringify({ status: "healthy" }));
						} else if (req.url === "/v1/indexes/list") {
							res.writeHead(401, { "Content-Type": "application/json" });
							res.end(JSON.stringify({ detail: "Invalid API key" }));
						} else if (req.url?.startsWith("/redirect/")) {
							const [, , code, target] = req.url.split("/");
							res.writeHead(Number(code), { Location: `/${target}` });
							res.end();
						} else if (req.url === "/loop") {
							res.writeHead(302, { Location: "/loop" });
							res.end();
						} else if (req.url === "/stall") {
							// Never answers; the client's inactivity timeout must fire.
						} else if (req.url === "/echo") {
							res.writeHead(200, { "Content-Type": "application/json" });
							res.end(
								JSON.stringify({
									method: req.method,
									header: req.headers["x-test"],
									body: Buffer.concat(chunks).toString(),
								}),
							);
						} else {
							res.writeHead(204);
							res.end();
						}
					});
				},
			);
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			port = (server.address() as AddressInfo).port;
		});

		afterAll(async () => {
			await new Promise((resolve) => server?.close(resolve) ?? resolve(null));
			if (certDir) rmSync(certDir, { recursive: true, force: true });
		});

		test("loopback host with verifySsl unset connects", async () => {
			const client = new CyborgDB({ baseUrl: `https://localhost:${port}` });
			await expect(client.getHealth()).resolves.toEqual({ status: "healthy" });
		});

		test("verifySsl=false connects", async () => {
			const client = new CyborgDB({
				baseUrl: `https://127.0.0.1:${port}`,
				verifySsl: false,
			});
			await expect(client.getHealth()).resolves.toEqual({ status: "healthy" });
		});

		test("verifySsl=true rejects the self-signed certificate", async () => {
			const client = new CyborgDB({
				baseUrl: `https://localhost:${port}`,
				verifySsl: true,
			});
			const err = await client.getHealth().catch((e: unknown) => e);
			expect(err).toBeInstanceOf(CyborgDBTransportError);
			// Match the reason, not just any failure: a closed port or a server
			// that never started also throws CyborgDBTransportError. The code is
			// stable across Node versions; the message wording is not.
			expect(causeCodes(err)).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
		});

		test("error responses still map to typed errors", async () => {
			const client = new CyborgDB({
				baseUrl: `https://localhost:${port}`,
				apiKey: "bad-key",
			});
			await expect(client.listIndexes()).rejects.toBeInstanceOf(
				CyborgDBAuthenticationError,
			);
		});

		test("insecure fetch forwards method, headers and body", async () => {
			const insecureFetch = (await createInsecureFetch()) as typeof fetch;
			const res = await insecureFetch(`https://127.0.0.1:${port}/echo`, {
				method: "POST",
				headers: { "X-Test": "yes" },
				body: JSON.stringify({ a: 1 }),
			});
			expect(await res.json()).toEqual({
				method: "POST",
				header: "yes",
				body: '{"a":1}',
			});
		});

		test.each([
			[307, "POST", '{"a":1}'],
			[308, "POST", '{"a":1}'],
			[303, "GET", ""],
			[302, "GET", ""],
		])("insecure fetch follows a %i redirect as %s", async (code, method, body) => {
			const insecureFetch = (await createInsecureFetch()) as typeof fetch;
			const res = await insecureFetch(
				`https://127.0.0.1:${port}/redirect/${code}/echo`,
				{
					method: "POST",
					headers: { "X-Test": "yes", "Content-Type": "application/json" },
					body: JSON.stringify({ a: 1 }),
				},
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ method, header: "yes", body });
		});

		test("insecure fetch gives up on a redirect loop", async () => {
			const insecureFetch = (await createInsecureFetch()) as typeof fetch;
			const err = await insecureFetch(`https://127.0.0.1:${port}/loop`).catch(
				(e: unknown) => e,
			);
			expect(err).toBeInstanceOf(TypeError);
			expect((err as Error).message).toBe("fetch failed");
			expect(((err as Error).cause as Error).message).toMatch(/redirects/);
		});

		test("insecure fetch times out a server that never answers", async () => {
			const insecureFetch = (await createInsecureFetch({
				inactivityTimeoutMs: 200,
			})) as typeof fetch;
			const err = await insecureFetch(`https://127.0.0.1:${port}/stall`).catch(
				(e: unknown) => e,
			);
			expect(err).toBeInstanceOf(TypeError);
			expect(((err as Error).cause as { code?: string }).code).toBe(
				"ETIMEDOUT",
			);
		});

		test("insecure fetch handles bodiless responses", async () => {
			const insecureFetch = (await createInsecureFetch()) as typeof fetch;
			const res = await insecureFetch(`https://127.0.0.1:${port}/empty`);
			expect(res.status).toBe(204);
			expect(await res.text()).toBe("");
		});
	});
});
