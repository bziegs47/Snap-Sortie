import type { GpsCoords } from './exif'

export interface Location {
  city: string
  state: string
  country: string
  display: string // "San Francisco, CA" or "London, UK"
}

const cache = new Map<string, Location>()
let lastGeocode = 0

export async function reverseGeocode(coords: GpsCoords): Promise<Location> {
  const key = `${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)}`
  if (cache.has(key)) return cache.get(key)!

  // Nominatim policy: max 1 request/second
  const now = Date.now()
  const wait = 1100 - (now - lastGeocode)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastGeocode = Date.now()

  const url =
    `https://nominatim.openstreetmap.org/reverse?lat=${coords.latitude}&lon=${coords.longitude}` +
    `&format=json&addressdetails=1`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'snap-sortie/1.0 (personal photo organizer)' }
  })

  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`)

  const data = (await res.json()) as { address: Record<string, string> }
  const addr = data.address

  const city =
    addr.city || addr.town || addr.village || addr.hamlet || addr.county || 'Unknown City'
  const state = addr.state || addr.region || ''
  const country = addr.country || 'Unknown Country'

  // Abbreviate US states to 2-letter code if possible
  const stateDisplay = addr.ISO3166_2_lvl4
    ? addr.ISO3166_2_lvl4.split('-')[1]
    : state

  const display = stateDisplay ? `${city}, ${stateDisplay}` : city

  const location: Location = { city, state, country, display }
  cache.set(key, location)
  return location
}

export function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim()
}
