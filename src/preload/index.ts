import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  organizePhotos: (filePaths: string[], perSortExclusions?: string) => ipcRenderer.invoke('organize-photos', filePaths, perSortExclusions),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s: Record<string, string>) => ipcRenderer.invoke('save-settings', s),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  revealInFinder: (path: string) => ipcRenderer.invoke('reveal-in-finder', path),
  openPreviewWindow: (filePath: string) => ipcRenderer.invoke('open-preview-window', filePath),
  moveFile: (currentPath: string, newRelativePath: string) => ipcRenderer.invoke('move-file', currentPath, newRelativePath),
  getOutputDir: () => ipcRenderer.invoke('get-output-dir'),
  onOpenFiles: (cb: (paths: string[]) => void) => {
    ipcRenderer.on('open-files', (_e, paths) => cb(paths))
    return () => ipcRenderer.removeAllListeners('open-files')
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
