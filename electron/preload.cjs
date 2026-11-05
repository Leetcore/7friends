const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sevenFriends', {
  listSharedFiles: () => ipcRenderer.invoke('list-shared-files'),
  selectSharedFiles: () => ipcRenderer.invoke('select-shared-files'),
  removeSharedFile: (fileId) => ipcRenderer.invoke('remove-shared-file', fileId),
  readSharedFileChunk: (fileId, offset, length) =>
    ipcRenderer.invoke('read-shared-file-chunk', fileId, offset, length),
  saveReceivedFile: (fileName, fileData) =>
    ipcRenderer.invoke('save-received-file', fileName, fileData),
})