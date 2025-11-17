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
const confirmIconEl = document.getElementById('confirmIcon');
const confirmNameEl = document.getElementById('confirmName');

let selected = { path: null, type: null };
let selectedEl = null;
let settings = null; // loaded user settings

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

function renderTreeNode(node) {
  if (!node) return document.createTextNode('');
  if (node.type === 'file') {
    const li = document.createElement('li');
    li.className = 'file';
    const item = document.createElement('div');
    item.className = 'item';
    const dot = document.createElement('span'); dot.className = 'dot';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = node.name;
    item.appendChild(dot);
    item.appendChild(name);
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectNode(item, node.path, 'file');
    });
    li.appendChild(item);
    return li;
  }
  const li = document.createElement('li');
  li.className = 'folder collapsed';
  const item = document.createElement('div'); item.className = 'item';
  const chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '▸';
  const name = document.createElement('span'); name.className = 'name'; name.textContent = node.name;
  const meta = document.createElement('span'); meta.className = 'meta badge'; meta.textContent = `${(node.children||[]).length}`;
  item.appendChild(chev); item.appendChild(name); item.appendChild(meta);
  const children = document.createElement('ul'); children.className = 'children';
  (node.children || []).forEach(c => children.appendChild(renderTreeNode(c)));
  item.addEventListener('click', () => {
    const isCollapsed = li.classList.contains('collapsed');
    li.classList.toggle('collapsed', !isCollapsed);
    li.classList.toggle('expanded', isCollapsed);
    selectNode(item, node.path, 'folder');
  });
  li.appendChild(item);
  li.appendChild(children);
  return li;
}

function renderTree(root) {
  treeEl.innerHTML = '';
  if (!root || !root.tree) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'No content found. Create a \'content\' folder in the project root and add files.';
    treeEl.appendChild(div);
    return;
  }
  const ul = document.createElement('ul');
  const nodes = (root.tree.children || []);
  if (nodes.length === 0) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'The content folder is empty.';
    treeEl.appendChild(div);
    return;
  }
  nodes.forEach(n => ul.appendChild(renderTreeNode(n)));
  treeEl.appendChild(ul);
}

function setAllFolders(expand) {
  const folders = treeEl.querySelectorAll('.folder');
  folders.forEach(f => {
    f.classList.toggle('collapsed', !expand);
    f.classList.toggle('expanded', expand);
  });
}

expandAllBtn?.addEventListener('click', () => setAllFolders(true));
collapseAllBtn?.addEventListener('click', () => setAllFolders(false));


async function loadTree() {
  try {
    setStatus('Loading…');
    const data = await fetchJSON('/api/tree');
    renderTree(data);
    // Clear any previous selection on refresh
    selected = { path: null, type: null };
    selectedEl = null;
    currentPathEl.textContent = 'None';
    generateBtn.disabled = true;
    setStatus('');
  } catch (e) {
    setStatus('Failed to load tree');
    // Also clear selection if load fails so stale paths aren't used
    selected = { path: null, type: null };
    selectedEl = null;
    currentPathEl.textContent = 'None';
    generateBtn.disabled = true;
  }
}

function selectNode(el, relPath, type) {
  if (selectedEl) selectedEl.classList.remove('selected');
  selectedEl = el;
  selected = { path: relPath, type };
  el.classList.add('selected');
  currentPathEl.textContent = relPath ? `/content/${relPath}` : 'Nothing selected';
  generateBtn.disabled = !selected.path;
}

function clearSelection() {
  if (selectedEl) {
    selectedEl.classList.remove('selected');
  }
  selectedEl = null;
  selected = { path: null, type: null };
  currentPathEl.textContent = 'None';
  generateBtn.disabled = true;
}

async function sendSelection() {
  if (!selected.path) {
    setStatus('Select a file or folder first');
    return;
  }
  if (!settings || !settings.serverHost || !settings.serverPort) {
    setStatus('Configure server settings first');
    showSettingsModal();
    return;
  }
  try {
    setStatus('Preparing…');
    // Validate selection on server (still logs absolute path)
    const selRes = await postJSON('/api/select', { path: selected.path, type: selected.type });
    if (!selRes.ok) throw new Error(`Selection HTTP ${selRes.status}`);
    const selData = await selRes.json();
    // Build remote URL directly (may trigger CORS if different origin)
    const relativeForContainer = `/content/${selected.path || ''}`.replace(/\/+$/,'');
    const directoryParam = encodeURIComponent(relativeForContainer);
    const lang = encodeURIComponent(settings.defaultLanguage || 'en');
    const remoteUrl = `http://${settings.serverHost}:${settings.serverPort}/batch?directory=${directoryParam}&forceLanguage=${lang}`;
    console.log('[Generate Subs] Remote URL:', remoteUrl);
    console.log('[Generate Subs] Params:', { directoryParam: relativeForContainer, lang });
    // Fire-and-forget: do not await the response
    setStatus('Sending…');
    try {
      fetch(remoteUrl, { method: 'POST', keepalive: true })
        .catch(err => console.warn('[Generate Subs] Fire-and-forget error:', err));
    } catch (ffErr) {
      console.warn('[Generate Subs] Dispatch error:', ffErr);
    }
    alert('Generation request sent to Subgen server.');
    setStatus('Sent');
  } catch (e) {
    console.error('[Generate Subs] Error:', e);
    setStatus(e.message || 'Failed to generate');
  }
}

refreshBtn.addEventListener('click', loadTree);
clearSelectionBtn?.addEventListener('click', clearSelection);

function showConfirmModal(pathToSend) {
  confirmPathEl.textContent = pathToSend || '';
  const isFolder = selected?.type === 'folder';
  confirmIconEl.textContent = isFolder ? '📁' : '📄';
  const name = (selected?.path || '').split('/').filter(Boolean).pop() || (isFolder ? 'Folder' : 'File');
  confirmNameEl.textContent = name;
  confirmModal.classList.remove('hidden');
}
function hideConfirmModal() {
  confirmModal.classList.add('hidden');
}

generateBtn.addEventListener('click', (e) => {
  if (!selected.path) return; // safety; button should be disabled anyway
  const relativeForContainer = `/content/${selected.path || ''}`.replace(/\/+$/,'');
  showConfirmModal(relativeForContainer);
});

confirmNoBtn?.addEventListener('click', hideConfirmModal);
confirmYesBtn?.addEventListener('click', async () => {
  hideConfirmModal();
  await sendSelection();
});

// Settings modal logic
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
    // Reload settings into memory
    settings = (await res.json()).settings;
  } catch (err) {
    setStatus('Failed to save settings');
  }
});

// Initial load
loadTree();
loadSettings();
