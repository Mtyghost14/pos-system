import { useEffect, useRef, useState } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from './store/useAuthStore'
import { useSettingsStore } from './store/useSettingsStore'
import Login from './pages/Login'
import Layout from './components/Layout'
import Sales from './pages/Sales'
import Products from './pages/Products'
import Inventory from './pages/Inventory'
import Purchases from './pages/Purchases'
import Invoices from './pages/Invoices'
import Corte from './pages/Corte'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Pedidos from './pages/Pedidos'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/ventas" replace />
  return <>{children}</>
}

function CloseGuard() {
  const shift = useAuthStore(s => s.shift)
  const navigate = useNavigate()
  const shiftRef = useRef(shift)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    shiftRef.current = shift
  }, [shift])

  useEffect(() => {
    const handler = () => {
      if (shiftRef.current) {
        navigate('/corte')
        setShowModal(true)
      } else {
        window.api.allowClose()
      }
    }
    window.api.onAppClosing(handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!showModal) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--nm-bg, #e8e8e8)',
        borderRadius: 12,
        padding: '32px 40px',
        maxWidth: 380,
        textAlign: 'center',
        boxShadow: '6px 6px 12px #b0b0b0, -6px -6px 12px #ffffff',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
        <p style={{ fontWeight: 600, marginBottom: 8 }}>Turno activo</p>
        <p style={{ marginBottom: 24, color: '#555' }}>
          Tienes un turno activo. Realiza el corte antes de cerrar el programa.
        </p>
        <button
          autoFocus
          onClick={() => setShowModal(false)}
          style={{
            padding: '10px 28px', borderRadius: 8, border: 'none',
            background: 'var(--nm-accent, #4f8ef7)', color: '#fff',
            fontWeight: 600, cursor: 'pointer', fontSize: 14,
          }}
        >
          Entendido
        </button>
      </div>
    </div>
  )
}

function UpdateBanner() {
  const [state, setState] = useState<'idle' | 'available' | 'downloading' | 'ready'>('idle')
  const [version, setVersion] = useState('')
  const [percent, setPercent] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.api.onUpdateAvailable((info) => {
      setVersion(info.version)
      setState('available')
    })
    window.api.onUpdateProgress((info) => {
      setPercent(info.percent)
      setState('downloading')
    })
    window.api.onUpdateReady((info) => {
      setVersion(info.version)
      setState('ready')
    })
  }, [])

  if (state === 'idle' || dismissed) return null

  const bannerStyle: React.CSSProperties = {
    position: 'fixed', bottom: 16, right: 16, zIndex: 9998,
    background: state === 'ready' ? '#1a7f37' : '#0969da',
    color: '#fff', borderRadius: 10,
    padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12,
    boxShadow: '0 4px 20px rgba(0,0,0,0.25)', fontSize: 13, maxWidth: 360,
  }

  return (
    <div style={bannerStyle}>
      <div style={{ flex: 1 }}>
        {state === 'available' && <><b>Actualización v{version} disponible</b> — descargando...</>}
        {state === 'downloading' && <><b>Descargando actualización v{version}...</b> {percent}%</>}
        {state === 'ready' && <><b>v{version} lista para instalar.</b> Se instalará al cerrar el programa.</>}
      </div>
      {state === 'ready' && (
        <button
          onClick={() => window.api.installUpdate()}
          style={{
            background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
            borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12,
          }}
        >
          Reiniciar ahora
        </button>
      )}
      <button
        onClick={() => setDismissed(true)}
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 16, padding: 0 }}
      >
        ×
      </button>
    </div>
  )
}

function CloudBanner() {
  const [state, setState] = useState<'ok' | 'offline' | 'unset'>('ok')

  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const s = await window.api.cloudStatus()
        if (!alive) return
        setState(s.ready ? 'ok' : s.configured ? 'offline' : 'unset')
      } catch { /* ignore */ }
    }
    check()
    const off = window.api.onCloudStatus((s: any) => {
      setState(s.ready ? 'ok' : 'offline')
    })
    const iv = setInterval(check, 8000)
    return () => { alive = false; clearInterval(iv); try { off?.() } catch {} }
  }, [])

  if (state === 'ok') return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9997,
      background: state === 'unset' ? '#8a6d00' : '#b3261e', color: '#fff',
      padding: '8px 16px', textAlign: 'center', fontSize: 13, fontWeight: 700,
      boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
    }}>
      {state === 'unset'
        ? '⚙️ Sincronización con la nube sin configurar — Configuración → Sincronización'
        : '☁️ Sin conexión con la nube — no se pueden registrar ventas ni ajustes de inventario hasta reconectar'}
    </div>
  )
}

export default function App() {
  const { loadSettings } = useSettingsStore()

  useEffect(() => {
    loadSettings()
  }, [])

  return (
    <HashRouter>
      <CloseGuard />
      <UpdateBanner />
      <CloudBanner />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Navigate to="/ventas" replace />} />
          <Route path="ventas" element={<Sales />} />
          <Route path="productos" element={<RequireAuth><Products /></RequireAuth>} />
          <Route path="inventario" element={<RequireAuth><Inventory /></RequireAuth>} />
          <Route path="compras" element={<RequireAdmin><Purchases /></RequireAdmin>} />
          <Route path="facturas" element={<RequireAdmin><Invoices /></RequireAdmin>} />
          <Route path="corte" element={<Corte />} />
          <Route path="pedidos" element={<Pedidos />} />
          <Route path="reportes" element={<RequireAdmin><Reports /></RequireAdmin>} />
          <Route path="configuracion" element={<RequireAdmin><Settings /></RequireAdmin>} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  )
}
