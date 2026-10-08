import { InstagramError, instagramRequest } from "@/lib/instagram/client";
import type { InstagramSession } from "@/lib/instagram/types";
import { browserLoginStatus, cancelBrowserLogin, startBrowserLogin } from "@/lib/instagram/browser-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "Instagram login failed.", session: error instanceof InstagramError ? error.session : undefined }, { status: 400, headers });
}
export async function GET() {
  try { return Response.json(await browserLoginStatus(), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    let result: InstagramSession;
    if (body.action === "browser-login") {
      result = await startBrowserLogin();
    } else if (body.action === "cancel-browser") {
      await cancelBrowserLogin();
      result = await instagramRequest("status");
    } else if (body.action === "login") {
      if (typeof body.username !== "string" || !/^[a-z\d._]{1,30}$/i.test(body.username.trim().replace(/^@/, ""))) throw new Error("Enter your Instagram username.");
      if (typeof body.password !== "string" || !body.password || body.password.length > 1024) throw new Error("Enter your Instagram password.");
      result = await instagramRequest("login", { username: body.username.trim().replace(/^@/, "").toLowerCase(), password: body.password });
    } else if (body.action === "code") {
      if (typeof body.code !== "string" || !/^\d{6,10}$/.test(body.code.replace(/\s/g, ""))) throw new Error("Enter the verification code from Instagram.");
      result = await instagramRequest("code", { code: body.code.replace(/\s/g, "") });
    } else if (body.action === "retry" || body.action === "logout") {
      if (body.action === "logout") await cancelBrowserLogin(true);
      result = await instagramRequest(body.action);
    } else throw new Error("Choose a login action.");
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
}
