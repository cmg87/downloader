import { InstagramError, instagramRequest } from "@/lib/instagram/client";
import { parseInstagramTarget } from "@/lib/instagram/url";
import type { InstagramMedia } from "@/lib/instagram/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const target = parseInstagramTarget(body.url);
    const result = await instagramRequest<InstagramMedia>("inspect", { target });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read Instagram media.", session: error instanceof InstagramError ? error.session : undefined }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
