import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { initDatabase } from './database'
import { registerIpcHandlers } from './ipc-handlers'
import { setupBackup } from './backup'
import { autoUpdater } from 'electron-updater'

let mainWindow: BrowserWindow | null = null

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

  let forceClose = false
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

  // Auto-updater (only in packaged app, not during development)
  if (process.env.NODE_ENV !== 'development') {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update:available', { version: info.version })
    })

    autoUpdater.on('download-progress', (progress) => {
      mainWindow?.webContents.send('update:progress', { percent: Math.round(progress.percent) })
    })

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update:ready', { version: info.version })
    })

    autoUpdater.on('error', (err) => {
      console.error('AutoUpdater error:', err.message)
    })

    // Check on startup (after a short delay so the window is ready)
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)
  }
})

// Renderer can trigger install when the user clicks "Reiniciar y actualizar"
ipcMain.on('update:install', () => {
  autoUpdater.quitAndInstall()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
