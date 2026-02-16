# YTM Overlay Win98 (Pear + Streamer.bot)

This is a lightweight OBS Browser Source overlay that looks like a Windows 98 mini music player.

## What it does
- Polls Pear Desktop API:
  - `GET /api/v1/song`
  - `GET /api/v1/queue`
- Listens to Streamer.bot WebSocket **Custom** events (`General.Custom`) to display:
  - who added which track (best-effort)
  - toast notifications

## Install
```bash
npm install
npm start
```

## OBS
Create a **Browser Source** with:
- URL: `http://127.0.0.1:7777/`
- Width/Height: start with 960x300 and adjust

## Configure
Edit `config.json`:
- Pear API baseUrl (default `http://localhost:26538`)
- Streamer.bot WS host/port/password
- Overlay queue size / poll interval

## Streamer.bot Custom Event convention
Send a custom event when you add a track:

- Event Name: `ytm.queue.add` (or `ytm.queue.pick`)
- Args: `{ user, videoId, title, artist }`

The overlay will show `(@user)` in the queue and the "added by" badge in Now Playing when possible.

---

If Pear token isn't present, the server will call `POST /auth/{clientId}` once. Accept the Pear authorization prompt, then it will save `pear-token.json`.
