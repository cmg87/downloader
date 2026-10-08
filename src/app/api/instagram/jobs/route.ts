import { createInstagramJob } from "@/lib/jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.inspectionId !== "string" || !/^[a-f\d-]{36}$/i.test(body.inspectionId)) throw new Error("Inspect an Instagram link first.");
    if (!Array.isArray(body.itemIds) || !body.itemIds.length || body.itemIds.length > 100 || body.itemIds.some((id) => typeof id !== "string" || !/^\d{1,4}$/.test(id))) throw new Error("Select the items to download.");
    if (body.destination !== "download" && body.destination !== "server") throw new Error("Choose Download or Save.");
    const job = createInstagramJob({ inspectionId: body.inspectionId, itemIds: [...new Set(body.itemIds)] }, body.destination);
    return Response.json(job, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not start this Instagram download." }, { status: 400 });
  }
}
