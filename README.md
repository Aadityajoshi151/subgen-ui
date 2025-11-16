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
- `GET /api/tree` – Returns the directory tree under `content/`.
- `POST /api/select` – JSON body `{ path, type }` returns `{ absolutePath, type }` and logs selection.
- `GET /api/settings` – Returns `{ exists, settings }`.
- `POST /api/settings` – Saves `serverHost`, `serverPort`, `defaultLanguage` (ISO code) to `user-settings.json`.

## Settings
On first run, the app will ask for:
- Subgen Server IP / host
- Subgen Server port
- Default language (ISO code default: `en`)

Languages stored as codes: `en, es, fr, de, hi, ja`.

These are saved in `user-settings.json` at the project root. You can open the settings modal anytime via the Settings button.

## Generation
Click "Generate Subs" after selecting a file or folder. The app will:
1. Call `POST /api/select` to validate selection.
2. Issue a `POST` (no body) to:
	`http://<serverHost>:<serverPort>/batch?directory=/content/<relativePath>&forceLanguage=<langCode>`

The `directory` parameter is always container-relative (never the host absolute path). Root selection would use `/content`.

Where `<langCode>` is the stored language (e.g. `en`). Ensure your Subgen server supports CORS if it is on a different origin; if not, proxy the request through the Express server.

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

`user-settings.json` is written within the container filesystem. To persist across container recreations, you can mount it:

```yaml
		volumes:
			- ./content:/app/content:rw
			- ./user-settings.json:/app/user-settings.json:rw
```

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

