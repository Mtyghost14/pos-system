import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
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

export default function App() {
  const { loadSettings } = useSettingsStore()

  useEffect(() => {
    loadSettings()
  }, [])

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Navigate to="/ventas" replace />} />
          <Route path="ventas" element={<Sales />} />
          <Route path="productos" element={<RequireAdmin><Products /></RequireAdmin>} />
          <Route path="inventario" element={<RequireAdmin><Inventory /></RequireAdmin>} />
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
