import test from "node:test";
import assert from "node:assert/strict";

import {
  buildYtDlpArgs,
  MAX_FILENAME_SEGMENT,
  OUTPUT_TEMPLATE,
  sanitizeFileSegment,
} from "../src/lib/download-args.ts";
import type { CreateJobInput } from "../src/lib/types.ts";

function input(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    url: "https://example.com/media/3100000000000000000",
    type: "image",
    format: "original",
    destination: "server",
    ...overrides,
  };
}

test("sanitized names drop path separators and reserved punctuation", () => {
  const name = sanitizeFileSegment("../../etc/passwd\\..\\media:name*?");
  assert.ok(!name.includes("/"), "must not contain a slash");
  assert.ok(!name.includes("\\"), "must not contain a backslash");
  assert.ok(!/[<>:"|?*]/.test(name), "must not contain reserved punctuation");
  assert.ok(!name.includes(".."), "must not contain a traversal segment");
});

test("sanitized names collapse whitespace, trim and cap length", () => {
  assert.equal(sanitizeFileSegment("  hello   world  "), "hello world");
  assert.equal(sanitizeFileSegment("a".repeat(500)).length, MAX_FILENAME_SEGMENT);
  assert.equal(sanitizeFileSegment("..."), "");
  assert.equal(sanitizeFileSegment("a.b.c"), "a.b.c");
});

test("the output template is id-tagged so different items cannot collide", () => {
  assert.ok(OUTPUT_TEMPLATE.includes("%(id)s"), "template must include the media id");
  assert.ok(OUTPUT_TEMPLATE.includes("%(ext)s"), "template must preserve the extension");
  assert.ok(OUTPUT_TEMPLATE.includes("%(title)s"));
});

test("re-downloads cannot silently clobber the persistent server directory", () => {
  const args = buildYtDlpArgs(input(), "/home/me/Videos/Downloader/%(title)s [%(id)s].%(ext)s");
  assert.ok(args.includes("--no-overwrites"));
  // The filename length cap keeps media titles from producing over-long paths.
  assert.equal(args[args.indexOf("--trim-filenames") + 1], "180");
});

test("different media items produce different playlist selections", () => {
  const first = buildYtDlpArgs(input({ itemIndex: 1 }), "/tmp/%(id)s.%(ext)s");
  const second = buildYtDlpArgs(input({ itemIndex: 2 }), "/tmp/%(id)s.%(ext)s");
  assert.equal(first[first.indexOf("--playlist-items") + 1], "1");
  assert.equal(second[second.indexOf("--playlist-items") + 1], "2");
});
