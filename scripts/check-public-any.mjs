/**
 * Walks every exported symbol reachable from dist/index.d.ts and exits
 * non-zero if any TypeFlags.Any is found.
 *
 * Skipped paths:
 *   - node_modules/ (upstream-owned)
 *   - dist/apis/**  (generated client internals)
 *   - dist/runtime.d.ts (generated runtime)
 *
 * Self-test mode (--self-test): loads a tiny in-memory fixture that contains
 * `export declare const x: any` and asserts a non-zero result.
 */
import ts from "typescript";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const SELF_TEST_PATH = path.join(projectRoot, "__check_public_any_fixture__.d.ts");
const FIXTURE_CONTENT = "export declare const x: any;";

function isSkippedFile(fileName) {
	if (fileName.includes("/node_modules/")) return true;
	if (fileName.includes("\\node_modules\\")) return true;
	const normalized = fileName.replace(/\\/g, "/");
	if (/\/dist\/apis\//.test(normalized)) return true;
	if (/\/dist\/runtime\.d\.ts$/.test(normalized)) return true;
	return false;
}

function isPrivateOrProtected(symbol) {
	const decls = symbol.declarations;
	if (!decls || decls.length === 0) return false;
	for (const decl of decls) {
		const flags = ts.getCombinedModifierFlags(decl);
		if (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) {
			return true;
		}
	}
	return false;
}

/**
 * Resolve an alias symbol to its target, then get the appropriate type.
 */
function getSymbolType(checker, symbol, location) {
	// Resolve aliases (re-exports) to their target symbol first.
	let resolved = symbol;
	if (symbol.flags & ts.SymbolFlags.Alias) {
		try {
			resolved = checker.getAliasedSymbol(symbol);
		} catch {
			// keep the original
		}
	}

	const flags = resolved.flags;
	// Type-only symbols (interfaces, type aliases) use getDeclaredTypeOfSymbol.
	const isValueSymbol =
		flags & (ts.SymbolFlags.Variable |
			ts.SymbolFlags.Function |
			ts.SymbolFlags.Class |
			ts.SymbolFlags.Method |
			ts.SymbolFlags.Property |
			ts.SymbolFlags.GetAccessor |
			ts.SymbolFlags.SetAccessor |
			ts.SymbolFlags.EnumMember);

	if (!isValueSymbol) {
		try {
			return checker.getDeclaredTypeOfSymbol(resolved);
		} catch {
			// fall through
		}
	}

	try {
		const decl = resolved.declarations?.[0] ?? location;
		return checker.getTypeOfSymbolAtLocation(resolved, decl);
	} catch {
		try {
			return checker.getDeclaredTypeOfSymbol(resolved);
		} catch {
			return checker.getTypeOfSymbolAtLocation(symbol, location);
		}
	}
}

/**
 * Walk exported symbols from a .d.ts file and return all paths where TypeFlags.Any is found.
 */
function findAnyInDts(dtsPath, virtualFiles = {}) {
	const compilerHost = ts.createCompilerHost({});
	const originalGetSourceFile = compilerHost.getSourceFile.bind(compilerHost);
	compilerHost.getSourceFile = (fileName, languageVersion) => {
		const norm = fileName.replace(/\\/g, "/");
		for (const [vPath, vContent] of Object.entries(virtualFiles)) {
			if (norm === vPath.replace(/\\/g, "/")) {
				return ts.createSourceFile(fileName, vContent, languageVersion, true);
			}
		}
		return originalGetSourceFile(fileName, languageVersion);
	};
	compilerHost.fileExists = (fileName) => {
		const norm = fileName.replace(/\\/g, "/");
		for (const vPath of Object.keys(virtualFiles)) {
			if (norm === vPath.replace(/\\/g, "/")) return true;
		}
		return ts.sys.fileExists(fileName);
	};

	const program = ts.createProgram([dtsPath], { skipLibCheck: false }, compilerHost);
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(dtsPath);

	if (!sourceFile) {
		console.error(`Could not load ${dtsPath}`);
		return ["<file-not-found>"];
	}

	const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
	if (!moduleSymbol) {
		return [];
	}

	const exports = checker.getExportsOfModule(moduleSymbol);
	const visitedIds = new Set();
	const findings = [];

	function walkType(type, typePath) {
		const id = type.id;
		if (id !== undefined) {
			if (visitedIds.has(id)) return;
			visitedIds.add(id);
		}

		if (type.flags & ts.TypeFlags.Any) {
			findings.push(typePath);
			return;
		}

		// Union
		if (type.flags & ts.TypeFlags.Union) {
			for (const member of type.types) {
				walkType(member, typePath);
			}
			return;
		}

		// Intersection
		if (type.flags & ts.TypeFlags.Intersection) {
			for (const member of type.types) {
				walkType(member, typePath);
			}
			return;
		}

		// Object types (interfaces, classes, mapped types)
		if (type.flags & ts.TypeFlags.Object) {
			// Skip types whose own symbol is declared in node_modules or other
			// skipped paths (e.g. @langchain/core/documents Document type).
			const typeSym = type.getSymbol?.();
			if (typeSym) {
				const typeDecls = typeSym.declarations;
				if (typeDecls && typeDecls.length > 0 && isSkippedFile(typeDecls[0].getSourceFile().fileName)) {
					return;
				}
			}

			// Base types (extends) — only valid for interface/class types
			try {
				const baseTypes = checker.getBaseTypes(type);
				for (const base of baseTypes) {
					walkType(base, `${typePath}[base]`);
				}
			} catch {
				// not an interface/class type; skip
			}

			// Properties — skip private/protected members
			const properties = checker.getPropertiesOfType(type);
			for (const prop of properties) {
				if (isPrivateOrProtected(prop)) continue;
				const decls = prop.declarations;
				if (decls && decls.length > 0 && isSkippedFile(decls[0].getSourceFile().fileName)) {
					continue;
				}
				const propType = getSymbolType(checker, prop, decls?.[0] ?? sourceFile);
				walkType(propType, `${typePath}.${prop.name}`);
			}

			// Index signatures
			const stringIndexType = checker.getIndexTypeOfType(type, ts.IndexKind.String);
			if (stringIndexType) {
				walkType(stringIndexType, `${typePath}[string]`);
			}
			const numberIndexType = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
			if (numberIndexType) {
				walkType(numberIndexType, `${typePath}[number]`);
			}

			// Call signatures
			const callSigs = type.getCallSignatures();
			for (let i = 0; i < callSigs.length; i++) {
				const sig = callSigs[i];
				for (const param of sig.parameters) {
					if (isPrivateOrProtected(param)) continue;
					const paramDecl = param.declarations?.[0];
					if (paramDecl && isSkippedFile(paramDecl.getSourceFile().fileName)) continue;
					const paramType = getSymbolType(checker, param, paramDecl ?? sourceFile);
					walkType(paramType, `${typePath}(${param.name})`);
				}
				const ret = sig.getReturnType();
				walkType(ret, `${typePath}(=>)`);
			}

			// Construct signatures
			const constructSigs = type.getConstructSignatures();
			for (let i = 0; i < constructSigs.length; i++) {
				const sig = constructSigs[i];
				for (const param of sig.parameters) {
					if (isPrivateOrProtected(param)) continue;
					const paramDecl = param.declarations?.[0];
					if (paramDecl && isSkippedFile(paramDecl.getSourceFile().fileName)) continue;
					const paramType = getSymbolType(checker, param, paramDecl ?? sourceFile);
					walkType(paramType, `${typePath}.new(${param.name})`);
				}
			}

			// Type arguments (generics)
			const typeRef = type;
			if (typeRef.typeArguments) {
				for (let i = 0; i < typeRef.typeArguments.length; i++) {
					walkType(typeRef.typeArguments[i], `${typePath}<${i}>`);
				}
			}
		}
	}

	for (const exp of exports) {
		const decls = exp.declarations;
		if (decls && decls.length > 0 && isSkippedFile(decls[0].getSourceFile().fileName)) {
			continue;
		}
		const expType = getSymbolType(checker, exp, decls?.[0] ?? sourceFile);
		walkType(expType, exp.name);
	}

	return findings;
}

async function main() {
	const args = process.argv.slice(2);
	const isSelfTest = args.includes("--self-test");

	if (isSelfTest) {
		// Verify that a planted `any` is detected
		const findings = findAnyInDts(SELF_TEST_PATH, {
			[SELF_TEST_PATH]: FIXTURE_CONTENT,
		});
		if (findings.length === 0) {
			console.error("SELF-TEST FAILED: planted `any` was not detected");
			process.exit(1);
		}
		console.log(`Self-test passed: detected any at: ${findings.join(", ")}`);
		process.exit(0);
	}

	const dtsPath = path.join(projectRoot, "dist", "index.d.ts");
	const findings = findAnyInDts(dtsPath);

	if (findings.length === 0) {
		console.log("check-public-any: OK — no `any` found in dist/index.d.ts");
		process.exit(0);
	} else {
		console.error(`check-public-any: FAIL — found ${findings.length} occurrence(s) of \`any\`:`);
		for (const f of findings) {
			console.error(`  ${f}`);
		}
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
