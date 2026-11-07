//! Progressive playback for `/stream/:id`.
//!
//! Instead of waiting for yt-dlp to download a whole track, we ask yt-dlp
//! only for the direct googlevideo URL (`-J`), which also tells us the
//! exact file size. From then on:
//!
//! - a background filler downloads the file in ranged chunks into the
//!   usual `<id>.part` (renamed to `<id>.webm` when done, so caching works
//!   as before), and
//! - `/stream` answers the audio element's Range requests right away with
//!   a correct `Content-Range` / `Content-Length`, reading bytes from the
//!   growing `.part` file, or straight from googlevideo when the request
//!   is ahead of the filler (a seek into the not-yet-downloaded part).
//!
//! Knowing the size up front is what makes this work: the old comment in
//! `stream_handler` explains that piping yt-dlp's stdout could not give
//! the element a valid length, so seeking broke.

use std::io::SeekFrom;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::process::Command as TokioCommand;

use crate::DownloadState;

/// Same selector as the old download path: progressive http only, webm
/// preferred, trailing `/best` for combined-mp4-only videos.
pub const AUDIO_FORMAT: &str =
    "bestaudio[ext=webm][protocol^=http]/bestaudio[protocol^=http]/bestaudio/best";

/// Size of each ranged request to googlevideo. Matches yt-dlp's
/// `http_chunk_size` for YouTube: one long unranged request gets throttled.
const UPSTREAM_CHUNK: u64 = 10 * 1024 * 1024;

/// How far ahead of the filler a request may start and still be served
/// from the `.part` file (by waiting a moment) instead of opening its own
/// upstream connection.
const FILE_AHEAD_SLACK: u64 = 512 * 1024;

/// Bytes handed to the response body per read from the `.part` file.
const READ_CHUNK: usize = 64 * 1024;

/// A direct media URL resolved by yt-dlp, with everything needed to fetch
/// byte ranges from it ourselves.
#[derive(Clone, Debug)]
pub struct ResolvedAudio {
    pub url: String,
    pub size: u64,
    pub mime: &'static str,
    pub headers: Vec<(String, String)>,
    /// Unix time before which googlevideo answers 403. Anonymous sessions
    /// must sit out the length of the pre-roll ad; yt-dlp reports it as
    /// `available_at` and its own downloader sleeps until then.
    pub available_at: Option<u64>,
}

/// YouTube client tried first when resolving. As of 2026-11 yt-dlp's
/// default list leads with `tv_samsung`, whose player response carries a
/// pre-roll ad: googlevideo then answers 403 until the ad's skip point
/// (~5 s, see `available_at`). `visionos` gets no ad, needs no JS
/// challenge (faster lookup), and returns plain https opus/webm (itag 251)
/// that works at once. Not pinned: on failure the caller falls back to
/// yt-dlp's defaults, so a YouTube change only costs one extra lookup.
pub const FAST_CLIENT: &str = "visionos";

pub struct ResolveError {
    pub age_gated: bool,
}

/// Run `yt-dlp -J` and pull out the chosen format's URL and size.
/// Fails (non-age-gated) when the format isn't plain http or its size is
/// unknown; the caller then falls back to a full yt-dlp download.
pub async fn resolve_audio(
    program: &Path,
    watch_url: &str,
    cookies: Option<&Path>,
    player_client: Option<&str>,
) -> Result<ResolvedAudio, ResolveError> {
    let mut cmd = TokioCommand::new(program);
    cmd.args([
        "-J",
        "-f",
        AUDIO_FORMAT,
        "--no-playlist",
        "--no-warnings",
        "--extractor-retries",
        "3",
        "--socket-timeout",
        "15",
    ]);
    if let Some(c) = cookies {
        cmd.arg("--cookies").arg(c);
    }
    if let Some(client) = player_client {
        cmd.arg("--extractor-args")
            .arg(format!("youtube:player_client={client}"));
    }
    cmd.arg(watch_url);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    let out = match tokio::time::timeout(Duration::from_secs(60), cmd.output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            eprintln!("[stream] spawn yt-dlp -J: {e}");
            return Err(ResolveError { age_gated: false });
        }
        Err(_) => {
            eprintln!("[stream] yt-dlp -J timed out");
            return Err(ResolveError { age_gated: false });
        }
    };
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        if !stderr.trim().is_empty() {
            eprint!("{stderr}");
        }
        let age_gated =
            stderr.contains("confirm your age") || stderr.contains("Sign in to confirm you");
        return Err(ResolveError { age_gated });
    }
    match parse_resolved(&out.stdout) {
        Some(r) => Ok(r),
        None => {
            eprintln!("[stream] yt-dlp -J gave no direct http URL with a known size");
            Err(ResolveError { age_gated: false })
        }
    }
}

fn parse_resolved(json: &[u8]) -> Option<ResolvedAudio> {
    let v: serde_json::Value = serde_json::from_slice(json).ok()?;
    let protocol = v.get("protocol")?.as_str()?;
    if protocol != "https" && protocol != "http" {
        return None;
    }
    let url = v.get("url")?.as_str()?.to_string();
    let size = v
        .get("filesize")
        .and_then(|s| s.as_u64())
        .or_else(|| clen_from_url(&url))?;
    if size == 0 {
        return None;
    }
    let mime = match v.get("ext").and_then(|e| e.as_str()).unwrap_or("") {
        "m4a" | "mp4" => "audio/mp4",
        "mp3" => "audio/mpeg",
        _ => "audio/webm",
    };
    let headers = v
        .get("http_headers")
        .and_then(|h| h.as_object())
        .map(|h| {
            h.iter()
                .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let available_at = v.get("available_at").and_then(|t| t.as_u64());
    Some(ResolvedAudio {
        url,
        size,
        mime,
        headers,
        available_at,
    })
}

/// googlevideo URLs carry the content length as `clen=`.
fn clen_from_url(url: &str) -> Option<u64> {
    let query = url.split_once('?')?.1;
    query
        .split('&')
        .find_map(|kv| kv.strip_prefix("clen="))
        .and_then(|v| v.parse().ok())
}

/// Sleep until the URL becomes fetchable (see `available_at`).
async fn wait_until_available(r: &ResolvedAudio) {
    let Some(at) = r.available_at else { return };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    let wait = at as f64 - now;
    if wait > 0.0 {
        // Capped so a bogus timestamp can't stall playback for minutes.
        tokio::time::sleep(Duration::from_secs_f64(wait.min(60.0))).await;
    }
}

/// Open one ranged request (`start..=end`) against the resolved URL.
async fn open_range(
    http: &reqwest::Client,
    r: &ResolvedAudio,
    start: u64,
    end: u64,
) -> Result<reqwest::Response, String> {
    wait_until_available(r).await;
    let mut req = http.get(&r.url);
    for (k, v) in &r.headers {
        req = req.header(k.as_str(), v.as_str());
    }
    let resp = req
        .header(header::RANGE, format!("bytes={start}-{end}"))
        .send()
        .await
        .map_err(|e| format!("request: {e}"))?;
    let status = resp.status();
    let whole_file = start == 0 && end + 1 == r.size;
    if status == StatusCode::PARTIAL_CONTENT || (status == StatusCode::OK && whole_file) {
        Ok(resp)
    } else {
        Err(format!("HTTP {status}"))
    }
}

/// Download the whole file into `file` in ranged chunks, publishing
/// progress through `state.downloaded` and `state.notify`. Each chunk is
/// retried a few times, resuming where it stopped. Returns whether every
/// byte arrived.
pub async fn fill(
    http: &reqwest::Client,
    r: &ResolvedAudio,
    mut file: tokio::fs::File,
    state: &Arc<DownloadState>,
) -> bool {
    let mut pos: u64 = 0;
    while pos < r.size {
        let end = (pos + UPSTREAM_CHUNK).min(r.size) - 1;
        let mut attempts = 0;
        while pos <= end {
            match open_range(http, r, pos, end).await {
                Ok(mut resp) => loop {
                    match resp.chunk().await {
                        Ok(Some(b)) => {
                            let take = b.len().min((end + 1 - pos) as usize);
                            if let Err(e) = file.write_all(&b[..take]).await {
                                eprintln!("[stream] write .part: {e}");
                                return false;
                            }
                            pos += take as u64;
                            state.downloaded.store(pos, Ordering::Release);
                            state.notify.notify_waiters();
                            if pos > end {
                                break;
                            }
                        }
                        Ok(None) => break,
                        Err(e) => {
                            eprintln!("[stream] fill read at {pos}: {e}");
                            break;
                        }
                    }
                },
                Err(e) => eprintln!("[stream] fill open at {pos}: {e}"),
            }
            if pos > end {
                break;
            }
            attempts += 1;
            if attempts >= 4 {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(500 * attempts)).await;
        }
    }
    file.flush().await.is_ok()
}

/// A parsed single-range `Range: bytes=…` header, clamped to `size`.
#[derive(Debug, PartialEq)]
pub enum RangeReq {
    /// No (usable) Range header: send the whole file with 200.
    Full,
    /// Inclusive byte range, answered with 206.
    Part(u64, u64),
    /// Starts past the end: 416.
    Unsatisfiable,
}

pub fn parse_range(header: Option<&str>, size: u64) -> RangeReq {
    let Some(h) = header else { return RangeReq::Full };
    let Some(spec) = h.trim().strip_prefix("bytes=") else {
        return RangeReq::Full;
    };
    if spec.contains(',') {
        // Multi-range: answering with the whole file is allowed.
        return RangeReq::Full;
    }
    let Some((a, b)) = spec.split_once('-') else {
        return RangeReq::Full;
    };
    let (a, b) = (a.trim(), b.trim());
    if a.is_empty() {
        // Suffix range: the last N bytes.
        let Ok(n) = b.parse::<u64>() else { return RangeReq::Full };
        if n == 0 {
            return RangeReq::Unsatisfiable;
        }
        return RangeReq::Part(size.saturating_sub(n), size - 1);
    }
    let Ok(start) = a.parse::<u64>() else { return RangeReq::Full };
    if start >= size {
        return RangeReq::Unsatisfiable;
    }
    let end = if b.is_empty() {
        size - 1
    } else {
        match b.parse::<u64>() {
            Ok(e) if e >= start => e.min(size - 1),
            _ => return RangeReq::Full,
        }
    };
    RangeReq::Part(start, end)
}

/// State for one response body: walks `pos..=end`, reading from the
/// `.part` file while the filler is ahead, waiting briefly when it's just
/// behind, and proxying googlevideo directly otherwise.
struct BodyCursor {
    pos: u64,
    end: u64,
    file: Option<tokio::fs::File>,
    upstream: Option<reqwest::Response>,
    state: Arc<DownloadState>,
    r: ResolvedAudio,
    http: reqwest::Client,
}

impl BodyCursor {
    async fn next_chunk(&mut self) -> Option<Result<Bytes, std::io::Error>> {
        loop {
            if self.pos > self.end {
                return None;
            }

            if let Some(resp) = self.upstream.as_mut() {
                match resp.chunk().await {
                    Ok(Some(mut b)) => {
                        let room = (self.end + 1 - self.pos) as usize;
                        if b.len() > room {
                            b.truncate(room);
                        }
                        self.pos += b.len() as u64;
                        return Some(Ok(b));
                    }
                    // This upstream chunk is done; the loop picks the
                    // next source for whatever is left.
                    Ok(None) => self.upstream = None,
                    Err(e) => return Some(Err(std::io::Error::other(e))),
                }
                continue;
            }

            let avail = self.state.downloaded.load(Ordering::Acquire);
            if self.pos < avail {
                if let Some(f) = self.file.as_mut() {
                    let want = (avail - self.pos).min(self.end + 1 - self.pos);
                    let want = want.min(READ_CHUNK as u64) as usize;
                    let mut buf = vec![0u8; want];
                    let read = async {
                        f.seek(SeekFrom::Start(self.pos)).await?;
                        f.read(&mut buf).await
                    }
                    .await;
                    match read {
                        Ok(n) if n > 0 => {
                            buf.truncate(n);
                            self.pos += n as u64;
                            return Some(Ok(Bytes::from(buf)));
                        }
                        // The file stopped giving bytes it should have
                        // (deleted after a failed fill): go upstream.
                        _ => self.file = None,
                    }
                }
            }

            let filler_gave_up = self.state.complete.load(Ordering::Acquire) && avail < self.r.size;
            if self.file.is_none() || filler_gave_up || self.pos > avail + FILE_AHEAD_SLACK {
                if let Err(e) = self.open_upstream().await {
                    return Some(Err(e));
                }
                continue;
            }

            // The filler is just behind us: wait for it to catch up.
            let notified = self.state.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let moved = self.state.downloaded.load(Ordering::Acquire) > self.pos
                || self.state.complete.load(Ordering::Acquire);
            if !moved
                && tokio::time::timeout(Duration::from_secs(20), notified)
                    .await
                    .is_err()
            {
                // Filler is stuck: stop relying on it for this response.
                eprintln!("[stream] filler stalled at {avail}; proxying the rest");
                self.file = None;
            }
        }
    }

    async fn open_upstream(&mut self) -> Result<(), std::io::Error> {
        let end = (self.pos + UPSTREAM_CHUNK - 1).min(self.end);
        let mut last = String::new();
        for attempt in 0..3u64 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(400 * attempt)).await;
            }
            match open_range(&self.http, &self.r, self.pos, end).await {
                Ok(resp) => {
                    self.upstream = Some(resp);
                    return Ok(());
                }
                Err(e) => last = e,
            }
        }
        eprintln!("[stream] upstream range {}-{end}: {last}", self.pos);
        Err(std::io::Error::other(last))
    }
}

/// Answer a `/stream` request from a resolved track that isn't fully
/// cached yet. `part` is the filler's file opened for reading (None if it
/// couldn't be opened, in which case every byte is proxied).
pub fn respond(
    range_header: Option<&str>,
    r: &ResolvedAudio,
    state: Arc<DownloadState>,
    part: Option<tokio::fs::File>,
    http: reqwest::Client,
) -> Response {
    let size = r.size;
    let (status, start, end) = match parse_range(range_header, size) {
        RangeReq::Full => (StatusCode::OK, 0, size - 1),
        RangeReq::Part(s, e) => (StatusCode::PARTIAL_CONTENT, s, e),
        RangeReq::Unsatisfiable => {
            let mut resp = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
            if let Ok(v) = HeaderValue::from_str(&format!("bytes */{size}")) {
                resp.headers_mut().insert(header::CONTENT_RANGE, v);
            }
            return resp;
        }
    };

    let cursor = BodyCursor {
        pos: start,
        end,
        file: part,
        upstream: None,
        state,
        r: r.clone(),
        http,
    };
    let stream = futures_util::stream::unfold(cursor, |mut c| async move {
        let item = c.next_chunk().await?;
        Some((item, c))
    });

    let mut resp = Response::new(Body::from_stream(stream));
    *resp.status_mut() = status;
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(r.mime));
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(end + 1 - start));
    if status == StatusCode::PARTIAL_CONTENT {
        if let Ok(v) = HeaderValue::from_str(&format!("bytes {start}-{end}/{size}")) {
            h.insert(header::CONTENT_RANGE, v);
        }
    }
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_parsing() {
        assert_eq!(parse_range(None, 100), RangeReq::Full);
        assert_eq!(parse_range(Some("bytes=0-"), 100), RangeReq::Part(0, 99));
        assert_eq!(parse_range(Some("bytes=10-19"), 100), RangeReq::Part(10, 19));
        assert_eq!(parse_range(Some("bytes=90-500"), 100), RangeReq::Part(90, 99));
        assert_eq!(parse_range(Some("bytes=-10"), 100), RangeReq::Part(90, 99));
        assert_eq!(parse_range(Some("bytes=-500"), 100), RangeReq::Part(0, 99));
        assert_eq!(parse_range(Some("bytes=100-"), 100), RangeReq::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=0-1,5-6"), 100), RangeReq::Full);
        assert_eq!(parse_range(Some("items=0-1"), 100), RangeReq::Full);
        assert_eq!(parse_range(Some("bytes=20-10"), 100), RangeReq::Full);
    }

    #[test]
    fn resolved_json() {
        let json = br#"{"protocol":"https","url":"https://x.googlevideo.com/videoplayback?a=1&clen=4242&b=2",
            "ext":"webm","http_headers":{"User-Agent":"UA"},"available_at":1794028353}"#;
        let r = parse_resolved(json).unwrap();
        assert_eq!(r.size, 4242);
        assert_eq!(r.mime, "audio/webm");
        assert_eq!(r.available_at, Some(1794028353));
        assert_eq!(r.headers, vec![("User-Agent".to_string(), "UA".to_string())]);

        let m3u8 = br#"{"protocol":"m3u8_native","url":"https://x/y.m3u8","filesize":10}"#;
        assert!(parse_resolved(m3u8).is_none());
        let no_size = br#"{"protocol":"https","url":"https://x/y?a=1"}"#;
        assert!(parse_resolved(no_size).is_none());
    }
}
