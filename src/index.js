const express = require('express');
const fs = require('fs');
const path = require('path');
const subgenLogs = require('./subgenLogs');

const app = express();
const PORT = 8585;

const CONTENT_DIR = path.resolve(process.cwd(), 'content');
const CONFIG_DIR = path.resolve(process.cwd(), 'config');
const LEGACY_SETTINGS_PATH = path.resolve(process.cwd(), 'user-settings.json');
const USER_SETTINGS_PATH = path.join(CONFIG_DIR, 'user-settings.json');

const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts'
]);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub']);

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// A subtitle "belongs" to a video if its name (minus subtitle extension,
// minus an optional trailing language code like ".en") starts with the
// video's basename, e.g. "ep1.mkv" <- "ep1.srt" / "ep1.en.srt".
function subtitleMatchesVideo(subtitleBase, videoBase) {
  return subtitleBase === videoBase || subtitleBase.startsWith(videoBase + '.');
}

function nonHiddenNames(dirPath) {
  try {
    return fs.readdirSync(dirPath).filter(n => !n.startsWith('.'));
  } catch {
    return [];
  }
}

// Lists only the immediate children of dirPath (one level deep) so that
// browsing a large library doesn't require walking the entire tree up front.
// Subtitle files are hidden from the listing; instead the video they belong
// to is flagged with hasSubtitle.
function listChildren(dirPath, basePath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const visible = entries.filter(e => !e.name.startsWith('.'));
  const subtitleBases = visible
    .filter(e => !e.isDirectory() && SUBTITLE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map(e => path.basename(e.name, path.extname(e.name)));

  return visible
    .filter(e => e.isDirectory() || !SUBTITLE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map(ent => {
      const fullPath = path.join(dirPath, ent.name);
      const isDir = ent.isDirectory();
      const relPath = path.relative(basePath, fullPath).split(path.sep).join('/');
      const node = { name: ent.name, path: relPath, type: isDir ? 'folder' : 'file' };
      if (isDir) {
        const childNames = nonHiddenNames(fullPath);
        const childSubtitleExts = childNames.filter(n => SUBTITLE_EXTENSIONS.has(path.extname(n).toLowerCase()));
        node.childCount = childNames.length - childSubtitleExts.length;
      } else {
        const videoBase = path.basename(ent.name, path.extname(ent.name));
        node.hasSubtitle = subtitleBases.some(sb => subtitleMatchesVideo(sb, videoBase));
      }
      return node;
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

// Recursively collects video files under dirPath. Only used at generate-time
// (an explicit user action), not on every tree load.
function collectVideoFiles(dirPath, basePath, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, ent.name);
    if (ent.isDirectory()) {
      collectVideoFiles(fullPath, basePath, out);
    } else if (VIDEO_EXTENSIONS.has(path.extname(ent.name).toLowerCase())) {
      const relPath = path.relative(basePath, fullPath).split(path.sep).join('/');
      out.push(relPath);
    }
  }
  return out;
}

function safeResolveContent(p) {
  const requested = path.resolve(CONTENT_DIR, p || '');
  if (!requested.startsWith(CONTENT_DIR)) return null;
  return requested;
}

function defaultSettings() {
  return { serverHost: '', serverPort: '', defaultLanguage: 'en', subgenContainerName: '' };
}

const LANGUAGE_MAP = {
  english: 'en', en: 'en',
  spanish: 'es', es: 'es',
  french: 'fr', fr: 'fr',
  german: 'de', de: 'de',
  hindi: 'hi', hi: 'hi',
  japanese: 'ja', ja: 'ja'
};

function normalizeLanguage(val) {
  if (!val || typeof val !== 'string') return 'en';
  const lower = val.trim().toLowerCase();
  return LANGUAGE_MAP[lower] || 'en';
}

function ensureConfigDir() {
  try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
}

function readSettings() {
  ensureConfigDir();
  try {
    if (fs.existsSync(USER_SETTINGS_PATH)) {
      const raw = fs.readFileSync(USER_SETTINGS_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      parsed.defaultLanguage = normalizeLanguage(parsed.defaultLanguage);
      return { ...defaultSettings(), ...parsed };
    }
    if (fs.existsSync(LEGACY_SETTINGS_PATH)) {
      const rawLegacy = fs.readFileSync(LEGACY_SETTINGS_PATH, 'utf8');
      const parsedLegacy = JSON.parse(rawLegacy);
      parsedLegacy.defaultLanguage = normalizeLanguage(parsedLegacy.defaultLanguage);
      fs.writeFileSync(USER_SETTINGS_PATH, JSON.stringify(parsedLegacy, null, 2));
      return { ...defaultSettings(), ...parsedLegacy };
    }
    return null;
  } catch {
    return null;
  }
}

function writeSettings(s) {
  ensureConfigDir();
  const clean = { ...defaultSettings() };
  if (typeof s.serverHost === 'string') clean.serverHost = s.serverHost.trim();
  if (s.serverPort !== undefined && s.serverPort !== null) {
    const n = Number(s.serverPort);
    if (!Number.isNaN(n) && n >= 1 && n <= 65535) clean.serverPort = String(n);
  }
  clean.defaultLanguage = normalizeLanguage(s.defaultLanguage);
  if (typeof s.subgenContainerName === 'string') clean.subgenContainerName = s.subgenContainerName.trim();
  fs.writeFileSync(USER_SETTINGS_PATH, JSON.stringify(clean, null, 2));
  return clean;
}

app.get('/api/tree', (req, res) => {
  if (!fs.existsSync(CONTENT_DIR)) {
    return res.json({ exists: false, message: 'content directory not found', tree: null });
  }
  const rel = typeof req.query.path === 'string' ? req.query.path : '';
  const target = safeResolveContent(rel);
  if (!target) return res.status(400).json({ error: 'Invalid path' });
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
  if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a folder' });
  const children = listChildren(target, CONTENT_DIR);
  res.json({ exists: true, path: rel, children });
});

app.get('/api/settings', (req, res) => {
  const s = readSettings();
  if (!s) return res.json({ exists: false, settings: defaultSettings() });
  res.json({ exists: true, settings: s });
});

app.post('/api/settings', (req, res) => {
  try {
    const saved = writeSettings(req.body || {});
    subgenLogs.configure(saved.subgenContainerName, handleSubgenLogEvent, handleSubgenLogStatus);
    res.json({ ok: true, settings: saved });
  } catch {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.post('/api/select', (req, res) => {
  const rel = (req.body && req.body.path) || '';
  const full = safeResolveContent(rel);
  if (!full) return res.status(400).json({ error: 'Invalid path' });
  try {
    const stat = fs.statSync(full);
    const type = stat.isDirectory() ? 'folder' : 'file';
    console.log('[Generate Subs] Selected:', { type, path: full });
    return res.json({ ok: true, type, relPath: rel, absolutePath: full });
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
});

// --- Progress tracking -----------------------------------------------
// Subgen has no polling/status API. Two sources feed progress here:
// 1. WEBHOOK_URL_COMPLETED - subgen POSTs {file, subtitle, language} when a
//    file finishes; reliable but binary (no percentage, fires only on success).
// 2. Tailing the subgen container's own logs (via Docker socket, optional) -
//    gives live "WORKER START" / "NN%" / "WORKER FINISH" lines per file.
// This all resets on server restart.
const trackedJobs = new Map(); // relPath -> { relPath, type, groupPath, status, percent, subtitle, language, queuedAt, completedAt }
let submitCounter = 0;
let subgenLogStatus = { state: 'disabled', detail: null, containerName: null };

function findJobByDisplayName(name) {
  for (const job of trackedJobs.values()) {
    if (path.basename(job.relPath) === name) return job;
  }
  // ProgressHandler truncates long filenames to 37 chars + "..".
  if (name.endsWith('..')) {
    const prefix = name.slice(0, -2);
    for (const job of trackedJobs.values()) {
      if (path.basename(job.relPath).startsWith(prefix)) return job;
    }
  }
  return null;
}

function handleSubgenLogEvent(event) {
  const job = findJobByDisplayName(event.name);
  if (!job) return;
  if (event.type === 'start') {
    job.status = 'processing';
    if (job.percent == null) job.percent = 0;
  } else if (event.type === 'progress') {
    job.status = 'processing';
    job.percent = event.percent;
  } else if (event.type === 'finish' && job.status !== 'done') {
    job.status = 'done';
    job.percent = 100;
    job.completedAt = job.completedAt || Date.now();
  }
}

function handleSubgenLogStatus(status) {
  subgenLogStatus = status;
  console.log('[Subgen Logs]', status.state, status.detail || '', status.containerName || '');
}

app.post('/api/generate', (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: 'No items provided' });

  const registered = [];
  for (const item of items) {
    const rel = (item && item.path) || '';
    const full = safeResolveContent(rel);
    if (!full) continue;
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const files = collectVideoFiles(full, CONTENT_DIR);
      for (const f of files) {
        submitCounter += 1;
        const job = { relPath: f, type: 'file', groupPath: rel, status: 'queued', percent: null, subtitle: null, language: null, order: submitCounter, queuedAt: Date.now(), completedAt: null };
        trackedJobs.set(f, job);
        registered.push(job);
      }
    } else {
      submitCounter += 1;
      const job = { relPath: rel, type: 'file', groupPath: null, status: 'queued', percent: null, subtitle: null, language: null, order: submitCounter, queuedAt: Date.now(), completedAt: null };
      trackedJobs.set(rel, job);
      registered.push(job);
    }
  }
  console.log('[Generate Subs] Registered for tracking:', registered.map(r => r.relPath));
  res.json({ ok: true, registered: registered.length });
});

app.post('/api/webhook/subgen-complete', (req, res) => {
  const body = req.body || {};
  const filePath = body.file || '';
  // Subgen reports the container path it was given, e.g. "/content/Show/ep1.mkv".
  const relPath = filePath.replace(/^\/?content\/?/, '');
  const job = trackedJobs.get(relPath);
  if (job) {
    job.status = 'done';
    job.percent = 100;
    job.subtitle = body.subtitle || null;
    job.language = body.language || null;
    job.completedAt = Date.now();
    console.log('[Generate Subs] Completed:', relPath);
  } else {
    console.log('[Generate Subs] Webhook for untracked file:', filePath);
  }
  res.json({ ok: true });
});

app.get('/api/progress', (req, res) => {
  const jobs = Array.from(trackedJobs.values()).sort((a, b) => a.order - b.order);
  let view = jobs;
  if (!subgenLogs.isActive()) {
    // No live log feed configured: fall back to a heuristic. With
    // CONCURRENT_TRANSCRIPTIONS=1 jobs run in submission order, so the oldest
    // still-queued job is the one most likely in progress right now.
    const firstQueued = jobs.find(j => j.status === 'queued');
    view = jobs.map(j => ({ ...j, status: j === firstQueued ? 'processing' : j.status }));
  }
  const groups = {};
  for (const j of view) {
    if (!j.groupPath) continue;
    if (!groups[j.groupPath]) groups[j.groupPath] = { total: 0, done: 0 };
    groups[j.groupPath].total += 1;
    if (j.status === 'done') groups[j.groupPath].done += 1;
  }
  res.json({ jobs: view, groups, logStatus: subgenLogStatus });
});

app.post('/api/progress/clear', (req, res) => {
  trackedJobs.clear();
  res.json({ ok: true });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  const initialSettings = readSettings();
  if (initialSettings && initialSettings.subgenContainerName) {
    subgenLogs.configure(initialSettings.subgenContainerName, handleSubgenLogEvent, handleSubgenLogStatus);
  }
});
