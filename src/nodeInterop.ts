/**
 * Opt-in access to Node-only capabilities, kept out of the static module graph.
 *
 * Two SDK features are genuinely Node-specific: relaxing TLS verification for
 * local development (`node:https`) and caching sample datasets on disk
 * (`node:fs` and friends). Neither can work on an Edge runtime, and a *static*
 * `import ... from "node:fs"` anywhere in the graph makes the whole package
 * unimportable there — bundlers such as wrangler and the Vercel Edge builder
 * fail to resolve the specifier at build time, before any call is made.
 *
 * So the specifier is assembled at call time. A bundler sees `import(name)`
 * with a runtime value and leaves it alone, which keeps `cyborgdb` importable
 * everywhere; the feature simply degrades on hosts that have no such module.
 */

/** True when running on Node (as opposed to a browser or an Edge runtime). */
export function isNodeRuntime(): boolean {
	return typeof process !== "undefined" && Boolean(process.versions?.node);
}

/**
 * Import a Node builtin by bare name (e.g. `"fs"`), or resolve to `undefined`
 * when the host has no such module.
 *
 * @param name Builtin name without the `node:` prefix.
 * @returns The module namespace, or `undefined` off Node / on failure.
 */
export async function optionalNodeBuiltin<T = unknown>(
	name: string,
): Promise<T | undefined> {
	if (!isNodeRuntime()) {
		return undefined;
	}
	try {
		// Built at runtime on purpose — see the module comment. Do not inline
		// this into a literal, or Edge builds start failing on resolution.
		const specifier = `node:${name}`;
		return (await import(/* webpackIgnore: true */ specifier)) as T;
	} catch {
		return undefined;
	}
}
