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
  queueScroll: document.getElementById("queueScroll"),
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

function hackerText(seed) {
  const base = String(seed || "").replace(/\s+/g, "");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    const idx = (base.charCodeAt(i % base.length) + i * 7) % chars.length;
    out += chars[idx];
  }
  return out || "SYSOK";
}

function pickStatusFill(now, qCount, volTxt) {
  const infoBase = `INFO:${now?.isPaused ? "PAUSE" : "PLAY"} | Q:${qCount} | VOL:${volTxt}`;
  const sys = `SYS:${hackerText(now?.title || now?.artist || "SYS")}`;
  const mem = `MEM:${Math.floor(32 + (Math.sin(Date.now() / 1500) + 1) * 16)}%`;
  const net = `NET:${Math.floor(40 + (Math.cos(Date.now() / 1200) + 1) * 20)}%`;
  const bit = `BIT:${now?.duration ? (now.duration > 600 ? "96" : "128") : "128"}kbps`;
  return [infoBase, sys, mem, net, bit];
}
let lastInfoPanelIndex = 0;

function setStatusPanels(items) {
  const panels = [el.statusUser, el.statusLikes, el.statusViews, el.statusInfo];
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    if (!panel) continue;
    panel.innerHTML = "";
    const item = items[i];
    if (!item) {
      panel.textContent = "";
      continue;
    }
    if (item.type === "badge") {
      const label = document.createElement("span");
      label.className = "status-label";
      label.textContent = "Added by:";
      const badge = document.createElement("span");
      badge.className = "status-badge";
      badge.textContent = `@${String(item.user || "").replace(/^@/, "")}`;
      badge.style.color = item.color || hashColor(item.user || "");
      panel.appendChild(label);
      panel.appendChild(badge);
    } else {
      panel.textContent = item.text || "";
    }
  }
}

function buildStatusItems(now, qCount, volTxt) {
  const items = [];
  if (now?.addedBy) {
    items.push({ type: "badge", user: now.addedBy, color: now.addedByColor || "" });
  }

  const likes = now?.likes ? `LIKES:${now.likes}` : "";
  const views = now?.views ? `VIEWS:${now.views}` : "";
  const likeView = likes && views ? `${likes} | ${views}` : (likes || views);
  if (likeView) items.push({ type: "text", text: likeView });

  const infoBits = [];
  infoBits.push(`INFO:${now?.isPaused ? "PAUSE" : "PLAY"}`);
  infoBits.push(`Q:${qCount}`);
  infoBits.push(`VOL:${volTxt}`);
  if (now?.shuffle != null) infoBits.push(`SHUF:${now.shuffle ? "ON" : "OFF"}`);
  if (now?.repeat) infoBits.push(`REP:${now.repeat}`);
  if (now?.likeState) infoBits.push(`LIKE:${now.likeState}`);
  const infoTxt = infoBits.join(" | ");
  items.push({ type: "text", text: infoTxt, _isInfo: true });

  const fillers = pickStatusFill(now, qCount, volTxt).slice(1);
  while (items.length < 4) {
    const t = fillers.shift() || `SYS:${hackerText(now?.title || now?.artist || "SYS")}`;
    items.push({ type: "text", text: t });
  }

  const infoIndex = items.findIndex(i => i?._isInfo);
  lastInfoPanelIndex = infoIndex >= 0 ? infoIndex : 2;
  lastInfoBase = infoTxt.split(" | VOL")[0];

  return items.slice(0, 4);
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

let lastRealVol = null;
let lastInfoBase = "";
const VOL_GAMMA = 1.0; // keep linear unless we need compensation

function applyVolumeCurve(pct) {
  const p = clampPct(pct) / 100;
  if (!Number.isFinite(p)) return 0;
  if (VOL_GAMMA === 1) return clampPct(p * 100);
  return clampPct(Math.pow(p, VOL_GAMMA) * 100);
}

function renderVolumePct(pct) {
  if (el.volRow) el.volRow.style.display = "";
  if (el.volFill) el.volFill.style.width = `${pct}%`;
  if (el.volKnob) el.volKnob.style.left = `${pct}%`;
  if (el.volPct) el.volPct.textContent = `${Math.round(pct)}%`;
}

function fakeVolume() {
  const t = Date.now() / 1000;
  return 35 + 15 * Math.sin(t * 0.6);
}

function getDisplayVol(vol) {
  if (Number.isFinite(vol)) return applyVolumeCurve(vol);
  if (lastRealVol != null) return applyVolumeCurve(lastRealVol);
  return applyVolumeCurve(fakeVolume());
}

function setVolume(vol) {
  if (vol == null || !Number.isFinite(vol)) {
    renderVolumePct(getDisplayVol(vol));
    return;
  }
  lastRealVol = clampPct(vol);
  renderVolumePct(applyVolumeCurve(lastRealVol));
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

function buildSection(label) {
  const div = document.createElement("div");
  div.className = "queue-section";
  div.textContent = label;
  return div;
}

let lastVideoId = "";
let lastPaused = null;
let liveNow = null;
let rafId = 0;
let lastFrameTs = 0;
let scrollDir = -1;
let scrollPauseUntil = 0;
let lastAutoTs = 0;
let lastQueueKey = "";
let lastCurrentId = "";
let autoScrollPos = null;
let lastMaxScroll = 0;

function updateAutoScroll() {
  const sc = el.queueScroll;
  if (!sc) return;
  const maxScroll = sc.scrollHeight - sc.clientHeight;
  if (maxScroll <= 1) {
    updateAutoScroll._init = false;
    autoScrollPos = null;
    lastMaxScroll = maxScroll;
    return;
  }
  const now = performance.now();

  if (!updateAutoScroll._init || autoScrollPos == null) {
    autoScrollPos = maxScroll; // start at bottom
    scrollDir = -1; // move up first
    updateAutoScroll._init = true;
    lastAutoTs = now;
    scrollPauseUntil = now + 600;
    lastMaxScroll = maxScroll;
    sc.scrollTop = autoScrollPos;
    return;
  }

  if (Math.abs(maxScroll - lastMaxScroll) > 1) {
    autoScrollPos = Math.min(autoScrollPos, maxScroll);
    lastMaxScroll = maxScroll;
  }

  if (now < scrollPauseUntil) return;

  const dt = Math.max(0, (now - lastAutoTs) / 1000);
  lastAutoTs = now;
  const speed = 8;
  let next = autoScrollPos + speed * dt * scrollDir;

  if (next <= 0) {
    next = 0;
    scrollDir = 1;
    scrollPauseUntil = now + 700;
  } else if (next >= maxScroll) {
    next = maxScroll;
    scrollDir = -1;
    scrollPauseUntil = now + 700;
  }

  autoScrollPos = next;
  sc.scrollTop = autoScrollPos;
}

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
  if (liveNow && lastRealVol == null) {
    renderVolumePct(clampPct(fakeVolume()));
  }
  if (lastInfoBase && lastRealVol == null) {
    const v = Math.round(getDisplayVol(NaN));
    const panels = [el.statusUser, el.statusLikes, el.statusViews, el.statusInfo];
    const panel = panels[lastInfoPanelIndex];
    if (panel) panel.textContent = `${lastInfoBase} | VOL:${v}%`;
  }
  updateAutoScroll();

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
    lastInfoBase = "INFO: READY | Q:0";
    lastInfoPanelIndex = 2;
    setStatusPanels([
      { type: "text", text: "USER: --" },
      { type: "text", text: "LIKES: -- | VIEWS: --" },
      { type: "text", text: "INFO: READY | Q:0 | VOL:--" },
      { type: "text", text: `SYS:${hackerText("READY")}` }
    ]);
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
    setLine(el.nowStatus, "");
    setAddedToast(now.addedBy || "", now.addedByColor || "");

    const qCount = Array.isArray(data.queue) ? data.queue.length : 0;
    const vol = Number(data.volume ?? now.volume);
    const volPct = getDisplayVol(vol);
    const volTxt = `${Math.round(volPct)}%`;
    const items = buildStatusItems(now, qCount, volTxt);
    setStatusPanels(items);

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
    if (!current || !(current.title || current.videoId)) {
      el.queueCurrent.innerHTML = "";
      lastCurrentId = "";
    } else if (current.videoId !== lastCurrentId) {
      el.queueCurrent.innerHTML = "";
      el.queueCurrent.appendChild(buildQueueItem(current, true));
      lastCurrentId = current.videoId;
    }
  }

  const all = Array.isArray(data.queue) ? data.queue : [];
  const curId = current?.videoId || "";
  const idx = curId ? all.findIndex(q => q.videoId === curId) : -1;
  const past = idx > 0 ? all.slice(0, idx) : [];
  const upcoming = idx >= 0 ? all.slice(idx + 1) : all.slice();
  const filteredUpcoming = upcoming.filter(q => !curId || q.videoId !== curId);
  const filteredPast = past.filter(q => !curId || q.videoId !== curId);

  const queueKey = `${curId}|${all.map(q => q.videoId || q.title || "").join("|")}`;
  if (queueKey !== lastQueueKey) {
    lastQueueKey = queueKey;
    el.queue.innerHTML = "";
    if (filteredPast.length) {
      el.queue.appendChild(buildSection("Passées"));
      for (const q of filteredPast) el.queue.appendChild(buildQueueItem(q, false));
    }
    if (filteredUpcoming.length) {
      el.queue.appendChild(buildSection("À suivre"));
      for (const q of filteredUpcoming) el.queue.appendChild(buildQueueItem(q, false));
    }
    // keep auto scroll state; height changes are handled in updateAutoScroll
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
