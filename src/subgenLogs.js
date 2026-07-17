const Docker = require('dockerode');

// Subgen's real log output (confirmed against a live container) looks like:
//   INFO: Processing audio with duration 20:54.571
//   Detected Language: english
//   Transcribe:  42%|████▏     | 521.56/1254.57 [03:03<05:00,  2.44sec/s]
// tqdm writes the "Transcribe: NN%|" bar using \r (not \n) to overwrite
// itself, and Python's own logging calls get interleaved on the same raw
// line as a result, so lines are NOT parsed one at a time — instead each
// chunk of stream output is scanned directly:
//   - "Processing audio with duration" marks a NEW file starting (subgen
//     has no per-file name in these lines; with CONCURRENT_TRANSCRIPTIONS=1
//     the oldest still-open tracked job is assumed to be the one running).
//   - "Transcribe: NN%|" gives the live percentage for whichever job is
//     currently marked "processing".
const FILE_START_RE = /Processing audio with duration/g;
const PROGRESS_RE = /Transcribe:\s*(\d+)%\|/g;

function parseChunk(text) {
  const events = [];
  const startMatches = text.match(FILE_START_RE);
  if (startMatches) {
    for (let i = 0; i < startMatches.length; i++) events.push({ type: 'file-start' });
  }
  const progressMatches = [...text.matchAll(PROGRESS_RE)];
  if (progressMatches.length > 0) {
    const last = progressMatches[progressMatches.length - 1];
    events.push({ type: 'progress', percent: Number(last[1]) });
  }
  return events;
}

let docker = null;
try {
  docker = new Docker();
} catch {
  docker = null;
}

let currentContainerName = null;
let currentStream = null;
let reconnectTimer = null;
let onEventCallback = null;
let onStatusCallback = null;

function stopTailing() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (currentStream) {
    try { currentStream.destroy(); } catch {}
    currentStream = null;
  }
}

function reportStatus(state, detail) {
  if (onStatusCallback) onStatusCallback({ state, detail, containerName: currentContainerName });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (currentContainerName) attach(currentContainerName);
  }, 10000);
}

function attach(containerName) {
  if (!docker) {
    reportStatus('error', 'Docker socket unavailable (is /var/run/docker.sock mounted?)');
    return;
  }
  const container = docker.getContainer(containerName);
  container.logs({ follow: true, stdout: true, stderr: true, tail: 0 }, (err, stream) => {
    if (currentContainerName !== containerName) return; // superseded by a newer configure() call
    if (err) {
      reportStatus('error', err.message);
      scheduleReconnect();
      return;
    }
    currentStream = stream;
    reportStatus('connected');

    const handleChunk = (chunk) => {
      const events = parseChunk(chunk.toString('utf8'));
      if (onEventCallback) events.forEach(onEventCallback);
    };

    // Docker multiplexes stdout/stderr frames unless the container was
    // started with a TTY; demux so we get plain text either way.
    const stdout = { write: handleChunk };
    const stderr = { write: handleChunk };
    try {
      docker.modem.demuxStream(stream, stdout, stderr);
    } catch {
      stream.on('data', handleChunk);
    }

    stream.on('error', (streamErr) => {
      reportStatus('error', streamErr.message);
      scheduleReconnect();
    });
    stream.on('end', () => {
      reportStatus('disconnected');
      scheduleReconnect();
    });
  });
}

// Switches log tailing to a new container name (or stops it if name is empty).
// onEvent receives { type: 'file-start' } or { type: 'progress', percent }.
// onStatus receives { state: 'connected'|'disconnected'|'error', detail?, containerName }.
function configure(containerName, onEvent, onStatus) {
  onEventCallback = onEvent;
  onStatusCallback = onStatus;
  const trimmed = (containerName || '').trim();
  if (trimmed === currentContainerName) return;
  stopTailing();
  currentContainerName = trimmed || null;
  if (currentContainerName) attach(currentContainerName);
}

function isActive() {
  return !!currentContainerName;
}

module.exports = { configure, isActive };
