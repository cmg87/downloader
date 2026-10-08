import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Guard rail for the acceptance criterion "no credentials appear in logs or
// committed artifacts". This scans the working tree (excluding build output and
// dependencies) for real credential shapes and asserts the ignore rules that
// keep cookie files out of the repository.

const root = fileURLToPath(new URL("..", import.meta.url));

const SKIP_DIRS = new Set([".git", ".next", "node_modules", "out", "build"]);

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

const files = walk(root);

// A Netscape cookie jar has tab-separated rows with a TRUE/FALSE flag.
const NETSCAPE_ROW = /\t(?:TRUE|FALSE)\t/;
const NETSCAPE_HEADER = /^# (?:Netscape )?HTTP Cookie File/m;
// Instagram's session cookie value is a long opaque token.
const SESSION_COOKIE = /sessionid=[A-Za-z0-9%_:-]{20,}/;

test("no Netscape cookie jars or live session tokens are present in the repo", () => {
  const offenders: string[] = [];
  for (const file of files) {
    const name = relative(root, file);
    // Test fixtures/docs intentionally mention the words; only scan for values.
    const text = readFileSync(file, "utf8");
    if (NETSCAPE_HEADER.test(text) || NETSCAPE_ROW.test(text) || SESSION_COOKIE.test(text)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, [], `possible credential material in: ${offenders.join(", ")}`);
});

test("cookie files are ignored by git", () => {
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /cookies?\*?\.txt/);
  assert.match(ignore, /\.cookies\.txt/);
});

test("a present app.log never records a cookie value", () => {
  const logPath = join(root, "app.log");
  let text: string;
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return; // no log file on this machine — nothing to leak
  }
  assert.doesNotMatch(text, SESSION_COOKIE);
  assert.doesNotMatch(text, NETSCAPE_ROW);
});

// Keep statSync used so an empty-tree regression is visible rather than silent.
test("the scan actually found source files", () => {
  assert.ok(files.some((file) => file.endsWith("jobs.ts")));
  assert.ok(files.some((file) => statSync(file).isFile()));
});
