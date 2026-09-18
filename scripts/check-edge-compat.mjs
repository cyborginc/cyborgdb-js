#!/usr/bin/env node
/**
 * Fails if the `cyborgdb` entry point stops being Edge-compatible.
 *
 * The Vercel and Cloudflare Edge runtimes provide no Node builtins and no
 * `Buffer`. A single static `import ... from "node:crypto"` anywhere in the
 * module graph makes the package unimportable there — the failure happens at
 * bundle time, before any SDK call is made. This check is the guard that keeps
 * one from creeping back in.
 *
 * It does three things:
 *   1. bundles the entry point for a browser-like target, where an unresolved
 *      `node:*` specifier is a hard error rather than a silent externalization;
 *   2. greps the bundle for `node:` imports and bare `Buffer` references;
 *   3. reports which module pulled in any offender, so the failure is
 *      actionable rather than just a "something broke".
 *
 * Run: `npm run check:edge`
 */

import { build } from "esbuild";

/** Entry points that must import cleanly on an Edge runtime. */
const EDGE_ENTRY_POINTS = ["src/index.ts"];

/**
 * Globals that exist on Node but not on the Edge. `process` is excluded: the
 * SDK reads it only behind `typeof process !== "undefined"` guards, which are
 * correct and which a textual scan cannot distinguish from an unguarded read.
 */
const FORBIDDEN_GLOBALS = [/\bBuffer\b/, /\b__dirname\b/, /\b__filename\b/];

/** Static `node:`-prefixed imports/requires left in the output. */
const NODE_BUILTIN_REFERENCE =
	/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']node:[\w/]+["']/g;

const failures = [];

for (const entryPoint of EDGE_ENTRY_POINTS) {
	let result;
	try {
		result = await build({
			entryPoints: [entryPoint],
			bundle: true,
			// `browser` refuses to silently externalize Node builtins the way
			// `node` does, so an unresolved `node:fs` fails the build here.
			platform: "browser",
			format: "esm",
			write: false,
			metafile: true,
			logLevel: "silent",
			// The SDK loads genuinely Node-only features through a runtime
			// specifier (see src/nodeInterop.ts). esbuild can't bundle those and
			// says so; that warning is the design, not a problem.
			logOverride: { "unsupported-dynamic-import": "silent" },
		});
	} catch (error) {
		const detail = (error.errors ?? [])
			.map((e) => `    ${e.text}${e.location ? ` (${e.location.file}:${e.location.line})` : ""}`)
			.join("\n");
		failures.push(
			`${entryPoint}: failed to bundle for an Edge target.\n${detail || `    ${error.message}`}`,
		);
		continue;
	}

	const output = result.outputFiles[0].text;

	const builtins = [...new Set(output.match(NODE_BUILTIN_REFERENCE) ?? [])];
	if (builtins.length > 0) {
		failures.push(
			`${entryPoint}: Node builtin(s) reachable from the entry point: ${builtins.join(", ")}`,
		);
	}

	for (const pattern of FORBIDDEN_GLOBALS) {
		if (pattern.test(output)) {
			failures.push(
				`${entryPoint}: uses ${pattern.source.replaceAll("\\b", "")}, which does not exist on Edge runtimes. ` +
					"Use the helpers in src/bytes.ts instead.",
			);
		}
	}
}

if (failures.length > 0) {
	console.error("Edge-compatibility check FAILED:\n");
	for (const failure of failures) {
		console.error(`  - ${failure}`);
	}
	console.error(
		"\nThe cyborgdb entry point must import on Vercel Edge and Cloudflare Workers,\n" +
			"which provide no Node builtins. Move Node-only code behind\n" +
			"optionalNodeBuiltin() (src/nodeInterop.ts) or out of the root entry point.",
	);
	process.exit(1);
}

console.log(
	`Edge-compatibility check passed for: ${EDGE_ENTRY_POINTS.join(", ")}`,
);
