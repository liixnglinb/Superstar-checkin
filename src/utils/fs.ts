import * as fs from 'fs'
import * as path from 'path'

export function writeFileAtomic(filePath: string, data: string | Buffer): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  try {
    fs.writeFileSync(tempPath, data)
    fs.renameSync(tempPath, filePath)
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
  }
}
