import { useState, useRef } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import { useSettingsStore } from '../store/useSettingsStore'

const BILLS = [1000, 500, 200, 100, 50, 20]
const COINS = [20, 10, 5, 2, 1, 0.5]
const fmtCash = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

function CashCounterModal({ onConfirm, onClose }: { onConfirm: (total: number) => void; onClose: () => void }) {
  // Zero React state — all live updates go straight to the DOM so React never
  // re-renders this component while the user is typing (which would steal focus).
  const inputRefs    = useRef<Record<string, HTMLInputElement | null>>({})
  const subRefs      = useRef<Record<string, HTMLSpanElement | null>>({})
  const totalRef     = useRef<HTMLSpanElement | null>(null)
  const btnTotalRef  = useRef<HTMLSpanElement | null>(null)

  const computeTotal = () =>
    [...BILLS, ...COINS].reduce((sum, d) => {
      const qty = parseInt(inputRefs.current[String(d)]?.value || '0') || 0
      return sum + qty * d
    }, 0)

  const recalc = () => {
    let total = 0
    for (const d of [...BILLS, ...COINS]) {
      const qty = parseInt(inputRefs.current[String(d)]?.value || '0') || 0
      const sub = qty * d
      total += sub
      const el = subRefs.current[String(d)]
      if (el) {
        el.textContent = sub > 0 ? fmtCash(sub) : '—'
        el.style.color = sub > 0 ? 'var(--nm-text)' : 'var(--nm-text-light)'
      }
    }
    if (totalRef.current)    totalRef.current.textContent    = fmtCash(total)
    if (btnTotalRef.current) btnTotalRef.current.textContent = fmtCash(total)
  }

  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const filtered = input.value.replace(/\D/g, '')
    if (input.value !== filtered) input.value = filtered
    recalc()
  }

  const allDenoms = [...BILLS, ...COINS]

  const makeRow = (d: number, bg: string, label: string) => (
    <div key={d} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 80px', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <div style={{ background: bg, color: '#fff', fontWeight: 900, fontSize: 13, borderRadius: 8, padding: '4px 0', textAlign: 'center' }}>{label}</div>
      <input
        type="text"
        inputMode="numeric"
        ref={el => { inputRefs.current[String(d)] = el }}
        defaultValue=""
        onInput={handleInput}
        placeholder="0"
        className="nm-input"
        style={{ padding: '6px 10px', fontSize: 14, fontWeight: 800, textAlign: 'center', width: '100%' }}
      />
      <span
        ref={el => { subRefs.current[String(d)] = el }}
        style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: 'var(--nm-text-light)' }}
      >—</span>
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.2)', padding: '28px 28px', width: 380, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--nm-text)', marginBottom: 16, textAlign: 'center' }}>🪙 Contar Efectivo</div>

        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--nm-accent)', marginBottom: 6 }}>Billetes</div>
        {BILLS.map(d => makeRow(d, 'linear-gradient(145deg,#6b9cf0,#4d7ee8)', `$${d}`))}

        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--nm-text-muted)', margin: '10px 0 6px' }}>Monedas</div>
        {COINS.map(d => makeRow(d, 'linear-gradient(145deg,#c8cdd5,#adb4be)', d < 1 ? `${d * 100}¢` : `$${d}`))}

        <div style={{ background: 'var(--nm-bg)', borderRadius: 14, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0', boxShadow: 'var(--nm-inset)' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--nm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</span>
          <span ref={totalRef} style={{ fontSize: 26, fontWeight: 900, color: 'var(--nm-text)' }}>{fmtCash(0)}</span>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="nm-btn" style={{ flex: 1, padding: '11px', fontSize: 13 }}>Cancelar</button>
          <button onClick={() => onConfirm(computeTotal())} className="nm-btn-accent" style={{ flex: 1, padding: '11px', fontSize: 13 }}>
            Usar <span ref={btnTotalRef}>{fmtCash(0)}</span> →
          </button>
        </div>
      </div>
    </div>
  )
}

const navItems = [
  { path: '/ventas', label: 'Ventas', icon: '🛒', roles: ['admin', 'cajero'] },
  { path: '/corte', label: 'Corte', icon: '💰', roles: ['admin', 'cajero'] },
  { path: '/productos', label: 'Productos', icon: '📦', roles: ['admin', 'cajero'] },
  { path: '/inventario', label: 'Inventario', icon: '📋', roles: ['admin', 'cajero'] },
  { path: '/compras', label: 'Compras', icon: '🚚', roles: ['admin'] },
  { path: '/facturas', label: 'Facturas', icon: '🧾', roles: ['admin'] },
  { path: '/reportes', label: 'Reportes', icon: '📊', roles: ['admin'] },
  { path: '/configuracion', label: 'Config', icon: '⚙️', roles: ['admin'] },
]

export default function Layout() {
  const { user, shift, setShift, logout } = useAuthStore()
  const { settings } = useSettingsStore()
  const navigate = useNavigate()
  const [openingCash, setOpeningCash] = useState('')
  const [openingError, setOpeningError] = useState('')
  const [showLogoutBlock, setShowLogoutBlock] = useState(false)
  const [showCashCounter, setShowCashCounter] = useState(false)

  const handleLogout = () => {
    if (shift) {
      setShowLogoutBlock(true)
      return
    }
    logout()
    navigate('/login')
  }

  const goToCorte = () => {
    setShowLogoutBlock(false)
    navigate('/corte')
  }

  const handleOpenShift = async () => {
    if (!openingCash || !user) return
    setOpeningError('')
    const res = await window.api.openShift({ cashier_id: user.id, opening_cash: parseFloat(openingCash) })
    if (res.success) {
      const sh = await window.api.getActiveShift(user.id)
      setShift(sh)
      setOpeningCash('')
    } else {
      setOpeningError('Error al abrir turno. Intente de nuevo.')
    }
  }

  const visibleNav = navItems.filter(n => n.roles.includes(user?.role || ''))

  return (
    <div className="flex h-screen" style={{ background: 'var(--nm-bg)' }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col items-center py-3 gap-1 flex-shrink-0"
        style={{
          width: 72,
          background: '#FFFFFF',
          boxShadow: '1px 0 0 rgba(60,60,67,0.12), 2px 0 16px rgba(0,0,0,0.06)',
          zIndex: 10,
        }}
      >
        {/* Logo/Store Name */}
        <div
          className="flex items-center justify-center mb-3"
          style={{
            width: 48, height: 48, borderRadius: 14,
            background: 'linear-gradient(160deg, #FF6584, #FF2D55)',
            boxShadow: '0 4px 14px rgba(255,45,85,0.35)',
            fontSize: 20,
          }}
        >
          🏪
        </div>
        <div style={{
          fontSize: 9, fontWeight: 800, color: 'var(--nm-text-muted)',
          letterSpacing: '0.05em', textTransform: 'uppercase',
          textAlign: 'center', marginBottom: 4,
        }}>
          {(settings?.store_name || 'POS').slice(0, 8)}
        </div>

        <div style={{ width: 40, height: 1, background: 'var(--nm-separator)', borderRadius: 1, marginBottom: 4 }} />

        {visibleNav.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            title={item.label}
            className="nm-tooltip"
            data-tip={item.label}
            style={({ isActive }) => ({
              width: 52, height: 50,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              borderRadius: 14, cursor: 'pointer', textDecoration: 'none',
              transition: 'all 0.18s ease',
              background: isActive ? 'rgba(255,45,85,0.08)' : 'transparent',
              boxShadow: isActive ? '0 1px 6px rgba(255,45,85,0.12)' : 'none',
              color: isActive ? 'var(--nm-accent)' : 'var(--nm-text-muted)',
            })}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>{item.icon}</span>
            <span style={{ fontSize: 8, marginTop: 3, fontWeight: 800, letterSpacing: '0.03em' }}>
              {item.label}
            </span>
          </NavLink>
        ))}

        <div style={{ flex: 1 }} />

        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--nm-text-muted)', textAlign: 'center', marginBottom: 4, letterSpacing: '0.04em' }}>
          {user?.name?.split(' ')[0]}
        </div>

        <button
          onClick={handleLogout}
          title="Cerrar sesión"
          className="nm-btn"
          style={{ width: 52, height: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 14 }}
        >
          <span style={{ fontSize: 16 }}>🚪</span>
          <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--nm-text-muted)', marginTop: 2, letterSpacing: '0.03em' }}>Salir</span>
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto nm-scroll" style={{ background: 'var(--nm-bg)' }}>
        <Outlet />
      </main>

      {/* ── Logout Blocked: corte required ── */}
      {showLogoutBlock && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 110,
          background: 'rgba(242,242,247,0.75)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#FFFFFF',
            borderRadius: 28,
            boxShadow: '0 24px 60px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.07)',
            padding: '40px 48px',
            width: 420,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            textAlign: 'center',
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: 20,
              background: 'linear-gradient(160deg, #FF6860, #FF3B30)',
              boxShadow: '0 6px 20px rgba(255,59,48,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32,
            }}>
              ⚠️
            </div>

            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--nm-text)', letterSpacing: '-0.02em' }}>
              Turno Activo
            </h2>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--nm-text-muted)', lineHeight: 1.6 }}>
              Debe realizar el <strong style={{ color: 'var(--nm-text)', fontWeight: 700 }}>Corte de Caja</strong> antes de cerrar sesión.<br />
              Esto asegura que el turno quede registrado correctamente.
            </p>

            <div style={{
              width: '100%',
              background: 'var(--nm-bg)',
              borderRadius: 12,
              border: '1px solid var(--nm-separator)',
              padding: '10px 16px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--nm-text-muted)',
            }}>
              Turno #{shift?.id} · Cajero: {user?.name}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 4 }}>
              <button
                onClick={goToCorte}
                className="nm-btn-accent"
                style={{ width: '100%', padding: '14px', fontSize: 15 }}
              >
                Ir al Corte de Caja →
              </button>
              <button
                onClick={() => setShowLogoutBlock(false)}
                className="nm-btn"
                style={{ width: '100%', padding: '11px', fontSize: 13, color: 'var(--nm-text-muted)' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Shift Opening Gate ── blocks the entire app until a shift is open */}
      {!shift && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(242,242,247,0.75)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#FFFFFF',
            borderRadius: 28,
            boxShadow: '0 24px 60px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.07)',
            padding: '40px 48px',
            width: 420,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
          }}>
            {/* Icon */}
            <div style={{
              width: 72, height: 72, borderRadius: 20,
              background: 'linear-gradient(160deg, #FF6584, #FF2D55)',
              boxShadow: '0 6px 20px rgba(255,45,85,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, marginBottom: 20,
            }}>
              💰
            </div>

            <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: 'var(--nm-text)', textAlign: 'center', letterSpacing: '-0.02em' }}>
              Apertura de Turno
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, fontWeight: 500, color: 'var(--nm-text-muted)', textAlign: 'center' }}>
              Ingrese el efectivo inicial en caja para comenzar
            </p>

            {/* User info */}
            <div style={{
              width: '100%', marginBottom: 18,
              background: 'var(--nm-bg)',
              borderRadius: 12,
              border: '1px solid var(--nm-separator)',
              padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 18 }}>👤</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--nm-text)' }}>{user?.name}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--nm-text-muted)', textTransform: 'capitalize' }}>{user?.role}</div>
              </div>
            </div>

            <div style={{ width: '100%', marginBottom: 12 }}>
              <input
                type="number"
                value={openingCash}
                onChange={e => setOpeningCash(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleOpenShift() }}
                placeholder="0.00"
                className="nm-input"
                autoFocus
                step="0.01"
                min="0"
                style={{ width: '100%', padding: '16px 18px', fontSize: 28, textAlign: 'right', fontWeight: 800, marginBottom: 8 }}
              />
              <button
                onClick={() => setShowCashCounter(true)}
                className="nm-btn"
                style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 700, color: 'var(--nm-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                🪙 Contar billetes y monedas
              </button>
            </div>

            {openingError && (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--nm-danger)', marginBottom: 10 }}>
                ⚠️ {openingError}
              </div>
            )}

            <button
              onClick={handleOpenShift}
              disabled={!openingCash}
              className="nm-btn-accent"
              style={{ width: '100%', padding: '15px', fontSize: 16, opacity: !openingCash ? 0.45 : 1, cursor: !openingCash ? 'not-allowed' : 'pointer' }}
            >
              Abrir Turno →
            </button>

            <button
              onClick={handleLogout}
              style={{
                marginTop: 14, background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, color: 'var(--nm-text-light)',
                fontFamily: '-apple-system, SF Pro Text, Inter, sans-serif',
              }}
            >
              Cancelar y cerrar sesión
            </button>
          </div>

          {showCashCounter && (
            <CashCounterModal
              onConfirm={total => { setOpeningCash(total.toFixed(2)); setShowCashCounter(false) }}
              onClose={() => setShowCashCounter(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}
