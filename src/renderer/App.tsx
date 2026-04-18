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

export default function App() {
  const { loadSettings } = useSettingsStore()

  useEffect(() => {
    loadSettings()
  }, [])

  return (
    <HashRouter>
      <CloseGuard />
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
          <Route path="reportes" element={<RequireAdmin><Reports /></RequireAdmin>} />
          <Route path="configuracion" element={<RequireAdmin><Settings /></RequireAdmin>} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  )
}
