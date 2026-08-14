const { spawn } = require('child_process');

// Maps both ISO 639-1 and the common ISO 639-2 variants ffprobe reports
// (from stream tags.language) to the 2-letter codes this app uses elsewhere.
const LANG_3_TO_2 = {
  eng: 'en', en: 'en',
  spa: 'es', es: 'es',
  fre: 'fr', fra: 'fr', fr: 'fr',
  ger: 'de', deu: 'de', de: 'de',
  hin: 'hi', hi: 'hi',
  jpn: 'ja', ja: 'ja'
};

function normalizeStreamLanguage(code) {
  if (!code || typeof code !== 'string') return null;
  const lower = code.trim().toLowerCase();
  return LANG_3_TO_2[lower] || null;
}

// A track counts as "real" if it's an actual readable subtitle a viewer
// would use - not a forced-only, commentary, or hearing-impaired/SDH track.
function isRealSubtitleTrack(stream) {
  const d = stream.disposition || {};
  if (d.forced === 1) return false;
  if (d.comment === 1) return false;
  if (d.hearing_impaired === 1) return false;
  if (d.visual_impaired === 1) return false;
  if (d.attached_pic === 1) return false;
  return true;
}

function pickBestTrack(streams) {
  const real = streams.filter(isRealSubtitleTrack);
  if (real.length === 0) return null;
  const byDefault = real.find(s => (s.disposition || {}).default === 1);
  if (byDefault) return byDefault;
  const english = real.find(s => normalizeStreamLanguage((s.tags || {}).language) === 'en');
  if (english) return english;
  return real[0];
}

function runFfprobe(absPath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-select_streams', 's',
      '-show_entries', 'stream=index,codec_name:stream_tags=language:stream_disposition=default,forced,comment,hearing_impaired,visual_impaired,attached_pic',
      '-of', 'json',
      absPath
    ];
    let proc;
    try {
      proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
    }, 5000);
    proc.stdout.on('data', (chunk) => { out += chunk; });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out);
        resolve(Array.isArray(parsed.streams) ? parsed.streams : []);
      } catch {
        resolve(null);
      }
    });
  });
}

// Cache keyed by absolute path; invalidated automatically if the file's
// mtime or size changes, so re-probing only happens when a file is new
// or has actually been replaced.
const cache = new Map(); // absPath -> { mtimeMs, size, result }

async function probeEmbeddedSubtitle(absPath, stat) {
  const cached = cache.get(absPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.result;
  }
  const streams = await runFfprobe(absPath);
  let result = { hasEmbedded: false, language: null };
  if (streams) {
    const best = pickBestTrack(streams);
    if (best) {
      result = { hasEmbedded: true, language: normalizeStreamLanguage((best.tags || {}).language) };
    }
  }
  cache.set(absPath, { mtimeMs: stat.mtimeMs, size: stat.size, result });
  return result;
}

// Runs probeEmbeddedSubtitle over a list of {absPath, stat} entries with a
// bounded number of concurrent ffprobe processes, so opening a folder with
// many videos doesn't spawn dozens of processes at once nor run serially.
async function probeMany(entries, concurrency = 4) {
  const results = new Array(entries.length);
  let next = 0;
  async function worker() {
    while (next < entries.length) {
      const i = next++;
      const { absPath, stat } = entries[i];
      results[i] = await probeEmbeddedSubtitle(absPath, stat);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, worker);
  await Promise.all(workers);
  return results;
}

module.exports = { probeMany, normalizeStreamLanguage };
