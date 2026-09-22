const MAX_URL_LENGTH = 4_096;

export function validateMediaUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Paste a media URL to continue.");
  }

  const rawUrl = value.trim();
  if (rawUrl.length > MAX_URL_LENGTH) {
    throw new Error("That URL is too long.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Enter a complete URL, including https://.");
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error("Only http:// and https:// URLs are supported.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs containing embedded usernames or passwords are not supported.");
  }

  return parsed.toString();
}
