import { errorKindOf, inspectMedia } from "@/lib/yt-dlp";
import { validateMediaUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: unknown };
    const url = validateMediaUrl(body.url);
    const capabilities = await inspectMedia(url);
    return Response.json(capabilities);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to inspect this URL.";
    return Response.json({ error: message, errorKind: errorKindOf(error) }, { status: 400 });
  }
}
