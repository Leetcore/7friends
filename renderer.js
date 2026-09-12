const myPeerIdEl = document.getElementById('myPeerId');
const peerInput = document.getElementById('peerInput');
const connectBtn = document.getElementById('connectBtn');
const shareFolderBtn = document.getElementById('shareFolderBtn');
const localFoldersEl = document.getElementById('localFolders');
const remoteFoldersEl = document.getElementById('remoteFolders');
const connectionsEl = document.getElementById('connections');

const sharedFolders = [];
const remoteShares = new Map();
const dataConnections = new Map();

const peer = new Peer({
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  }
});

function renderTree(nodes) {
  if (!nodes || nodes.length === 0) {
    return document.createTextNode('');
  }

  const ul = document.createElement('ul');
  for (const node of nodes) {
    const li = document.createElement('li');
    li.className = 'tree-node';

    const label = document.createElement('span');
    label.className = 'folder';
    label.textContent = `📁 ${node.name}`;
    li.appendChild(label);

    if (node.children?.length) {
      li.appendChild(renderTree(node.children));
    }

    ul.appendChild(li);
  }

  return ul;
}

function renderLocalFolders() {
  localFoldersEl.innerHTML = '';

  if (sharedFolders.length === 0) {
    localFoldersEl.textContent = 'Noch kein Ordner freigegeben.';
    return;
  }

  for (const folder of sharedFolders) {
    const wrapper = document.createElement('div');
    wrapper.className = 'peer-group';

    const title = document.createElement('div');
    title.className = 'peer-title';
    title.textContent = `📂 ${folder.name}`;
    wrapper.appendChild(title);

    wrapper.appendChild(renderTree(folder.children));
    localFoldersEl.appendChild(wrapper);
  }
}

function renderRemoteFolders() {
  remoteFoldersEl.innerHTML = '';

  if (remoteShares.size === 0) {
    remoteFoldersEl.textContent = 'Noch keine Freigaben von anderen Teilnehmern.';
    return;
  }

  for (const [peerId, folders] of remoteShares.entries()) {
    const wrapper = document.createElement('div');
    wrapper.className = 'peer-group';

    const title = document.createElement('div');
    title.className = 'peer-title';
    title.textContent = `👤 ${peerId}`;
    wrapper.appendChild(title);

    for (const folder of folders) {
      const folderTitle = document.createElement('div');
      folderTitle.textContent = `📂 ${folder.name}`;
      wrapper.appendChild(folderTitle);
      wrapper.appendChild(renderTree(folder.children));
    }

    remoteFoldersEl.appendChild(wrapper);
  }
}

function renderConnections() {
  connectionsEl.innerHTML = '';
  for (const peerId of dataConnections.keys()) {
    const li = document.createElement('li');
    li.textContent = peerId;
    connectionsEl.appendChild(li);
  }

  if (dataConnections.size === 0) {
    const li = document.createElement('li');
    li.textContent = 'Keine aktiven Verbindungen';
    connectionsEl.appendChild(li);
  }
}

function sendShares(conn) {
  conn.send({
    type: 'folder-update',
    folders: sharedFolders
  });
}

function broadcastShares() {
  for (const conn of dataConnections.values()) {
    if (conn.open) {
      sendShares(conn);
    }
  }
}

function attachConnection(conn) {
  conn.on('open', () => {
    dataConnections.set(conn.peer, conn);
    renderConnections();
    sendShares(conn);
  });

  conn.on('data', (message) => {
    if (message?.type === 'folder-update' && Array.isArray(message.folders)) {
      remoteShares.set(conn.peer, message.folders);
      renderRemoteFolders();
    }
  });

  conn.on('close', () => {
    dataConnections.delete(conn.peer);
    remoteShares.delete(conn.peer);
    renderConnections();
    renderRemoteFolders();
  });

  conn.on('error', (err) => {
    console.error(`Fehler mit ${conn.peer}:`, err);
  });
}

peer.on('open', (id) => {
  myPeerIdEl.textContent = id;
});

peer.on('connection', (conn) => {
  attachConnection(conn);
});

peer.on('error', (err) => {
  console.error('Peer Fehler:', err);
  myPeerIdEl.textContent = `Fehler: ${err.type || err.message}`;
});

connectBtn.addEventListener('click', () => {
  const targetId = peerInput.value.trim();
  if (!targetId) {
    return;
  }

  if (targetId === peer.id) {
    return;
  }

  if (dataConnections.has(targetId)) {
    return;
  }

  const conn = peer.connect(targetId, { reliable: true });
  attachConnection(conn);
  peerInput.value = '';
});

shareFolderBtn.addEventListener('click', async () => {
  const folder = await window.electronAPI.selectFolder();
  if (!folder) {
    return;
  }

  const alreadyShared = sharedFolders.some((entry) => entry.path === folder.path);
  if (alreadyShared) {
    return;
  }

  sharedFolders.push(folder);
  renderLocalFolders();
  broadcastShares();
});

renderConnections();
renderLocalFolders();
renderRemoteFolders();
