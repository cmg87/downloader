import test from "node:test";
import assert from "node:assert/strict";

// Smoke check that the alias loader makes app modules importable under
// `node --test`. Kept tiny; the real flow suites live in media-flow.test.ts.
test("the @/ alias resolves app modules for node --test", async () => {
  const jobs = await import("@/lib/jobs.ts");
  assert.equal(typeof jobs.createDownloadJob, "function");
  assert.equal(typeof jobs.getDownloadJob, "function");
});
