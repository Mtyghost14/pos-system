import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays, addMonths, endOfMonth, format, isSameDay, isSameMonth,
  parseISO, startOfMonth, startOfWeek,
} from 'date-fns'
import { es } from 'date-fns/locale'
import Modal from '../components/Modal'

const ESTADOS = [
  { value: 'por_aprobar', label: 'Por aprobar', color: '#B45309', bg: '#FEF3C7' },
  { value: 'aprobado', label: 'Aprobado', color: '#6D28D9', bg: '#EDE9FE' },
  { value: 'en_proceso', label: 'En proceso', color: '#1D4ED8', bg: '#DBEAFE' },
  { value: 'listo', label: 'Listo', color: '#047857', bg: '#D1FAE5' },
  { value: 'entregado', label: 'Entregado', color: '#6B7280', bg: '#F3F4F6' },
  { value: 'cancelado', label: 'Cancelado', color: '#BE123C', bg: '#FFE4E6' },
] as const
type Estado = typeof ESTADOS[number]['value']
const estadoInfo = (e: string) => ESTADOS.find(x => x.value === e) ?? ESTADOS[0]

const money = (n: number) => `$${(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Item = { descripcion: string; cantidad: number; precio_unit: number; catalog_id: number | null }
type Pedido = {
  id: number; telefono: string | null; cliente: string; fecha_hora: string
  pedido: string | null; colores: string | null; tecnica: string | null; texto: string | null
  total: number; anticipo: number; pendiente: number; estado: Estado; notas: string | null
  balloon_order_items: Item[]
}

function resumenBreve(p: { pedido?: string | null; balloon_order_items?: Item[] }) {
  const t = (p.pedido ?? '').trim()
  if (t) return t
  const its = (p.balloon_order_items ?? []).filter(i => i.descripcion?.trim())
  return its.length ? its.map(i => `${Number(i.cantidad) || 1}× ${i.descripcion}`).join(', ') : '—'
}

function mensajeConfirmacion(p: Pedido, datosPago: string) {
  const f = parseISO(p.fecha_hora)
  const anticipo = Math.round((p.total || 0) / 2)
  const resta = (p.total || 0) - anticipo
  const its = (p.balloon_order_items ?? []).filter(i => i.descripcion?.trim())
  const L: string[] = [`¡Hola ${p.cliente}! 🎈`, '', 'Confirmamos tu pedido:', '',
    `🗓️ ${format(f, "EEEE, dd 'de' MMMM", { locale: es })} · ${format(f, 'hh:mm a', { locale: es })}`]
  for (const it of its) L.push(`• ${Number(it.cantidad) || 1}× ${it.descripcion} — $${(Number(it.cantidad) || 1) * (Number(it.precio_unit) || 0)}`)
  if (p.pedido) L.push(`🎈 ${p.pedido}`)
  if (p.colores) L.push(`Colores: ${p.colores}`)
  if (p.tecnica) L.push(`Técnica: ${p.tecnica}`)
  if (p.texto) L.push(`Texto: "${p.texto}"`)
  L.push('', `💰 Total: $${p.total}`, `✅ Anticipo (50%): $${anticipo}`, `Resta al entregar: $${resta}`, '',
    'Para apartar tu fecha, transfiere el anticipo a esta cuenta:', datosPago.trim() || '[datos de pago]', '',
    'Cuando recibamos el anticipo confirmamos y comenzamos tu pedido. ¡Gracias! ✨')
  return L.join('\n')
}

const api = () => (window as any).api
const card: React.CSSProperties = { background: 'var(--nm-bg)', borderRadius: 16, boxShadow: 'var(--nm-raised)', padding: 16 }
const input = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function Pedidos() {
  const [mes, setMes] = useState(() => startOfMonth(new Date()))
  const [dia, setDia] = useState<Date>(new Date())
  const [filtro, setFiltro] = useState<Estado | 'todos'>('todos')
  const [busca, setBusca] = useState('')
  const [rows, setRows] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [detalle, setDetalle] = useState<Pedido | null>(null)
  const [editar, setEditar] = useState<Pedido | 'nuevo' | null>(null)
  const [datosPago, setDatosPago] = useState('')

  const cargar = async () => {
    setLoading(true); setErr('')
    const from = addMonths(startOfMonth(mes), -1).toISOString()
    const to = addMonths(endOfMonth(mes), 1).toISOString()
    const r = await api().ordersList(from, to)
    setLoading(false)
    if (!r.ok) { setErr(r.message || 'No se pudo cargar'); setRows([]); return }
    setRows(r.data || [])
  }
  useEffect(() => { cargar() }, [mes]) // eslint-disable-line
  useEffect(() => { api().ordersDatosPago().then((r: any) => r.ok && setDatosPago(r.data || '')) }, [])

  const grid = useMemo(() => {
    const start = startOfWeek(startOfMonth(mes), { weekStartsOn: 1 })
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [mes])
  const diasConPedido = useMemo(
    () => new Set(rows.filter(p => p.estado !== 'cancelado').map(p => format(parseISO(p.fecha_hora), 'yyyy-MM-dd'))),
    [rows],
  )
  const lista = useMemo(() => {
    let base = rows
    if (busca.trim().length >= 2) {
      const q = busca.trim().toLowerCase()
      base = rows.filter(p => p.cliente.toLowerCase().includes(q) || (p.telefono || '').includes(q))
    } else {
      base = rows.filter(p => isSameDay(parseISO(p.fecha_hora), dia))
    }
    if (filtro !== 'todos') base = base.filter(p => p.estado === filtro)
    return [...base].sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora))
  }, [rows, busca, dia, filtro])

  const cambiarEstado = async (id: number, e: Estado) => {
    const r = await api().ordersSetEstado(id, e)
    if (!r.ok) return alert(r.message)
    await cargar()
    setDetalle(d => (d && d.id === id ? { ...d, estado: e } : d))
  }
  const borrar = async (id: number) => {
    if (!confirm('¿Eliminar este pedido?')) return
    const r = await api().ordersDelete(id)
    if (!r.ok) return alert(r.message)
    setDetalle(null); setEditar(null); cargar()
  }
  const copiar = async (p: Pedido) => {
    try { await navigator.clipboard.writeText(mensajeConfirmacion(p, datosPago)); alert('Confirmación copiada — pégala en WhatsApp') }
    catch { alert('No se pudo copiar') }
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--nm-text)' }}>Pedidos de globos</h1>
        <button className="nm-btn-accent" style={{ padding: '10px 16px', fontSize: 13, fontWeight: 800 }} onClick={() => setEditar('nuevo')}>+ Nuevo pedido</button>
      </div>

      <input className={input} placeholder="Buscar por nombre o teléfono…" value={busca} onChange={e => setBusca(e.target.value)} />

      {busca.trim().length < 2 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button className="nm-btn" style={{ padding: '4px 12px' }} onClick={() => setMes(addMonths(mes, -1))}>‹</button>
            <div style={{ fontWeight: 800, textTransform: 'capitalize', color: 'var(--nm-text)' }}>{format(mes, 'MMMM yyyy', { locale: es })}</div>
            <button className="nm-btn" style={{ padding: '4px 12px' }} onClick={() => setMes(addMonths(mes, 1))}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, textAlign: 'center' }}>
            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
              <div key={i} style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', padding: '4px 0' }}>{d}</div>
            ))}
            {grid.map((d, i) => {
              const fuera = !isSameMonth(d, mes)
              const sel = isSameDay(d, dia)
              const hoy = isSameDay(d, new Date())
              const tiene = diasConPedido.has(format(d, 'yyyy-MM-dd'))
              return (
                <button
                  key={i}
                  onClick={() => setDia(d)}
                  style={{
                    aspectRatio: '1', borderRadius: 10, border: hoy ? '1.5px solid var(--nm-accent)' : '1px solid transparent',
                    background: sel ? 'var(--nm-accent)' : 'transparent',
                    color: sel ? '#fff' : fuera ? 'var(--nm-text-light)' : 'var(--nm-text)',
                    fontSize: 14, fontWeight: sel ? 800 : 500, position: 'relative', cursor: 'pointer',
                  }}
                >
                  {format(d, 'd')}
                  {tiene && !sel && <span style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: 5, height: 5, borderRadius: '50%', background: 'var(--nm-accent)' }} />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(['todos', ...ESTADOS.map(e => e.value)] as const).map(f => (
          <button
            key={f}
            onClick={() => setFiltro(f as Estado | 'todos')}
            style={{
              borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: '1px solid var(--nm-separator)',
              background: filtro === f ? 'var(--nm-accent)' : 'transparent',
              color: filtro === f ? '#fff' : 'var(--nm-text-muted)',
            }}
          >
            {f === 'todos' ? 'Todos' : estadoInfo(f).label}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 12, color: 'var(--nm-text-muted)', textTransform: 'capitalize' }}>
        {busca.trim().length >= 2 ? `${lista.length} resultado(s)` : format(dia, "EEEE d 'de' MMMM", { locale: es })}
      </div>

      {err && <div style={{ color: 'var(--nm-danger)', fontSize: 13 }}>{err}</div>}

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {loading && <div style={{ padding: 16, fontSize: 13, color: 'var(--nm-text-muted)' }}>Cargando…</div>}
        {!loading && lista.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'var(--nm-text-muted)' }}>Sin pedidos</div>}
        {lista.map((p, i) => {
          const info = estadoInfo(p.estado)
          const f = parseISO(p.fecha_hora)
          return (
            <button
              key={p.id}
              onClick={() => setDetalle(p)}
              style={{
                display: 'flex', width: '100%', alignItems: 'center', gap: 12, padding: 12, textAlign: 'left',
                borderTop: i ? '1px solid var(--nm-separator)' : 'none', background: 'transparent', cursor: 'pointer',
                opacity: p.estado === 'cancelado' ? 0.5 : 1,
              }}
            >
              <div style={{ width: 52, textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--nm-text)' }}>{format(f, 'HH:mm')}</div>
                <div style={{ fontSize: 10, color: 'var(--nm-text-muted)' }}>{format(f, 'dd MMM', { locale: es })}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--nm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.cliente}</div>
                <div style={{ fontSize: 12, color: 'var(--nm-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{resumenBreve(p)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, color: info.color, background: info.bg }}>{info.label}</span>
                <div style={{ fontSize: 11, color: 'var(--nm-text-muted)', marginTop: 2 }}>{p.pendiente > 0 ? `debe ${money(p.pendiente)}` : 'pagado'}</div>
              </div>
            </button>
          )
        })}
      </div>

      {detalle && (
        <DetalleModal
          p={detalle}
          onClose={() => setDetalle(null)}
          onEditar={() => { setEditar(detalle); setDetalle(null) }}
          onEstado={cambiarEstado}
          onCopiar={() => copiar(detalle)}
        />
      )}
      {editar && (
        <FormModal
          base={editar === 'nuevo' ? null : editar}
          datosPago={datosPago}
          onClose={() => setEditar(null)}
          onSaved={() => { setEditar(null); cargar() }}
          onDelete={borrar}
        />
      )}
    </div>
  )
}

// ─── Detalle ─────────────────────────────────────────────────────────────────
function DetalleModal({ p, onClose, onEditar, onEstado, onCopiar }: {
  p: Pedido; onClose: () => void; onEditar: () => void
  onEstado: (id: number, e: Estado) => void; onCopiar: () => void
}) {
  const f = parseISO(p.fecha_hora)
  const its = p.balloon_order_items ?? []
  const row = { display: 'flex', gap: 8, fontSize: 13 } as React.CSSProperties
  const lbl = { width: 90, color: 'var(--nm-text-muted)', flexShrink: 0 } as React.CSSProperties
  return (
    <Modal title={p.cliente} onClose={onClose} size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, color: 'var(--nm-text-muted)', textTransform: 'capitalize' }}>
            {format(f, "EEEE d 'de' MMMM · HH:mm", { locale: es })}
          </div>
          <button className="nm-btn" style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700 }} onClick={onEditar}>Editar</button>
        </div>

        <div style={{ ...card, boxShadow: 'var(--nm-inset)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {p.telefono && <div style={row}><span style={lbl}>Teléfono</span><span>{p.telefono}</span></div>}
          {its.length > 0 && (
            <div>
              <div style={{ ...lbl, marginBottom: 2 }}>Renglones</div>
              {its.map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{Number(it.cantidad) || 1}× {it.descripcion}</span>
                  <span>{money((Number(it.cantidad) || 1) * (Number(it.precio_unit) || 0))}</span>
                </div>
              ))}
            </div>
          )}
          {p.pedido && <div style={row}><span style={lbl}>Pedido</span><span>{p.pedido}</span></div>}
          {p.colores && <div style={row}><span style={lbl}>Colores</span><span>{p.colores}</span></div>}
          {p.tecnica && <div style={row}><span style={lbl}>Técnica</span><span>{p.tecnica}</span></div>}
          {p.texto && <div style={row}><span style={lbl}>Texto</span><span>{p.texto}</span></div>}
          {p.notas && <div style={row}><span style={lbl}>Notas</span><span>{p.notas}</span></div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', ...card }}>
          <div><div style={{ fontSize: 11, color: 'var(--nm-text-muted)' }}>Total</div><div style={{ fontWeight: 800 }}>{money(p.total)}</div></div>
          <div><div style={{ fontSize: 11, color: 'var(--nm-text-muted)' }}>Anticipo</div><div style={{ fontWeight: 800 }}>{money(p.anticipo)}</div></div>
          <div><div style={{ fontSize: 11, color: 'var(--nm-text-muted)' }}>Pendiente</div><div style={{ fontWeight: 800, color: p.pendiente > 0 ? 'var(--nm-danger)' : 'var(--nm-success)' }}>{money(p.pendiente)}</div></div>
        </div>

        {p.estado === 'por_aprobar' && (
          <button
            onClick={() => onEstado(p.id, 'aprobado')}
            style={{ width: '100%', borderRadius: 10, background: '#059669', color: '#fff', padding: '12px', fontSize: 13, fontWeight: 800, border: 'none', cursor: 'pointer' }}
          >
            ✓ Anticipo recibido — Aprobar pedido
          </button>
        )}

        <button className="nm-btn" style={{ padding: '10px', fontSize: 13, fontWeight: 700 }} onClick={onCopiar}>
          Copiar confirmación (WhatsApp)
        </button>

        <div>
          <div style={{ fontSize: 11, color: 'var(--nm-text-muted)', marginBottom: 6 }}>Cambiar estado</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ESTADOS.map(e => (
              <button
                key={e.value}
                onClick={() => onEstado(p.id, e.value)}
                style={{
                  borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid var(--nm-separator)',
                  background: p.estado === e.value ? 'var(--nm-accent)' : 'transparent',
                  color: p.estado === e.value ? '#fff' : 'var(--nm-text-muted)',
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Formulario ──────────────────────────────────────────────────────────────
const toLocalInput = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function FormModal({ base, datosPago, onClose, onSaved, onDelete }: {
  base: Pedido | null; datosPago: string
  onClose: () => void; onSaved: () => void; onDelete: (id: number) => void
}) {
  const editId = base?.id ?? null
  const [f, setF] = useState({
    telefono: base?.telefono ?? '', cliente: base?.cliente ?? '',
    fecha_hora: toLocalInput(base?.fecha_hora), pedido: base?.pedido ?? '', colores: base?.colores ?? '',
    tecnica: base?.tecnica ?? '', texto: base?.texto ?? '', total: base ? String(base.total) : '',
    anticipo: base ? String(base.anticipo) : '', estado: (base?.estado ?? 'por_aprobar') as Estado, notas: base?.notas ?? '',
  })
  const [items, setItems] = useState<Item[]>(base?.balloon_order_items ?? [])
  const [catalogo, setCatalogo] = useState<{ id: number; categoria: string; nombre: string; precio: number }[]>([])
  const [saving, setSaving] = useState(false)
  const anticipoTocado = useRef(!!base)
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }))

  useEffect(() => { api().ordersCatalog().then((r: any) => r.ok && setCatalogo(r.data || [])) }, [])

  const total = Number(f.total) || 0
  const suma = items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.precio_unit) || 0), 0)
  useEffect(() => {
    if (anticipoTocado.current) return
    const mitad = total ? String(Math.round(total / 2)) : ''
    setF(p => (p.anticipo === mitad ? p : { ...p, anticipo: mitad }))
  }, [total])
  const pendiente = total - (Number(f.anticipo) || 0)

  const addCat = (v: string) => {
    if (v === 'otro') { setItems(p => [...p, { descripcion: '', cantidad: 1, precio_unit: 0, catalog_id: null }]); return }
    const c = catalogo.find(x => String(x.id) === v)
    if (c) setItems(p => [...p, { descripcion: c.nombre, cantidad: 1, precio_unit: c.precio, catalog_id: c.id }])
  }

  const guardar = async () => {
    if (!f.cliente.trim()) return alert('Falta el nombre')
    setSaving(true)
    const r = await api().ordersSave({
      id: editId, telefono: f.telefono.trim() || null, cliente: f.cliente.trim(),
      fecha_hora: new Date(f.fecha_hora).toISOString(),
      pedido: f.pedido.trim() || null, colores: f.colores.trim() || null,
      tecnica: f.tecnica.trim() || null, texto: f.texto.trim() || null,
      total, anticipo: Number(f.anticipo) || 0, estado: f.estado, notas: f.notas.trim() || null,
      items: items.filter(it => it.descripcion.trim()).map(it => ({
        descripcion: it.descripcion.trim(), cantidad: Number(it.cantidad) || 1,
        precio_unit: Number(it.precio_unit) || 0, catalog_id: it.catalog_id,
      })),
    })
    setSaving(false)
    if (!r.ok) return alert(r.message)
    onSaved()
  }
  const copiar = async () => {
    const p: Pedido = {
      id: editId ?? 0, telefono: f.telefono, cliente: f.cliente, fecha_hora: new Date(f.fecha_hora).toISOString(),
      pedido: f.pedido, colores: f.colores, tecnica: f.tecnica, texto: f.texto,
      total, anticipo: Number(f.anticipo) || 0, pendiente, estado: f.estado, notas: f.notas,
      balloon_order_items: items.filter(it => it.descripcion.trim()),
    }
    try { await navigator.clipboard.writeText(mensajeConfirmacion(p, datosPago)); alert('Confirmación copiada') }
    catch { alert('No se pudo copiar') }
  }

  const lbl = 'text-xs font-medium text-gray-600'
  return (
    <Modal title={editId ? 'Editar pedido' : 'Nuevo pedido'} onClose={onClose} size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label className={lbl}>Teléfono</label><input className={input} value={f.telefono} onChange={e => set('telefono', e.target.value)} /></div>
          <div><label className={lbl}>Nombre *</label><input className={input} value={f.cliente} onChange={e => set('cliente', e.target.value)} /></div>
          <div><label className={lbl}>Fecha y hora *</label><input type="datetime-local" className={input} value={f.fecha_hora} onChange={e => set('fecha_hora', e.target.value)} /></div>
          <div><label className={lbl}>Estado</label>
            <select className={input} value={f.estado} onChange={e => set('estado', e.target.value)}>
              {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ ...card, boxShadow: 'var(--nm-inset)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className={lbl}>Renglones</span><span style={{ fontSize: 12, color: 'var(--nm-text-muted)' }}>suma {money(suma)}</span>
          </div>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input className={input} style={{ flex: 1 }} placeholder="Descripción" value={it.descripcion}
                onChange={e => setItems(p => p.map((x, j) => j === i ? { ...x, descripcion: e.target.value, catalog_id: null } : x))} />
              <input className={input} style={{ width: 56 }} type="number" value={it.cantidad}
                onChange={e => setItems(p => p.map((x, j) => j === i ? { ...x, cantidad: Number(e.target.value) } : x))} />
              <input className={input} style={{ width: 90 }} type="number" value={it.precio_unit}
                onChange={e => setItems(p => p.map((x, j) => j === i ? { ...x, precio_unit: Number(e.target.value) } : x))} />
              <button className="nm-btn" style={{ padding: '0 10px' }} onClick={() => setItems(p => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <select className={input} value="" onChange={e => { addCat(e.target.value); e.target.value = '' }}>
            <option value="">+ Agregar del catálogo…</option>
            <option value="otro">Otro (temporada / impreso / personalizado)…</option>
            {['Individual', 'Paquete', 'Temporada'].map(cat => {
              const cs = catalogo.filter(c => c.categoria === cat)
              return cs.length ? <optgroup key={cat} label={cat}>{cs.map(c => <option key={c.id} value={String(c.id)}>{c.nombre} — {money(c.precio)}</option>)}</optgroup> : null
            })}
          </select>
          {suma > 0 && suma !== total && (
            <button className="nm-btn" style={{ width: '100%', marginTop: 6, padding: 8, fontSize: 12 }} onClick={() => set('total', String(suma))}>
              Usar {money(suma)} como Total
            </button>
          )}
        </div>

        <div><label className={lbl}>Pedido</label><textarea className={input} rows={2} value={f.pedido} onChange={e => set('pedido', e.target.value)} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label className={lbl}>Colores</label><input className={input} value={f.colores} onChange={e => set('colores', e.target.value)} /></div>
          <div><label className={lbl}>Técnica</label><input className={input} value={f.tecnica} onChange={e => set('tecnica', e.target.value)} /></div>
        </div>
        <div><label className={lbl}>Texto (lo que va en el globo)</label><input className={input} value={f.texto} onChange={e => set('texto', e.target.value)} /></div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label className={lbl}>Total $</label><input className={input} type="number" value={f.total} onChange={e => set('total', e.target.value)} /></div>
          <div><label className={lbl}>Anticipo $</label><input className={input} type="number" value={f.anticipo} onChange={e => { anticipoTocado.current = true; set('anticipo', e.target.value) }} /></div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: pendiente > 0 ? 'var(--nm-danger)' : 'var(--nm-success)' }}>Pendiente: {money(pendiente)}</div>
        <div><label className={lbl}>Notas</label><textarea className={input} rows={2} value={f.notas} onChange={e => set('notas', e.target.value)} /></div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="nm-btn-accent" style={{ flex: 1, padding: 12, fontSize: 13, fontWeight: 800 }} disabled={saving} onClick={guardar}>{saving ? 'Guardando…' : 'Guardar'}</button>
          <button className="nm-btn" style={{ padding: 12, fontSize: 13 }} onClick={copiar}>Copiar confirmación</button>
        </div>
        {editId && (
          <button className="nm-btn-danger" style={{ padding: 10, fontSize: 13 }} onClick={() => onDelete(editId)}>Eliminar pedido</button>
        )}
      </div>
    </Modal>
  )
}
