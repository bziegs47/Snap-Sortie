import { existsSync } from 'fs'
import { join, basename, extname } from 'path'
import { dialog, BrowserWindow } from 'electron'

export type CollisionChoice = 'overwrite' | 'duplicate' | 'skip'

/**
 * Check if destPath exists and prompt the user to overwrite or duplicate.
 * Returns the final destination path to use, or null if the user chose to skip.
 */
export async function resolveCollision(
  destDir: string,
  filename: string,
  parentWindow?: BrowserWindow | null
): Promise<{ path: string; choice: CollisionChoice }> {
  const destPath = join(destDir, filename)

  if (!existsSync(destPath)) {
    return { path: destPath, choice: 'duplicate' }
  }

  const ext = extname(filename)
  const base = basename(filename, ext)

  const result = await dialog.showMessageBox(parentWindow || undefined as any, {
    type: 'question',
    title: 'File Already Exists',
    message: `"${filename}" already exists in this folder.`,
    detail: destDir,
    buttons: ['Overwrite', 'Keep Both', 'Skip'],
    defaultId: 1,
    cancelId: 2
  })

  switch (result.response) {
    case 0: // Overwrite
      return { path: destPath, choice: 'overwrite' }
    case 1: { // Keep Both — find a unique name
      let newPath = destPath
      let counter = 1
      while (existsSync(newPath)) {
        newPath = join(destDir, `${base}_${counter}${ext}`)
        counter++
      }
      return { path: newPath, choice: 'duplicate' }
    }
    case 2: // Skip
    default:
      return { path: '', choice: 'skip' }
  }
}
