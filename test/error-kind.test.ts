import { test } from "node:test";
import assert from "node:assert/strict";

import {
  YtDlpError,
  classifyYtDlpError,
  classifyYtDlpErrorKind,
  errorKindOf,
  ytDlpErrorMessage,
} from "../src/lib/error-kind.ts";

// Real stderr captured from the reproduced anonymous site media failure
// (no cookies supplied). Authentication must be distinguishable from a media
// that is genuinely unavailable/expired.
const ANON_STORY = [
  "ERROR: [generic] 3100000000000000000: Downloading webpage",
  "ERROR: [generic] 3100000000000000000: This content is unreachable.",
  "  Use --cookies-from-browser or --cookies for the authentication.",
].join("\n");

test("anonymous media failure classifies as auth, not unavailable", () => {
  assert.equal(classifyYtDlpErrorKind(ANON_STORY), "auth");

  const error = classifyYtDlpError(ANON_STORY);
  assert.ok(error instanceof YtDlpError);
  assert.equal(error.kind, "auth");
  assert.match(error.message, /requires a login/i);

  // The auth message must differ from the unavailable message.
  assert.notEqual(error.message, ytDlpErrorMessage("unavailable", ANON_STORY));
  assert.doesNotMatch(error.message, /expired/i);
});

test("rejected / expired session still classifies as auth", () => {
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] Login required"), "auth");
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] You need to log in to view this"), "auth");
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] authentication failed"), "auth");
});

test("an explicitly expired stored session is its own kind with login guidance", () => {
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] cookies expired"), "session-expired");
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] session expired, log in again"), "session-expired");
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] login session invalid"), "session-expired");

  const error = classifyYtDlpError("ERROR: [generic] cookies expired");
  assert.equal(error.kind, "session-expired");
  assert.match(error.message, /current login/i);
  assert.match(error.message, /publicly accessible/i);
  // Never the generic "pick a browser" auth text, nor an off-limits bypass.
  assert.notEqual(error.message, ytDlpErrorMessage("auth", ""));
});

test("a login challenge is its own kind and is never bypassed by the app", () => {
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] challenge_required"), "challenge");
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] checkpoint reached"), "challenge");
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] Confirm your identity to continue"), "challenge");

  const error = classifyYtDlpError("ERROR: [generic] challenge_required");
  assert.equal(error.kind, "challenge");
  assert.match(error.message, /identity check/i);
  assert.match(error.message, /cannot be downloaded/i);
});

test("throttling and transport failures are distinct from a bad session", () => {
  assert.equal(classifyYtDlpErrorKind("ERROR: HTTP Error 429: Too Many Requests"), "rate-limit");
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] rate limit reached, try again later"), "rate-limit");
  assert.match(ytDlpErrorMessage("rate-limit", "HTTP Error 429"), /rate-limiting|too many requests/i);

  assert.equal(classifyYtDlpErrorKind("ERROR: Unable to connect: connection refused"), "network");
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] HTTPSConnectionPool Read timed out"), "network");
  assert.equal(classifyYtDlpErrorKind("ERROR: [Errno -3] Temporary failure in name resolution"), "network");
  assert.match(ytDlpErrorMessage("network", "connection refused"), /network|connection/i);
});

test("genuinely unavailable / expired / private media classifies as unavailable", () => {
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] This media is no longer available"), "unavailable");
  assert.equal(classifyYtDlpErrorKind("ERROR: [youtube] xyz: Video unavailable"), "unavailable");
  assert.equal(classifyYtDlpErrorKind("ERROR: [youtube] abc: This video has been removed"), "unavailable");
  assert.equal(classifyYtDlpErrorKind("ERROR: [generic] The requested content does not exist"), "unavailable");
  assert.equal(classifyYtDlpErrorKind("ERROR: Private video"), "unavailable");
  assert.match(ytDlpErrorMessage("unavailable", "video unavailable"), /unavailable or has expired/i);
  assert.match(ytDlpErrorMessage("unavailable", "private video"), /private/i);
});

test("unsupported URLs and extractors classify as unsupported", () => {
  assert.equal(classifyYtDlpErrorKind("ERROR: Unsupported URL: https://example.com/x"), "unsupported");
  assert.equal(classifyYtDlpErrorKind("ERROR: No suitable extractor found"), "unsupported");
  assert.match(ytDlpErrorMessage("unsupported", ""), /not supported/i);
});

test("filesystem / ffmpeg failures classify as output", () => {
  assert.equal(classifyYtDlpErrorKind("ERROR: ffmpeg not found. Please install ffmpeg"), "output");
  assert.equal(classifyYtDlpErrorKind("ERROR: ffmpeg error while merging formats"), "output");
  assert.equal(classifyYtDlpErrorKind("ERROR: No space left on device"), "output");
  assert.equal(classifyYtDlpErrorKind("ERROR: [Errno 13] Permission denied"), "output");
});

test("unrecognized stderr falls back to unknown", () => {
  assert.equal(classifyYtDlpErrorKind("ERROR: something completely unexpected"), "unknown");
  assert.equal(classifyYtDlpErrorKind(""), "unknown");
});

test("errorKindOf reads only classified yt-dlp errors", () => {
  assert.equal(errorKindOf(classifyYtDlpError(ANON_STORY)), "auth");
  assert.equal(errorKindOf(new Error("plain failure")), undefined);
  assert.equal(errorKindOf("not an error"), undefined);
});
