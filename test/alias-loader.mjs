// Module resolve hook for the `node --test` suites.
//
// The app sources import through the Next.js path alias `@/` (see tsconfig
// `paths`). Node's built-in test runner has no notion of that alias, so this
// hook rewrites `@/foo` to `<repo>/src/foo(.ts|.tsx|.js)` and redirects the one
// JSX/`next/og` module (post-render) to a lightweight stub. That lets the job
// pipeline be imported and exercised with real `node --test` without a Next
// build. Production code and the alias-free libs are untouched.

import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const root = resolvePath(testDir, "..");
const srcDir = resolvePath(root, "src");

// Modules that cannot be type-stripped / must not load under plain node ES
// modules: `.tsx` JSX (post-render pulls in `next/og`). Stub them for tests.
const STUBS = {
  "lib/post-render": resolvePath(testDir, "stubs", "post-render.mjs"),
};

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolveAlias(specifier) {
  const relative = specifier.slice(2); // strip "@/"
  const stubbed = STUBS[relative];
  if (stubbed) return stubbed;

  const base = resolvePath(srcDir, relative);
  return firstExisting([
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    resolvePath(base, "index.ts"),
    resolvePath(base, "index.tsx"),
  ]);
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = resolveAlias(specifier);
    if (target) {
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
