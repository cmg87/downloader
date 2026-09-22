import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { Readable } from "node:stream";

import {
  getInternalDownloadJob,
  scheduleRetrievedFileCleanup,
} from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getInternalDownloadJob(id);

  if (
    !job ||
    job.status !== "complete" ||
    job.destination !== "download" ||
    !job.filePath
  ) {
    return Response.json({ error: "Download not found or expired." }, { status: 404 });
  }

  try {
    const fileInfo = await stat(job.filePath);
    const nodeStream = createReadStream(job.filePath);
    nodeStream.once("close", () => scheduleRetrievedFileCleanup(job));

    const filename = basename(job.filePath);
    const fallbackName = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    const stream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(fileInfo.size),
        "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "The prepared file is no longer available." }, { status: 404 });
  }
}
