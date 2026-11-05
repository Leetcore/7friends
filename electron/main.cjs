const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { open, readFile, stat, writeFile } = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const path = require('node:path')

function sharedFilesManifestPath() {
  return path.join(app.getPath('userData'), 'shared-files.json')
}

async function readSharedFileRecords() {
  try {
    const contents = await readFile(sharedFilesManifestPath(), 'utf8')
    const records = JSON.parse(contents)
    if (!Array.isArray(records)) return []
    return records.filter((record) => typeof record.id === 'string' && typeof record.path === 'string')
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

async function writeSharedFileRecords(records) {
  await writeFile(sharedFilesManifestPath(), JSON.stringify(records, null, 2), 'utf8')
}

function getMimeType(filePath) {
  const mimeTypes = {
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.wav': 'audio/wav',
  }
  return mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

async function listSharedFiles() {
  const records = await readSharedFileRecords()
  return Promise.all(records.map(async (record) => {
    try {
      const fileInfo = await stat(record.path)
      if (!fileInfo.isFile()) throw new Error('Shared path is not a file')
      return {
        id: record.id,
        name: path.basename(record.path),
        size: fileInfo.size,
        type: getMimeType(record.path),
        lastModified: fileInfo.mtimeMs,
        available: true,
      }
    } catch {
      return {
        id: record.id,
        name: path.basename(record.path),
        size: Number.isSafeInteger(record.size) ? record.size : 0,
        type: typeof record.type === 'string' ? record.type : getMimeType(record.path),
        lastModified: Number.isFinite(record.lastModified) ? record.lastModified : 0,
        available: false,
      }
    }
  }))
}

ipcMain.handle('list-shared-files', listSharedFiles)

ipcMain.handle('select-shared-files', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const options = { properties: ['openFile', 'multiSelections'] }
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled) return listSharedFiles()

  const records = await readSharedFileRecords()
  for (const filePath of result.filePaths) {
    const fileInfo = await stat(filePath)
    if (!fileInfo.isFile()) continue

    const existing = records.find((record) => record.path === filePath)
    const record = existing || { id: randomUUID(), path: filePath }
    record.name = path.basename(filePath)
    record.size = fileInfo.size
    record.type = getMimeType(filePath)
    record.lastModified = fileInfo.mtimeMs
    if (!existing) records.push(record)
  }

  await writeSharedFileRecords(records)
  return listSharedFiles()
})

ipcMain.handle('remove-shared-file', async (event, fileId) => {
  const records = await readSharedFileRecords()
  await writeSharedFileRecords(records.filter((record) => record.id !== fileId))
  return listSharedFiles()
})

ipcMain.handle('read-shared-file-chunk', async (event, fileId, offset, length) => {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > 64 * 1024) {
    throw new Error('Invalid shared file range')
  }

  const records = await readSharedFileRecords()
  const record = records.find((item) => item.id === fileId)
  if (!record) throw new Error('Shared file not found')

  const fileInfo = await stat(record.path)
  if (!fileInfo.isFile()) throw new Error('Shared path is not a file')
  const bytesToRead = Math.min(length, Math.max(0, fileInfo.size - offset))
  const file = await open(record.path, 'r')
  try {
    const buffer = Buffer.alloc(bytesToRead)
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, offset)
    return new Uint8Array(buffer.subarray(0, bytesRead))
  } finally {
    await file.close()
  }
})

ipcMain.handle('save-received-file', async (event, fileName, fileData) => {
  const safeName = path.basename(String(fileName || 'datei').replaceAll('\\', '_').replaceAll('/', '_')) || 'datei'
  const window = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showSaveDialog(window, {
    title: 'Datei speichern',
    defaultPath: safeName,
  })

  if (result.canceled || !result.filePath) return false

  await writeFile(result.filePath, Buffer.from(fileData))
  return true
})

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#f4f3ef',
    title: '7friends',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (app.isPackaged) {
    window.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    window.loadURL('http://127.0.0.1:5173')
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})