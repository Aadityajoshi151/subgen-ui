const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8585;

const CONTENT_DIR = path.resolve(process.cwd(), 'content');
const CONFIG_DIR = path.resolve(process.cwd(), 'config');
const LEGACY_SETTINGS_PATH = path.resolve(process.cwd(), 'user-settings.json');
const USER_SETTINGS_PATH = path.join(CONFIG_DIR, 'user-settings.json');

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

function getDirTree(dirPath, basePath = CONTENT_DIR) {
  const name = path.basename(dirPath);
  let type = 'folder';
  let children = [];
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) type = 'file';
  } catch {
    return null;
  }
  if (type === 'folder') {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      children = entries
        .filter(e => !e.name.startsWith('.'))
        .map(ent => getDirTree(path.join(dirPath, ent.name), basePath))
        .filter(Boolean)
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      children = [];
    }
  }
  const relPath = path.relative(basePath, dirPath);
  return { name, path: relPath, type, children };
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
  const tree = getDirTree(CONTENT_DIR);
  res.json({ exists: true, tree });
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

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
