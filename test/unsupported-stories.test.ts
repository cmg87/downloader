import test from "node:test";
import assert from "node:assert/strict";

import { validateMediaUrl } from "../src/lib/url.ts";
import { POST as inspect } from "../src/app/api/inspect/route.ts";
import { POST as download } from "../src/app/api/jobs/route.ts";

test("Instagram story and highlight URLs are rejected by both endpoints", async () => {
  for (const url of [
    "https://www.instagram.com/stories/example/123/",
    "https://instagram.com/stories/example/",
    "https://www.instagram.com/stories/highlights/123/",
    "https://www.instagram.com/STORIES/example/123/?igsh=example",
    "https://www.instagram.com/%73tories/example/123/",
  ]) {
    assert.throws(() => validateMediaUrl(url), /Use the Instagram tab/);
    for (const endpoint of [inspect, download]) {
      const response = await endpoint(new Request("http://localhost/api/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, type: "video", quality: "best", format: "mp4", destination: "download" }),
      }));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /Use the Instagram tab/);
    }
  }
});

test("public posts, reels and other sites remain accepted", () => {
  for (const url of [
    "https://www.instagram.com/p/example/",
    "https://www.instagram.com/reel/example/",
    "https://www.youtube.com/watch?v=example",
    "https://x.com/example/status/123",
    "https://www.threads.com/@example/post/123",
    "https://example.com/stories/example/",
  ]) assert.equal(validateMediaUrl(url), url);
});
