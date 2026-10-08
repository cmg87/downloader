export interface InstagramSession {
  state: "disconnected" | "connected" | "code-required" | "challenge" | "browser-login";
  username?: string;
  challengeUrl?: string;
  message?: string;
}
export type InstagramTarget =
  | { kind: "post"; shortcode: string }
  | { kind: "stories"; username: string; mediaId?: string };
export interface InstagramMedia {
  id: string;
  title: string;
  items: { id: string; type: "image" | "video"; thumbnail: string }[];
}
export interface InstagramJobInput {
  inspectionId: string;
  itemIds: string[];
}
