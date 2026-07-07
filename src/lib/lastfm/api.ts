import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { md5Hex } from "./md5";

/**
 * Thin client for the Last.fm 2.0 web service.
 *
 * All calls are routed through `tauri-plugin-http` (Rust-side `reqwest`)
 * rather than the webview's `fetch` — Last.fm doesn't send permissive CORS
 * headers, so a browser fetch to `ws.audioscrobbler.com` is blocked. Going
 * through Rust sidesteps CORS entirely. The host is allow-listed in
 * `src-tauri/capabilities/default.json`.
 *
 * Auth model (desktop flow, https://www.last.fm/api/desktop):
 *   1. `auth.getToken` → an unauthorised request token.
 *   2. Send the user to `www.last.fm/api/auth?api_key=…&token=…` in their
 *      browser to grant access.
 *   3. `auth.getSession` with that token → a long-lived session key (`sk`),
 *      which every write call (scrobble / now-playing) must carry.
 *
 * Write methods must be signed: an `api_sig` = md5(sorted `key+value`
 * pairs, excluding `format`, followed by the shared secret).
 */

const API_ROOT = "https://ws.audioscrobbler.com/2.0/";

export type LastfmCreds = { apiKey: string; apiSecret: string };

export type LastfmScrobbleTrack = {
  artist: string;
  track: string;
  album?: string;
  /** Track length in whole seconds; helps Last.fm match the right release. */
  duration?: number;
};

/** Build the api_sig for a set of params (excludes `format`). */
function signParams(params: Record<string, string>, secret: string): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "format" && k !== "callback")
    .sort();
  let s = "";
  for (const k of keys) s += k + params[k];
  s += secret;
  return md5Hex(s);
}

type LastfmError = { error?: number; message?: string };

/**
 * Issue a Last.fm API request. When `secret` is provided the request is
 * signed. `format=json` is appended for a JSON response (it is excluded
 * from the signature per the API spec).
 */
async function request<T>(
  params: Record<string, string>,
  opts: { secret?: string; method?: "GET" | "POST" } = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const full: Record<string, string> = { ...params };
  if (opts.secret) full.api_sig = signParams(full, opts.secret);
  full.format = "json";

  const body = new URLSearchParams(full).toString();
  let res: Response;
  if (method === "POST") {
    res = await tauriFetch(API_ROOT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } else {
    res = await tauriFetch(`${API_ROOT}?${body}`, { method: "GET" });
  }

  // Last.fm returns HTTP 200 with an `{error, message}` body for API-level
  // failures, but also genuine 4xx/5xx for transport problems — surface both.
  let json: (T & LastfmError) | undefined;
  try {
    json = (await res.json()) as T & LastfmError;
  } catch {
    json = undefined;
  }
  if (json && typeof json.error === "number") {
    const err = new Error(
      json.message ?? `Last.fm error ${json.error}`,
    ) as Error & { code?: number };
    err.code = json.error;
    throw err;
  }
  if (!res.ok) throw new Error(`Last.fm HTTP ${res.status}`);
  if (!json) throw new Error("Last.fm returned an unreadable response");
  return json;
}

/** Step 1 of the desktop auth flow — fetch an unauthorised request token. */
export async function getToken(creds: LastfmCreds): Promise<string> {
  const json = await request<{ token?: string }>(
    { method: "auth.getToken", api_key: creds.apiKey },
    { secret: creds.apiSecret },
  );
  if (!json.token) throw new Error("Last.fm did not return a token");
  return json.token;
}

/** The URL the user visits in their browser to authorise the token. */
export function authorizeUrl(apiKey: string, token: string): string {
  return `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(
    apiKey,
  )}&token=${encodeURIComponent(token)}`;
}

/**
 * Step 3 — exchange an authorised token for a session key. Throws with a
 * `.code` of 14 while the user hasn't authorised yet (callers poll on this).
 */
export async function getSession(
  creds: LastfmCreds,
  token: string,
): Promise<{ key: string; name: string }> {
  const json = await request<{ session?: { key: string; name: string } }>(
    { method: "auth.getSession", api_key: creds.apiKey, token },
    { secret: creds.apiSecret },
  );
  if (!json.session?.key) throw new Error("Last.fm did not return a session");
  return { key: json.session.key, name: json.session.name };
}

function trackParams(t: LastfmScrobbleTrack): Record<string, string> {
  const p: Record<string, string> = { artist: t.artist, track: t.track };
  if (t.album) p.album = t.album;
  if (t.duration && t.duration > 0) p.duration = String(Math.round(t.duration));
  return p;
}

/** Tell Last.fm what's playing right now (expires after the track length). */
export async function updateNowPlaying(
  creds: LastfmCreds,
  sessionKey: string,
  t: LastfmScrobbleTrack,
): Promise<void> {
  await request(
    {
      method: "track.updateNowPlaying",
      api_key: creds.apiKey,
      sk: sessionKey,
      ...trackParams(t),
    },
    { secret: creds.apiSecret, method: "POST" },
  );
}

/** Mark a track as loved on the linked Last.fm account. */
export async function love(
  creds: LastfmCreds,
  sessionKey: string,
  t: { artist: string; track: string },
): Promise<void> {
  await request(
    {
      method: "track.love",
      api_key: creds.apiKey,
      sk: sessionKey,
      artist: t.artist,
      track: t.track,
    },
    { secret: creds.apiSecret, method: "POST" },
  );
}

/** Remove the loved mark from a track. */
export async function unlove(
  creds: LastfmCreds,
  sessionKey: string,
  t: { artist: string; track: string },
): Promise<void> {
  await request(
    {
      method: "track.unlove",
      api_key: creds.apiKey,
      sk: sessionKey,
      artist: t.artist,
      track: t.track,
    },
    { secret: creds.apiSecret, method: "POST" },
  );
}

/**
 * Scrobble a played track. `timestamp` is the Unix time (UTC seconds) at
 * which the track *started* playing, per the Last.fm spec.
 */
export async function scrobble(
  creds: LastfmCreds,
  sessionKey: string,
  t: LastfmScrobbleTrack,
  timestamp: number,
): Promise<void> {
  await request(
    {
      method: "track.scrobble",
      api_key: creds.apiKey,
      sk: sessionKey,
      timestamp: String(timestamp),
      ...trackParams(t),
    },
    { secret: creds.apiSecret, method: "POST" },
  );
}
