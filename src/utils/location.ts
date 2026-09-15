import * as fs from 'fs'
import * as path from 'path'
import { writeFileAtomic } from './fs'

interface SavedLocation {
  address: string
  lat: number
  lon: number
  lastUsed: string
  useCount: number
}

let locations: SavedLocation[] = []
let filePath = ''

export function initLocationStore(dataDir: string) {
  filePath = path.join(dataDir, 'learned-locations.json')
  try {
    if (fs.existsSync(filePath)) {
      locations = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
  } catch { /* 空文件 */ }
}

function save() {
  if (!filePath) return
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileAtomic(filePath, JSON.stringify(locations, null, 2))
}

export function getLearnedLocation(address: string): { lat: number; lon: number } | null {
  if (!address) return null
  const found = locations.find(l => l.address === address)
  if (found) {
    found.lastUsed = new Date().toISOString()
    found.useCount++
    save()
    return { lat: found.lat, lon: found.lon }
  }
  return null
}

export function saveLearnedLocation(address: string, lat: number, lon: number) {
  if (!address) return
  const existing = locations.find(l => l.address === address)
  if (existing) {
    existing.lat = lat
    existing.lon = lon
    existing.lastUsed = new Date().toISOString()
    existing.useCount++
  } else {
    locations.push({ address, lat, lon, lastUsed: new Date().toISOString(), useCount: 1 })
  }
  if (locations.length > 50) locations = locations.slice(-50)
  save()
}
