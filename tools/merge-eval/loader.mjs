// Offline TypeScript execution using the project's existing compiler dependency.
import ts from 'typescript';
import { readFileSync } from 'node:fs';
export function resolve(specifier, context, next) {
	try {
		return next(specifier, context);
	} catch (error) {
		if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier))
			return next(`${specifier}.ts`, context);
		throw error;
	}
}
export function load(url, context, next) {
	if (!url.endsWith('.ts')) return next(url, context);
	return {
		format: 'module',
		shortCircuit: true,
		source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
			compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
		}).outputText
	};
}
