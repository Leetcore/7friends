const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sevenFriends', {
  saveReceivedFile: (fileName, fileData) =>
    ipcRenderer.invoke('save-received-file', fileName, fileData),
})