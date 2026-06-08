import { useState, useEffect } from 'react'
import { useAuthStore } from '../store/useAuthStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import Modal from '../components/Modal'

const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
const fmtDate = (s: string) => {
  if (!s) return ''
  const d = new Date(s)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Flat denomination list — each has a hardcoded unique ID so there can NEVER be key collisions.
const DENOMS: { id: string; value: number; label: string; isBill: boolean }[] = [
  { id: 'bill_1000', value: 1000, label: '$1,000', isBill: true },
  { id: 'bill_500',  value: 500,  label: '$500',   isBill: true },
  { id: 'bill_200',  value: 200,  label: '$200',   isBill: true },
  { id: 'bill_100',  value: 100,  label: '$100',   isBill: true },
  { id: 'bill_50',   value: 50,   label: '$50',    isBill: true },
  { id: 'bill_20',   value: 20,   label: '$20',    isBill: true },
  { id: 'coin_20',   value: 20,   label: '$20',    isBill: false },
  { id: 'coin_10',   value: 10,   label: '$10',    isBill: false },
  { id: 'coin_5',    value: 5,    label: '$5',     isBill: false },
  { id: 'coin_2',    value: 2,    label: '$2',     isBill: false },
  { id: 'coin_1',    value: 1,    label: '$1',     isBill: false },
  { id: 'coin_050',  value: 0.5,  label: '50¢',   isBill: false },
]

const fmtD = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

function DenomRow({ denom, qty, onQtyChange }: {
  denom: typeof DENOMS[number]
  qty: number
  onQtyChange: (id: string, val: number) => void
}) {
  const subtotal = qty * denom.value
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 100px 90px',
      alignItems: 'center', gap: 10,
      padding: '6px 4px',
      boxShadow: '0 1px 0 var(--nm-shadow-light), 0 2px 0 rgba(184,190,199,0.2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          minWidth: 64, padding: '4px 10px', borderRadius: 8,
          background: denom.isBill
            ? 'linear-gradient(145deg, #6b9cf0, #4d7ee8)'
            : 'linear-gradient(145deg, #c8cdd5, #adb4be)',
          boxShadow: denom.isBill
            ? '2px 2px 6px rgba(77,126,232,0.35), -1px -1px 4px rgba(255,255,255,0.6)'
            : '2px 2px 6px rgba(150,160,175,0.3), -1px -1px 4px rgba(255,255,255,0.6)',
          color: 'white', fontWeight: 900, fontSize: 13, textAlign: 'center',
        }}>
          {denom.label}
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--nm-text-muted)' }}>
          {denom.isBill ? 'billete' : 'moneda'}
        </span>
      </div>
      <input
        type="text"
        inputMode="numeric"
        value={qty > 0 ? String(qty) : ''}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9]/g, '')
          onQtyChange(denom.id, raw === '' ? 0 : parseInt(raw, 10))
        }}
        placeholder="0"
        className="nm-input"
        style={{ padding: '6px 10px', fontSize: 15, fontWeight: 800, textAlign: 'center', width: '100%' }}
        onFocus={e => e.target.select()}
      />
      <div style={{
        textAlign: 'right', fontSize: 13, fontWeight: 800,
        color: subtotal > 0 ? 'var(--nm-text)' : 'var(--nm-text-light)',
      }}>
        {subtotal > 0 ? fmtD(subtotal) : '—'}
      </div>
    </div>
  )
}

function CashCounterModal({ onConfirm, onClose }: { onConfirm: (total: number) => void; onClose: () => void }) {
  // Store quantities as numbers keyed by hardcoded denomination IDs
  const [counts, setCounts] = useState<Record<string, number>>({})

  const handleQtyChange = (id: string, val: number) => {
    setCounts(prev => ({ ...prev, [id]: val }))
  }

  // Sum: each denomination's count * its face value
  const billsTotal = DENOMS.filter(d => d.isBill).reduce((s, d) => s + (counts[d.id] || 0) * d.value, 0)
  const coinsTotal = DENOMS.filter(d => !d.isBill).reduce((s, d) => s + (counts[d.id] || 0) * d.value, 0)
  const total = billsTotal + coinsTotal

  return (
    <Modal title="Contador de Efectivo" onClose={onClose} size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 100px 90px',
          gap: 10, padding: '0 4px 8px',
          fontSize: 10, fontWeight: 800, letterSpacing: '0.07em',
          textTransform: 'uppercase', color: 'var(--nm-text-muted)',
        }}>
          <div>Denominación</div>
          <div style={{ textAlign: 'center' }}>Cantidad</div>
          <div style={{ textAlign: 'right' }}>Subtotal</div>
        </div>

        {/* Bills section */}
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--nm-accent)', padding: '6px 4px 2px' }}>
          Billetes
        </div>
        {DENOMS.filter(d => d.isBill).map(d => (
          <DenomRow key={d.id} denom={d} qty={counts[d.id] || 0} onQtyChange={handleQtyChange} />
        ))}

        {/* Coins section */}
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--nm-text-muted)', padding: '10px 4px 2px' }}>
          Monedas
        </div>
        {DENOMS.filter(d => !d.isBill).map(d => (
          <DenomRow key={d.id} denom={d} qty={counts[d.id] || 0} onQtyChange={handleQtyChange} />
        ))}

        {/* Subtotals */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 4px 0', fontSize: 12, color: 'var(--nm-text-muted)' }}>
          <span>Billetes: <b>{fmtD(billsTotal)}</b></span>
          <span>Monedas: <b>{fmtD(coinsTotal)}</b></span>
        </div>

        {/* Total */}
        <div style={{
          marginTop: 8,
          background: 'var(--nm-bg)',
          borderRadius: 14,
          boxShadow: 'var(--nm-inset)',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--nm-text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Total contado
          </span>
          <span style={{ fontSize: 28, fontWeight: 900, color: 'var(--nm-text)', letterSpacing: '-0.02em' }}>
            {fmtD(total)}
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={onClose} className="nm-btn" style={{ flex: 1, padding: '12px', fontSize: 13, color: 'var(--nm-text-muted)' }}>
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(total)}
            className="nm-btn-accent"
            style={{ flex: 1, padding: '12px', fontSize: 13 }}
          >
            Usar {fmtD(total)} →
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function Corte() {
  const { user, shift, setShift, logout } = useAuthStore()
  const { settings } = useSettingsStore()
  const [summary, setSummary] = useState<any>(null)
  const [cashBalance, setCashBalance] = useState(0)
  const [countedCash, setCountedCash] = useState('')
  const [loading, setLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showCashCounter, setShowCashCounter] = useState(false)
  const [printing, setPrinting] = useState<false | 'cajero' | 'dia'>(false)
  const [closedData, setClosedData] = useState<any>(null)

  useEffect(() => {
    if (shift) {
      loadSummary()
      loadCashBalance()
    }
  }, [shift])

  const loadSummary = async () => {
    if (!shift) return
    const res = await window.api.getShiftSummary(shift.id)
    setSummary(res)
  }

  const loadCashBalance = async () => {
    if (!shift) return
    const bal = await window.api.getCashBalance(shift.id)
    setCashBalance(bal)
  }

  const buildPrintData = (overrideCountedCash?: number) => ({
    storeName: settings?.store_name,
    storeAddress: settings?.store_address,
    storePhone: settings?.store_phone,
    storeSocial: settings?.store_social || settings?.store_instagram,
    cashierName: user?.name,
    shiftId: shift?.id,
    startedAt: fmtDate(shift?.started_at || ''),
    endedAt: fmtDate(new Date().toISOString()),
    sales: {
      count:         summary?.sales?.count || 0,
      total:         summary?.sales?.total || 0,
      cost_total:    summary?.sales?.cost_total || 0,
      efectivo:      summary?.sales?.efectivo || 0,
      tarjeta:       summary?.sales?.tarjeta || 0,
      transferencia: summary?.sales?.transferencia || 0,
      mixto:         summary?.sales?.mixto || 0,
    },
    salesByCategory:  summary?.salesByCategory || [],
    movementDetails:  summary?.movementDetails || [],
    entradas:         summary?.entradas || 0,
    salidas:          summary?.salidas || 0,
    mixtoCash:        summary?.mixtoCash || 0,
    utility:          summary?.utility || 0,
    openingCash:      shift?.opening_cash || 0,
    expectedCash:     cashBalance,
    countedCash:      overrideCountedCash ?? (parseFloat(countedCash) || undefined),
  })

  const handleCloseShift = async () => {
    if (!shift || !user) return
    setLoading(true)
    const printData = buildPrintData(parseFloat(countedCash) || 0)
    const res = await window.api.closeShift({ shift_id: shift.id, closing_cash: parseFloat(countedCash) || 0 })
    if (res.success) {
      setClosedData(printData)
      // Don't navigate yet — show print button in modal first
    }
    setLoading(false)
  }

  const handlePrintShift = async (data?: any) => {
    setPrinting('cajero')
    await window.api.printShiftSummary(data ?? buildPrintData())
    setPrinting(false)
  }

  const handlePrintDailyCorte = async () => {
    setPrinting('dia')
    const dailyData = await (window.api as any).getDailyCorte()
    await (window.api as any).printDailyCorte(dailyData)
    setPrinting(false)
  }

  if (!shift) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--nm-bg)' }}>
        <div style={{ textAlign: 'center', color: 'var(--nm-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 48 }}>💰</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--nm-text)' }}>Sin turno activo</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Abra un turno desde la pantalla de Ventas</div>
          {closedData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              <button
                onClick={async () => { await handlePrintShift(closedData); logout() }}
                disabled={!!printing}
                className="nm-btn-accent"
                style={{ padding: '14px 32px', fontSize: 14, fontWeight: 800, borderRadius: 14, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                🖨️ {printing === 'cajero' ? 'Imprimiendo...' : 'Imprimir Corte de Cajero'}
              </button>
              <button
                onClick={async () => { await handlePrintDailyCorte(); logout() }}
                disabled={!!printing}
                className="nm-btn"
                style={{ padding: '14px 32px', fontSize: 14, fontWeight: 800, borderRadius: 14, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                📅 {printing === 'dia' ? 'Imprimiendo...' : 'Imprimir Corte del Día'}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const difference = (parseFloat(countedCash) || 0) - cashBalance

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--nm-bg)', overflowY: 'auto' }}>
      <div style={{
        background: 'var(--nm-bg)',
        boxShadow: '0 3px 10px var(--nm-shadow-dark), 0 -1px 4px var(--nm-shadow-light)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexShrink: 0,
        zIndex: 5,
      }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: 'var(--nm-text)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Corte de Caja
        </h1>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--nm-text-muted)' }}>
          Turno #{shift.id} — Inicio: {fmtDate(shift.started_at)}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={loadSummary} className="nm-btn" style={{ padding: '6px 14px', fontSize: 12, color: 'var(--nm-accent)' }}>
          Actualizar
        </button>
        <button
          onClick={() => {
            if (!countedCash) return
            setShowConfirm(true)
          }}
          className="nm-btn-danger"
          disabled={!countedCash}
          style={{
            padding: '8px 20px', fontSize: 13, letterSpacing: '0.04em',
            opacity: !countedCash ? 0.4 : 1,
            cursor: !countedCash ? 'not-allowed' : 'pointer',
          }}
          title={!countedCash ? 'Ingrese el efectivo contado antes de cerrar' : ''}
        >
          CERRAR TURNO
        </button>
      </div>

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Dashboard 1: Caja */}
        <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--nm-text)', marginBottom: 4 }}>💵 Caja</div>
          <div style={{ height: 2, boxShadow: '0 1px 0 var(--nm-shadow-light), 0 -1px 0 var(--nm-shadow-dark)', borderRadius: 1, marginBottom: 4 }} />

          <Row label="Efectivo inicial" value={fmt(shift.opening_cash)} />
          <Row label="Ventas en efectivo" value={fmt((summary?.sales?.efectivo || 0) + (summary?.mixtoCash || 0))} />
          <Row label="Entradas de efectivo" value={fmt(summary?.entradas || 0)} color="var(--nm-accent)" />
          <Row label="Retiros de efectivo" value={`-${fmt(summary?.salidas || 0)}`} color="var(--nm-danger)" />
          <div style={{ height: 2, boxShadow: '0 1px 0 var(--nm-shadow-light), 0 -1px 0 var(--nm-shadow-dark)', borderRadius: 1 }} />
          <Row label="Efectivo esperado en caja" value={fmt(cashBalance)} bold />

          <div style={{ marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--nm-text-muted)' }}>
                Efectivo contado físicamente
              </label>
              <button
                onClick={() => setShowCashCounter(true)}
                className="nm-btn"
                style={{ padding: '5px 12px', fontSize: 11, color: 'var(--nm-accent)', display: 'flex', alignItems: 'center', gap: 5 }}
              >
                🪙 Contar billetes
              </button>
            </div>
            <input
              type="number"
              value={countedCash}
              onChange={e => setCountedCash(e.target.value)}
              placeholder="0.00"
              className="nm-input"
              style={{ width: '100%', padding: '12px 14px', fontSize: 22, textAlign: 'right', fontWeight: 900 }}
              step="0.01"
            />
            {!countedCash && (
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-warning)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚠️ Requerido para poder cerrar el turno
              </div>
            )}
          </div>

          {countedCash && (
            <div style={{
              borderRadius: 14, padding: '12px 16px', textAlign: 'center',
              background: 'var(--nm-bg)',
              boxShadow: difference < 0
                ? 'inset 3px 3px 8px rgba(204,47,42,0.18), inset -2px -2px 6px rgba(255,255,255,0.7)'
                : difference > 0
                  ? 'inset 3px 3px 8px rgba(232,169,26,0.18), inset -2px -2px 6px rgba(255,255,255,0.7)'
                  : 'inset 3px 3px 8px rgba(47,168,93,0.18), inset -2px -2px 6px rgba(255,255,255,0.7)',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', marginBottom: 4 }}>DIFERENCIA</div>
              <div style={{
                fontSize: 28, fontWeight: 900,
                color: difference < 0 ? 'var(--nm-danger)' : difference > 0 ? '#c98f00' : 'var(--nm-success)',
              }}>
                {difference > 0 ? '+' : ''}{fmt(difference)}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nm-text-muted)', marginTop: 4 }}>
                {difference < 0 ? '⚠️ Faltante en caja' : difference > 0 ? '⚠️ Sobrante en caja' : '✓ Cuadre exacto'}
              </div>
            </div>
          )}
        </div>

        {/* Dashboard 2: Ventas */}
        <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--nm-text)', marginBottom: 4 }}>📊 Ventas del Turno</div>
          <div style={{ height: 2, boxShadow: '0 1px 0 var(--nm-shadow-light), 0 -1px 0 var(--nm-shadow-dark)', borderRadius: 1, marginBottom: 4 }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <KPIBox label="Total Ventas" value={fmt(summary?.sales?.total || 0)} color="blue" />
            <KPIBox label="Utilidad" value={fmt(summary?.utility || 0)} color="green" />
            <KPIBox label="Nº Transacciones" value={String(summary?.sales?.count || 0)} color="purple" />
            <KPIBox label="Ticket Promedio" value={summary?.sales?.count > 0 ? fmt((summary?.sales?.total || 0) / summary.sales.count) : '$0.00'} color="yellow" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
            <PaymentRow label="💵 Efectivo" amount={summary?.sales?.efectivo || 0} />
            <PaymentRow label="💳 Tarjeta" amount={summary?.sales?.tarjeta || 0} />
            <PaymentRow label="📱 Transferencia" amount={summary?.sales?.transferencia || 0} />
          </div>

          {summary?.salesByCategory?.length > 0 && (
            <div style={{ paddingTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--nm-text-muted)', marginBottom: 8 }}>Ventas por Categoría</div>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={summary.salesByCategory}>
                  <XAxis dataKey="category" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => fmt(v)} />
                  <Bar dataKey="total" fill="#5b8dee" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {showCashCounter && (
        <CashCounterModal
          onConfirm={total => {
            setCountedCash(total.toFixed(2))
            setShowCashCounter(false)
          }}
          onClose={() => setShowCashCounter(false)}
        />
      )}

      {showConfirm && (
        <Modal title={closedData ? 'Turno Cerrado' : 'Cerrar Turno'} onClose={() => { if (closedData) { logout() } else { setShowConfirm(false) } }} size="sm">
          {closedData ? (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(145deg, #46cf80, #2fa85d)', boxShadow: '0 6px 20px rgba(47,168,93,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>✓</div>
              <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--nm-text)', margin: 0 }}>Turno cerrado correctamente</p>
              <button
                onClick={() => handlePrintShift(closedData)}
                disabled={!!printing}
                className="nm-btn-accent"
                style={{ width: '100%', padding: '13px', fontSize: 13, fontWeight: 800, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                🖨️ {printing === 'cajero' ? 'Imprimiendo...' : 'Imprimir Corte de Cajero'}
              </button>
              <button
                onClick={handlePrintDailyCorte}
                disabled={!!printing}
                className="nm-btn"
                style={{ width: '100%', padding: '13px', fontSize: 13, fontWeight: 800, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--nm-text)' }}
              >
                📅 {printing === 'dia' ? 'Imprimiendo...' : 'Imprimir Corte del Día'}
              </button>
              <button onClick={() => logout()} className="nm-btn" style={{ width: '100%', padding: '10px', fontSize: 12, color: 'var(--nm-text-muted)' }}>
                Salir sin imprimir
              </button>
            </div>
          ) : (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
              <div style={{ fontSize: 42 }}>⚠️</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--nm-text)', margin: 0 }}>¿Está seguro de cerrar el turno?</p>
              {difference !== 0 && countedCash && (
                <div style={{
                  borderRadius: 12, padding: '10px 16px', fontSize: 13, fontWeight: 700, width: '100%',
                  background: 'var(--nm-bg)',
                  boxShadow: difference < 0
                    ? 'inset 2px 2px 6px rgba(204,47,42,0.2), inset -2px -2px 5px rgba(255,255,255,0.7)'
                    : 'inset 2px 2px 6px rgba(232,169,26,0.2), inset -2px -2px 5px rgba(255,255,255,0.7)',
                  color: difference < 0 ? 'var(--nm-danger)' : '#c98f00',
                }}>
                  {difference < 0 ? `Faltante de ${fmt(Math.abs(difference))}` : `Sobrante de ${fmt(difference)}`}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                <button onClick={() => setShowConfirm(false)} className="nm-btn" style={{ flex: 1, padding: '12px', fontSize: 13, color: 'var(--nm-text-muted)' }}>Cancelar</button>
                <button onClick={handleCloseShift} disabled={loading} className="nm-btn-danger" style={{ flex: 1, padding: '12px', fontSize: 13 }}>
                  {loading ? 'Cerrando...' : 'Confirmar Cierre'}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

function Row({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--nm-text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: bold ? 800 : 600, color: color || 'var(--nm-text)' }}>{value}</span>
    </div>
  )
}

const kpiAccents: Record<string, { gradient: string; glow: string }> = {
  blue:   { gradient: 'linear-gradient(145deg, #6b9cf0, #4d7ee8)', glow: 'rgba(77,126,232,0.3)' },
  green:  { gradient: 'linear-gradient(145deg, #46cf80, #2fa85d)', glow: 'rgba(47,168,93,0.3)' },
  purple: { gradient: 'linear-gradient(145deg, #b47ee8, #9058cc)', glow: 'rgba(144,88,204,0.3)' },
  yellow: { gradient: 'linear-gradient(145deg, #fbc84a, #e8a91a)', glow: 'rgba(232,169,26,0.3)' },
}

function KPIBox({ label, value, color }: { label: string; value: string; color: string }) {
  const accent = kpiAccents[color] || kpiAccents.blue
  return (
    <div style={{
      background: 'var(--nm-bg)', borderRadius: 14, padding: '12px 14px',
      boxShadow: 'var(--nm-raised-sm)', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -10, right: -10, width: 50, height: 50, borderRadius: '50%',
        background: `radial-gradient(circle, ${accent.glow} 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--nm-text)', letterSpacing: '-0.01em' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--nm-text-muted)', marginTop: 3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</div>
    </div>
  )
}

function PaymentRow({ label, amount }: { label: string; amount: number }) {
  const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      background: 'var(--nm-bg)', borderRadius: 10, padding: '8px 12px',
      boxShadow: 'var(--nm-inset-sm)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--nm-text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--nm-text)' }}>{fmt(amount)}</span>
    </div>
  )
}
