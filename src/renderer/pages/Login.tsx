import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import kaddoLogo from '../assets/kaddo-logo.png'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setUser } = useAuthStore()
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) { setError('Ingrese usuario y contraseña'); return }
    setLoading(true)
    setError('')

    const res = await window.api.login(username, password)
    if (!res.success) {
      setError(res.message || 'Error al iniciar sesión')
      setLoading(false)
      return
    }

    setUser(res.user)
    navigate('/ventas')
    setLoading(false)
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'var(--nm-bg)' }}
    >
      {/* Background decorative circles */}
      <div style={{
        position: 'fixed', top: -120, right: -120, width: 400, height: 400,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(91,141,238,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'fixed', bottom: -80, left: -80, width: 300, height: 300,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(56,193,114,0.07) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img
            src={kaddoLogo}
            alt="Kaddo Gift Boutique"
            style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 20, boxShadow: 'var(--nm-raised-lg)', display: 'block' }}
          />
        </div>

        {/* Form card */}
        <div
          style={{
            background: 'var(--nm-bg)',
            borderRadius: 24,
            padding: '32px 40px',
            boxShadow: 'var(--nm-raised-lg)',
          }}
        >
          <form onSubmit={handleLogin}>
            {/* Username */}
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 800,
                color: 'var(--nm-text-muted)', marginBottom: 8,
                letterSpacing: '0.08em', textTransform: 'uppercase',
              }}>
                Usuario
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="nm-input"
                placeholder="Ingrese su usuario"
                autoFocus
                autoComplete="username"
                style={{ width: '100%', padding: '14px 16px', fontSize: 15 }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 800,
                color: 'var(--nm-text-muted)', marginBottom: 8,
                letterSpacing: '0.08em', textTransform: 'uppercase',
              }}>
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="nm-input"
                placeholder="••••••••"
                autoComplete="current-password"
                style={{ width: '100%', padding: '14px 16px', fontSize: 15 }}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: 'var(--nm-bg)',
                boxShadow: 'inset 3px 3px 8px rgba(220,50,50,0.15), inset -2px -2px 6px rgba(255,255,255,0.7)',
                borderRadius: 12, padding: '12px 16px', marginBottom: 20,
                fontSize: 13, fontWeight: 700,
                color: 'var(--nm-danger)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>⚠️</span> {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="nm-btn-accent"
              style={{ width: '100%', padding: '15px', fontSize: 16 }}
            >
              {loading ? '⏳ Verificando...' : 'Iniciar Sesión →'}
            </button>
          </form>

        </div>
      </div>
    </div>
  )
}
