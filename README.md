# Subgen UI

A simple, modern web UI to browse a local `content/` folder. The server exposes APIs to read a directory tree and log a selected file or folder.

On selection, the absolute path is logged on the server console.

## Quick Start

```bash
# From project root
npm install
npm start
# Open the UI
open http://localhost:8585/
```

If you don't see any files, create a folder named `content` in the project root and add some files/folders inside it:

```bash
mkdir -p content
printf "Hello from content!\n" > content/hello.txt
mkdir -p content/docs && printf "Readme" > content/docs/readme.md
```

## Endpoints
- `GET /api/tree?path=<relPath>` – Returns the immediate children of a folder under `content/` (root when `path` is omitted). Loads one level at a time so browsing a large library stays fast.
- `GET /api/settings` – Returns `{ exists, settings }`.
- `POST /api/settings` – Saves `serverHost`, `serverPort`, `defaultLanguage` (ISO code), `subgenContainerName` to `config/user-settings.json`.
- `POST /api/generate` – JSON body `{ items: [{ path, type }] }`. Queues the selected files (expanding folders to their video files) and dispatches them to subgen one at a time.
- `GET /api/progress` – Returns tracked job statuses (`queued`/`processing`/`done`/`skipped`/`error`) and live log-tailing status.
- `POST /api/progress/clear` – Clears tracked jobs and the dispatch queue.

## Settings
On first run, the app will ask for:
- Subgen Server IP / host
- Subgen Server port
- Default language (ISO code default: `en`)

Languages stored as codes: `en, es, fr, de, hi, ja`.

These are saved in `user-settings.json` at the project root. You can open the settings modal anytime via the Settings button.

## Generation
Select one or more files/folders (checkboxes) and click "Generate Subs". The app will:
1. Call `POST /api/generate`, which validates the selection, expands any selected folders into their individual video files, and queues all of them server-side.
2. The server dispatches queued files to subgen's `/batch` endpoint **one at a time**:
	`POST http://<serverHost>:<serverPort>/batch?directory=/content/<relativePath>&forceLanguage=<langCode>`

	It only sends the next file once the current one is confirmed finished (or skipped) via live log tailing — see Progress Tracking below. This is deliberate: subgen doesn't reliably report *which* file a given progress line belongs to, so sending one at a time (rather than one big multi-file request) keeps progress attribution unambiguous.

The `directory` query parameter is container-relative (never the host absolute path). `<langCode>` is the stored default language (e.g. `en`). Since this request now originates from the Express server rather than the browser, CORS is not a concern — subgen just needs to be network-reachable from the subgen-ui container/host.

## Progress Tracking
Subgen has no polling/status API, so live progress is optional and comes from tailing the subgen container's own logs over the Docker socket:
- Set "Subgen Docker Container Name" in Settings (the name `docker ps` shows for it).
- Mount `/var/run/docker.sock:/var/run/docker.sock:ro` into subgen-ui (see `docker-compose.yaml`).

With that configured, each file shows live `queued → processing NN% → done` (or `skipped`, if subgen already had subtitles for it, or `error` if the request to subgen couldn't be sent). Without it, files still get dispatched correctly, you just won't see live percentages.

## Docker

### Build & Run (Docker CLI)

```bash
docker build -t subgen-ui .
docker run --name subgen-ui --rm -p 8585:8585 -v "$(pwd)/content:/app/content" subgen-ui
```

### Using Docker Compose

```bash
docker compose up --build
```

This will:
- Build the image from `Dockerfile` (node:20-alpine base).
- Expose the app on `localhost:8585`.
- Bind mount `./content` on the host into `/app/content` (read-only) in the container. If you need write access from the UI later, switch to `:rw`.

To stop:

```bash
docker compose down
```

### Persisting Settings

Settings now live in `config/user-settings.json`. The compose file mounts `./config` to `/app/config` (rw) so changes persist. If migrating from an older version that stored `user-settings.json` at the project root, the server will auto-migrate it into `config/` on first run.

### Rebuild After Code Changes

```bash
docker compose build --no-cache
docker compose up -d
```

### Logs

View container logs (selection events, etc.):

```bash
docker logs -f subgen-ui
```

