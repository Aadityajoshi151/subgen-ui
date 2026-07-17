const treeEl = document.getElementById('tree');
const currentPathEl = document.getElementById('currentPath');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refreshBtn');
const generateBtn = document.getElementById('generateBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const settingsBtn = document.getElementById('settingsBtn');
const expandAllBtn = document.getElementById('expandAllBtn');
const collapseAllBtn = document.getElementById('collapseAllBtn');

// Settings modal elements
const settingsModal = document.getElementById('settingsModal');
const settingsForm = document.getElementById('settingsForm');
const cancelSettingsBtn = document.getElementById('cancelSettings');
const inputHost = document.getElementById('serverHost');
const inputPort = document.getElementById('serverPort');
const selectLang = document.getElementById('defaultLanguage');

// Confirm modal elements
const confirmModal = document.getElementById('confirmModal');
const confirmPathEl = document.getElementById('confirmPath');
const confirmYesBtn = document.getElementById('confirmYes');
const confirmNoBtn = document.getElementById('confirmNo');

// Progress panel elements
const progressPanel = document.getElementById('progressPanel');
const progressList = document.getElementById('progressList');
const progressSummary = document.getElementById('progressSummary');
const clearProgressBtn = document.getElementById('clearProgressBtn');
const hideProgressBtn = document.getElementById('hideProgressBtn');

// selected: Map<relPath, {type}>
let selected = new Map();
let settings = null; // loaded user settings
let progressTimer = null;

function setStatus(msg) { statusEl.textContent = msg || ''; }

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function postJSON(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
}

// --- Tree rendering (lazy: only immediate children are fetched per folder) ---

function updateSelectionSummary() {
  const count = selected.size;
  currentPathEl.textContent = count === 0 ? 'None' : `${count} item${count > 1 ? 's' : ''}`;
  generateBtn.disabled = count === 0;
}

function toggleSelected(relPath, type, checked) {
  if (checked) selected.set(relPath, { type });
  else selected.delete(relPath);
  updateSelectionSummary();
}

function buildItemRow(node) {
  const item = document.createElement('div');
  item.className = 'item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'select-box';
  checkbox.checked = selected.has(node.path);
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSelected(node.path, node.type, checkbox.checked);
  });
  item.appendChild(checkbox);

  if (node.type === 'folder') {
    const chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '▸';
    item.appendChild(chev);
  } else {
    const dot = document.createElement('span'); dot.className = 'dot';
    item.appendChild(dot);
  }

  const name = document.createElement('span'); name.className = 'name'; name.textContent = node.name;
  item.appendChild(name);

  if (node.type === 'file' && node.hasSubtitle) {
    const sub = document.createElement('span');
    sub.className = 'has-subtitle';
    sub.textContent = '💬';
    sub.title = 'Subtitle already generated';
    item.appendChild(sub);
  }

  if (node.type === 'folder') {
    const meta = document.createElement('span'); meta.className = 'meta badge'; meta.textContent = `${node.childCount || 0}`;
    item.appendChild(meta);
  }

  return item;
}

function renderTreeNode(node) {
  if (node.type === 'file') {
    const li = document.createElement('li');
    li.className = 'file';
    li.appendChild(buildItemRow(node));
    return li;
  }

  const li = document.createElement('li');
  li.className = 'folder collapsed';
  const item = buildItemRow(node);
  const children = document.createElement('ul'); children.className = 'children';
  let loaded = false;

  async function loadChildren() {
    if (loaded) return;
    loaded = true;
    children.innerHTML = '<li class="loading">Loading…</li>';
    try {
      const data = await fetchJSON(`/api/tree?path=${encodeURIComponent(node.path)}`);
      children.innerHTML = '';
      (data.children || []).forEach(c => children.appendChild(renderTreeNode(c)));
      if ((data.children || []).length === 0) {
        children.innerHTML = '<li class="empty-folder">Empty</li>';
      }
    } catch (e) {
      children.innerHTML = '<li class="empty-folder">Failed to load</li>';
      loaded = false;
    }
  }

  item.addEventListener('click', async () => {
    const isCollapsed = li.classList.contains('collapsed');
    if (isCollapsed) await loadChildren();
    li.classList.toggle('collapsed', !isCollapsed);
    li.classList.toggle('expanded', isCollapsed);
  });

  li.appendChild(item);
  li.appendChild(children);
  li._loadChildren = loadChildren;
  li._node = node;
  return li;
}

function renderRoot(children) {
  treeEl.innerHTML = '';
  if (!children || children.length === 0) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'The content folder is empty.';
    treeEl.appendChild(div);
    return;
  }
  const ul = document.createElement('ul');
  children.forEach(n => ul.appendChild(renderTreeNode(n)));
  treeEl.appendChild(ul);
}

async function setAllFolders(expand) {
  const folders = Array.from(treeEl.querySelectorAll('.folder'));
  if (expand) {
    // Load one level at a time so we don't fire hundreds of requests at once.
    for (const f of folders) {
      if (f._loadChildren) await f._loadChildren();
      f.classList.remove('collapsed');
      f.classList.add('expanded');
    }
  } else {
    folders.forEach(f => {
      f.classList.add('collapsed');
      f.classList.remove('expanded');
    });
  }
}

expandAllBtn?.addEventListener('click', () => setAllFolders(true));
collapseAllBtn?.addEventListener('click', () => setAllFolders(false));

async function loadTree() {
  try {
    setStatus('Loading…');
    const data = await fetchJSON('/api/tree');
    if (!data.exists) {
      treeEl.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'empty';
      div.textContent = 'No content found. Create a \'content\' folder in the project root and add files.';
      treeEl.appendChild(div);
    } else {
      renderRoot(data.children);
    }
    selected.clear();
    updateSelectionSummary();
    setStatus('');
  } catch (e) {
    setStatus('Failed to load tree');
    selected.clear();
    updateSelectionSummary();
  }
}

function clearSelection() {
  selected.clear();
  updateSelectionSummary();
  treeEl.querySelectorAll('.select-box').forEach(cb => { cb.checked = false; });
}

async function sendSelection() {
  if (selected.size === 0) {
    setStatus('Select at least one file or folder first');
    return;
  }
  if (!settings || !settings.serverHost || !settings.serverPort) {
    setStatus('Configure server settings first');
    showSettingsModal();
    return;
  }
  try {
    setStatus('Preparing…');
    const items = Array.from(selected.entries()).map(([p, v]) => ({ path: p, type: v.type }));
    const genRes = await postJSON('/api/generate', { items });
    if (!genRes.ok) throw new Error(`Generate HTTP ${genRes.status}`);

    // Subgen's /batch endpoint accepts multiple paths in one call, pipe-separated.
    const directoryParam = items
      .map(i => `/content/${i.path}`.replace(/\/+$/, ''))
      .join('|');
    const encodedDirectory = encodeURIComponent(directoryParam);
    const lang = encodeURIComponent(settings.defaultLanguage || 'en');
    const remoteUrl = `http://${settings.serverHost}:${settings.serverPort}/batch?directory=${encodedDirectory}&forceLanguage=${lang}`;
    console.log('[Generate Subs] Remote URL:', remoteUrl);
    setStatus('Sending…');
    try {
      const req = fetch(remoteUrl, { method: 'POST' });
      window._lastGenRequest = req;
      req.catch(err => console.warn('[Generate Subs] Request error:', err));
    } catch (ffErr) {
      console.warn('[Generate Subs] Dispatch error:', ffErr);
    }
    setStatus('Sent');
    showProgressPanel();
    startProgressPolling();
  } catch (e) {
    console.error('[Generate Subs] Error:', e);
    setStatus(e.message || 'Failed to generate');
  }
}

refreshBtn.addEventListener('click', loadTree);
clearSelectionBtn?.addEventListener('click', clearSelection);

function showConfirmModal() {
  const items = Array.from(selected.keys());
  confirmPathEl.textContent = items.map(p => `/content/${p}`).join('\n');
  confirmModal.classList.remove('hidden');
}
function hideConfirmModal() {
  confirmModal.classList.add('hidden');
}

generateBtn.addEventListener('click', () => {
  if (selected.size === 0) return; // safety; button should be disabled anyway
  showConfirmModal();
});

confirmNoBtn?.addEventListener('click', hideConfirmModal);
confirmYesBtn?.addEventListener('click', async () => {
  hideConfirmModal();
  await sendSelection();
});

// --- Progress panel ---

function showProgressPanel() { progressPanel.classList.remove('hidden'); }
function hideProgressPanel() { progressPanel.classList.add('hidden'); }

function statusBadgeClass(status) {
  if (status === 'done') return 'badge-done';
  if (status === 'processing') return 'badge-processing';
  return 'badge-queued';
}

function renderProgress(data) {
  const jobs = data.jobs || [];
  progressList.innerHTML = '';
  if (jobs.length === 0) {
    progressList.innerHTML = '<li class="empty-folder">No jobs tracked yet.</li>';
  }
  jobs.forEach(job => {
    const li = document.createElement('li');
    li.className = 'progress-item';
    const name = document.createElement('span');
    name.className = 'progress-name';
    name.textContent = job.relPath;
    const badge = document.createElement('span');
    badge.className = `badge ${statusBadgeClass(job.status)}`;
    badge.textContent = job.status;
    li.appendChild(name);
    li.appendChild(badge);
    progressList.appendChild(li);
  });

  const groupEntries = Object.entries(data.groups || {});
  if (groupEntries.length > 0) {
    const header = document.createElement('li');
    header.className = 'progress-group-header';
    header.textContent = 'Folders';
    progressList.insertBefore(header, progressList.firstChild);
    groupEntries.reverse().forEach(([groupPath, g]) => {
      const li = document.createElement('li');
      li.className = 'progress-item progress-group';
      const name = document.createElement('span');
      name.className = 'progress-name';
      name.textContent = `/content/${groupPath}`;
      const badge = document.createElement('span');
      badge.className = 'badge badge-queued';
      badge.textContent = `${g.done}/${g.total}`;
      li.appendChild(name);
      li.appendChild(badge);
      progressList.insertBefore(li, progressList.firstChild.nextSibling);
    });
  }

  const total = jobs.length;
  const done = jobs.filter(j => j.status === 'done').length;
  progressSummary.textContent = total ? `${done}/${total} done` : '';
}

async function pollProgress() {
  try {
    const data = await fetchJSON('/api/progress');
    renderProgress(data);
  } catch (e) {
    // ignore transient failures
  }
}

function startProgressPolling() {
  if (progressTimer) return;
  pollProgress();
  progressTimer = setInterval(pollProgress, 4000);
}

function stopProgressPolling() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

clearProgressBtn?.addEventListener('click', async () => {
  await postJSON('/api/progress/clear', {});
  await pollProgress();
});

hideProgressBtn?.addEventListener('click', () => {
  hideProgressPanel();
  stopProgressPolling();
});

// --- Settings modal logic ---
function showSettingsModal() { settingsModal.classList.remove('hidden'); }
function hideSettingsModal() { settingsModal.classList.add('hidden'); }

async function loadSettings() {
  try {
    const data = await fetchJSON('/api/settings');
    settings = data.settings || { serverHost: '', serverPort: '', defaultLanguage: 'en' };
    inputHost.value = settings.serverHost || '';
    inputPort.value = settings.serverPort || '';
    selectLang.value = settings.defaultLanguage || 'en';
    if (!data.exists || !settings.serverHost || !settings.serverPort) {
      showSettingsModal();
    }
  } catch (e) {
    settings = { serverHost: '', serverPort: '', defaultLanguage: 'en' };
    inputHost.value = '';
    inputPort.value = '';
    selectLang.value = 'en';
    showSettingsModal();
  }
}

settingsBtn.addEventListener('click', showSettingsModal);
cancelSettingsBtn.addEventListener('click', hideSettingsModal);
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    serverHost: inputHost.value.trim(),
    serverPort: inputPort.value.trim(),
    defaultLanguage: selectLang.value
  };
  try {
    setStatus('Saving settings…');
    const res = await postJSON('/api/settings', payload);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    hideSettingsModal();
    setStatus('Settings saved');
    settings = (await res.json()).settings;
  } catch (err) {
    setStatus('Failed to save settings');
  }
});

// Initial load
loadTree();
loadSettings();

// Resume polling on load in case a batch is still running from before a refresh.
(async () => {
  try {
    const data = await fetchJSON('/api/progress');
    if ((data.jobs || []).length > 0) {
      showProgressPanel();
      renderProgress(data);
      startProgressPolling();
    }
  } catch {}
})();
