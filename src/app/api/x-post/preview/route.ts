import { parsePostOptions } from "@/lib/post-options";
import { renderPostImage } from "@/lib/post-render";
import { getXPost } from "@/lib/x-post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (!id || !/^\d{10,25}$/.test(id)) throw new Error("Choose a valid X post first.");
    const options = parsePostOptions({
      ratio: params.get("ratio"),
      theme: params.get("theme"),
      background: params.get("background"),
      showDate: params.get("showDate") !== "false",
      showMetrics: params.get("showMetrics") !== "false",
      output: params.get("output"),
    });
    const post = await getXPost(`https://x.com/i/status/${id}`);
    const { png } = await renderPostImage(post, options);
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not render this post." }, { status: 400 });
  }
}
