function fmtTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const el = {
  nowTitle: document.getElementById("nowTitle"),
  nowArtist: document.getElementById("nowArtist"),
  nowAlbum: document.getElementById("nowAlbum"),
  nowDuration: document.getElementById("nowDuration"),
  nowStatus: document.getElementById("nowStatus"),
  nowAddedToast: document.getElementById("nowAddedToast"),
  tNow: document.getElementById("tNow"),
  tDur: document.getElementById("tDur"),
  fill: document.getElementById("progFill"),
  knob: document.getElementById("progKnob"),
  btnPrev: document.getElementById("btnPrev"),
  btnPlay: document.getElementById("btnPlay"),
  btnNext: document.getElementById("btnNext"),
  statusUser: document.getElementById("statusUser"),
  statusLikes: document.getElementById("statusLikes"),
  statusViews: document.getElementById("statusViews"),
  statusInfo: document.getElementById("statusInfo"),
  thumb: document.getElementById("nowThumb"),
  queueCurrent: document.getElementById("queueCurrent"),
  queue: document.getElementById("queueList"),
  toastStack: document.getElementById("toastStack"),
  volRow: document.getElementById("volRow"),
  volFill: document.getElementById("volFill"),
  volKnob: document.getElementById("volKnob"),
  volPct: document.getElementById("volPct")
};

const EMPTY_IMG =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function setLine(node, text) {
  const t = String(text ?? "").trim();
  node.textContent = t;
  node.style.display = t ? "" : "none";
}

function setKV(node, label, value) {
  const v = String(value ?? "").trim();
  if (!v) {
    node.textContent = "";
    node.style.display = "none";
    return;
  }
  node.style.display = "";
  node.innerHTML = "";
  const l = document.createElement("span");
  l.className = "info-label";
  l.textContent = label;
  const val = document.createElement("span");
  val.className = "info-value";
  val.textContent = v;
  node.appendChild(l);
  node.appendChild(val);
}

function setAddedToast(user, color) {
  if (!el.nowAddedToast) return;
  const u = String(user || "").trim();
  if (!u) {
    el.nowAddedToast.style.display = "none";
    el.nowAddedToast.textContent = "";
    return;
  }
  el.nowAddedToast.style.display = "";
  el.nowAddedToast.innerHTML = "";
  const label = document.createElement("span");
  label.className = "info-toast-label";
  label.textContent = "Ajouté par";
  const name = document.createElement("span");
  name.className = "info-toast-user";
  name.textContent = `@${u.replace(/^@/, "")}`;
  name.style.color = color || hashColor(u);
  el.nowAddedToast.appendChild(label);
  el.nowAddedToast.appendChild(name);
}

function setStatus(user, likes, views, info) {
  if (el.statusUser) el.statusUser.textContent = user || "";
  if (el.statusLikes) el.statusLikes.textContent = likes || "";
  if (el.statusViews) el.statusViews.textContent = views || "";
  if (el.statusInfo) el.statusInfo.textContent = info || "";
}

function clampPct(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function pulse(btn) {
  if (!btn) return;
  btn.classList.add("is-pressed");
  clearTimeout(btn._pulseTimer);
  btn._pulseTimer = setTimeout(() => btn.classList.remove("is-pressed"), 220);
}

function setVolume(vol) {
  if (vol == null || !Number.isFinite(vol)) {
    if (el.volRow) el.volRow.style.display = "none";
    return;
  }
  const pct = clampPct(vol);
  if (el.volRow) el.volRow.style.display = "";
  if (el.volFill) el.volFill.style.width = `${pct}%`;
  if (el.volKnob) el.volKnob.style.left = `${pct}%`;
  if (el.volPct) el.volPct.textContent = `${Math.round(pct)}%`;
}

function pickThumb(thumb, videoId) {
  if (thumb) return thumb;
  if (videoId) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return "";
}

const TWITCH_COLORS = [
  "#FF0000", "#0000FF", "#008000", "#B22222", "#FF7F50", "#9ACD32",
  "#FF4500", "#2E8B57", "#DAA520", "#D2691E", "#5F9EA0", "#1E90FF",
  "#FF69B4", "#8A2BE2", "#00FF7F"
];

function hashColor(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TWITCH_COLORS[h % TWITCH_COLORS.length];
}

function buildQueueItem(q, isCurrent = false) {
  const li = document.createElement("div");
  li.className = `queue-item${isCurrent ? " is-current" : ""}`;

  const img = document.createElement("img");
  img.className = "queue-thumb";
  const qThumb = pickThumb(q.thumbnail, q.videoId);
  img.src = qThumb || EMPTY_IMG;
  if (!qThumb) img.classList.add("is-empty");
  img.alt = "";

  const text = document.createElement("div");
  text.className = "queue-text";

  const title = q.title || "";
  const artist = q.artist || "";
  const album = q.album || "";
  const duration = q.duration ? fmtTime(q.duration) : "";
  const by = q.addedBy ? `@${q.addedBy}` : "";
  const byColor = q.addedByColor || (q.addedBy ? hashColor(q.addedBy) : "");

  if (by) {
    const badge = document.createElement("div");
    badge.className = "queue-toast";
    badge.textContent = by;
    if (byColor) badge.style.color = byColor;
    text.appendChild(badge);
  }

  const addLine = (label, value) => {
    const v = String(value || "").trim();
    if (!v) return;
    const line = document.createElement("div");
    line.className = "queue-line";
    const l = document.createElement("span");
    l.className = "queue-label";
    l.textContent = label;
    const val = document.createElement("span");
    val.className = "queue-value";
    val.textContent = v;
    line.appendChild(l);
    line.appendChild(val);
    text.appendChild(line);
  };

  addLine("Titre", title || "Unknown");
  addLine("Artiste", artist);
  addLine("Album", album);
  addLine("Durée", duration);

  li.appendChild(img);
  li.appendChild(text);
  return li;
}

let lastVideoId = "";
let lastPaused = null;
let liveNow = null;
let rafId = 0;
let lastFrameTs = 0;

function updateProgress() {
  if (!liveNow) {
    el.tNow.textContent = "0:00";
    el.tDur.textContent = "0:00";
    el.fill.style.width = "0%";
    if (el.knob) el.knob.style.left = "0%";
    return;
  }
  const elapsed = Number(liveNow.elapsed) || 0;
  const duration = Number(liveNow.duration) || 0;
  if (duration > 0) {
    el.tNow.textContent = fmtTime(elapsed);
    el.tDur.textContent = fmtTime(duration);
  } else {
    el.tNow.textContent = fmtTime(elapsed);
    el.tDur.textContent = "0:00";
  }
  let pct = 0;
  if (duration > 0) pct = clampPct((elapsed / duration) * 100);
  else if (Number.isFinite(liveNow.progress)) pct = clampPct(liveNow.progress * 100);
  el.fill.style.width = `${pct}%`;
  if (el.knob) el.knob.style.left = `${pct}%`;
}

function tick(ts) {
  if (!lastFrameTs) lastFrameTs = ts;
  const dt = (ts - lastFrameTs) / 1000;
  lastFrameTs = ts;

  if (liveNow && !liveNow.paused) {
    liveNow.elapsed = (Number(liveNow.elapsed) || 0) + dt;
    if (liveNow.duration > 0) {
      liveNow.elapsed = Math.min(liveNow.elapsed, liveNow.duration);
    }
    updateProgress();
  }

  rafId = requestAnimationFrame(tick);
}

function ensureTicker() {
  if (rafId) return;
  rafId = requestAnimationFrame(tick);
}

function render(data) {
  const now = data.now;

  if (!now) {
    liveNow = null;
    lastFrameTs = 0;
    el.nowTitle.textContent = "Rien en lecture";
    setLine(el.nowArtist, "");
    setLine(el.nowAlbum, "");
    setLine(el.nowDuration, "");
    setLine(el.nowStatus, "");
    setAddedToast("", "");
    updateProgress();
    if (el.btnPlay) el.btnPlay.classList.remove("is-paused");
    el.thumb.src = EMPTY_IMG;
    el.thumb.classList.add("is-empty");
    if (el.btnPlay) el.btnPlay.classList.remove("is-pressed");
    setVolume(null);
    setStatus("USER: --", "LIKES: --", "VIEWS: --", "INFO: READY");
    lastVideoId = "";
    lastPaused = null;
  } else {
    const title = now.title || "Unknown";
    const artist = now.artist || "";
    const album = now.album || "";
    const by = now.addedBy ? `@${now.addedBy}` : "";

    setKV(el.nowTitle, "Titre", title);
    setKV(el.nowArtist, "Artiste", artist);
    setKV(el.nowAlbum, "Album", album);
    setKV(el.nowDuration, "Durée", now.duration ? fmtTime(now.duration) : "");
    setKV(el.nowStatus, "Statut", now.isPaused ? "Pause" : "Lecture");
    setAddedToast(now.addedBy || "", now.addedByColor || "");

    const qCount = Array.isArray(data.queue) ? data.queue.length : 0;
    const vol = Number(data.volume ?? now.volume);
    const volTxt = Number.isFinite(vol) ? `${Math.round(vol)}%` : "--";
    const userTxt = now.addedBy ? `USER: @${now.addedBy}` : (artist ? `ARTIST: ${artist}` : `TRACK: ${title}`);
    const likesTxt = now.likes ? `LIKES: ${now.likes}` : (album ? `ALBUM: ${album}` : "LIKES: --");
    const viewsTxt = now.views ? `VIEWS: ${now.views}` : (now.duration ? `LEN: ${fmtTime(now.duration)}` : "VIEWS: --");
    const infoTxt = `INFO: ${now.isPaused ? "PAUSE" : "PLAY"} | Q:${qCount} | VOL:${volTxt}`;
    setStatus(userTxt, likesTxt, viewsTxt, infoTxt);

    liveNow = {
      elapsed: Number(now.elapsed) || 0,
      duration: Number(now.duration) || 0,
      paused: Boolean(now.isPaused),
      progress: Number.isFinite(now.progress) ? now.progress : null
    };
    updateProgress();

    if (el.btnPlay) el.btnPlay.classList.toggle("is-paused", now.isPaused);
    if (el.btnPlay) el.btnPlay.classList.toggle("is-pressed", now.isPaused);
    const thumb = pickThumb(now.thumbnail, now.videoId);
    el.thumb.src = thumb || EMPTY_IMG;
    el.thumb.classList.toggle("is-empty", !thumb);
    setVolume(Number(data.volume ?? now.volume));

    if (now.videoId && now.videoId !== lastVideoId) {
      pulse(el.btnNext);
      lastVideoId = now.videoId;
      lastFrameTs = 0;
    }
    if (lastPaused !== null && now.isPaused !== lastPaused) {
      pulse(el.btnPlay);
    }
    lastPaused = now.isPaused;
  }

  const current = now ? {
    videoId: now.videoId,
    title: now.title || "",
    artist: now.artist || "",
    album: now.album || "",
    duration: now.duration || 0,
    thumbnail: now.thumbnail || "",
    addedBy: now.addedBy || "",
    addedByColor: now.addedByColor || ""
  } : null;

  if (el.queueCurrent) {
    el.queueCurrent.innerHTML = "";
    if (current && (current.title || current.videoId)) {
      el.queueCurrent.appendChild(buildQueueItem(current, true));
    }
  }

  const list = (data.queue || []).filter(q => !current || q.videoId !== current.videoId);
  el.queue.innerHTML = "";
  for (const q of list) {
    el.queue.appendChild(buildQueueItem(q, false));
  }

  el.toastStack.innerHTML = "";
  for (const t of (data.toasts || [])) {
    if (t && t.kind === "add") continue;
    const div = document.createElement("div");
    div.className = "toast";
    if (typeof t === "string") {
      div.textContent = t;
    } else if (t && t.kind === "add" && t.user) {
      const user = document.createElement("span");
      user.className = "toast-user";
      user.textContent = `@${t.user}`;
      user.style.color = t.color || hashColor(t.user);
      const text = document.createElement("span");
      text.className = "toast-text";
      const track = t.track || "";
      text.textContent = track ? ` a ajouté: ${track}` : " a ajouté un morceau";
      div.appendChild(user);
      div.appendChild(text);
    } else {
      div.textContent = t?.text || "";
    }
    el.toastStack.appendChild(div);
  }

  ensureTicker();
}

const es = new EventSource("/sse");
es.onmessage = (ev) => {
  try {
    render(JSON.parse(ev.data));
  } catch {}
};
