import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import { join, basename, dirname } from 'path'
import { rename, mkdir, readdir, rmdir } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { organizeFile } from './services/organizer'
import { getSettings, saveSettings } from './services/store'
import { resolveCollision } from './services/collision'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1020,
    minWidth: 760,
    minHeight: 520,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1a10',
    icon: join(__dirname, '../../resources/icon.icns'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File(s)…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (!mainWindow) return
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile', 'multiSelections'],
              filters: [{ name: 'Photos & Documents', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'tif', 'tiff', 'webp', 'pdf'] }]
            })
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send('open-files', result.filePaths)
            }
          }
        },
        { type: 'separator' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Show Snap Sortie',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) {
              mainWindow.show()
              mainWindow.focus()
            } else {
              createWindow()
            }
          }
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  app.setName('Snap Sortie')
  electronApp.setAppUserModelId('com.snapsortie')
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Helpers ───────────────────────────────────────────────

/** Remove empty directories walking up from `dir`, stopping at `stopAt` (exclusive). */
async function pruneEmptyDirs(dir: string, stopAt: string): Promise<void> {
  let current = dir
  // Normalize stopAt so comparison is reliable
  const boundary = stopAt.endsWith('/') ? stopAt.slice(0, -1) : stopAt
  while (current.length > boundary.length && current.startsWith(boundary)) {
    try {
      const entries = await readdir(current)
      if (entries.length > 0) break  // not empty — stop
      await rmdir(current)
      current = dirname(current)
    } catch {
      break  // permission error or already deleted — stop
    }
  }
}

// ── IPC Handlers ──────────────────────────────────────────

// Organize dropped files — accepts optional per-sort exclusions
ipcMain.handle('organize-photos', async (_e, filePaths: string[], perSortExclusions?: string) => {
  const settings = getSettings()
  if (!settings.outputDir) throw new Error('No output folder configured.')
  // Merge permanent + per-sort exclusions
  const mergedSettings = { ...settings }
  if (perSortExclusions) {
    const permanent = settings.excludedTerms || ''
    const parts = [permanent, perSortExclusions].filter(Boolean)
    mergedSettings.excludedTerms = parts.join(', ')
  }
  const results = []
  for (const filePath of filePaths) {
    const result = await organizeFile(filePath, mergedSettings, mainWindow)
    results.push(result)
  }
  return results
})

// Settings
ipcMain.handle('get-settings', () => getSettings())
ipcMain.handle('save-settings', (_e, settings) => saveSettings(settings))

// Pick output folder
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

// Pick files to organize
ipcMain.handle('pick-files', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Photos & Documents', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'tif', 'tiff', 'webp', 'pdf'] }]
  })
  return result.canceled ? [] : result.filePaths
})

// Open a file preview in a separate window
ipcMain.handle('open-preview-window', async (_e, filePath: string) => {
  const { existsSync, readFileSync } = require('fs')
  const { extname: pathExtname } = require('path')
  console.log('[preview] Requested path:', filePath, '| exists:', existsSync(filePath))
  if (!existsSync(filePath)) {
    throw new Error('File has been moved or deleted.')
  }

  const filename = basename(filePath)
  const ext = pathExtname(filePath).toLowerCase()
  const isPdf = ext === '.pdf'

  const previewWin = new BrowserWindow({
    width: 800,
    height: 700,
    minWidth: 400,
    minHeight: 300,
    title: filename,
    backgroundColor: '#0e0e0e',
    webPreferences: {
      sandbox: true,
      contextIsolation: true
    }
  })

  previewWin.setMenuBarVisibility(false)


  if (isPdf) {
    // Chromium's built-in PDF viewer handles PDFs natively
    previewWin.loadFile(filePath)
  } else {
    // For images, write a temp HTML file that references the image as base64
    const { execFileSync } = require('child_process')
    const { tmpdir } = require('os')
    const { randomUUID } = require('crypto')
    const { unlinkSync, writeFileSync } = require('fs')

    let imageFile = filePath
    let sipsTemp: string | null = null

    // Convert non-Chromium-native formats to JPEG via sips
    const chromiumNative = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
    if (!chromiumNative.has(ext)) {
      sipsTemp = join(tmpdir(), `snapsortie-preview-${randomUUID()}.jpg`)
      try {
        execFileSync('sips', ['-s', 'format', 'jpeg', filePath, '--out', sipsTemp])
        imageFile = sipsTemp
      } catch {
        sipsTemp = null
      }
    }

    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.webp': 'image/webp',
      '.tif': 'image/tiff', '.tiff': 'image/tiff'
    }
    const actualMime = sipsTemp ? 'image/jpeg' : (mimeMap[ext] || 'image/jpeg')
    const b64 = readFileSync(imageFile).toString('base64')

    // Clean up sips temp
    if (sipsTemp) {
      try { unlinkSync(sipsTemp) } catch {}
    }

    // Write a temp HTML file — avoids data URL size limits
    const htmlTemp = join(tmpdir(), `snapsortie-preview-${randomUUID()}.html`)
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${filename}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0e0e0e; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: auto; }
  img { max-width: 100%; max-height: 100vh; object-fit: contain; }
</style></head>
<body><img src="data:${actualMime};base64,${b64}" alt="${filename}"></body></html>`
    writeFileSync(htmlTemp, html)
    previewWin.loadFile(htmlTemp)

    // Clean up temp HTML when window closes
    previewWin.on('closed', () => {
      try { unlinkSync(htmlTemp) } catch {}
    })
  }
})

// Move a file to a new relative path under outputDir, then clean up empty dirs
ipcMain.handle('move-file', async (_e, currentPath: string, newRelativePath: string) => {
  const settings = getSettings()
  if (!settings.outputDir) throw new Error('No output folder configured.')
  const filename = basename(currentPath)
  const oldDir = dirname(currentPath)
  const newDir = join(settings.outputDir, newRelativePath)
  await mkdir(newDir, { recursive: true })

  // Check for collision
  const collision = await resolveCollision(newDir, filename, mainWindow)
  if (collision.choice === 'skip') {
    throw new Error('Move cancelled — file already exists.')
  }

  await rename(currentPath, collision.path)

  // Walk up from old directory, removing empty folders up to outputDir
  await pruneEmptyDirs(oldDir, settings.outputDir)

  return collision.path
})

// Resolve dropped paths — expand folders into supported files recursively
ipcMain.handle('resolve-drop-paths', async (_e, paths: string[]) => {
  const { statSync, readdirSync } = require('fs')
  const supportedExts = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.webp', '.pdf'])
  const files: string[] = []

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue // skip hidden files
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (supportedExts.has(require('path').extname(entry.name).toLowerCase())) {
        files.push(fullPath)
      }
    }
  }

  for (const p of paths) {
    try {
      const s = statSync(p)
      if (s.isDirectory()) {
        walk(p)
      } else if (supportedExts.has(require('path').extname(p).toLowerCase())) {
        files.push(p)
      }
    } catch { /* skip inaccessible paths */ }
  }

  return files
})

// Get the output directory so the renderer can compute relative paths
ipcMain.handle('get-output-dir', () => {
  return getSettings().outputDir
})

// Open folder in Finder — return false if file no longer exists
ipcMain.handle('reveal-in-finder', (_e, filePath: string) => {
  const { existsSync } = require('fs')
  if (existsSync(filePath)) {
    shell.showItemInFolder(filePath)
    return true
  }
  return false
})

