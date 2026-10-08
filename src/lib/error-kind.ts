import type { JobErrorKind } from "./types";

/**
 * Pure yt-dlp error classification. Kept in its own alias-free module so it can
 * be unit-tested with `node --test` (the `@/` alias does not resolve there).
 * `src/lib/yt-dlp.ts` re-exports everything here.
 */

export class YtDlpError extends Error {
  readonly kind: JobErrorKind;

  constructor(kind: JobErrorKind, message: string) {
    super(message);
    this.name = "YtDlpError";
    this.kind = kind;
  }
}

/**
 * Map yt-dlp stderr to a coarse error kind.
 *
 * Order matters. Security challenges, expiry, throttling and transport
 * failures are checked *before* the generic auth bucket so the cause is not
 * collapsed into one message, and all of them are checked before
 * "unavailable" so a rejected/expired session is never reported as
 * "media deleted".
 */
export function classifyYtDlpErrorKind(stderr: string): JobErrorKind {
  const message = stderr.toLowerCase();

  if (message.includes("unsupported url") || message.includes("no suitable extractor")) {
    return "unsupported";
  }

  // A login challenge/checkpoint is a *human* step: it must not be retried
  // blindly and must never be bypassed by the app.
  if (
    message.includes("challenge_required") ||
    message.includes("challenge required") ||
    message.includes("checkpoint") ||
    message.includes("confirm your identity") ||
    message.includes("verify your identity") ||
    message.includes("unusual login") ||
    message.includes("suspicious login")
  ) {
    return "challenge";
  }

  // The site explicitly reports an expired/rejected session.
  if (
    message.includes("expired") ||
    (message.includes("session") && message.includes("invalid"))
  ) {
    return "session-expired";
  }

  // Throttling: wait, then retry — distinct from a bad session.
  if (
    message.includes("rate limit") ||
    message.includes("rate-limit") ||
    message.includes("too many requests") ||
    message.includes("http error 429") ||
    message.includes("429 too many") ||
    message.includes("going too fast") ||
    message.includes("try again later")
  ) {
    return "rate-limit";
  }

  // The request never reached the site.
  if (
    message.includes("connection refused") ||
    message.includes("connection reset") ||
    message.includes("connection aborted") ||
    message.includes("unable to connect") ||
    message.includes("temporary failure in name resolution") ||
    message.includes("name or service not known") ||
    message.includes("getaddrinfo") ||
    message.includes("network is unreachable") ||
    message.includes("failed to establish") ||
    message.includes("remote end closed connection") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("ssl") ||
    message.includes("certificate")
  ) {
    return "network";
  }

  if (
    message.includes("sign in") ||
    message.includes("log in") ||
    message.includes("logged in") ||
    message.includes("login required") ||
    message.includes("login") ||
    message.includes("cookies") ||
    message.includes("authentication") ||
    message.includes("authorization")
  ) {
    return "auth";
  }

  if (
    message.includes("private video") ||
    message.includes("private content") ||
    message.includes("video unavailable") ||
    message.includes("has been removed") ||
    message.includes("deleted") ||
    message.includes("no longer available") ||
    message.includes("is not available") ||
    message.includes("does not exist")
  ) {
    return "unavailable";
  }

  if (message.includes("no video formats") || message.includes("requested format is not available")) {
    return "unavailable";
  }

  if (message.includes("no video could be found in this tweet")) {
    return "unavailable";
  }

  if (
    (message.includes("ffmpeg") && (message.includes("not found") || message.includes("error"))) ||
    message.includes("no space left") ||
    message.includes("permission denied") ||
    message.includes("read-only file system")
  ) {
    return "output";
  }

  return "unknown";
}

/**
 * Friendly, user-facing message for a classified error. `stderr` is used only
 * to pick between sub-cases of a kind; it is never surfaced verbatim.
 */
export function ytDlpErrorMessage(kind: JobErrorKind, stderr: string): string {
  const message = stderr.toLowerCase();

  switch (kind) {
    case "auth":
      return "This content requires a login. Only publicly accessible media is supported.";
    case "session-expired":
      return "The site requires a current login. Only publicly accessible media is supported.";
    case "challenge":
      return "The site requires an identity check. This content cannot be downloaded here.";
    case "rate-limit":
      return "The site is rate-limiting this PC. Wait a few minutes, then try again.";
    case "network":
      return "Couldn't reach the site. Check this PC’s internet connection and try again.";
    case "unsupported":
      return "This URL is not supported by yt-dlp.";
    case "unavailable":
      if (message.includes("private video") || message.includes("private content")) {
        return "This media is private and cannot be downloaded.";
      }
      if (message.includes("no video formats") || message.includes("requested format is not available")) {
        return "No usable formats were found for this media.";
      }
      if (message.includes("no video could be found in this tweet")) {
        return "X did not provide a video for this post. It may be restricted, unavailable, or temporarily inaccessible.";
      }
      return "This media is unavailable or has expired.";
    case "output":
      return "yt-dlp could not produce the file. Check that ffmpeg is installed and the output location is writable.";
    default:
      return "yt-dlp could not inspect this URL.";
  }
}

/** Extract the kind from an error produced by {@link classifyYtDlpError}. */
export function errorKindOf(error: unknown): JobErrorKind | undefined {
  return error instanceof YtDlpError ? error.kind : undefined;
}

/** Build a classified, user-facing error in one step. */
export function classifyYtDlpError(stderr: string): YtDlpError {
  const kind = classifyYtDlpErrorKind(stderr);
  return new YtDlpError(kind, ytDlpErrorMessage(kind, stderr));
}
