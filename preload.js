const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    startStream: (url) => ipcRenderer.invoke('start-stream', url),
    stopStream: () => ipcRenderer.invoke('stop-stream'),
    extractClip: (data) => ipcRenderer.invoke('extract-clip', data),
    openFile: (filePath) => ipcRenderer.send('open-file', filePath)
});
