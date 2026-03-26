/// <reference types="vite/client" />

interface Window {
  api: {
    organizePhotos: (filePaths: string[], perSortExclusions?: string) => Promise<import('../../main/services/organizer').OrganizeResult[]>
    getSettings: () => Promise<import('../../main/services/store').Settings>
    saveSettings: (s: Record<string, string>) => Promise<void>
    pickFolder: () => Promise<string | null>
    pickFiles: () => Promise<string[]>
    openPreviewWindow: (filePath: string) => Promise<void>
    revealInFinder: (path: string) => Promise<boolean>
    moveFile: (currentPath: string, newRelativePath: string) => Promise<string>
    getOutputDir: () => Promise<string>
    onOpenFiles: (cb: (paths: string[]) => void) => () => void
  }
  electron: {
    shell: { openExternal: (url: string) => void }
  }
}
