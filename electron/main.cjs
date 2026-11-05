const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { writeFile } = require('node:fs/promises')
const path = require('node:path')

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