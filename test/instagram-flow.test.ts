import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import { parseInstagramTarget } from "../src/lib/instagram/url.ts";

function request(body: unknown) {
  return new Request("http://localhost/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("Instagram input supports posts, reels, profiles and individual/current stories", () => {
  assert.deepEqual(parseInstagramTarget("https://www.instagram.com/p/ABC_def/?igsh=ignored"), { kind: "post", shortcode: "ABC_def" });
  assert.deepEqual(parseInstagramTarget("https://instagram.com/reel/video/"), { kind: "post", shortcode: "video" });
  assert.deepEqual(parseInstagramTarget("@example"), { kind: "stories", username: "example" });
  assert.deepEqual(parseInstagramTarget("https://www.instagram.com/example/"), { kind: "stories", username: "example" });
  assert.deepEqual(parseInstagramTarget("https://www.instagram.com/stories/example/102/"), { kind: "stories", username: "example", mediaId: "102" });
  for (const invalid of ["https://instagram.com.evil.test/p/example", "https://example.com/p/example", "https://name:pass@instagram.com/p/example", "https://instagram.com/stories/example/not-id/", "https://instagram.com/accounts/", "file:///p/abc", "https://instagram.com/stories/highlights/123/", "@", "https://instagram.com/p/abc/more/"]) {
    assert.throws(() => parseInstagramTarget(invalid));
  }
});

test("Instagram API → real Python protocol → jobs → original downloadable files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "instagram-flow-"));
  process.env.MEDIA_DOWNLOADER_INSTAGRAM_DIR = join(root, "session");
  process.env.MEDIA_DOWNLOADER_SAVE_DIR = join(root, "saves");
  process.env.MEDIA_DOWNLOADER_INSTAGRAM_PYTHON = "python3";
  process.env.PYTHONPATH = resolve("test/fixtures/instagram");
  process.env.PYTHONDONTWRITEBYTECODE = "1";
  const session = await import("../src/app/api/instagram/session/route.ts");
  const inspect = await import("../src/app/api/instagram/inspect/route.ts");
  const jobs = await import("../src/app/api/instagram/jobs/route.ts");
  const { getDownloadJob, getInternalDownloadJob } = await import("../src/lib/jobs.ts");
  const { GET: file } = await import("../src/app/api/jobs/[id]/file/route.ts");
  const bridge = globalThis as typeof globalThis & { __instagramBridge?: { child: ChildProcess } };
  t.after(async () => { bridge.__instagramBridge?.child.kill(); await rm(root, { recursive: true, force: true }); });
  assert.deepEqual(await (await session.GET()).json(), { state: "disconnected" });
  const publicResponse = await inspect.POST(request({ url: "https://instagram.com/p/photo/" }));
  assert.equal(publicResponse.status, 200);
  const publicPhoto = await publicResponse.json();
  const publicJob = await jobs.POST(request({ inspectionId: publicPhoto.id, itemIds: ["1"], destination: "server" }));
  const publicSaved = await finish((await publicJob.json()).id);
  assert.equal(publicSaved.status, "complete", publicSaved.error);
  assert.equal(await readFile(publicSaved.savedPath!, "utf8"), "original-media-bytes");
  assert.deepEqual(await (await session.GET()).json(), { state: "disconnected" });
  const unavailableStory = await inspect.POST(request({ url: "@example" }));
  assert.equal(unavailableStory.status, 400);
  assert.match((await unavailableStory.json()).error, /Stories require/);
  assert.equal((await session.POST(request({ action: "login", username: "example", password: "" }))).status, 400);
  assert.equal((await jobs.POST(request({ inspectionId: "bad", itemIds: ["1"], destination: "download" }))).status, 400);
  const pending = await session.POST(request({ action: "login", username: "verify", password: "fake-password" }));
  assert.equal((await pending.json()).state, "code-required");
  const wrong = await session.POST(request({ action: "code", code: "000000" }));
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).session.state, "code-required");
  const connected = await session.POST(request({ action: "code", code: "123456" }));
  assert.deepEqual(await connected.json(), { state: "connected", username: "verify" });
  const saved = await readFile(join(root, "session/session.json"), "utf8");
  assert.doesNotMatch(saved, /fake-password|password|123456/);
  // Restart only the bridge, then read status: persisted session loads without credentials.
  const previous = bridge.__instagramBridge!.child;
  previous.kill();
  await new Promise<void>((resolve) => previous.once("close", resolve));
  assert.deepEqual(await (await session.GET()).json(), { state: "connected", username: "verify" });
  const inspected = await inspect.POST(request({ url: "https://instagram.com/p/album/" }));
  assert.equal(inspected.status, 200);
  const album = await inspected.json();
  assert.deepEqual(album.items.map((item: { type: string }) => item.type), ["image", "video"]);
  assert.doesNotMatch(JSON.stringify(album), /cookies|fake_session|filePath/);
  const download = await jobs.POST(request({ inspectionId: album.id, itemIds: ["1", "2"], destination: "download" }));
  assert.equal(download.status, 202);
  const created = await download.json();
  async function finish(id: string) {
    for (let count = 0; count < 100; count++) {
      const job = getDownloadJob(id)!;
      if (job.status === "complete" || job.status === "error") return job;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Job did not finish");
  }
  const ready = await finish(created.id);
  assert.equal(ready.status, "complete", ready.error);
  assert.ok(ready.filename?.endsWith(".zip"));
  assert.equal(ready.fileUrl, `/api/jobs/${created.id}/file`);
  assert.equal(ready.savedPath, undefined);
  const response = await file(new Request(`http://localhost${ready.fileUrl}`), { params: Promise.resolve({ id: created.id }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Disposition")!, /attachment/);
  const zip = Buffer.from(await response.arrayBuffer());
  assert.equal(zip.subarray(0, 2).toString(), "PK");
  const story = await (await inspect.POST(request({ url: "https://instagram.com/stories/example/102/" }))).json();
  const pc = await jobs.POST(request({ inspectionId: story.id, itemIds: ["1"], destination: "server" }));
  const savedJob = await finish((await pc.json()).id);
  assert.equal(savedJob.status, "complete", savedJob.error);
  assert.ok(savedJob.savedPath?.endsWith(".mp4"));
  assert.equal(await readFile(savedJob.savedPath!, "utf8"), "original-media-bytes");
  assert.equal(savedJob.fileUrl, undefined);
  const arbitrary = await jobs.POST(request({ inspectionId: album.id, itemIds: ["99"], destination: "download" }));
  assert.equal((await finish((await arbitrary.json()).id)).status, "error");
  assert.deepEqual(await (await session.POST(request({ action: "logout" }))).json(), { state: "disconnected" });
  assert.equal((await inspect.POST(request({ url: "@example" }))).status, 400);
  const challenge = await session.POST(request({ action: "login", username: "checkpoint", password: "fake-password" }));
  const challengeState = await challenge.json();
  assert.equal(challengeState.state, "challenge");
  assert.equal(challengeState.challengeUrl, "https://www.instagram.com/challenge/123/");
  assert.equal((await (await session.POST(request({ action: "retry" }))).json()).state, "connected");
  const internal = getInternalDownloadJob(created.id);
  if (internal?.filePath) await rm(join(internal.filePath, ".."), { recursive: true, force: true });
});
