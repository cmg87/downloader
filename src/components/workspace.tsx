"use client";

import { useState } from "react";

import { CopyXPost } from "@/components/copy-x-post";
import { Downloader } from "@/components/downloader";
import { InstagramDownloader } from "@/components/instagram-downloader";

export function Workspace() {
  const [tab, setTab] = useState<"media" | "post" | "instagram">("media");

  return (
    <div className="workspace">
      <div className="workspace-tabs" role="tablist" aria-label="Downloader mode">
        <button id="media-tab" role="tab" aria-controls="media-panel" aria-selected={tab === "media"} type="button" className={tab === "media" ? "selected" : ""} onClick={() => setTab("media")}>Download media</button>
        <button id="post-tab" role="tab" aria-controls="post-panel" aria-selected={tab === "post"} type="button" className={tab === "post" ? "selected" : ""} onClick={() => setTab("post")}>Copy X post</button>
        <button id="instagram-tab" role="tab" aria-controls="instagram-panel" aria-selected={tab === "instagram"} type="button" className={tab === "instagram" ? "selected" : ""} onClick={() => setTab("instagram")}>Instagram</button>
      </div>
      <div id="media-panel" role="tabpanel" aria-labelledby="media-tab" hidden={tab !== "media"}><Downloader /></div>
      <div id="post-panel" role="tabpanel" aria-labelledby="post-tab" hidden={tab !== "post"}><CopyXPost /></div>
      <div id="instagram-panel" role="tabpanel" aria-labelledby="instagram-tab" hidden={tab !== "instagram"}><InstagramDownloader active={tab === "instagram"} /></div>
    </div>
  );
}
