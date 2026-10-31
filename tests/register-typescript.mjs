// Unit-test loader only. Production Next.js retains its server-only boundary.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {};', shortCircuit: true };
    }
    if (specifier === 'next/server' || specifier === 'next/headers') {
      return nextResolve(specifier + '.js', context);
    }
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error;
      for (const suffix of ['.ts', '.tsx', '/index.ts']) {
        try { return nextResolve(specifier + suffix, context); } catch { /* next candidate */ }
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (!/\.tsx?$/.test(url) || url.includes('/node_modules/')) return nextLoad(url, context);
    return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        fileName: new URL(url).pathname,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
  },
});
