import { useEffect, useRef } from 'react'
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

  // Keep ref in sync without re-registering the listener
  useEffect(() => {
    shiftRef.current = shift
  }, [shift])

  // Register the listener exactly once
  useEffect(() => {
    const handler = () => {
      if (shiftRef.current) {
        navigate('/corte')
        setTimeout(() => {
          alert('Tienes un turno activo. Realiza el corte antes de cerrar el programa.')
        }, 100)
      } else {
        window.api.allowClose()
      }
    }
    window.api.onAppClosing(handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
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
