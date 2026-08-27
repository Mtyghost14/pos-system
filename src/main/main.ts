import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { initDatabase } from './database'
import { registerIpcHandlers } from './ipc-handlers'
import { setupBackup } from './backup'
import { autoUpdater } from 'electron-updater'

// Force GDI print path so older thermal printer drivers (e.g. Star TSP100)
// can process the job. Chromium 112+ defaults to a PDF compositor pipeline
// that GDI-only drivers receive as a blank page.
app.commandLine.appendSwitch('disable-features', 'UsePdfCompositorServiceForPrint')

let mainWindow: BrowserWindow | null = null
// Set to true right before an intentional quit (user allowed close, or an
// update is being installed) so the `close` handler below doesn't block it.
let forceClose = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Sistema POS',
    show: false,
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (e) => {
    if (forceClose) return
    e.preventDefault()
    mainWindow?.webContents.send('app:closing')
  })

  ipcMain.on('app:allow-close', () => {
    forceClose = true
    mainWindow?.close()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  try {
    initDatabase()
    registerIpcHandlers()
    setupBackup()
    createWindow()
  } catch (err) {
    console.error('Error initializing app:', err)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Auto-updater — listeners are always registered so the Configuración →
  // Actualizaciones panel works; the automatic startup check only runs in the
  // packaged app (electron-updater can't check from an unpacked dev build).
  setupAutoUpdater()
  if (process.env.NODE_ENV !== 'development') {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)
  }
})

function setupAutoUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', { version: info.version })
  })

  autoUpdater.on('update-not-available', (info) => {
    mainWindow?.webContents.send('update:not-available', { version: info?.version })
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', { percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update:ready', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    console.error('AutoUpdater error:', err?.message || err)
    mainWindow?.webContents.send('update:error', { message: err?.message || 'Error desconocido al actualizar' })
  })
}

// Current installed version, shown in the Actualizaciones panel.
ipcMain.handle('app:getVersion', () => app.getVersion())

// Manual "buscar actualizaciones" trigger. Resolves once the check completes;
// the update-available / update-not-available / error events carry the detail.
ipcMain.handle('update:check', async () => {
  if (process.env.NODE_ENV === 'development') {
    return { ok: false, message: 'Las actualizaciones solo funcionan en la aplicación instalada.' }
  }
  try {
    const res = await autoUpdater.checkForUpdates()
    const latest = res?.updateInfo?.version
    const current = app.getVersion()
    const updateAvailable = (res as any)?.isUpdateAvailable ?? (!!latest && latest !== current)
    return { ok: true, updateAvailable, version: latest, current }
  } catch (err: any) {
    return { ok: false, message: err?.message || 'No se pudo verificar si hay actualizaciones' }
  }
})

// Renderer can trigger install when the user clicks "Reiniciar e instalar"
ipcMain.on('update:install', () => {
  forceClose = true // let the window `close` handler through for the updater
  autoUpdater.quitAndInstall()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
