import * as exifr from 'exifr'
import { stat } from 'fs/promises'

export interface GpsCoords {
  latitude: number
  longitude: number
}

export async function extractGps(filePath: string): Promise<GpsCoords | null> {
  try {
    const gps = await exifr.gps(filePath)
    if (gps?.latitude && gps?.longitude) {
      return { latitude: gps.latitude, longitude: gps.longitude }
    }
    return null
  } catch {
    return null
  }
}

export async function extractDate(filePath: string): Promise<Date> {
  try {
    const data = await exifr.parse(filePath, { pick: ['DateTimeOriginal', 'CreateDate'] })
    if (data?.DateTimeOriginal) return new Date(data.DateTimeOriginal)
    if (data?.CreateDate) return new Date(data.CreateDate)
  } catch {
    // fall through to file mtime
  }
  const s = await stat(filePath)
  return s.mtime
}
