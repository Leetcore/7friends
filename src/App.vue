<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Peer } from 'peerjs'

function loadSavedFriends() {
  try {
    const savedFriends = JSON.parse(localStorage.getItem('7friends.friends') || '[]')
    if (!Array.isArray(savedFriends)) return []

    return savedFriends
      .filter((friend) => friend && typeof friend.peerId === 'string')
      .map((friend) => ({
        peerId: friend.peerId,
        nickname: typeof friend.nickname === 'string' ? friend.nickname : 'Freund',
        approved: true,
        status: 'Getrennt',
        files: [],
      }))
  } catch {
    return []
  }
}

const peerId = ref(localStorage.getItem('7friends.peerId') || crypto.randomUUID())
const nickname = ref(localStorage.getItem('7friends.nickname') || 'Mira')
const activeTab = ref('own')
const activePeerId = ref('')
const friendIdInput = ref('')
const localFiles = ref([])
const friends = ref(loadSavedFriends())
const accessRequests = ref([])
const transferMessage = ref('')
const peerStatus = ref('Verbinde mit dem Peer-Netzwerk')
const fileInput = ref(null)
const audioRef = ref(null)
const activeTrack = ref(null)
const peerIdDraft = ref('')
const peerIdEditorOpen = ref(false)
const peerIdError = ref('')
const isApplyingPeerId = ref(false)

let peer
const connections = new Map()
const incomingTransfers = new Map()
const activeFriend = computed(() => friends.value.find((friend) => friend.peerId === activePeerId.value))
const totalSize = computed(() => localFiles.value
  .filter((item) => item.available)
  .reduce((sum, item) => sum + item.size, 0))

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isMp3(file) {
  return file.type === 'audio/mpeg' || file.name.toLowerCase().endsWith('.mp3')
}

function setActiveTrack(track) {
  if (activeTrack.value) URL.revokeObjectURL(activeTrack.value.url)
  activeTrack.value = track
  nextTick(() => {
    audioRef.value?.play().catch(() => {})
  })
}

async function readOriginalFileChunk(item, offset, length) {
  if (item.file) return item.file.slice(offset, offset + length).arrayBuffer()
  if (!window.sevenFriends?.readSharedFileChunk) throw new Error('Original file access is unavailable')

  const chunk = await window.sevenFriends.readSharedFileChunk(item.id, offset, length)
  if (chunk instanceof ArrayBuffer) return chunk
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength).slice().buffer
  }
  throw new Error('Invalid original file data')
}

async function playLocalFile(item) {
  if (!item.available) return

  try {
    let audioFile = item.file
    if (!audioFile) {
      const chunks = []
      const chunkSize = 64 * 1024
      for (let offset = 0; offset < item.size; offset += chunkSize) {
        chunks.push(await readOriginalFileChunk(item, offset, chunkSize))
      }
      audioFile = new Blob(chunks, { type: item.type })
    }

    setActiveTrack({
      name: item.name,
      owner: 'Mein Ordner',
      url: URL.createObjectURL(audioFile),
    })
  } catch {
    transferMessage.value = `Die Originaldatei ${item.name} kann nicht gelesen werden.`
  }
}

function closePlayer() {
  audioRef.value?.pause()
  if (activeTrack.value) URL.revokeObjectURL(activeTrack.value.url)
  activeTrack.value = null
}

function saveFriends() {
  const savedFriends = friends.value
    .filter((friend) => friend.approved)
    .map(({ peerId: friendPeerId, nickname: friendNickname }) => ({
      peerId: friendPeerId,
      nickname: friendNickname,
    }))
  localStorage.setItem('7friends.friends', JSON.stringify(savedFriends))
}

function metadataForFiles() {
  return localFiles.value.filter((item) => item.available).map(({ id, name, size, type, lastModified }) => ({
    id,
    name,
    size,
    type: type || 'application/octet-stream',
    modified: lastModified,
  }))
}

function sendFileList(connection) {
  const friend = friends.value.find((item) => item.peerId === connection.peer && item.approved)
  if (connection.open && friend) connection.send({ type: 'file-list', files: metadataForFiles() })
}

function getFriend(connection) {
  let friend = friends.value.find((item) => item.peerId === connection.peer)
  if (!friend) {
    friend = {
      peerId: connection.peer,
      nickname: 'Freund',
      approved: false,
      status: 'Warte auf Bestätigung',
      files: [],
    }
    friends.value.push(friend)
  }
  return friend
}

function startFriendSession(connection, friend) {
  friend.status = 'Verbunden'
  activePeerId.value = connection.peer
  connection.send({ type: 'hello', nickname: nickname.value })
  sendFileList(connection)
}

function acceptKnownFriend(connection, friend) {
  friend.approved = true
  friend.status = 'Verbunden'
  saveFriends()
  connection.send({ type: 'access-approved', nickname: nickname.value })
  startFriendSession(connection, friend)
}

function approveAccessRequest(peerIdToApprove) {
  const request = accessRequests.value.find((item) => item.peerId === peerIdToApprove)
  const connection = connections.get(peerIdToApprove)
  if (!request || !connection?.open) return

  const friend = getFriend(connection)
  friend.nickname = request.nickname
  friend.approved = true
  friend.files = []
  saveFriends()
  connection.send({ type: 'access-approved', nickname: nickname.value })
  startFriendSession(connection, friend)
  accessRequests.value = accessRequests.value.filter((item) => item.peerId !== peerIdToApprove)
}

function declineAccessRequest(peerIdToDecline) {
  const connection = connections.get(peerIdToDecline)
  if (connection?.open) {
    connection.send({ type: 'access-denied' })
    connection.close()
  }
  accessRequests.value = accessRequests.value.filter((item) => item.peerId !== peerIdToDecline)
}

function handleMessage(connection, message) {
  if (!message || typeof message !== 'object') return

  if (message.type === 'access-request') {
    const savedFriend = friends.value.find((item) => item.peerId === connection.peer && item.approved)
    if (savedFriend) {
      savedFriend.nickname = message.nickname || savedFriend.nickname
      acceptKnownFriend(connection, savedFriend)
      return
    }

    const existingRequest = accessRequests.value.find((item) => item.peerId === connection.peer)
    if (existingRequest) {
      existingRequest.nickname = message.nickname || 'Freund'
    } else {
      accessRequests.value.push({
        peerId: connection.peer,
        nickname: message.nickname || 'Freund',
      })
    }
    connection.send({ type: 'access-pending' })
    return
  }

  if (message.type === 'access-approved') {
    const friend = getFriend(connection)
    friend.nickname = message.nickname || friend.nickname
    friend.approved = true
    saveFriends()
    startFriendSession(connection, friend)
    return
  }

  if (message.type === 'access-pending') {
    const friend = friends.value.find((item) => item.peerId === connection.peer)
    if (friend && !friend.approved) friend.status = 'Warte auf Bestätigung'
    return
  }

  if (message.type === 'access-denied') {
    friends.value = friends.value.filter((item) => item.peerId !== connection.peer || item.approved)
    transferMessage.value = 'Die Verbindungsanfrage wurde abgelehnt.'
    window.setTimeout(() => { transferMessage.value = '' }, 4000)
    connection.close()
    return
  }

  const friend = friends.value.find((item) => item.peerId === connection.peer && item.approved)
  if (!friend) return

  if (message.type === 'hello') {
    friend.nickname = message.nickname || friend.nickname
    saveFriends()
    sendFileList(connection)
  }

  if (message.type === 'file-list') {
    getFriend(connection).files = Array.isArray(message.files) ? message.files : []
  }

  if (message.type === 'file-request') {
    const item = localFiles.value.find((file) => file.id === message.fileId)
    if (item?.available) {
      transferFile(connection, item, message.action === 'play' && isMp3(item) ? 'play' : 'download')
        .catch(() => {
          transferMessage.value = `Übertragung von ${item.name} fehlgeschlagen.`
          window.setTimeout(() => { transferMessage.value = '' }, 5000)
        })
    }
  }

  if (message.type === 'file-start') {
    incomingTransfers.set(message.transferId, {
      name: message.name,
      type: message.mimeType,
      action: message.action,
      expectedSize: Number.isSafeInteger(message.size) ? message.size : null,
      receivedSize: 0,
      nextChunkIndex: 0,
      invalid: false,
      chunks: [],
    })
    transferMessage.value = message.action === 'play'
      ? `Lade ${message.name} in den Player …`
      : `Empfange ${message.name} …`
  }

  if (message.type === 'file-chunk') {
    const transfer = incomingTransfers.get(message.transferId)
    if (!transfer) return

    let chunk = message.chunk
    if (ArrayBuffer.isView(chunk)) {
      chunk = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
    }
    if (!(chunk instanceof ArrayBuffer)) {
      transfer.invalid = true
      return
    }

    if (message.index !== transfer.nextChunkIndex) transfer.invalid = true
    transfer.nextChunkIndex += 1
    transfer.receivedSize += chunk.byteLength
    transfer.chunks.push(chunk)
  }

  if (message.type === 'file-end') {
    const transfer = incomingTransfers.get(message.transferId)
    if (!transfer) return
    incomingTransfers.delete(message.transferId)
    if (transfer.invalid || (transfer.expectedSize !== null && transfer.receivedSize !== transfer.expectedSize)) {
      transferMessage.value = `Datei unvollständig empfangen (${transfer.receivedSize} von ${transfer.expectedSize ?? 'unbekannt'} Bytes). Bitte erneut anfragen.`
      window.setTimeout(() => { transferMessage.value = '' }, 6000)
      return
    }

    const blob = new Blob(transfer.chunks, { type: transfer.type })
    if (transfer.action === 'play') {
      setActiveTrack({
        name: transfer.name,
        owner: friend.nickname,
        url: URL.createObjectURL(blob),
      })
      transferMessage.value = `${transfer.name} ist bereit.`
    } else {
      saveReceivedFile(transfer.name, blob)
    }
    if (transfer.action === 'play') window.setTimeout(() => { transferMessage.value = '' }, 4000)
  }
}

function registerConnection(connection, direction) {
  connections.set(connection.peer, connection)
  connection.on('open', () => {
    if (direction === 'outgoing') {
      getFriend(connection).status = 'Verbindungsanfrage wird gesendet'
      connection.send({ type: 'access-request', nickname: nickname.value })
      return
    }

    const friend = friends.value.find((item) => item.peerId === connection.peer && item.approved)
    if (friend) acceptKnownFriend(connection, friend)
  })
  connection.on('data', (message) => handleMessage(connection, message))
  connection.on('close', () => {
    if (connections.get(connection.peer) === connection) {
      connections.delete(connection.peer)
      const friend = friends.value.find((item) => item.peerId === connection.peer)
      if (friend?.approved) friend.status = 'Getrennt'
    }
    accessRequests.value = accessRequests.value.filter((item) => item.peerId !== connection.peer)
  })
  connection.on('error', () => {
    if (connections.get(connection.peer) !== connection) return
    const friend = friends.value.find((item) => item.peerId === connection.peer)
    if (friend) friend.status = 'Verbindung fehlgeschlagen'
  })
}

function connectToFriend() {
  const targetId = friendIdInput.value.trim()
  if (!targetId || targetId === peerId.value || !peer || peer.destroyed) return
  const existing = connections.get(targetId)
  if (existing?.open) {
    activePeerId.value = targetId
    activeTab.value = 'friends'
    return
  }

  const connection = peer.connect(targetId, { reliable: true })
  getFriend(connection).status = 'Verbindung wird aufgebaut'
  registerConnection(connection, 'outgoing')
  friendIdInput.value = ''
  activeTab.value = 'friends'
}

function reconnectToFriend(friend) {
  if (!friend.approved || !peer || peer.destroyed) return

  const previousConnection = connections.get(friend.peerId)
  if (previousConnection) {
    connections.delete(friend.peerId)
    previousConnection.close()
  }

  activePeerId.value = friend.peerId
  activeTab.value = 'friends'
  friend.status = 'Verbindung wird aufgebaut'
  const connection = peer.connect(friend.peerId, { reliable: true })
  registerConnection(connection, 'outgoing')
}

function refreshFriends() {
  const approvedFriends = friends.value.filter((friend) => friend.approved)
  if (approvedFriends.length === 0) return

  const selectedPeerId = activePeerId.value || approvedFriends[0].peerId
  for (const friend of approvedFriends) reconnectToFriend(friend)
  activePeerId.value = selectedPeerId
}

function removeFriend(friendPeerId) {
  const connection = connections.get(friendPeerId)
  if (connection) {
    connections.delete(friendPeerId)
    connection.close()
  }

  friends.value = friends.value.filter((friend) => friend.peerId !== friendPeerId)
  saveFriends()
  if (activePeerId.value === friendPeerId) activePeerId.value = ''
}

function addFiles(event) {
  const selectedFiles = Array.from(event.target.files || [])
  for (const file of selectedFiles) {
    localFiles.value.push({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
      available: true,
      file,
    })
  }
  event.target.value = ''
  for (const connection of connections.values()) sendFileList(connection)
}

async function chooseFiles() {
  if (!window.sevenFriends?.selectSharedFiles) {
    fileInput.value?.click()
    return
  }

  try {
    localFiles.value = await window.sevenFriends.selectSharedFiles()
  } catch {
    transferMessage.value = 'Die Originaldateien konnten nicht freigegeben werden.'
    window.setTimeout(() => { transferMessage.value = '' }, 5000)
  }

  for (const connection of connections.values()) sendFileList(connection)
}

async function removeFile(fileId) {
  if (window.sevenFriends?.removeSharedFile) {
    try {
      localFiles.value = await window.sevenFriends.removeSharedFile(fileId)
    } catch {
      transferMessage.value = 'Die Freigabe konnte nicht entfernt werden.'
      window.setTimeout(() => { transferMessage.value = '' }, 5000)
      return
    }
  } else {
    localFiles.value = localFiles.value.filter((item) => item.id !== fileId)
  }

  for (const connection of connections.values()) sendFileList(connection)
}

async function transferFile(connection, item, action = 'download') {
  const transferId = crypto.randomUUID()
  const chunkSize = 32 * 1024
  await connection.send({
    type: 'file-start',
    transferId,
    name: item.name,
    mimeType: item.type || 'application/octet-stream',
    size: item.size,
    action,
  })

  let chunkIndex = 0
  for (let offset = 0; offset < item.size; offset += chunkSize) {
    if (!connection.open) throw new Error('Connection closed during transfer')
    const chunkLength = Math.min(chunkSize, item.size - offset)
    const chunk = await readOriginalFileChunk(item, offset, chunkLength)
    if (chunk.byteLength !== chunkLength) throw new Error('Original file changed during transfer')
    await connection.send({ type: 'file-chunk', transferId, index: chunkIndex, chunk })
    chunkIndex += 1
  }

  await connection.send({ type: 'file-end', transferId })
}

async function restoreSharedFiles() {
  if (!window.sevenFriends?.listSharedFiles) return
  try {
    localFiles.value = await window.sevenFriends.listSharedFiles()
  } catch {
    transferMessage.value = 'Gespeicherte Originaldateien konnten nicht geladen werden.'
  }
}

function requestFile(file, action) {
  const connection = connections.get(activePeerId.value)
  if (!connection?.open) return
  connection.send({ type: 'file-request', fileId: file.id, action })
  transferMessage.value = action === 'play'
    ? `Wiedergabe von ${file.name} wird vorbereitet …`
    : `Download von ${file.name} angefragt …`
}

function requestDownload(file) {
  requestFile(file, 'download')
}

function requestPlayback(file) {
  requestFile(file, 'play')
}

async function saveReceivedFile(fileName, blob) {
  try {
    if (window.sevenFriends?.saveReceivedFile) {
      const saved = await window.sevenFriends.saveReceivedFile(fileName, await blob.arrayBuffer())
      transferMessage.value = saved
        ? `${fileName} wurde gespeichert.`
        : 'Speichern abgebrochen.'
    } else {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      transferMessage.value = `${fileName} wurde gespeichert.`
    }
  } catch {
    transferMessage.value = 'Die Datei konnte nicht gespeichert werden.'
  }

  window.setTimeout(() => { transferMessage.value = '' }, 4000)
}

async function copyPeerId() {
  try {
    await navigator.clipboard.writeText(peerId.value)
    transferMessage.value = 'Deine ID wurde kopiert.'
    window.setTimeout(() => { transferMessage.value = '' }, 2500)
  } catch {
    transferMessage.value = 'Die ID konnte nicht kopiert werden.'
  }
}

function openPeerIdEditor() {
  peerIdDraft.value = peerId.value
  peerIdError.value = ''
  peerIdEditorOpen.value = true
}

function generatePeerId() {
  peerIdDraft.value = crypto.randomUUID()
  peerIdError.value = ''
}

function closePeerIdEditor() {
  if (isApplyingPeerId.value) return

  const savedPeerId = localStorage.getItem('7friends.peerId') || peerId.value
  if (peerId.value !== savedPeerId) {
    const failedPeer = peer
    peer = null
    if (failedPeer && !failedPeer.destroyed) failedPeer.destroy()
    peerId.value = savedPeerId
    peerStatus.value = 'Verbinde mit dem Peer-Netzwerk'
    startPeer(savedPeerId)
  }

  peerIdError.value = ''
  peerIdEditorOpen.value = false
}

function applyPeerId() {
  const nextId = peerIdDraft.value.trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(nextId)) {
    peerIdError.value = 'Nutze 1 bis 128 Buchstaben, Zahlen, Bindestriche oder Unterstriche.'
    return
  }

  if (nextId === peerId.value) {
    peerIdEditorOpen.value = false
    return
  }

  peerIdError.value = ''
  isApplyingPeerId.value = true
  const previousPeer = peer
  peer = null
  if (previousPeer && !previousPeer.destroyed) previousPeer.destroy()

  connections.clear()
  accessRequests.value = []
  activePeerId.value = ''
  for (const friend of friends.value) friend.status = 'Getrennt'
  peerId.value = nextId
  peerStatus.value = 'Verbinde mit dem Peer-Netzwerk'
  startPeer(nextId)
}

function saveNickname() {
  const cleanedName = nickname.value.trim().slice(0, 28) || 'Freund'
  nickname.value = cleanedName
  localStorage.setItem('7friends.nickname', cleanedName)
  for (const connection of connections.values()) {
    const friend = friends.value.find((item) => item.peerId === connection.peer && item.approved)
    if (connection.open && friend) connection.send({ type: 'hello', nickname: cleanedName })
  }
}

function startPeer(id) {
  const currentPeer = new Peer(id)
  peer = currentPeer
  currentPeer.on('open', (openedId) => {
    if (peer !== currentPeer) return
    peerId.value = openedId
    peerIdDraft.value = openedId
    peerStatus.value = 'Im Peer-Netzwerk erreichbar'
    localStorage.setItem('7friends.peerId', openedId)
    isApplyingPeerId.value = false
    peerIdEditorOpen.value = false
  })
  currentPeer.on('connection', (connection) => registerConnection(connection, 'incoming'))
  currentPeer.on('error', (error) => {
    if (peer !== currentPeer) return
    if (error.type === 'unavailable-id') {
      peerStatus.value = 'Diese ID ist bereits vergeben.'
      peerIdError.value = 'Diese ID ist bereits vergeben. Wähle eine andere.'
    } else {
      peerStatus.value = 'Peer-Netzwerk nicht erreichbar'
      peerIdError.value = isApplyingPeerId.value ? 'Die Verbindung konnte nicht aufgebaut werden.' : ''
    }
    isApplyingPeerId.value = false
  })
}

onMounted(() => {
  localStorage.setItem('7friends.peerId', peerId.value)
  localStorage.setItem('7friends.nickname', nickname.value)
  restoreSharedFiles().finally(() => startPeer(peerId.value))
})

onUnmounted(() => {
  if (activeTrack.value) URL.revokeObjectURL(activeTrack.value.url)
  if (peer && !peer.destroyed) peer.destroy()
})
</script>

<template>
  <main class="app-shell">
    <aside class="sidebar">
      <a class="wordmark" href="#" aria-label="7friends Startseite">
        <span class="brand-mark">7</span>
        <span>friends<span class="wordmark-period">.</span></span>
      </a>

      <div class="profile-block">
        <label for="nickname">DEIN PROFIL</label>
        <input id="nickname" v-model="nickname" maxlength="28" @change="saveNickname" />
        <div class="profile-controls">
          <button class="id-copy" type="button" @click="copyPeerId">
            <span class="online-dot"></span>
            <span class="id-value">{{ peerId.slice(0, 18) }}…</span>
            <span class="copy-label">Kopieren</span>
          </button>
          <button class="id-edit-button" type="button" title="GUID ändern" @click="openPeerIdEditor">
            <span aria-hidden="true">✎</span><span class="id-edit-label">GUID ändern</span>
          </button>
        </div>
      </div>

      <nav class="main-nav" aria-label="Hauptnavigation">
        <button :class="{ selected: activeTab === 'own' }" @click="activeTab = 'own'">
          <span class="nav-symbol">▤</span> Mein Ordner
          <span class="nav-count">{{ localFiles.length }}</span>
        </button>
        <button :class="{ selected: activeTab === 'friends' }" @click="activeTab = 'friends'">
          <span class="nav-symbol">⌘</span> Freunde
          <span class="nav-count">{{ friends.length }}</span>
        </button>
      </nav>

      <div class="sidebar-bottom">
        <span class="network-indicator"><span class="online-dot"></span>{{ peerStatus }}</span>
        <p>Privat geteilt. Direkt verbunden.</p>
      </div>
    </aside>

    <section class="workspace" :class="{ 'has-player': activeTrack }">
      <header class="topbar">
        <div class="breadcrumb"><span>DEIN NETZWERK</span><span class="breadcrumb-divider">/</span><strong>{{ activeTab === 'own' ? 'Mein Ordner' : 'Freunde' }}</strong></div>
        <div class="topbar-right"><span class="circle-count">{{ friends.filter((friend) => friend.status === 'Verbunden').length }}</span> online</div>
      </header>

      <div v-if="activeTab === 'own'" class="page-content">
        <div class="page-heading">
          <div>
            <div class="eyebrow">DEIN PRIVATER AUSTAUSCH</div>
            <h1>Mein Ordner<span class="heading-period">.</span></h1>
            <p class="heading-copy">Dateien, die du mit deinen Freunden teilst.</p>
          </div>
          <button class="primary-button" type="button" @click="chooseFiles">
            <span class="button-plus">+</span> Dateien hinzufügen
          </button>
          <input ref="fileInput" class="visually-hidden" type="file" multiple tabindex="-1" aria-hidden="true" @change="addFiles" />
        </div>

        <section class="folder-summary" aria-label="Ordnerübersicht">
          <div><span class="summary-label">GETEILTE DATEIEN</span><strong>{{ localFiles.length }}</strong></div>
          <span class="summary-rule"></span>
          <div><span class="summary-label">GESAMTGRÖSSE</span><strong>{{ formatSize(totalSize) }}</strong></div>
          <div class="summary-note"><span class="status-pip"></span> Nur für verbundene Freunde sichtbar</div>
        </section>

        <div class="list-heading"><h2>Dateien</h2><span>Name <span class="sort-arrow">↓</span></span></div>
        <div v-if="localFiles.length" class="file-list">
          <div v-for="item in localFiles" :key="item.id" class="file-row">
            <div class="file-icon" :class="item.type.startsWith('image/') ? 'image-file' : 'generic-file'">
              {{ item.type.startsWith('image/') ? 'IMG' : 'FILE' }}
            </div>
            <div class="file-name"><strong>{{ item.name }}</strong><span>Zuletzt geändert {{ item.lastModified ? new Date(item.lastModified).toLocaleDateString('de-DE') : 'Datum unbekannt' }}</span></div>
            <span class="file-size">{{ formatSize(item.size) }}</span>
            <span class="share-state" :class="{ unavailable: !item.available }"><span v-if="item.available" class="status-pip"></span>{{ item.available ? 'Geteilt' : 'Originaldatei nicht gefunden' }}</span>
            <div class="file-actions">
              <button v-if="isMp3(item) && item.available" class="play-button" type="button" :aria-label="`${item.name} abspielen`" title="MP3 abspielen" @click="playLocalFile(item)">▶</button>
              <button class="row-action" type="button" :aria-label="`${item.name} aus der Freigabe entfernen`" title="Freigabe entfernen; Original bleibt erhalten" @click="removeFile(item.id)">×</button>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <div class="empty-illustration"><span class="folder-tab"></span><span class="folder-body"></span><span class="folder-spark">+</span></div>
          <h3>Dein Ordner ist noch leer</h3>
          <p>Füge Dateien hinzu, um sie mit verbundenen Freunden zu teilen.</p>
          <button class="text-button" type="button" @click="chooseFiles">Dateien auswählen <span>→</span></button>
        </div>

        <footer class="page-foot"><span>7friends <span>·</span> Dein kleiner Kreis für Dateien</span><span>Peer-to-Peer-Verbindung</span></footer>
      </div>

      <div v-else class="page-content friends-page">
        <div class="page-heading">
          <div>
            <div class="eyebrow">DEIN KREIS</div>
            <h1>Freunde<span class="heading-period">.</span></h1>
            <p class="heading-copy">Verbinde dich direkt und stöbere in geteilten Ordnern.</p>
          </div>
        </div>

        <form class="connect-form" @submit.prevent="connectToFriend">
          <div class="connect-intro"><span class="connect-icon">+</span><div><strong>Mit einem Freund verbinden</strong><span>Frage nach der persönlichen ID deines Freundes.</span></div></div>
          <div class="connect-controls"><input v-model="friendIdInput" aria-label="Peer-ID des Freundes" placeholder="Peer-ID einfügen …" /><button class="primary-button" type="submit">Verbinden <span>→</span></button></div>
        </form>

        <section v-if="accessRequests.length" class="access-requests" aria-labelledby="requests-title">
          <div class="requests-heading"><h2 id="requests-title">Zugriffsanfragen</h2><span>{{ accessRequests.length }} offen</span></div>
          <div v-for="request in accessRequests" :key="request.peerId" class="access-request">
            <span class="avatar request-avatar">{{ request.nickname.slice(0, 1).toUpperCase() }}</span>
            <div class="request-details"><strong>{{ request.nickname }}</strong><span>{{ request.peerId }}</span></div>
            <div class="request-actions">
              <button class="approve-button" type="button" @click="approveAccessRequest(request.peerId)">✓ Bestätigen</button>
              <button class="decline-button" type="button" @click="declineAccessRequest(request.peerId)">Ablehnen</button>
            </div>
          </div>
        </section>

        <div class="friends-heading">
          <button class="friends-heading-refresh" type="button" title="Alle Verbindungen neu verbinden und Dateilisten aktualisieren" @click="refreshFriends">
            <span>Deine Verbindungen</span><span aria-hidden="true">↻</span>
          </button>
          <span>{{ friends.length }} {{ friends.length === 1 ? 'Person' : 'Personen' }}</span>
        </div>
        <div v-if="friends.length" class="friend-list">
          <div v-for="friend in friends" :key="friend.peerId" class="friend-row" :class="{ chosen: activePeerId === friend.peerId }">
            <button class="friend-select" type="button" :disabled="!friend.approved" @click="reconnectToFriend(friend)">
              <span class="avatar">{{ friend.nickname.slice(0, 1).toUpperCase() }}</span>
              <span class="friend-details"><strong>{{ friend.nickname }}</strong><small>{{ friend.peerId.slice(0, 24) }}…</small></span>
              <span class="friend-status"><i :class="{ online: friend.status === 'Verbunden' }"></i>{{ friend.status }}</span>
              <span class="friend-file-count">{{ friend.approved ? `${friend.files.length} Dateien` : friend.status }} <span v-if="friend.approved">→</span></span>
            </button>
            <button v-if="friend.approved" class="friend-remove" type="button" :aria-label="`${friend.nickname} aus den Verbindungen entfernen`" title="Freund entfernen; künftig ist eine neue Anfrage nötig" @click="removeFriend(friend.peerId)">×</button>
          </div>
        </div>
        <div v-else class="friends-empty"><span class="empty-circle">⌘</span><strong>Dein Kreis wartet auf Freunde</strong><p>Teile deine ID oder verbinde dich mit der ID eines Freundes.</p></div>

        <section v-if="activeFriend" class="friend-folder">
          <div class="friend-folder-heading"><div><div class="eyebrow">FREIGEGEBENER ORDNER</div><h2>{{ activeFriend.nickname }}<span>’s Dateien</span></h2></div><span class="folder-count">{{ activeFriend.files.length }} Dateien</span></div>
          <div v-if="activeFriend.files.length" class="file-list compact-list">
            <div v-for="file in activeFriend.files" :key="file.id" class="file-row">
              <div class="file-icon generic-file">FILE</div>
              <div class="file-name"><strong>{{ file.name }}</strong><span>Geteilt von {{ activeFriend.nickname }}</span></div>
              <span class="file-size">{{ formatSize(file.size) }}</span>
              <div class="file-actions">
                <button v-if="isMp3(file)" class="play-button" type="button" :aria-label="`${file.name} von ${activeFriend.nickname} abspielen`" title="MP3 direkt abspielen" @click="requestPlayback(file)">▶</button>
                <button class="download-button" type="button" title="Mit Originalnamen speichern" @click="requestDownload(file)">↓ <span>Speichern</span></button>
              </div>
            </div>
          </div>
          <div v-else class="friend-folder-empty">Dieser Ordner enthält noch keine Dateien.</div>
        </section>

        <footer class="page-foot"><span>7friends <span>·</span> Dein kleiner Kreis für Dateien</span><span>Peer-to-Peer-Verbindung</span></footer>
      </div>

      <div v-if="activeTrack" class="player-bar">
        <div class="player-meta"><span>JETZT IM PLAYER</span><strong>{{ activeTrack.name }}</strong><small>Aus {{ activeTrack.owner }}</small></div>
        <audio ref="audioRef" :src="activeTrack.url" controls :aria-label="`Wiedergabe: ${activeTrack.name}`"></audio>
        <button class="player-close" type="button" aria-label="Player schließen" title="Player schließen" @click="closePlayer">×</button>
      </div>

      <Transition name="toast"><div v-if="transferMessage" class="toast-message">{{ transferMessage }}</div></Transition>
    </section>

    <div v-if="peerIdEditorOpen" class="id-dialog-overlay" @click.self="closePeerIdEditor">
      <section class="id-dialog" role="dialog" aria-modal="true" aria-labelledby="id-dialog-title">
        <div class="eyebrow">DEIN PROFIL</div>
        <h2 id="id-dialog-title">GUID ändern</h2>
        <p>Beim Wechsel werden aktuelle Verbindungen getrennt. Deine Freunde bleiben gespeichert, brauchen aber deine neue ID.</p>
        <label for="peer-id-draft">Peer-ID</label>
        <input id="peer-id-draft" v-model="peerIdDraft" maxlength="128" :disabled="isApplyingPeerId" @keyup.enter="applyPeerId" />
        <p v-if="peerIdError" class="id-dialog-error" role="alert">{{ peerIdError }}</p>
        <div class="id-dialog-actions">
          <button class="random-id-button" type="button" :disabled="isApplyingPeerId" @click="generatePeerId">Neue Zufalls-GUID</button>
          <span class="id-dialog-spacer"></span>
          <button class="cancel-id-button" type="button" :disabled="isApplyingPeerId" @click="closePeerIdEditor">Abbrechen</button>
          <button class="primary-button" type="button" :disabled="isApplyingPeerId" @click="applyPeerId">{{ isApplyingPeerId ? 'Verbinde …' : 'Übernehmen' }}</button>
        </div>
      </section>
    </div>
  </main>
</template>