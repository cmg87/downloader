import { getDownloadJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getDownloadJob(id);

  if (!job) {
    return Response.json({ error: "Job not found or expired." }, { status: 404 });
  }

  return Response.json(job, {
    headers: { "Cache-Control": "no-store" },
  });
}
