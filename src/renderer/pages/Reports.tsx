import { useState, useEffect } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import KPICard from '../components/KPICard'

const fmt  = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
const fmtK = (n: number) => n >= 1000000 ? `$${(n/1000000).toFixed(1)}M` : n >= 1000 ? `$${(n/1000).toFixed(1)}k` : fmt(n)
const fmtQty = (n: number) => `${Math.round(n || 0).toLocaleString('es-MX')} pzs`

// Custom tooltip for the category pie chart — shows money + pieces + %
function CategoryPieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const total = payload[0].value
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E5EA', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: 12 }}>
      <div style={{ fontWeight: 800, color: '#1C1C1E', marginBottom: 6 }}>{d.category || 'Sin categoría'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: '#8E8E93' }}>Ventas</span>
          <span style={{ fontWeight: 700, color: '#1C1C1E' }}>{fmt(total)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: '#8E8E93' }}>Piezas</span>
          <span style={{ fontWeight: 700, color: '#007AFF' }}>{fmtQty(d.qty)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: '#8E8E93' }}>Utilidad</span>
          <span style={{ fontWeight: 700, color: '#34C759' }}>{fmt(d.profit)}</span>
        </div>
      </div>
    </div>
  )
}

// Export button
function ExportBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} style={{
      padding: '7px 16px', borderRadius: 10, border: 'none', cursor: loading ? 'wait' : 'pointer',
      fontSize: 12, fontWeight: 700, background: loading ? '#E5E5EA' : '#34C759',
      color: loading ? '#8E8E93' : '#fff', boxShadow: loading ? 'none' : '0 2px 8px rgba(52,199,89,0.3)',
      display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
    }}>
      {loading ? '⏳ Exportando...' : '⬇ Exportar Excel'}
    </button>
  )
}

const PINK   = '#FF2D55'
const PINK2  = '#FF6584'
const BLUE   = '#007AFF'
const GREEN  = '#34C759'
const YELLOW = '#FF9500'
const PURPLE = '#AF52DE'
const TEAL   = '#30B0C7'
const COLORS = [PINK, BLUE, GREEN, YELLOW, PURPLE, TEAL, '#FF3B30', '#5AC8FA']

type AppTab = 'dashboard' | 'analiticos'
type Period = 'hoy' | 'semana' | 'mes' | 'mes_ant' | 'anio' | 'anio_ant' | 'custom'

function getPeriodDates(period: Period): { from: string; to: string } {
  const now = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  switch (period) {
    case 'hoy':     return { from: iso(now), to: iso(now) }
    case 'semana':  { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: iso(d), to: iso(now) } }
    case 'mes':     return { from: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`, to: iso(now) }
    case 'mes_ant': { const f = new Date(now.getFullYear(), now.getMonth()-1, 1); const l = new Date(now.getFullYear(), now.getMonth(), 0); return { from: iso(f), to: iso(l) } }
    case 'anio':    return { from: `${now.getFullYear()}-01-01`, to: iso(now) }
    case 'anio_ant':{ const y = now.getFullYear()-1; return { from: `${y}-01-01`, to: `${y}-12-31` } }
    default:        return { from: iso(now), to: iso(now) }
  }
}

function pct(a: number, b: number) {
  if (!b) return a > 0 ? 100 : 0
  return ((a - b) / b) * 100
}

function Delta({ a, b, invert = false }: { a: number; b: number; invert?: boolean }) {
  const p = pct(a, b)
  const up = p >= 0
  const good = invert ? !up : up
  if (b === 0 && a === 0) return null
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
      background: good ? 'rgba(52,199,89,0.12)' : 'rgba(255,45,85,0.12)',
      color: good ? '#1A8F3A' : PINK,
    }}>
      {up ? '▲' : '▼'} {Math.abs(p).toFixed(1)}%
    </span>
  )
}

// ─── SHARED CARD ─────────────────────────────────────────────────────────────
function Card({ title, children, style }: { title?: string; children: React.ReactNode; style?: any }) {
  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 18,
      boxShadow: '0 2px 12px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04)',
      padding: 18, ...style,
    }}>
      {title && <div style={{ fontSize: 12, fontWeight: 800, color: '#3C3C43', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 14 }}>{title}</div>}
      {children}
    </div>
  )
}

// ─── COMPARISON KPI ──────────────────────────────────────────────────────────
function CompareKPI({ label, today, yesterday, format = fmt, icon, color }: any) {
  return (
    <Card style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: color || 'linear-gradient(160deg,#FF6584,#FF2D55)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{icon}</div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color: '#1C1C1E', letterSpacing: '-0.02em', lineHeight: 1 }}>{format(today)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#8E8E93' }}>vs ayer {format(yesterday)}</span>
        <Delta a={today} b={yesterday} />
      </div>
    </Card>
  )
}

// ─── DASHBOARD TAB ───────────────────────────────────────────────────────────
function DashboardTab() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    ;(window.api as any).getDashboard().then((d: any) => { setData(d); setLoading(false) })
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', border: `3px solid rgba(255,45,85,0.15)`, borderTopColor: PINK, animation: 'spin 0.8s linear infinite' }} />
      <span style={{ color: '#8E8E93', fontSize: 13 }}>Cargando datos...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
  if (!data) return null

  const { today, yesterday, thisMonth, lastMonth, trend, topToday, recentSales, lowStock, byDayOfWeek, inventoryValue, slowMovers } = data

  const trendLabels = trend.map((r: any) => ({ ...r, label: r.date.slice(5) }))

  const fmtTime = (ts: string) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  const exportDashboard = async () => {
    if (!data) return
    setExporting(true)
    const today = data.today
    const todayStr = new Date().toISOString().slice(0, 10)
    await (window.api as any).exportToExcelMulti({
      filename: `dashboard_${todayStr}.xlsx`,
      sheets: [
        {
          name: 'Resumen Hoy',
          columns: [{ header: 'Métrica', key: 'k', width: 28 }, { header: 'Hoy', key: 'v', width: 18 }, { header: 'Ayer', key: 'y', width: 18 }],
          rows: [
            { k: 'Ventas', v: today.sales, y: data.yesterday.sales },
            { k: 'Utilidad', v: today.profit, y: data.yesterday.profit },
            { k: 'Transacciones', v: today.transactions, y: data.yesterday.transactions },
            { k: 'Ticket Promedio', v: today.avg_ticket, y: data.yesterday.avg_ticket },
            { k: 'Margen %', v: today.margin, y: data.yesterday.margin },
          ],
        },
        {
          name: 'Top Productos Hoy',
          columns: [{ header: 'Producto', key: 'n', width: 35 }, { header: 'Piezas', key: 'q', width: 12 }, { header: 'Ventas', key: 'r', width: 18 }],
          rows: (data.topToday || []).map((p: any) => ({ n: p.name, q: p.qty, r: p.revenue })),
        },
        {
          name: 'Tendencia 30 días',
          columns: [{ header: 'Fecha', key: 'd', width: 14 }, { header: 'Ventas', key: 't', width: 18 }, { header: 'Utilidad', key: 'p', width: 18 }, { header: 'Tickets', key: 'c', width: 12 }],
          rows: (data.trend || []).map((r: any) => ({ d: r.date, t: r.total, p: r.profit, c: r.transactions })),
        },
        {
          name: 'Stock Bajo',
          columns: [{ header: 'Código', key: 'c', width: 16 }, { header: 'Producto', key: 'n', width: 35 }, { header: 'Stock', key: 's', width: 10 }, { header: 'Mínimo', key: 'm', width: 10 }, { header: 'Precio', key: 'p', width: 14 }],
          rows: (data.lowStock || []).map((p: any) => ({ c: p.code, n: p.name, s: p.stock, m: p.min_stock, p: p.price })),
        },
      ],
    })
    setExporting(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Section: Hoy */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Hoy</div>
        <ExportBtn onClick={exportDashboard} loading={exporting} />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <CompareKPI label="Ventas" today={today.sales} yesterday={yesterday.sales} icon="💰" color="linear-gradient(160deg,#FF6584,#FF2D55)" />
        <CompareKPI label="Utilidad" today={today.profit} yesterday={yesterday.profit} icon="📈" color="linear-gradient(160deg,#6FD891,#34C759)" />
        <CompareKPI label="Transacciones" today={today.transactions} yesterday={yesterday.transactions} format={(n: number) => String(n)} icon="🧾" color="linear-gradient(160deg,#4DA3FF,#007AFF)" />
        <CompareKPI label="Ticket Promedio" today={today.avg_ticket} yesterday={yesterday.avg_ticket} icon="🎫" color="linear-gradient(160deg,#FFB340,#FF9500)" />
        <CompareKPI label="Margen" today={today.margin} yesterday={yesterday.margin} format={(n: number) => `${n.toFixed(1)}%`} icon="%" color="linear-gradient(160deg,#BF7AF0,#AF52DE)" />
      </div>

      {/* Section: Este Mes */}
      <div style={{ fontSize: 11, fontWeight: 800, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>Este Mes</div>
      <div style={{ display: 'flex', gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8E8E93', marginBottom: 4 }}>VENTAS MES ACTUAL</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: '#1C1C1E' }}>{fmt(thisMonth.sales)}</div>
            </div>
            <Delta a={thisMonth.sales} b={lastMonth.sales} />
          </div>
          <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 4 }}>Mes anterior: {fmt(lastMonth.sales)}</div>
        </Card>
        <Card style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8E8E93', marginBottom: 4 }}>UTILIDAD MES ACTUAL</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: GREEN }}>{fmt(thisMonth.profit)}</div>
            </div>
            <Delta a={thisMonth.profit} b={lastMonth.profit} />
          </div>
          <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 4 }}>Mes anterior: {fmt(lastMonth.profit)}</div>
        </Card>
        <Card style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8E8E93', marginBottom: 4 }}>INVENTARIO</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#1C1C1E' }}>{fmt(inventoryValue.sell_value)}</div>
          <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 4 }}>
            Costo: {fmt(inventoryValue.cost_value)} · {inventoryValue.total_products} productos
            {inventoryValue.out_of_stock > 0 && <span style={{ color: PINK, fontWeight: 700 }}> · {inventoryValue.out_of_stock} sin stock</span>}
          </div>
        </Card>
      </div>

      {/* Trend + Day of week */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Card title="Tendencia 30 Días">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendLabels} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PINK} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={PINK} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={GREEN} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={GREEN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={4} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtK} />
              <Tooltip formatter={(v: any, n: any) => [fmt(v), n === 'total' ? 'Ventas' : 'Utilidad']} labelFormatter={l => `Fecha: ${l}`} />
              <Area type="monotone" dataKey="total" name="total" stroke={PINK} strokeWidth={2} fill="url(#gSales)" dot={false} />
              <Area type="monotone" dataKey="profit" name="profit" stroke={GREEN} strokeWidth={2} fill="url(#gProfit)" dot={false} />
              <Legend formatter={(v: any) => v === 'total' ? 'Ventas' : 'Utilidad'} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Patrón por Día de Semana">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byDayOfWeek} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
              <XAxis dataKey="dow" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtK} />
              <Tooltip formatter={(v: any) => fmt(v)} />
              <Bar dataKey="total" name="Ventas" radius={[4, 4, 0, 0]}>
                {byDayOfWeek.map((_: any, i: number) => (
                  <Cell key={i} fill={i === new Date().getDay() ? PINK : '#E5E5EA'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Top hoy + Recent sales + Low stock */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {/* Top productos hoy */}
        <Card title="Top Productos Hoy">
          {topToday.length === 0
            ? <div style={{ color: '#8E8E93', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>Sin ventas hoy</div>
            : topToday.map((p: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < topToday.length - 1 ? '1px solid #F2F2F7' : 'none' }}>
                <div style={{ width: 22, height: 22, borderRadius: 7, background: i === 0 ? 'linear-gradient(160deg,#FF6584,#FF2D55)' : '#F2F2F7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: i === 0 ? '#fff' : '#8E8E93', flexShrink: 0 }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1C1C1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: '#8E8E93' }}>{p.qty} uds.</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: PINK }}>{fmt(p.revenue)}</div>
              </div>
            ))}
        </Card>

        {/* Ventas recientes */}
        <Card title="Ventas Recientes">
          {recentSales.length === 0
            ? <div style={{ color: '#8E8E93', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>Sin ventas hoy</div>
            : recentSales.map((s: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: i < recentSales.length - 1 ? '1px solid #F2F2F7' : 'none' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#8E8E93', minWidth: 36, fontFamily: 'monospace' }}>{fmtTime(s.timestamp)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1C1C1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.folio}</div>
                  <div style={{ fontSize: 10, color: '#8E8E93' }}>{s.items} art. · {s.payment_type}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#1C1C1E' }}>{fmt(s.total)}</div>
              </div>
            ))}
        </Card>

        {/* Bajo stock */}
        <Card title={`Bajo Stock ${lowStock.length > 0 ? `(${lowStock.length})` : ''}`}>
          {lowStock.length === 0
            ? <div style={{ color: GREEN, fontSize: 12, textAlign: 'center', padding: '20px 0', fontWeight: 700 }}>✓ Todo en orden</div>
            : lowStock.map((p: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < lowStock.length - 1 ? '1px solid #F2F2F7' : 'none' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.stock <= 0 ? '#FF3B30' : YELLOW, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1C1C1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: '#8E8E93' }}>Mín: {p.min_stock}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 900, color: p.stock <= 0 ? '#FF3B30' : YELLOW }}>{p.stock}</div>
              </div>
            ))}
        </Card>
      </div>

      {/* Slow movers */}
      {slowMovers.length > 0 && (
        <Card title="Productos sin Movimiento (últimos 30 días)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {slowMovers.map((p: any, i: number) => (
              <div key={i} style={{ background: '#F2F2F7', borderRadius: 12, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1C1C1E' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: '#8E8E93', fontFamily: 'monospace' }}>{p.code}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: YELLOW }}>{p.stock} uds.</div>
                  <div style={{ fontSize: 10, color: '#8E8E93' }}>{fmt(p.price)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── ANALYTICS TAB ───────────────────────────────────────────────────────────
function AnalyticsTab() {
  const [period, setPeriod] = useState<Period>('mes')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [exporting, setExporting] = useState(false)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (period !== 'custom') load()
  }, [period])

  const load = async () => {
    setLoading(true)
    const dates = period === 'custom' ? { from: customFrom, to: customTo } : getPeriodDates(period)
    if (!dates.from || !dates.to) { setLoading(false); return }
    const res = await window.api.getReports(dates)
    setData(res)
    setLoading(false)
  }

  const periods: { id: Period; label: string }[] = [
    { id: 'hoy',     label: 'Hoy' },
    { id: 'semana',  label: '7 días' },
    { id: 'mes',     label: 'Este mes' },
    { id: 'mes_ant', label: 'Mes anterior' },
    { id: 'anio',    label: 'Este año' },
    { id: 'anio_ant',label: 'Año anterior' },
    { id: 'custom',  label: 'Personalizado' },
  ]

  const exportAnalytics = async () => {
    if (!data) return
    setExporting(true)
    const label = periods.find(p => p.id === period)?.label || period
    const dates = period === 'custom' ? { from: customFrom, to: customTo } : getPeriodDates(period)
    await (window.api as any).exportToExcelMulti({
      filename: `reporte_${label.replace(/\s+/g,'_')}_${dates.from}_${dates.to}.xlsx`,
      sheets: [
        {
          name: 'Resumen',
          columns: [{ header: 'Métrica', key: 'k', width: 28 }, { header: 'Valor', key: 'v', width: 20 }],
          rows: [
            { k: 'Período', v: `${dates.from} — ${dates.to}` },
            { k: 'Total Ventas', v: data.kpis.total_sales },
            { k: 'Utilidad', v: data.kpis.total_profit },
            { k: 'Transacciones', v: data.kpis.transactions },
            { k: 'Ticket Promedio', v: data.kpis.avg_ticket },
            { k: 'Margen %', v: data.kpis.avg_margin },
          ],
        },
        {
          name: 'Ventas por Día',
          columns: [{ header: 'Fecha', key: 'd', width: 14 }, { header: 'Ventas', key: 't', width: 18 }, { header: 'Utilidad', key: 'p', width: 18 }],
          rows: (data.byDay || []).map((r: any) => ({ d: r.date, t: r.total, p: r.profit })),
        },
        {
          name: 'Por Forma de Pago',
          columns: [{ header: 'Método', key: 'm', width: 20 }, { header: 'Ventas', key: 't', width: 18 }, { header: 'Tickets', key: 'c', width: 12 }],
          rows: (data.byPayment || []).map((r: any) => ({ m: r.payment_type, t: r.total, c: r.count })),
        },
        {
          name: 'Por Categoría',
          columns: [
            { header: 'Categoría', key: 'c', width: 25 },
            { header: 'Ventas', key: 't', width: 18 },
            { header: 'Piezas', key: 'q', width: 12 },
            { header: 'Utilidad', key: 'p', width: 18 },
          ],
          rows: (data.byCategory || []).map((r: any) => ({ c: r.category || 'Sin categoría', t: r.total, q: Math.round(r.qty || 0), p: r.profit })),
        },
        {
          name: 'Top Más Vendidos',
          columns: [
            { header: 'Código', key: 'cd', width: 16 },
            { header: 'Producto', key: 'n', width: 35 },
            { header: 'Categoría', key: 'cat', width: 20 },
            { header: 'Piezas', key: 'q', width: 12 },
            { header: 'Ingresos', key: 'r', width: 18 },
            { header: 'Utilidad', key: 'p', width: 18 },
          ],
          rows: (data.topProducts || []).map((r: any) => ({ cd: r.code, n: r.name, cat: r.category, q: Math.round(r.total_qty || 0), r: r.total_revenue, p: r.total_profit })),
        },
        {
          name: 'Top Más Rentables',
          columns: [
            { header: 'Código', key: 'cd', width: 16 },
            { header: 'Producto', key: 'n', width: 35 },
            { header: 'Piezas', key: 'q', width: 12 },
            { header: 'Utilidad', key: 'p', width: 18 },
            { header: 'Margen %', key: 'm', width: 12 },
          ],
          rows: (data.topProfit || []).map((r: any) => ({ cd: r.code, n: r.name, q: Math.round(r.total_qty || 0), p: r.total_profit, m: (r.margin || 0).toFixed(1) })),
        },
        {
          name: 'Ventas por Hora',
          columns: [{ header: 'Hora', key: 'h', width: 10 }, { header: 'Ventas', key: 't', width: 18 }, { header: 'Tickets', key: 'c', width: 12 }],
          rows: Array.from({ length: 24 }, (_, h) => {
            const d = (data.byHour || []).find((b: any) => b.hour === h)
            return { h: `${String(h).padStart(2,'0')}:00`, t: d?.total || 0, c: d?.count || 0 }
          }),
        },
      ],
    })
    setExporting(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Period selector */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {periods.map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)} style={{
            padding: '6px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 800, transition: 'all 0.15s',
            background: period === p.id ? PINK : '#FFFFFF',
            color: period === p.id ? '#fff' : '#8E8E93',
            boxShadow: period === p.id ? '0 2px 8px rgba(255,45,85,0.3)' : '0 1px 4px rgba(0,0,0,0.08)',
          }}>{p.label}</button>
        ))}
        {period === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="nm-input" style={{ padding: '6px 10px', fontSize: 12 }} />
            <span style={{ color: '#8E8E93' }}>—</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="nm-input" style={{ padding: '6px 10px', fontSize: 12 }} />
            <button onClick={load} style={{ padding: '6px 16px', fontSize: 12, background: PINK, color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}>Consultar</button>
          </>
        )}
        <div style={{ flex: 1 }} />
        {data && <ExportBtn onClick={exportAnalytics} loading={exporting} />}
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: `3px solid rgba(255,45,85,0.15)`, borderTopColor: PINK, animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {!loading && !data && (
        <div style={{ textAlign: 'center', color: '#8E8E93', padding: 60, fontSize: 14 }}>Selecciona un período</div>
      )}

      {!loading && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            <KPICard label="Total Ventas"     value={fmt(data.kpis.total_sales)}                        icon="💰" color="blue"   />
            <KPICard label="Utilidad"          value={fmt(data.kpis.total_profit)}                       icon="📈" color="green"  />
            <KPICard label="Transacciones"     value={String(data.kpis.transactions)}                    icon="🧾" color="purple" />
            <KPICard label="Ticket Promedio"   value={fmt(data.kpis.avg_ticket)}                         icon="🎫" color="yellow" />
            <KPICard label="Margen"            value={`${(data.kpis.avg_margin || 0).toFixed(1)}%`}     icon="%" color="gray"   />
          </div>

          {/* Sales by day + by payment */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <Card title="Ventas y Utilidad por Día">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.byDay} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtK} />
                  <Tooltip formatter={(v: any, n: any) => [fmt(v), n === 'total' ? 'Ventas' : 'Utilidad']} labelFormatter={l => `Fecha: ${l}`} />
                  <Legend formatter={(v: any) => v === 'total' ? 'Ventas' : 'Utilidad'} />
                  <Bar dataKey="total"  name="total"  fill={PINK}  radius={[3,3,0,0]} />
                  <Bar dataKey="profit" name="profit" fill={GREEN} radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Forma de Pago">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.byPayment} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={fmtK} />
                  <YAxis dataKey="payment_type" type="category" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip formatter={(v: any) => [fmt(v), 'Total']} />
                  <Bar dataKey="total" radius={[0,4,4,0]}>
                    {data.byPayment.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Category pie + sales by hour */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Card title="Ventas por Categoría">
              {/* Legend table below chart */}
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={data.byCategory} dataKey="total" nameKey="category" cx="50%" cy="50%" outerRadius={80} innerRadius={36}
                    label={({ name, percent }: any) => `${((percent||0)*100).toFixed(0)}%`}
                    labelLine={false}>
                    {data.byCategory.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<CategoryPieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              {/* Category breakdown table */}
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.byCategory.map((cat: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                    <span style={{ flex: 1, color: '#1C1C1E', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.category || 'Sin categoría'}</span>
                    <span style={{ color: '#007AFF', fontWeight: 700, minWidth: 52, textAlign: 'right' }}>{Math.round(cat.qty || 0)} pzs</span>
                    <span style={{ color: '#1C1C1E', fontWeight: 700, minWidth: 70, textAlign: 'right' }}>{fmt(cat.total)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Ventas por Hora del Día">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={Array.from({ length: 24 }, (_, h) => {
                  const d = data.byHour.find((b: any) => b.hour === h)
                  return { hour: `${String(h).padStart(2,'0')}h`, total: d?.total || 0, count: d?.count || 0 }
                })} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
                  <XAxis dataKey="hour" tick={{ fontSize: 8 }} interval={1} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtK} />
                  <Tooltip formatter={(v: any, n: any) => [n === 'total' ? fmt(v) : v, n === 'total' ? 'Ventas' : 'Tickets']} />
                  <Bar dataKey="total" radius={[2,2,0,0]}>
                    {Array.from({ length: 24 }, (_, h) => {
                      const d = data.byHour.find((b: any) => b.hour === h)
                      const val = d?.total || 0
                      const max = Math.max(...data.byHour.map((x: any) => x.total))
                      const intensity = max > 0 ? val / max : 0
                      return <Cell key={h} fill={intensity > 0.7 ? PINK : intensity > 0.4 ? PINK2 : '#E5E5EA'} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Utilidad por categoría */}
          <Card title="Ventas y Utilidad por Categoría">
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={data.byCategory} margin={{ left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtK} />
                <Tooltip formatter={(v: any) => fmt(v)} />
                <Legend formatter={(v: any) => v === 'total' ? 'Ventas' : 'Utilidad'} />
                <Bar dataKey="total"  name="total"  fill={BLUE}  radius={[3,3,0,0]} />
                <Bar dataKey="profit" name="profit" fill={GREEN} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Top tables */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Card title="Top 10 Más Vendidos (por ingresos)">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #F2F2F7' }}>
                    <th style={{ textAlign: 'left', padding: '0 0 8px', color: '#8E8E93', fontWeight: 700, fontSize: 11 }}>Producto</th>
                    <th style={{ textAlign: 'right', padding: '0 0 8px', color: '#8E8E93', fontWeight: 700, fontSize: 11 }}>Piezas</th>
                    <th style={{ textAlign: 'right', padding: '0 0 8px', color: '#8E8E93', fontWeight: 700, fontSize: 11 }}>Ingreso</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F2F2F7' }}>
                      <td style={{ padding: '7px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: i < 3 ? PINK : '#8E8E93', fontWeight: 800, minWidth: 20 }}>#{i+1}</span>
                        <span style={{ fontWeight: 600, color: '#1C1C1E' }}>{p.name}</span>
                      </td>
                      <td style={{ padding: '7px 0', textAlign: 'right', color: '#007AFF', fontWeight: 700 }}>{Math.round(p.total_qty || 0)} pzs</td>
                      <td style={{ padding: '7px 0', textAlign: 'right', fontWeight: 800, color: BLUE }}>{fmt(p.total_revenue)}</td>
                    </tr>
                  ))}
                  {data.topProducts.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: '20px 0', color: '#8E8E93', fontSize: 12 }}>Sin datos</td></tr>}
                </tbody>
              </table>
            </Card>

            <Card title="Top 10 Más Rentables">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #F2F2F7' }}>
                    <th style={{ textAlign: 'left', padding: '0 0 8px', color: '#8E8E93', fontWeight: 700, fontSize: 11 }}>Producto</th>
                    <th style={{ textAlign: 'right', padding: '0 0 8px', color: '#8E8E93', fontWeight: 700, fontSize: 11 }}>Utilidad</th>
                    <th style={{ textAlign: 'right', padding: '0 0 8px', color: '#8E8E93', fontWeight: 700, fontSize: 11 }}>Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProfit.map((p: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F2F2F7' }}>
                      <td style={{ padding: '7px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: i < 3 ? GREEN : '#8E8E93', fontWeight: 800, minWidth: 20 }}>#{i+1}</span>
                        <span style={{ fontWeight: 600, color: '#1C1C1E' }}>{p.name}</span>
                      </td>
                      <td style={{ padding: '7px 0', textAlign: 'right', fontWeight: 800, color: GREEN }}>{fmt(p.total_profit)}</td>
                      <td style={{ padding: '7px 0', textAlign: 'right', color: '#8E8E93' }}>{(p.margin||0).toFixed(1)}%</td>
                    </tr>
                  ))}
                  {data.topProfit.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: '20px 0', color: '#8E8E93', fontSize: 12 }}>Sin datos</td></tr>}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ROOT ────────────────────────────────────────────────────────────────────
export default function Reports() {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard')

  const TABS: { id: AppTab; label: string; icon: string }[] = [
    { id: 'dashboard',  label: 'Dashboard',   icon: '⚡' },
    { id: 'analiticos', label: 'Analíticos',  icon: '📊' },
  ]

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#F2F2F7' }}>
      {/* Header */}
      <div style={{ background: '#FFFFFF', borderBottom: '1px solid rgba(60,60,67,0.12)', padding: '14px 20px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(160deg,#FF6584,#FF2D55)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📊</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#1C1C1E', letterSpacing: '-0.02em' }}>Reportes</div>
            <div style={{ fontSize: 11, color: '#8E8E93' }}>{new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: '8px 18px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
              background: 'transparent', transition: 'all 0.15s',
              color: activeTab === t.id ? PINK : '#8E8E93',
              borderBottom: activeTab === t.id ? `2px solid ${PINK}` : '2px solid transparent',
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {activeTab === 'dashboard'  && <DashboardTab />}
        {activeTab === 'analiticos' && <AnalyticsTab />}
      </div>
    </div>
  )
}
