const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8585;

const CONTENT_DIR = path.resolve(process.cwd(), 'content');
const CONFIG_DIR = path.resolve(process.cwd(), 'config');
const LEGACY_SETTINGS_PATH = path.resolve(process.cwd(), 'user-settings.json');
const USER_SETTINGS_PATH = path.join(CONFIG_DIR, 'user-settings.json');

const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts'
]);

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Lists only the immediate children of dirPath (one level deep) so that
// browsing a large library doesn't require walking the entire tree up front.
function listChildren(dirPath, basePath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => !e.name.startsWith('.'))
    .map(ent => {
      const fullPath = path.join(dirPath, ent.name);
      const isDir = ent.isDirectory();
      const relPath = path.relative(basePath, fullPath).split(path.sep).join('/');
      const node = { name: ent.name, path: relPath, type: isDir ? 'folder' : 'file' };
      if (isDir) {
        let childCount = 0;
        try {
          childCount = fs.readdirSync(fullPath).filter(n => !n.startsWith('.')).length;
        } catch {
          childCount = 0;
        }
        node.childCount = childCount;
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
  return { serverHost: '', serverPort: '', defaultLanguage: 'en' };
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
// Subgen has no polling/status API, but it can POST a completion event
// (WEBHOOK_URL_COMPLETED) to us for every file it finishes. We keep an
// in-memory record of the files the user queued and flip them to 'done'
// as those webhook events arrive. This resets on server restart.
const trackedJobs = new Map(); // relPath -> { relPath, type, groupPath, status, subtitle, language, queuedAt, completedAt }
let submitCounter = 0;

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
        const job = { relPath: f, type: 'file', groupPath: rel, status: 'queued', subtitle: null, language: null, order: submitCounter, queuedAt: Date.now(), completedAt: null };
        trackedJobs.set(f, job);
        registered.push(job);
      }
    } else {
      submitCounter += 1;
      const job = { relPath: rel, type: 'file', groupPath: null, status: 'queued', subtitle: null, language: null, order: submitCounter, queuedAt: Date.now(), completedAt: null };
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
  // Heuristic: with CONCURRENT_TRANSCRIPTIONS=1 jobs run in submission order,
  // so the oldest still-queued job is the one most likely in progress right now.
  const firstQueued = jobs.find(j => j.status === 'queued');
  const view = jobs.map(j => ({
    ...j,
    status: j === firstQueued ? 'processing' : j.status
  }));
  const groups = {};
  for (const j of view) {
    if (!j.groupPath) continue;
    if (!groups[j.groupPath]) groups[j.groupPath] = { total: 0, done: 0 };
    groups[j.groupPath].total += 1;
    if (j.status === 'done') groups[j.groupPath].done += 1;
  }
  res.json({ jobs: view, groups });
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
});
