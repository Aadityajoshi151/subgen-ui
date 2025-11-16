const treeEl = document.getElementById('tree');
const currentPathEl = document.getElementById('currentPath');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refreshBtn');
const generateBtn = document.getElementById('generateBtn');
const settingsBtn = document.getElementById('settingsBtn');

// Settings modal elements
const settingsModal = document.getElementById('settingsModal');
const settingsForm = document.getElementById('settingsForm');
const cancelSettingsBtn = document.getElementById('cancelSettings');
const inputHost = document.getElementById('serverHost');
const inputPort = document.getElementById('serverPort');
const selectLang = document.getElementById('defaultLanguage');

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

async function loadTree() {
  try {
    setStatus('Loading…');
    const data = await fetchJSON('/api/tree');
    renderTree(data);
    setStatus('');
  } catch (e) {
    setStatus('Failed to load tree');
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
    const selRes = await postJSON('/api/select', { path: selected.path, type: selected.type });
    if (!selRes.ok) throw new Error(`Selection HTTP ${selRes.status}`);
    const selData = await selRes.json();
    // Use container-relative path under /content instead of absolute host path
    const relativeForContainer = `/content/${selected.path || ''}`.replace(/\/+$/,'');
    const directoryParam = encodeURIComponent(relativeForContainer);
    const lang = encodeURIComponent(settings.defaultLanguage || 'en');
    const remoteUrl = `http://${settings.serverHost}:${settings.serverPort}/batch?directory=${directoryParam}&forceLanguage=${lang}`;
    setStatus('Calling Subgen server…');
    const remoteRes = await fetch(remoteUrl, { method: 'POST' });
    if (!remoteRes.ok) throw new Error(`Remote HTTP ${remoteRes.status}`);
    setStatus('Subs generation triggered');
  } catch (e) {
    setStatus(e.message || 'Failed to generate');
  }
}

refreshBtn.addEventListener('click', loadTree);
generateBtn.addEventListener('click', sendSelection);

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
