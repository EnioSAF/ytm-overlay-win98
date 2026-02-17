import fs from "fs";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";
import { StreamerbotClient } from "@streamerbot/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf-8"));
const showErrors = cfg?.overlay?.showErrors === true;
const pollMs = Math.max(250, Number(cfg?.overlay?.pollMs ?? 1000));
const volumePollMsRaw = Number(cfg?.overlay?.volumePollMs ?? 5000);
const volumePollMs = volumePollMsRaw > 0 ? Math.max(pollMs, volumePollMsRaw) : 0;
const debugVolume = cfg?.overlay?.debugVolume === true;

/** -----------------------------
 *  Pear API (minimal client)
 *  ----------------------------- */
function readPearToken() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, cfg.pear.tokenFile), "utf-8");
    const json = JSON.parse(raw);
    return json?.accessToken || "";
  } catch {
    return "";
  }
}
function clearPearToken() {
  try {
    fs.unlinkSync(path.join(__dirname, cfg.pear.tokenFile));
  } catch {}
}
function writePearToken(token) {
  fs.writeFileSync(
    path.join(__dirname, cfg.pear.tokenFile),
    JSON.stringify({ accessToken: token, savedAt: new Date().toISOString() }, null, 2),
    "utf-8"
  );
}

async function pearAuthIfNeeded() {
  const now = Date.now();
  if (pearAuthIfNeeded.blockedUntil && now < pearAuthIfNeeded.blockedUntil) {
    throw new Error("Pear auth cooldown");
  }
  let token = readPearToken();
  if (token) return token;

  // Pear swagger flow: POST /auth/{id} -> returns accessToken (after user approves prompt)
  const url = `${cfg.pear.baseUrl}/auth/${encodeURIComponent(cfg.pear.clientId)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      pearAuthIfNeeded.blockedUntil = Date.now() + 30000;
    }
    throw new Error(`Pear auth failed: ${resp.status} ${resp.statusText}`);
  }
  const json = await resp.json();

  const t = json?.accessToken || json?.token || "";
  if (!t) throw new Error("Pear auth returned no token (check Pear prompt / swagger).");

  writePearToken(t);
  return t;
}

async function pearGet(pathname) {
  async function doRequest(allowRetry) {
    const token = await pearAuthIfNeeded();
    const url = `${cfg.pear.baseUrl}${pathname}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status === 401 || resp.status === 403) {
      if (allowRetry) {
        clearPearToken();
        return doRequest(false);
      }
    }
    const text = await resp.text();
    if (!resp.ok) {
      const tail = text ? ` | ${text.slice(0, 160)}` : "";
      throw new Error(`Pear GET ${pathname} -> ${resp.status} ${resp.statusText}${tail}`);
    }
    if (!text || text.trim().length < 2) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      if (allowRetry) return doRequest(false);
      return null;
    }
  }

  return doRequest(true);
}

/** -----------------------------
 *  State (in-memory)
 *  ----------------------------- */
const state = {
  now: null,
  nowUpdatedAt: 0,
  queue: [],
  addedBy: new Map(), // videoId -> { user, ts, title?, artist? }
  toasts: [],
  volume: null,
  shuffle: null,
  repeat: "",
  likeState: ""
};
let volumeSupported = true;
let shuffleSupported = true;
let repeatSupported = true;
let likeSupported = true;
let lastVolLogTs = 0;
let lastVolumePoll = 0;

function pushToast(payload) {
  const item = (typeof payload === "string") ? { text: payload } : { ...payload };
  item.ts = Date.now();
  state.toasts.unshift(item);
  state.toasts = state.toasts.slice(0, 6);
}
const lastError = { msg: "", ts: 0 };
function pushError(text) {
  const now = Date.now();
  if (text === lastError.msg && (now - lastError.ts) < 15000) return;
  lastError.msg = text;
  lastError.ts = now;
  if (showErrors) pushToast(text);
  else console.warn(text);
}

function normStr(x) {
  return String(x ?? "").trim();
}
function safeVideoId(obj) {
  return normStr(obj?.videoId || obj?.id || obj?.video_id);
}
function safeTitle(obj) {
  return normStr(obj?.title || obj?.name || obj?.videoTitle);
}
function safeArtist(obj) {
  return normStr(obj?.artist || obj?.author || obj?.channel || obj?.uploader);
}
function safeAddedBy(obj) {
  return normStr(
    obj?.addedBy
    || obj?.requestedBy
    || obj?.requester
    || obj?.user
    || obj?.login
    || obj?.requested_by
    || obj?.added_by
    || obj?.meta?.addedBy
    || obj?.meta?.requester
    || obj?.addedBy?.login
    || obj?.addedBy?.user
    || obj?.requester?.login
    || obj?.requester?.user
  );
}
function cleanTitleMeta(s) {
  s = normStr(s);
  if (!s) return s;
  s = s
    .replace(/\s*•\s*[\d.,]+\s*[kKmM]?\s*(vues|views)\b/gi, "")
    .replace(/\s*•\s*[\d.,]+\s*[kKmM]?\s*("?j'aime"?|likes)\b/gi, "")
    .replace(/\s*•\s*[\d.,]+\s*[kKmM]?\s*(j\'aime)\b/gi, "")
    .replace(/\s*[\d.,]+\s*[kKmM]?\s*(vues|views)\b/gi, "")
    .replace(/\s*[\d.,]+\s*[kKmM]?\s*("?j'aime"?|likes)\b/gi, "")
    .replace(/\s*•\s*•\s*/g, " • ")
    .replace(/\s*•\s*$/g, "")
    .replace(/^\s*•\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

function extractText(val) {
  if (val == null) return "";
  if (typeof val === "string" || typeof val === "number") return String(val);
  if (Array.isArray(val?.runs)) return val.runs.map(r => r?.text || "").join("");
  if (val?.simpleText) return String(val.simpleText);
  return "";
}

function parseCount(val) {
  if (val == null) return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const s = String(val).toLowerCase().replace(/\s+/g, "").replace(",", ".");
  const m = s.match(/([\d.]+)([km])?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mul = m[2] === "k" ? 1e3 : (m[2] === "m" ? 1e6 : 1);
  return Math.round(n * mul);
}

function formatCount(val) {
  const n = parseCount(val);
  if (n == null) return "";
  if (n >= 1e6) {
    const v = (n / 1e6).toFixed(1).replace(/\.0$/, "");
    return `${v}M`;
  }
  if (n >= 1e3) {
    const v = (n / 1e3).toFixed(1).replace(/\.0$/, "");
    return `${v}k`;
  }
  return String(n);
}

function extractCountFromText(text, kind) {
  const t = extractText(text);
  if (!t) return "";
  const re = kind === "views"
    ? /([\d.,]+)\s*([kKmM])?\s*(vues|views)\b/i
    : /([\d.,]+)\s*([kKmM])?\s*(j'aime|likes)\b/i;
  const m = t.match(re);
  if (!m) return "";
  return formatCount(`${m[1]}${m[2] || ""}`);
}

function countFromAny(kind, ...vals) {
  for (const v of vals) {
    const fromText = extractCountFromText(v, kind);
    if (fromText) return fromText;
    const fmt = formatCount(v);
    if (fmt) return fmt;
  }
  return "";
}
function safeAlbum(obj) {
  return normStr(
    obj?.album
      || obj?.albumName
      || obj?.collection
      || obj?.record
      || obj?.album?.name
      || obj?.album?.title
      || obj?.collection?.name
  );
}
function safeVolume(obj) {
  function scale(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n * 4)));
  }
  if (obj == null) return null;
  if (obj && typeof obj === "object" && "state" in obj) {
    const s = Number(obj.state);
    if (Number.isFinite(s)) {
      return scale(s);
    }
  }
  if (typeof obj === "number" && Number.isFinite(obj)) {
    return scale(obj);
  }
  if (typeof obj === "string") {
    const n = Number(obj);
    if (Number.isFinite(n)) {
      return scale(n);
    }
  }

  const raw =
    obj?.volume
    ?? obj?.volumePercent
    ?? obj?.volume_percent
    ?? obj?.level
    ?? obj?.percent
    ?? obj?.value
    ?? obj?.volumeLevel
    ?? obj?.volume_level;

  if (raw != null && typeof raw === "object") {
    const nested = safeVolume(raw);
    if (nested != null) return nested;
  }

  if (raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n)) return scale(n);
  }

  const nested =
    obj?.data
    ?? obj?.state
    ?? obj?.player
    ?? obj?.result;
  if (nested != null) return safeVolume(nested);

  return null;
}

function safeProgress(obj) {
  const raw =
    obj?.progress
    ?? obj?.progressPercent
    ?? obj?.progress_percent
    ?? obj?.positionPercent
    ?? obj?.position_percent
    ?? obj?.playedRatio
    ?? obj?.ratio
    ?? obj?.percent;
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 1) return n;
  if (n > 1 && n <= 100) return n / 100;
  return null;
}

function parseShuffle(obj) {
  if (obj == null) return null;
  if (typeof obj === "boolean") return obj;
  const v = obj?.shuffle ?? obj?.enabled ?? obj?.state ?? obj?.value ?? obj?.isOn;
  if (typeof v === "boolean") return v;
  const s = normStr(v).toLowerCase();
  if (!s) return null;
  if (s.includes("true") || s.includes("on") || s.includes("shuffle")) return true;
  if (s.includes("false") || s.includes("off")) return false;
  return null;
}

function parseRepeat(obj) {
  const s = normStr(obj?.mode ?? obj?.repeatMode ?? obj?.repeat_mode ?? obj?.state ?? obj?.value);
  if (!s) return "";
  const up = s.toUpperCase();
  if (up.includes("ONE")) return "ONE";
  if (up.includes("ALL")) return "ALL";
  if (up.includes("OFF")) return "OFF";
  return up;
}

function parseLikeState(obj) {
  if (obj == null) return "";
  if (typeof obj === "boolean") return obj ? "LIKE" : "NONE";
  const s = normStr(obj?.likeState ?? obj?.state ?? obj?.status ?? obj?.value);
  if (!s) return "";
  return s.toUpperCase();
}
function pickThumb(th) {
  if (!th) return "";
  if (typeof th === "string") return th;
  if (Array.isArray(th)) {
    const last = th[th.length - 1];
    return normStr(last?.url || last?.src || th[0]?.url || th[0]?.src || "");
  }
  return normStr(th?.url || th?.src || "");
}
function safeThumb(obj) {
  return normStr(
    pickThumb(obj?.thumbnails)
    || pickThumb(obj?.thumbnail?.thumbnails)
    || pickThumb(obj?.thumbnail)
    || pickThumb(obj?.artwork)
    || pickThumb(obj?.image)
    || ""
  );
}
function toSeconds(val) {
  if (val == null) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  const s = String(val).trim();
  if (!s) return 0;
  if (s.includes(":")) {
    const parts = s.split(":").map(p => parseInt(p.trim(), 10));
    if (parts.some(n => Number.isNaN(n))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n > 1000 ? n / 1000 : n;
}

function extractQueueArray(root) {
  if (Array.isArray(root)) return root;
  const candidates = [
    root?.items, root?.queue, root?.songs, root?.tracks, root?.entries,
    root?.data?.items, root?.data?.queue, root?.data?.songs, root?.data?.tracks,
    root?.queue?.items
  ];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return [];
}

function normalizeQueueItem(it) {
  const videoId = safeVideoId(it)
    || safeVideoId(it?.playlistPanelVideoRenderer?.navigationEndpoint?.watchEndpoint);

  const rawTitle =
    safeTitle(it)
    || normStr(it?.playlistPanelVideoRenderer?.title?.simpleText)
    || normStr(it?.playlistPanelVideoRenderer?.title?.runs?.map(r => r?.text).join("") || "");

  const rawArtist =
    safeArtist(it)
    || normStr(it?.playlistPanelVideoRenderer?.longBylineText?.runs?.map(r => r?.text).join("") || "");

  const album = safeAlbum(it);
  const addedBy =
    safeAddedBy(it)
    || safeAddedBy(it?.playlistPanelVideoRenderer)
    || safeAddedBy(it?.playlistPanelVideoRenderer?.navigationEndpoint);
  const thumbnail = safeThumb(it)
    || pickThumb(it?.playlistPanelVideoRenderer?.thumbnail?.thumbnails);
  const duration =
    toSeconds(
      it?.durationSeconds
      ?? it?.duration_seconds
      ?? it?.lengthSeconds
      ?? it?.length_seconds
      ?? it?.duration
      ?? it?.length
      ?? it?.durationMs
      ?? it?.duration_ms
    )
    || toSeconds(
      it?.playlistPanelVideoRenderer?.lengthText?.simpleText
      ?? it?.playlistPanelVideoRenderer?.lengthText?.runs?.map(r => r?.text).join("")
      ?? it?.playlistPanelVideoRenderer?.videoLengthText?.simpleText
      ?? it?.playlistPanelVideoRenderer?.videoLengthText?.runs?.map(r => r?.text).join("")
    );
  const views = countFromAny(
    "views",
    it?.viewCount,
    it?.views,
    it?.view_count,
    it?.viewCountText,
    it?.viewsText,
    rawTitle,
    rawArtist
  );
  const likes = countFromAny(
    "likes",
    it?.likeCount,
    it?.likes,
    it?.like_count,
    it?.likeCountText,
    it?.likesText,
    rawTitle,
    rawArtist
  );

  return {
    videoId,
    title: cleanTitleMeta(rawTitle),
    artist: cleanTitleMeta(rawArtist),
    album: cleanTitleMeta(album),
    thumbnail,
    duration,
    addedBy: addedBy ? addedBy.replace(/^@/, "").toLowerCase() : "",
    views,
    likes
  };
}

/** -----------------------------
 *  Poll Pear
 *  ----------------------------- */
async function pollPearOnce() {
  let song = null;
  let queueRaw = null;
  let volumeRaw = null;
  let shuffleRaw = null;
  let repeatRaw = null;
  let likeRaw = null;
  let songOk = false;
  let queueOk = false;
  let volumeOk = false;
  let shuffleOk = false;
  let repeatOk = false;
  let likeOk = false;

  try {
    song = await pearGet("/api/v1/song");
    songOk = true;
  } catch (e) {
    pushError(`Pear song: ${e.message}`);
  }

  try {
    queueRaw = await pearGet("/api/v1/queue");
    queueOk = true;
  } catch (e) {
    pushError(`Pear queue: ${e.message}`);
  }

  const nowTs = Date.now();
  const shouldPollVolume =
    volumeSupported
    && volumePollMs > 0
    && (nowTs - lastVolumePoll >= volumePollMs);
  if (shouldPollVolume) {
    lastVolumePoll = nowTs;
    try {
      volumeRaw = await pearGet("/api/v1/volume");
      volumeOk = true;
    } catch (e) {
      const msg = String(e?.message || "");
      if (msg.includes("404") || msg.includes("405") || msg.includes("501")) {
        volumeSupported = false;
      }
      pushError(`Pear volume: ${msg || "unknown error"}`);
    }
  }

  if (shuffleSupported) {
    try {
      shuffleRaw = await pearGet("/api/v1/shuffle");
      shuffleOk = true;
    } catch (e) {
      const msg = String(e?.message || "");
      if (msg.includes("404") || msg.includes("405") || msg.includes("501")) {
        shuffleSupported = false;
      }
      pushError(`Pear shuffle: ${msg || "unknown error"}`);
    }
  }

  if (repeatSupported) {
    try {
      repeatRaw = await pearGet("/api/v1/repeat-mode");
      repeatOk = true;
    } catch (e) {
      const msg = String(e?.message || "");
      if (msg.includes("404") || msg.includes("405") || msg.includes("501")) {
        repeatSupported = false;
      }
      pushError(`Pear repeat: ${msg || "unknown error"}`);
    }
  }

  if (likeSupported) {
    try {
      likeRaw = await pearGet("/api/v1/like-state");
      likeOk = true;
    } catch (e) {
      const msg = String(e?.message || "");
      if (msg.includes("404") || msg.includes("405") || msg.includes("501")) {
        likeSupported = false;
      }
      pushError(`Pear like-state: ${msg || "unknown error"}`);
    }
  }

  if (songOk && song) {
    const prevNow = state.now;
    const prevUpdatedAt = state.nowUpdatedAt;
    const volFromSong = safeVolume(song);
    if (volFromSong != null) state.volume = volFromSong;
    const videoId = safeVideoId(song);
    let elapsed = toSeconds(
      song?.elapsedSeconds
      ?? song?.elapsed_seconds
      ?? song?.elapsed
      ?? song?.position
      ?? song?.positionSeconds
      ?? song?.position_seconds
      ?? song?.currentTime
      ?? song?.currentTimeSeconds
      ?? song?.current_time
      ?? song?.current_time_seconds
      ?? song?.elapsedMs
      ?? song?.elapsed_ms
      ?? song?.positionMs
      ?? song?.position_ms
      ?? 0
    );
    let duration = toSeconds(
      song?.durationSeconds
      ?? song?.duration_seconds
      ?? song?.duration
      ?? song?.length
      ?? song?.lengthSeconds
      ?? song?.length_seconds
      ?? song?.durationMs
      ?? song?.duration_ms
      ?? song?.totalTime
      ?? song?.totalTimeSeconds
      ?? song?.total_time
      ?? song?.total_time_seconds
      ?? 0
    );
    const isPaused = Boolean(song?.isPaused ?? song?.is_paused ?? false);

    const progressRatio = safeProgress(song);
    if (duration > 0 && elapsed <= 0 && progressRatio != null) {
      elapsed = duration * progressRatio;
    }
    if (prevNow && prevNow.videoId && prevNow.videoId === videoId) {
      if (!duration && prevNow.duration) duration = prevNow.duration;
      if (elapsed <= 0 && prevNow.elapsed >= 0) {
        const delta = prevNow.isPaused ? 0 : (Date.now() - prevUpdatedAt) / 1000;
        elapsed = prevNow.elapsed + delta;
      }
    }

    state.now = {
      videoId,
      title: cleanTitleMeta(safeTitle(song)),
      artist: cleanTitleMeta(safeArtist(song) || normStr(song?.artists?.[0]?.name)),
      album: cleanTitleMeta(safeAlbum(song)),
      thumbnail: safeThumb(song),
      elapsed,
      duration,
      isPaused,
      volume: state.volume,
      progress: progressRatio,
      views: countFromAny(
        "views",
        song?.viewCount,
        song?.views,
        song?.view_count,
        song?.viewCountText,
        song?.viewsText,
        song?.videoDetails?.viewCount,
        song?.videoDetails?.viewCountText
      ),
      likes: countFromAny(
        "likes",
        song?.likeCount,
        song?.likes,
        song?.like_count,
        song?.likeCountText,
        song?.likesText,
        song?.videoDetails?.likeCount,
        song?.videoDetails?.likeCountText
      )
    };
    state.nowUpdatedAt = Date.now();
    if (!state.now.thumbnail && state.now.videoId) {
      state.now.thumbnail = `https://i.ytimg.com/vi/${state.now.videoId}/hqdefault.jpg`;
    }
  }

  if (queueOk && queueRaw) {
    const arr = extractQueueArray(queueRaw);
    state.queue = arr.map(normalizeQueueItem).filter(x => x.videoId || x.title);
  }

  if (shuffleOk && shuffleRaw) {
    const v = parseShuffle(shuffleRaw);
    if (v != null) state.shuffle = v;
  }

  if (repeatOk && repeatRaw) {
    const v = parseRepeat(repeatRaw);
    if (v) state.repeat = v;
  }

  if (likeOk && likeRaw) {
    const v = parseLikeState(likeRaw);
    if (v) state.likeState = v;
  }

  if (state.now && state.now.videoId) {
    const cur = state.queue.find(q => q.videoId === state.now.videoId);
    if (cur) {
      if (!state.now.duration && cur.duration) state.now.duration = cur.duration;
      if (!state.now.artist && cur.artist) state.now.artist = cur.artist;
      if (!state.now.album && cur.album) state.now.album = cur.album;
      if (!state.now.thumbnail && cur.thumbnail) state.now.thumbnail = cur.thumbnail;
    }
  }

  if (volumeOk && volumeRaw) {
    const vol = safeVolume(volumeRaw);
    if (vol != null) state.volume = vol;
  }
  if (debugVolume && (volumeOk || !volumeSupported)) {
    const nowTs2 = Date.now();
    if ((nowTs2 - lastVolLogTs) > 5000) {
      lastVolLogTs = nowTs2;
      let rawStr = "";
      try {
        rawStr = volumeRaw == null ? "(empty)" : (typeof volumeRaw === "string" ? volumeRaw : JSON.stringify(volumeRaw));
      } catch {
        rawStr = "(unserializable)";
      }
      const vol = safeVolume(volumeRaw);
      console.log(`[YTM] volume probe: supported=${volumeSupported} ok=${volumeOk} parsed=${vol ?? "null"} raw=${rawStr.slice(0, 200)}`);
    }
  }
}

setInterval(pollPearOnce, pollMs);
pollPearOnce();

/** -----------------------------
 *  Streamer.bot WS
 *  ----------------------------- */
const sb = new StreamerbotClient({
  host: cfg.streamerbot.host,
  port: cfg.streamerbot.port,
  password: cfg.streamerbot.password || undefined,
  onError: (err) => pushError(`Streamer.bot WS error: ${err?.message || err}`)
});

sb.on("General.Custom", (payload) => {
  const data = payload?.data;
  const eventName = data?.eventName || "";
  const args = data?.args || {};
  const text = typeof data === "string" ? data : "";

  // Convention:
  // eventName: "ytm.queue.add" | "ytm.queue.pick"
  // args: { user, videoId, title, artist }
  if (eventName) {
    if (eventName === "ytm.queue.add" || eventName === "ytm.queue.pick") {
      const rawUser = normStr(
        args.user
        || args.login
        || args.requester
        || args.requestedBy
        || args.addedBy
        || args.userName
        || args.userLogin
      );
      const color = normStr(args.color || args.userColor || args.displayColor || args.nameColor);
      const user = rawUser.replace(/^@/, "").toLowerCase();
      const videoId = normStr(args.videoId || args.videoID || args.id || args.video_id);
      const title = normStr(args.title || args.trackTitle || args.songTitle);
      const artist = normStr(args.artist || args.author || args.channel);
      const album = normStr(args.album || args.albumName);
      const thumbnail = normStr(args.thumbnail || args.thumb || args.image);

      if (videoId) {
        state.addedBy.set(videoId, { user, ts: Date.now(), title, artist, album, thumbnail, color });
      }
      if (!title && !artist && videoId) {
        console.log(`[YTM] add: @${user} -> ${videoId}`);
      }
    } else if (eventName === "ytm.volume") {
      const v = Number(args.volume ?? args.vol ?? args.value ?? args.percent);
      if (Number.isFinite(v)) {
        state.volume = v <= 1 ? Math.round(v * 100) : Math.round(v);
      }
    } else {
      pushToast(`[SB] ${eventName}`);
    }
  } else if (text) {
    pushToast(`[SB] ${text}`);
  }
});

/** -----------------------------
 *  HTTP server + SSE state stream
 *  ----------------------------- */
const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = () => {
    const maxQueue = Number(cfg?.overlay?.queueShowTop ?? 0);
    const baseQueue = (maxQueue && maxQueue > 0) ? state.queue.slice(0, maxQueue) : state.queue;
    const queueTop = baseQueue.map((q) => {
      const add = q.videoId ? state.addedBy.get(q.videoId) : null;
      return {
        ...q,
        addedBy: add?.user || q.addedBy || "",
        addedByColor: add?.color || "",
        album: q.album || add?.album || "",
        thumbnail: q.thumbnail || add?.thumbnail || ""
      };
    });

    const nowAdd = state.now?.videoId ? state.addedBy.get(state.now.videoId) : null;
    const nowQueue = state.now?.videoId ? state.queue.find(q => q.videoId === state.now.videoId) : null;
    let liveElapsed = state.now?.elapsed ?? 0;
    if (state.now && !state.now.isPaused && state.nowUpdatedAt) {
      liveElapsed = state.now.elapsed + (Date.now() - state.nowUpdatedAt) / 1000;
    }
    if (state.now?.duration > 0) {
      liveElapsed = Math.min(liveElapsed, state.now.duration);
    }

    const progressLive = (state.now?.duration > 0)
      ? Math.max(0, Math.min(1, liveElapsed / state.now.duration))
      : (state.now?.progress ?? null);

    const payload = {
      now: state.now ? {
        ...state.now,
        elapsed: liveElapsed,
        addedBy: nowAdd?.user || nowQueue?.addedBy || "",
        addedByColor: nowAdd?.color || "",
        album: state.now.album || nowAdd?.album || nowQueue?.album || "",
        thumbnail: state.now.thumbnail || nowAdd?.thumbnail || nowQueue?.thumbnail || "",
        volume: state.volume,
        progress: progressLive,
        views: state.now.views || nowQueue?.views || "",
        likes: state.now.likes || nowQueue?.likes || "",
        shuffle: state.shuffle,
        repeat: state.repeat,
        likeState: state.likeState
      } : null,
      queue: queueTop,
      toasts: state.toasts,
      volume: state.volume
    };

    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const timer = setInterval(send, 250);
  send();

  req.on("close", () => clearInterval(timer));
});

app.listen(cfg.server.port, () => {
  console.log(`Overlay server: http://127.0.0.1:${cfg.server.port}`);
  console.log(`OBS Browser Source URL: http://127.0.0.1:${cfg.server.port}/`);
});
