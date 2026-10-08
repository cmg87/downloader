import { createCopyXJob } from "@/lib/jobs";
import { parsePostOptions } from "@/lib/post-options";
import { validateMediaUrl } from "@/lib/url";
import { xPostId } from "@/lib/x-fallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const url = validateMediaUrl(body.url);
    if (!xPostId(url)) throw new Error("Paste a link to an X post first.");
    if (body.destination !== "download" && body.destination !== "server") {
      throw new Error("Choose Download or Save.");
    }
    const options = parsePostOptions(body.options);
    const job = createCopyXJob(url, options, body.destination);
    return Response.json(job, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not start this post export." }, { status: 400 });
  }
}
