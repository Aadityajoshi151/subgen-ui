const Docker = require('dockerode');

// Subgen logs everything to stderr with lines like:
//   WORKER START :[TRANSCRIBE] ep1.mkv                                  | Jobs: 1 processing, 2 queued
//   [ ep1.mkv                                 ]  42% |   123/295  s [ 02:03< 02:50,  1.00s/s] | Jobs: ...
//   WORKER FINISH: [TRANSCRIBE] ep1.mkv                                  in 2m 30s | Remaining: 1 queued
const PROGRESS_RE = /\[\s*(.*?)\s*\]\s*(\d+)%\s*\|\s*(\d+)\/(\d+)\s*s/;
const WORKER_START_RE = /WORKER START\s*:\[(\w+)\s*\]\s*(.*?)\s*\|\s*Jobs:/;
const WORKER_FINISH_RE = /WORKER FINISH:\s*\[(\w+)\s*\]\s*(.*?)\s+in\s+(\d+)m\s+(\d+)s/;

function parseLine(line) {
  let m = line.match(WORKER_START_RE);
  if (m) return { type: 'start', taskType: m[1].toLowerCase(), name: m[2].trim() };
  m = line.match(WORKER_FINISH_RE);
  if (m) return { type: 'finish', taskType: m[1].toLowerCase(), name: m[2].trim() };
  m = line.match(PROGRESS_RE);
  if (m) return { type: 'progress', name: m[1].trim(), percent: Number(m[2]) };
  return null;
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

    let buffer = '';
    const handleChunk = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep the trailing partial line
      for (const raw of lines) {
        const event = parseLine(raw);
        if (event && onEventCallback) onEventCallback(event);
      }
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
// onEvent receives { type: 'start'|'progress'|'finish', name, taskType?, percent? }.
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
