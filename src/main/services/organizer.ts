import { mkdir, copyFile } from 'fs/promises'
import { join, basename, extname } from 'path'
import { existsSync } from 'fs'
import { extractGps, extractDate } from './exif'
import { reverseGeocode, sanitizeFolderName } from './geocoder'
import { classifyPhoto } from './vision'
import { organizeDocument } from './document-organizer'
import type { Settings } from './store'

export interface OrganizeResult {
  originalPath: string
  destinationPath: string
  location: string
  category: string
  error?: string
}

const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.webp'])
const DOC_EXTS = new Set(['.pdf'])

export async function organizeFile(
  filePath: string,
  settings: Settings
): Promise<OrganizeResult> {
  const ext = extname(filePath).toLowerCase()
  if (DOC_EXTS.has(ext)) {
    return organizeDocument(filePath, settings)
  }
  if (PHOTO_EXTS.has(ext)) {
    return organizePhoto(filePath, settings)
  }
  return {
    originalPath: filePath,
    destinationPath: '',
    location: '',
    category: '',
    error: `Unsupported file type: ${ext}`
  }
}

export async function organizePhoto(
  filePath: string,
  settings: Settings
): Promise<OrganizeResult> {
  try {
    // 1. Extract GPS from EXIF
    const coords = await extractGps(filePath)

    // 2. Reverse geocode → location folder
    let locationFolder: string
    let locationDisplay: string

    if (coords) {
      const location = await reverseGeocode(coords)
      locationFolder = join(
        sanitizeFolderName(location.state || 'Unknown State'),
        sanitizeFolderName(location.city)
      )
      locationDisplay = `${location.city}, ${location.state}`
    } else {
      // No GPS — sort by screenshot detection then date
      const date = await extractDate(filePath)
      const year = date.getFullYear().toString()
      const monthNum = String(date.getMonth() + 1).padStart(2, '0')
      const monthName = date.toLocaleString('en-US', { month: 'short' })
      const month = `${monthNum} ${monthName}`
      const isScreenshot = /screenshot/i.test(basename(filePath))
      locationFolder = isScreenshot
        ? join('Unknown Location', 'Screenshots', year, month)
        : join('Unknown Location', year, month)
      locationDisplay = 'Unknown Location'
    }

    // 3. Classify content locally
    const category = await classifyPhoto(filePath)

    // 4. Build destination path — screenshots skip the category subfolder
    const isScreenshot = /screenshot/i.test(basename(filePath))
    const destDir = (coords || !isScreenshot)
      ? join(settings.outputDir, 'Photos', locationFolder, category)
      : join(settings.outputDir, 'Photos', locationFolder)
    await mkdir(destDir, { recursive: true })

    // 5. Handle filename collisions
    const ext = extname(filePath)
    const base = basename(filePath, ext)
    let destPath = join(destDir, basename(filePath))

    let counter = 1
    while (existsSync(destPath)) {
      destPath = join(destDir, `${base}_${counter}${ext}`)
      counter++
    }

    // 6. Copy file, preserving the original
    await copyFile(filePath, destPath)

    return {
      originalPath: filePath,
      destinationPath: destPath,
      location: locationDisplay,
      category
    }
  } catch (err) {
    return {
      originalPath: filePath,
      destinationPath: '',
      location: '',
      category: '',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
