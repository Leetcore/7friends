const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');

function getAppUrl() {
  return new URL(`file://${path.join(__dirname, 'index.html')}`).toString();
}

function createWindow() {
  const appUrl = getAppUrl();
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== appUrl) {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function readFolderTree(dirPath) {
  const MAX_DEPTH = 6;
  return readFolderTreeAtDepth(dirPath, 0, MAX_DEPTH);
}

async function readFolderTreeAtDepth(dirPath, depth, maxDepth) {
  if (depth >= maxDepth) {
    return [];
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const children = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const absolutePath = path.join(dirPath, entry.name);
    children.push({
      name: entry.name,
      path: absolutePath,
      children: await readFolderTreeAtDepth(absolutePath, depth + 1, maxDepth)
    });
  }

  return children.sort((a, b) => a.name.localeCompare(b.name));
}

ipcMain.handle('select-folder', async (event) => {
  if (event.senderFrame.url !== getAppUrl()) {
    throw new Error('Unauthorized sender');
  }

  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];
  const tree = await readFolderTree(selectedPath);

  return {
    name: path.basename(selectedPath),
    path: selectedPath,
    children: tree
  };
});
