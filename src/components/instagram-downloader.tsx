"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { InstagramMedia, InstagramSession } from "@/lib/instagram/types";
import type { DownloadDestination, DownloadJob } from "@/lib/types";
import { ErrorNotice, JobProgress } from "@/components/downloader";

interface ApiError { error?: string; session?: InstagramSession }

export function InstagramDownloader({ active }: { active: boolean }) {
  const [url, setUrl] = useState("");
  const [session, setSession] = useState<InstagramSession>();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [media, setMedia] = useState<InstagramMedia>();
  const [selected, setSelected] = useState<string[]>([]);
  const [job, setJob] = useState<DownloadJob>();
  const downloaded = useRef<string | undefined>(undefined);
  const initialized = useRef(false);
  const jobActive = Boolean(job && ["queued", "downloading", "processing"].includes(job.status));
  const jobId = job?.id;

  useEffect(() => {
    if (!active || initialized.current) return;
    initialized.current = true;
    fetch("/api/instagram/session", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as InstagramSession & ApiError;
        if (!response.ok) throw new Error(data.error ?? "Could not load Instagram login.");
        setSession(data);
      })
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : "Could not load Instagram login."); setSession({ state: "disconnected" }); });
  }, [active]);

  useEffect(() => {
    if (session?.state !== "browser-login") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function checkLogin() {
      try {
        const response = await fetch("/api/instagram/session", { cache: "no-store" });
        const data = await response.json() as InstagramSession & ApiError;
        if (!response.ok) throw new Error(data.error ?? "Could not check Instagram login.");
        if (cancelled) return;
        setSession(data);
        if (data.state === "connected") { setPassword(""); setCode(""); setError(undefined); }
        if (data.state === "browser-login") timer = setTimeout(checkLogin, 2000);
      } catch (reason) {
        if (!cancelled) { setError(reason instanceof Error ? reason.message : "Could not check Instagram login."); timer = setTimeout(checkLogin, 3000); }
      }
    }
    timer = setTimeout(checkLogin, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session?.state]);

  useEffect(() => {
    if (!jobId || !jobActive) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const data = await response.json() as DownloadJob & ApiError;
        if (!response.ok) throw new Error(data.error ?? "Could not check download progress.");
        if (cancelled) return;
        setJob(data);
        if (data.status === "error") {
          const statusResponse = await fetch("/api/instagram/session", { cache: "no-store" });
          if (statusResponse.ok && !cancelled) setSession(await statusResponse.json() as InstagramSession);
        }
        if (["queued", "downloading", "processing"].includes(data.status)) timer = setTimeout(poll, 1000);
      } catch (reason) {
        if (!cancelled) { setError(reason instanceof Error ? reason.message : "Could not check progress."); timer = setTimeout(poll, 3000); }
      }
    }
    timer = setTimeout(poll, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, jobActive]);

  useEffect(() => {
    if (job?.status !== "complete" || job.destination !== "download" || !job.fileUrl || downloaded.current === job.id) return;
    downloaded.current = job.id;
    const link = document.createElement("a");
    link.href = job.fileUrl;
    link.download = job.filename ?? "Instagram";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [job]);

  async function loginAction(action: "login" | "code" | "retry" | "logout" | "browser-login" | "cancel-browser") {
    if (busy || jobActive) return;
    setBusy(true);
    setLoginBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/instagram/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, username, password, code }),
      });
      const data = await response.json() as InstagramSession & ApiError;
      if (data.session) setSession(data.session);
      if (!response.ok) throw new Error(data.error ?? "Instagram login failed.");
      setSession(data);
      setCode("");
      setPassword("");
      if (action === "logout" || data.state === "connected") { setMedia(undefined); setJob(undefined); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Instagram login failed."); }
    finally { setBusy(false); setLoginBusy(false); }
  }

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || jobActive) return;
    setBusy(true); setError(undefined); setMedia(undefined); setJob(undefined);
    try {
      const response = await fetch("/api/instagram/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await response.json() as InstagramMedia & ApiError;
      if (data.session) setSession(data.session);
      if (!response.ok) throw new Error(data.error ?? "Could not read Instagram media.");
      setMedia(data); setSelected(data.items.map((item) => item.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read Instagram media."); }
    finally { setBusy(false); }
  }

  async function download(destination: DownloadDestination) {
    if (!media || busy || jobActive || !selected.length) return;
    setBusy(true); setError(undefined); setJob(undefined);
    try {
      const response = await fetch("/api/instagram/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inspectionId: media.id, itemIds: selected, destination }) });
      const data = await response.json() as DownloadJob & ApiError;
      if (!response.ok) throw new Error(data.error ?? "Could not start the download.");
      setJob(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start the download."); }
    finally { setBusy(false); }
  }

  return (
    <div className="app-frame">
      <header className="brand-block">
        <div className="brand-mark" aria-hidden="true"><Image src="/icons/app-mark.png" alt="" width={48} height={48} /></div>
        <div><p className="eyebrow">Photos · Videos · Stories</p><h1>Instagram</h1></div>
      </header>
      <form className="url-form" onSubmit={inspect}>
        <label className="sr-only" htmlFor="instagram-url">Instagram link or @username for stories</label>
        <input id="instagram-url" placeholder="Instagram link or @username…" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={url} onChange={(event) => { setUrl(event.target.value); setMedia(undefined); setJob(undefined); }} disabled={busy || jobActive} required />
        <button className="inspect-button" type="submit" aria-label="Inspect Instagram link" disabled={busy || jobActive || !url.trim()}>
          {busy ? <span className="spinner" /> : <Image src="/icons/inspect.png" alt="" width={26} height={26} />}
        </button>
      </form>

      <section className="instagram-login" aria-label="Instagram account" aria-live="polite">
        {!session && <p>Loading saved login…</p>}
        {session?.state === "connected" && <div className="instagram-account"><span>Logged in as <strong>@{session.username}</strong></span><button type="button" className="choice-button" onClick={() => void loginAction("logout")} disabled={busy || jobActive}>Sign out</button></div>}
        {session?.state === "disconnected" && <div className="instagram-login-form">
          <button type="button" className="instagram-submit" disabled={busy || jobActive} onClick={() => void loginAction("browser-login")}>{loginBusy ? "Opening Instagram…" : "Log in with Instagram"}</button>
          <p>Optional for public posts and reels. Stories need login. Opens Instagram on this PC.</p>
          <details><summary>Use username and password instead</summary><form className="instagram-login-form" onSubmit={(event) => { event.preventDefault(); void loginAction("login"); }}>
          <label htmlFor="instagram-username">Instagram username</label>
          <input id="instagram-username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} required />
          <label htmlFor="instagram-password">Password</label>
          <input id="instagram-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required />
          <button type="submit" className="instagram-submit" disabled={busy}>{loginBusy ? "Logging in…" : "Log in"}</button>
        </form></details></div>}
        {session?.state === "browser-login" && <div className="instagram-login-form">
          <p>Finish signing in in the Instagram window on this PC. Enter any codes there. This tab connects automatically when the session is validated.</p>
          {session.message && <p role="status">{session.message}</p>}
          <button type="button" className="choice-button" disabled={busy || jobActive} onClick={() => void loginAction("browser-login")}>Show Instagram window</button>
          <button type="button" className="choice-button" disabled={busy || jobActive} onClick={() => void loginAction("cancel-browser")}>Cancel login</button>
        </div>}
        {session?.state === "code-required" && <form className="instagram-login-form" onSubmit={(event) => { event.preventDefault(); void loginAction("code"); }}>
          <label htmlFor="instagram-code">Enter Instagram’s verification code for @{session.username}</label>
          <input id="instagram-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} required />
          <button type="submit" className="instagram-submit" disabled={busy}>{busy ? "Verifying…" : "Verify code"}</button>
          <button type="button" className="choice-button" onClick={() => void loginAction("logout")} disabled={busy}>Cancel login</button>
        </form>}
        {session?.state === "challenge" && <div className="instagram-login-form">
          <p>Instagram needs you to verify @{session.username}. Complete its steps, then return here.</p>
          <a className="retry-link" href={session.challengeUrl} target="_blank" rel="noreferrer">Continue on Instagram ↗</a>
          <button type="button" className="instagram-submit" disabled={busy} onClick={() => void loginAction("retry")}>{busy ? "Checking…" : "I’ve completed verification"}</button>
          <button type="button" className="choice-button" disabled={busy} onClick={() => void loginAction("logout")}>Cancel login</button>
        </div>}
      </section>
      {error && <ErrorNotice message={error} />}
      {error?.includes("account verification") && session?.state === "connected" && <p><a className="retry-link" href="https://www.instagram.com/" target="_blank" rel="noreferrer">Complete verification on Instagram ↗</a></p>}
      {media && <section className="media-card" aria-label="Instagram download options"><div className="options-panel">
        <h2 className="instagram-title">{media.title}</h2>
        <div className="instagram-items">
          {media.items.map((item, index) => <button key={item.id} className={`instagram-item ${selected.includes(item.id) ? "active" : ""}`} type="button" aria-pressed={selected.includes(item.id)} disabled={busy || jobActive} onClick={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}>
            <Image src={item.thumbnail} alt={`${item.type === "video" ? "Video" : "Photo"} ${index + 1}`} width={180} height={180} unoptimized />
            <span>{selected.includes(item.id) ? "✓ " : ""}{item.type === "video" ? "Video" : "Photo"} {index + 1}</span>
          </button>)}
        </div>
        {media.items.length > 1 && <button className="choice-button" type="button" disabled={busy || jobActive} onClick={() => setSelected(media.items.map((item) => item.id))}>Select all</button>}
        <p className="instagram-selection">{selected.length} selected{selected.length > 1 ? " · ZIP of original files" : " · Original file"}</p>
        <div className="action-grid">
          <button className="action-button secondary-action" type="button" onClick={() => void download("server")} disabled={busy || jobActive || !selected.length}><Image className="action-icon" src="/icons/save-pc.png" alt="" width={30} height={30} /><span><strong>Save</strong><small>This PC</small></span></button>
          <button className="action-button primary-action" type="button" onClick={() => void download("download")} disabled={busy || jobActive || !selected.length}><Image className="action-icon" src="/icons/download-device.png" alt="" width={30} height={30} /><span><strong>Download</strong><small>This device</small></span></button>
        </div>
        {job && <JobProgress job={job} />}
      </div></section>}
    </div>
  );
}
