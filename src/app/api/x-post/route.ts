import { getXPost } from "@/lib/x-post";
import { validateMediaUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { url?: unknown };
    const post = await getXPost(validateMediaUrl(body.url));
    return Response.json(post, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read this X post." }, { status: 400 });
  }
}
