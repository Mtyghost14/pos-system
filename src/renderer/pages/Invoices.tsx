import { useState, useEffect } from 'react'
import type { Invoice } from '../types'
import Modal from '../components/Modal'

const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

const CFDI_USES = [
  { code: 'G01', label: 'G01 - Adquisición de mercancias' },
  { code: 'G02', label: 'G02 - Devoluciones, descuentos o bonificaciones' },
  { code: 'G03', label: 'G03 - Gastos en general' },
  { code: 'I01', label: 'I01 - Construcciones' },
  { code: 'I02', label: 'I02 - Mobilario y equipo de oficina' },
  { code: 'I03', label: 'I03 - Equipo de transporte' },
  { code: 'I04', label: 'I04 - Equipo de computo y accesorios' },
  { code: 'I05', label: 'I05 - Dados, troqueles, moldes, matrices y herramental' },
  { code: 'I06', label: 'I06 - Comunicaciones telefónicas' },
  { code: 'I07', label: 'I07 - Comunicaciones satelitales' },
  { code: 'I08', label: 'I08 - Otra maquinaria y equipo' },
  { code: 'D01', label: 'D01 - Honorarios médicos, dentales y gastos hospitalarios' },
  { code: 'D02', label: 'D02 - Gastos médicos por incapacidad o discapacidad' },
  { code: 'D03', label: 'D03 - Gastos funerales' },
  { code: 'D04', label: 'D04 - Donativos' },
  { code: 'D10', label: 'D10 - Pagos por servicios educativos (colegiaturas)' },
  { code: 'S01', label: 'S01 - Sin efectos fiscales' },
  { code: 'CP01', label: 'CP01 - Pagos' },
  { code: 'CN01', label: 'CN01 - Nómina' },
]

const PAYMENT_FORMS = [
  { code: '01', label: '01 - Efectivo' },
  { code: '02', label: '02 - Cheque nominativo' },
  { code: '03', label: '03 - Transferencia electrónica de fondos' },
  { code: '04', label: '04 - Tarjeta de crédito' },
  { code: '28', label: '28 - Tarjeta de débito' },
  { code: '99', label: '99 - Por definir' },
]

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null)
  const [searchFolio, setSearchFolio] = useState('')
  const [foundSale, setFoundSale] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok')
  const [settings, setSettings] = useState<any>({})

  const emptyForm = { rfc_receptor: '', razon_social: '', cfdi_use: 'G03', payment_form: '01', total: '', description: '', sale_id: '' }
  const [form, setForm] = useState(emptyForm)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    load()
    window.api.getSettings().then(setSettings)
  }, [])

  const load = async () => setInvoices(await window.api.getInvoices())
  const showMsg = (m: string, type: 'ok' | 'err' = 'ok') => { setMsg(m); setMsgType(type); setTimeout(() => setMsg(''), 3000) }

  const handleSearchSale = async () => {
    if (!searchFolio) return
    const sales = await window.api.getSales({ limit: 1 })
    const sale = sales.find((s: any) => s.folio === searchFolio)
    if (sale) {
      setFoundSale(sale)
      set('total', String(sale.total))
      set('sale_id', String(sale.id))
    } else {
      setFoundSale(null)
      showMsg('Venta no encontrada', 'err')
    }
  }

  const handleCreate = async () => {
    if (!form.rfc_receptor || !form.razon_social || !form.total) {
      showMsg('RFC, Razón Social y Total son requeridos', 'err'); return
    }
    const res = await window.api.createInvoice({
      rfc_receptor: form.rfc_receptor,
      razon_social: form.razon_social,
      cfdi_use: form.cfdi_use,
      total: parseFloat(form.total),
      description: form.description,
      sale_id: form.sale_id ? parseInt(form.sale_id) : null,
    })
    if (res.success) {
      showMsg('Factura generada como borrador (requiere PAC para timbrado)')
      setShowCreate(false); setForm(emptyForm); setFoundSale(null); load()
    } else {
      showMsg('Error al generar factura', 'err')
    }
  }

  const handleCancel = async (inv: Invoice) => {
    if (!confirm('¿Cancelar esta factura?')) return
    await window.api.updateInvoice({ id: inv.id, status: 'cancelled' })
    showMsg('Factura cancelada'); load()
  }

  const statusLabel = (s: string) => ({ draft: 'Borrador', stamped: 'Timbrada', cancelled: 'Cancelada' }[s] || s)
  const statusColor = (s: string) => ({ draft: 'bg-yellow-100 text-yellow-700', stamped: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-700' }[s] || '')

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--nm-bg)' }}>
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
          Facturas CFDI 4.0
        </h1>
        {msg && (
          <span style={{
            padding: '4px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
            background: msgType === 'ok' ? 'linear-gradient(145deg, #46cf80, #2fa85d)' : 'linear-gradient(145deg, #e8504c, #cc2f2a)',
            color: 'white',
          }}>{msg}</span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowCreate(true)} className="nm-btn-accent" style={{ padding: '8px 18px', fontSize: 13 }}>
          + Nueva Factura
        </button>
      </div>

      {/* PAC notice */}
      <div style={{
        background: 'var(--nm-bg)',
        boxShadow: 'inset 2px 2px 6px rgba(232,169,26,0.15), inset -2px -2px 5px rgba(255,255,255,0.6)',
        padding: '8px 20px',
        fontSize: 12,
        fontWeight: 600,
        color: '#c98f00',
        flexShrink: 0,
      }}>
        ⚠️ Las facturas se generan como <strong>borrador</strong>. Para timbrado oficial ante el SAT se requieren credenciales PAC configuradas en Configuración.
      </div>

      <div className="nm-scroll" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <div style={{ background: 'var(--nm-bg)', borderRadius: 16, boxShadow: 'var(--nm-raised)', overflow: 'hidden' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ boxShadow: '0 2px 0 var(--nm-shadow-light), 0 3px 0 rgba(184,190,199,0.4)' }}>
                {['#', 'Fecha', 'RFC Receptor', 'Razón Social', 'Uso CFDI', 'Total', 'Folio Fiscal', 'Estado', 'Acciones'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--nm-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr key={inv.id} style={{ boxShadow: i > 0 ? '0 -1px 0 rgba(184,190,199,0.25)' : 'none' }}>
                  <td style={{ padding: '9px 12px', color: 'var(--nm-text-muted)', fontWeight: 600 }}>{inv.id}</td>
                  <td style={{ padding: '9px 12px', fontSize: 11, fontWeight: 600, color: 'var(--nm-text-muted)' }}>{inv.timestamp?.slice(0, 16)}</td>
                  <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontSize: 11 }}>{inv.rfc_receptor}</td>
                  <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--nm-text)' }}>{inv.razon_social}</td>
                  <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--nm-text-muted)', fontWeight: 600 }}>{inv.cfdi_use}</td>
                  <td style={{ padding: '9px 12px', fontWeight: 800, color: 'var(--nm-accent)' }}>{fmt(inv.total)}</td>
                  <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontSize: 10, color: 'var(--nm-text-light)' }}>{inv.folio_fiscal?.slice(0, 8)}...</td>
                  <td style={{ padding: '9px 12px' }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 800,
                      background: 'var(--nm-bg)',
                      boxShadow: inv.status === 'stamped'
                        ? 'inset 2px 2px 5px rgba(47,168,93,0.2), inset -1px -1px 4px rgba(255,255,255,0.7)'
                        : inv.status === 'cancelled'
                          ? 'inset 2px 2px 5px rgba(204,47,42,0.2), inset -1px -1px 4px rgba(255,255,255,0.7)'
                          : 'inset 2px 2px 5px rgba(232,169,26,0.2), inset -1px -1px 4px rgba(255,255,255,0.7)',
                      color: inv.status === 'stamped' ? 'var(--nm-success)' : inv.status === 'cancelled' ? 'var(--nm-danger)' : '#c98f00',
                    }}>{statusLabel(inv.status)}</span>
                  </td>
                  <td style={{ padding: '9px 12px', display: 'flex', gap: 8 }}>
                    <button onClick={() => setViewInvoice(inv)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--nm-accent)', fontFamily: 'Nunito, sans-serif' }}>Ver</button>
                    {inv.status !== 'cancelled' && (
                      <button onClick={() => handleCancel(inv)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--nm-danger)', fontFamily: 'Nunito, sans-serif' }}>Cancelar</button>
                    )}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: 'var(--nm-text-light)', fontWeight: 600 }}>Sin facturas generadas</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <Modal title="Nueva Factura CFDI 4.0" onClose={() => { setShowCreate(false); setFoundSale(null) }} size="lg">
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-3">
              <h4 className="text-sm font-bold text-blue-800 mb-2">Datos del Emisor (configurados en Ajustes)</h4>
              <div className="text-sm text-blue-700">RFC: {settings.rfc_emisor} | {settings.razon_social_emisor}</div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-gray-700 mb-2">Vincular a Venta (opcional)</h4>
              <div className="flex gap-2">
                <input value={searchFolio} onChange={e => setSearchFolio(e.target.value)} placeholder="Folio de venta..." className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none" />
                <button onClick={handleSearchSale} className="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg text-sm">Buscar</button>
              </div>
              {foundSale && <div className="text-sm text-green-700 mt-1">✓ Venta: {foundSale.folio} — {fmt(foundSale.total)}</div>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">RFC Receptor *</label>
                <input value={form.rfc_receptor} onChange={e => set('rfc_receptor', e.target.value.toUpperCase())} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" placeholder="XAXX010101000" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Razón Social *</label>
                <input value={form.razon_social} onChange={e => set('razon_social', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Nombre o empresa" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Uso CFDI</label>
                <select value={form.cfdi_use} onChange={e => set('cfdi_use', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {CFDI_USES.map(u => <option key={u.code} value={u.code}>{u.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Forma de Pago</label>
                <select value={form.payment_form} onChange={e => set('payment_form', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {PAYMENT_FORMS.map(f => <option key={f.code} value={f.code}>{f.label}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Total *</label>
                <input type="number" value={form.total} onChange={e => set('total', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-lg text-right font-bold focus:outline-none focus:ring-2 focus:ring-blue-500" step="0.01" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Descripción / Concepto</label>
                <input value={form.description} onChange={e => set('description', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="Descripción del servicio o producto" />
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
              <strong>Nota:</strong> Esta factura se guardará como borrador. Para el timbrado oficial (sello del SAT) configure las credenciales PAC en Configuración → Facturación.
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setShowCreate(false); setFoundSale(null) }} className="flex-1 border rounded-lg py-3 text-gray-600">Cancelar</button>
              <button onClick={handleCreate} className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-lg">Generar Factura</button>
            </div>
          </div>
        </Modal>
      )}

      {viewInvoice && (
        <Modal title={`Factura #${viewInvoice.id}`} onClose={() => setViewInvoice(null)} size="lg">
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><span className="font-medium text-gray-500">RFC Receptor:</span><div className="font-mono">{viewInvoice.rfc_receptor}</div></div>
              <div><span className="font-medium text-gray-500">Razón Social:</span><div>{viewInvoice.razon_social}</div></div>
              <div><span className="font-medium text-gray-500">Uso CFDI:</span><div>{viewInvoice.cfdi_use}</div></div>
              <div><span className="font-medium text-gray-500">Total:</span><div className="font-bold text-lg text-blue-700">{fmt(viewInvoice.total)}</div></div>
              <div><span className="font-medium text-gray-500">Estado:</span><div>{viewInvoice.status}</div></div>
              <div><span className="font-medium text-gray-500">Folio Fiscal:</span><div className="font-mono text-xs break-all">{viewInvoice.folio_fiscal}</div></div>
            </div>
            {viewInvoice.xml_content && (
              <div>
                <div className="font-medium text-gray-500 mb-1">XML CFDI:</div>
                <textarea readOnly value={viewInvoice.xml_content} className="w-full border rounded bg-gray-50 p-2 font-mono text-xs h-40" />
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
