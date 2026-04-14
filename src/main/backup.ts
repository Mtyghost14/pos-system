import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, statSync } from 'fs'

export function setupBackup() {
  // Run daily backup
  const DAY_MS = 24 * 60 * 60 * 1000
  performBackup()
  setInterval(performBackup, DAY_MS)
}

function performBackup() {
  try {
    const userDataPath = app.getPath('userData')
    const backupsDir = join(userDataPath, 'backups')
    if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true })

    const srcPath = join(userDataPath, 'pos.db')
    if (!existsSync(srcPath)) return

    const now = new Date()
    const name = `pos_backup_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.db`
    const destPath = join(backupsDir, name)

    copyFileSync(srcPath, destPath)

    // Keep only last 30 backups
    const backups = readdirSync(backupsDir)
      .filter(f => f.endsWith('.db'))
      .map(f => ({ name: f, mtime: statSync(join(backupsDir, f)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

    if (backups.length > 30) {
      for (const b of backups.slice(30)) {
        unlinkSync(join(backupsDir, b.name))
      }
    }
  } catch (err) {
    console.error('Backup failed:', err)
  }
}
