// node-builtins.d.ts -- the two Node APIs the source-reading tests need
// ======================================================================
// A couple of tests in this project read a source file as TEXT rather than
// rendering it -- App.css.test.ts checks that both themes declare the same
// tokens, the same way test_explain_costs.py reads the TypeScript registry
// from Python. Reading is the point: a variable declared in one theme and
// forgotten in the other is invisible to anything that renders.
//
// WHY NOT JUST INSTALL @types/node?
// ---------------------------------
// Because it is not free. @types/node redefines the global `setTimeout` to
// return `NodeJS.Timeout` instead of `number`, and three files here type
// their timer refs as `number` (ExportPanel, GenerationPanel,
// useProjectUiState). Installing it to satisfy one test would put type
// errors in unrelated production code, and the natural "fix" for those is to
// loosen types that are currently correct for the browser this app runs in.
//
// So: declare exactly what is used, nothing more. Vitest runs on Node, so the
// implementations are really there at runtime; this file only tells the type
// checker so. If a test ever needs more of Node than this, add the one
// function -- do not reach for the whole package.
//
// This file has no top-level import or export ON PURPOSE. That is what keeps
// it a global declaration file; add one and these become module
// augmentations of modules that do not exist, and every line below errors.

declare module "node:fs" {
  /** Read a whole file as a string. Only the encoding overload is used. */
  export function readFileSync(path: string, encoding: "utf-8"): string;
}

declare module "node:path" {
  /** Join path segments into an absolute path. */
  export function resolve(...segments: string[]): string;
}

/** Only `cwd()` is used, to anchor a read at the Vitest project root. */
declare const process: { cwd(): string };
