import { useState, useEffect } from 'react'
import { useSettingsStore } from '../store/useSettingsStore'
import { useAuthStore } from '../store/useAuthStore'
import type { User } from '../types'
import Modal from '../components/Modal'
import PageShell from '../components/PageShell'

type Tab = 'tienda' | 'impresora' | 'tickets' | 'facturacion' | 'usuarios' | 'respaldos'

export default function Settings() {
  const [tab, setTab] = useState<Tab>('tienda')
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok')

  const showMsg = (m: string, type: 'ok' | 'err' = 'ok') => {
    setMsg(m); setMsgType(type); setTimeout(() => setMsg(''), 3000)
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'tienda', label: 'Información de Tienda' },
    { id: 'impresora', label: 'Impresora Térmica' },
    { id: 'tickets', label: 'Tickets y Etiquetas' },
    { id: 'facturacion', label: 'Facturación SAT' },
    { id: 'usuarios', label: 'Usuarios' },
    { id: 'respaldos', label: 'Respaldos' },
  ]

  return (
    <PageShell
      title="Configuración"
      tabs={tabs}
      activeTab={tab}
      onTabChange={id => setTab(id as Tab)}
      message={msg}
      messageType={msgType}
    >
      {tab === 'tienda' && <StoreSettings showMsg={showMsg} />}
      {tab === 'impresora' && <PrinterSettings showMsg={showMsg} />}
      {tab === 'tickets' && <TicketsTab showMsg={showMsg} />}
      {tab === 'facturacion' && <InvoiceSettings showMsg={showMsg} />}
      {tab === 'usuarios' && <UsersSettings showMsg={showMsg} />}
      {tab === 'respaldos' && <BackupsTab showMsg={showMsg} />}
    </PageShell>
  )
}

function StoreSettings({ showMsg }: any) {
  const { settings, loadSettings } = useSettingsStore()
  const [form, setForm] = useState({ store_name: '', store_address: '', store_phone: '', store_rfc: '', receipt_footer: '' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (settings) {
      setForm({
        store_name: settings.store_name || '',
        store_address: settings.store_address || '',
        store_phone: settings.store_phone || '',
        store_rfc: settings.store_rfc || '',
        receipt_footer: settings.receipt_footer || '',
      })
    }
  }, [settings])

  const handleSave = async () => {
    await window.api.saveSettings(form)
    await loadSettings()
    showMsg('Configuración guardada')
  }

  return (
    <div className="max-w-lg">
      <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 className="font-bold text-gray-900">Datos de la Tienda</h2>
        {[
          { k: 'store_name', l: 'Nombre de la tienda' },
          { k: 'store_address', l: 'Dirección' },
          { k: 'store_phone', l: 'Teléfono' },
          { k: 'store_rfc', l: 'RFC' },
          { k: 'receipt_footer', l: 'Mensaje en pie de ticket' },
        ].map(({ k, l }) => (
          <div key={k}>
            <label className="text-sm font-medium text-gray-700">{l}</label>
            <input value={(form as any)[k]} onChange={e => set(k, e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        ))}
        <button onClick={handleSave} className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl">Guardar</button>
      </div>
    </div>
  )
}

function PrinterSettings({ showMsg }: any) {
  const { settings, loadSettings } = useSettingsStore()
  const [sysPrinters, setSysPrinters] = useState<{ name: string; isDefault: boolean }[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [loadingPrinters, setLoadingPrinters] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    if (settings) setSelectedPort(settings.printer_port || '')
  }, [settings])

  const refreshPrinters = async () => {
    setLoadingPrinters(true)
    const list = await (window.api as any).getSystemPrinters()
    setSysPrinters(list)
    setLoadingPrinters(false)
  }

  useEffect(() => { refreshPrinters() }, [])

  const handleSave = async () => {
    await window.api.saveSettings({ printer_port: selectedPort })
    await loadSettings()
    showMsg('Impresora guardada')
  }

  const handleTest = async () => {
    setTestResult(null)
    const res = await window.api.printReceipt({
      storeName: settings?.store_name || 'Mi Tienda',
      storeAddress: settings?.store_address || '',
      storePhone: settings?.store_phone || '',
      footer: settings?.receipt_footer || 'Gracias por su compra',
      date: new Date().toLocaleString('es-MX'),
      folio: 'TEST-001',
      cashierName: 'Prueba',
      items: [{ name: 'Coca-Cola 600ml', qty: 2, price: 18 }, { name: 'Sabritas 45g', qty: 1, price: 16 }],
      total: 52,
      paymentType: 'efectivo',
      received: 100,
      change: 48,
      printerName: selectedPort,
    })
    setTestResult({ ok: res.success, msg: res.success ? 'Ticket enviado a impresora' : (res.message || 'Error desconocido') })
    if (res.success) showMsg('Ticket de prueba enviado')
    else showMsg(`Error: ${res.message}`, 'err')
  }

  return (
    <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Main card */}
      <div style={{ background: 'var(--nm-surface)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--nm-text)', letterSpacing: '-0.01em', marginBottom: 2 }}>Impresora Térmica</div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--nm-text-muted)' }}>ESC/POS — Compatible con Epson, Star, Bixolon, y similares</div>
        </div>

        {/* System printer list */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Impresoras del sistema
            </label>
            <button onClick={refreshPrinters} className="nm-btn" style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 8 }}>
              {loadingPrinters ? '...' : '↺ Actualizar'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sysPrinters.length === 0 && !loadingPrinters && (
              <div style={{ fontSize: 12, color: 'var(--nm-text-muted)', fontWeight: 500, padding: '10px 0' }}>
                No se encontraron impresoras instaladas en el sistema
              </div>
            )}
            {sysPrinters.map(p => (
              <label key={p.name}
                onClick={() => setSelectedPort(p.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 14px', borderRadius: 12, cursor: 'pointer',
                  background: selectedPort === p.name ? 'rgba(255,45,85,0.07)' : 'var(--nm-bg)',
                  border: `1.5px solid ${selectedPort === p.name ? 'rgba(255,45,85,0.3)' : 'var(--nm-separator)'}`,
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${selectedPort === p.name ? 'var(--nm-accent)' : 'var(--nm-separator)'}`,
                  background: selectedPort === p.name ? 'var(--nm-accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {selectedPort === p.name && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'white' }} />}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--nm-text)' }}>{p.name}</div>
                  {p.isDefault && <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--nm-accent)', marginTop: 1 }}>Predeterminada</div>}
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Manual name input */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            O escribe el nombre manualmente
          </label>
          <input
            value={selectedPort}
            onChange={e => setSelectedPort(e.target.value)}
            className="nm-input"
            style={{ width: '100%', padding: '10px 14px', fontSize: 13 }}
            placeholder="Ej: EPSON TM-T20III, POS-58..."
          />
        </div>

        {/* Selected printer indicator */}
        {selectedPort && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(52,199,89,0.08)', borderRadius: 10, padding: '9px 14px',
            border: '1px solid rgba(52,199,89,0.2)',
          }}>
            <span style={{ fontSize: 14 }}>🖨️</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1A8F3A' }}>Seleccionada: {selectedPort}</span>
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div style={{
            fontSize: 12, fontWeight: 600, padding: '9px 14px', borderRadius: 10,
            background: testResult.ok ? 'rgba(52,199,89,0.08)' : 'rgba(255,59,48,0.08)',
            border: `1px solid ${testResult.ok ? 'rgba(52,199,89,0.2)' : 'rgba(255,59,48,0.2)'}`,
            color: testResult.ok ? '#1A8F3A' : 'var(--nm-danger)',
          }}>
            {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleSave} className="nm-btn-accent" style={{ flex: 1, padding: '12px', fontSize: 14 }}>
            Guardar
          </button>
          <button onClick={handleTest} disabled={!selectedPort} className="nm-btn"
            style={{ flex: 1, padding: '12px', fontSize: 13, opacity: !selectedPort ? 0.45 : 1 }}>
            🖨️ Imprimir Prueba
          </button>
        </div>
      </div>

      {/* Tips card */}
      <div style={{
        background: 'rgba(255,45,85,0.05)', borderRadius: 14,
        border: '1px solid rgba(255,45,85,0.15)', padding: '14px 18px',
        fontSize: 12, fontWeight: 500, color: 'var(--nm-text-muted)', lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--nm-text)', fontWeight: 700, display: 'block', marginBottom: 6 }}>Cómo conectar tu impresora</strong>
        <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <li>Conecta la impresora por USB y espera que el sistema la instale</li>
          <li>Haz clic en <strong>↺ Actualizar</strong> para ver la lista actualizada</li>
          <li>Selecciona tu impresora de la lista y guarda</li>
          <li>Usa <strong>Imprimir Prueba</strong> para verificar que funciona</li>
        </ul>
      </div>

      {/* Zebra label printer section */}
      <ZebraSettings showMsg={showMsg} />
    </div>
  )
}

function ZebraSettings({ showMsg }: any) {
  const { settings, loadSettings } = useSettingsStore()
  const [selected, setSelected] = useState('')
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([])
  const [loadingPrinters, setLoadingPrinters] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (settings) setSelected(settings.label_printer || '')
  }, [settings])

  const fetchPrinters = async () => {
    setLoadingPrinters(true)
    const list = await (window.api as any).getSystemPrinters()
    setPrinters(list || [])
    setLoadingPrinters(false)
    // Auto-select zebra if nothing selected yet
    if (!selected) {
      const zebra = (list || []).find((p: any) => /zebra/i.test(p.name))
      if (zebra) setSelected(zebra.name)
    }
  }

  useEffect(() => { fetchPrinters() }, [])

  const handleSave = async () => {
    await window.api.saveSettings({ label_printer: selected.trim() })
    await loadSettings()
    showMsg('Impresora de etiquetas guardada')
  }

  const handleTest = async () => {
    if (!selected) return
    setTesting(true)
    const testZPL = [
      '^XA',
      '^FO30,30^A0N,40,40^FDPrueba de impresion^FS',
      '^FO30,80^A0N,30,30^FDEtiquetadora OK^FS',
      '^XZ',
    ].join('\n')
    const printerName = selected.trim()
    const res = await (window.api as any).printZPL({ zpl: testZPL, printerName })
    setTesting(false)
    if (res?.success) showMsg('Prueba enviada a la impresora')
    else showMsg('Error: ' + (res?.message || 'No se pudo imprimir'))
  }

  const zebraFound = printers.some(p => /zebra/i.test(p.name))

  return (
    <div style={{ background: 'var(--nm-surface)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--nm-text)', letterSpacing: '-0.01em', marginBottom: 2 }}>
          🏷️ Impresora de Etiquetas (Zebra)
        </div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--nm-text-muted)' }}>
          ZPL — Exclusiva para imprimir etiquetas con código de barras
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Seleccionar impresora
          </label>
          <button onClick={fetchPrinters} className="nm-btn" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--nm-accent)' }}>
            {loadingPrinters ? 'Cargando...' : '↻ Actualizar'}
          </button>
        </div>

        {printers.length === 0 ? (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--nm-bg)', boxShadow: 'var(--nm-inset)', fontSize: 12, color: 'var(--nm-text-muted)' }}>
            {loadingPrinters ? 'Buscando impresoras...' : 'No se encontraron impresoras. Asegúrate de que estén instaladas en macOS.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {printers.map(p => {
              const isZebra = /zebra/i.test(p.name)
              const isSelected = selected === p.name
              return (
                <div
                  key={p.name}
                  onClick={() => setSelected(p.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 12, cursor: 'pointer',
                    background: isSelected ? 'var(--nm-bg)' : 'var(--nm-bg)',
                    boxShadow: isSelected
                      ? 'inset 2px 2px 6px rgba(91,141,238,0.2), inset -2px -2px 5px rgba(255,255,255,0.7), 0 0 0 2px var(--nm-accent)'
                      : 'var(--nm-inset-sm)',
                    transition: 'box-shadow 0.15s',
                  }}
                >
                  <span style={{ fontSize: 16 }}>{isZebra ? '🦓' : '🖨️'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--nm-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--nm-text-muted)', fontWeight: 500 }}>
                      {isZebra ? 'Impresora de etiquetas ZPL' : 'Impresora de sistema'}{p.isDefault ? ' · Por defecto' : ''}
                    </div>
                  </div>
                  {isSelected && (
                    <span style={{ fontSize: 14, color: 'var(--nm-accent)', fontWeight: 900 }}>✓</span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!zebraFound && printers.length > 0 && (
          <div style={{ fontSize: 11, color: '#c98f00', marginTop: 8, fontWeight: 600 }}>
            ⚠️ No se detectó una impresora Zebra. Instálala primero en Preferencias del Sistema → Impresoras.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={handleTest}
          disabled={!selected || testing}
          className="nm-btn"
          style={{ flex: 1, padding: '12px', fontSize: 13, opacity: !selected ? 0.4 : 1 }}
        >
          {testing ? 'Enviando...' : '🧪 Prueba de impresión'}
        </button>
        <button
          onClick={handleSave}
          disabled={!selected}
          className="nm-btn-accent"
          style={{ flex: 1, padding: '12px', fontSize: 13, opacity: !selected ? 0.4 : 1 }}
        >
          Guardar
        </button>
      </div>
    </div>
  )
}

function InvoiceSettings({ showMsg }: any) {
  const { settings, loadSettings } = useSettingsStore()
  const [form, setForm] = useState({ rfc_emisor: '', razon_social_emisor: '', regimen_fiscal_emisor: '', certificado_no: '', pac_url: '', pac_user: '', pac_password: '' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (settings) {
      setForm({
        rfc_emisor: settings.rfc_emisor || '',
        razon_social_emisor: settings.razon_social_emisor || '',
        regimen_fiscal_emisor: settings.regimen_fiscal_emisor || '',
        certificado_no: settings.certificado_no || '',
        pac_url: settings.pac_url || '',
        pac_user: settings.pac_user || '',
        pac_password: settings.pac_password || '',
      })
    }
  }, [settings])

  const handleSave = async () => {
    await window.api.saveSettings(form)
    await loadSettings()
    showMsg('Configuración de facturación guardada')
  }

  const REGIMENES = [
    { code: '601', label: '601 - General de Ley Personas Morales' },
    { code: '603', label: '603 - Personas Morales con Fines no Lucrativos' },
    { code: '605', label: '605 - Sueldos y Salarios e Ingresos Asimilados' },
    { code: '606', label: '606 - Arrendamiento' },
    { code: '607', label: '607 - Régimen de Enajenación o Adquisición de Bienes' },
    { code: '608', label: '608 - Demás ingresos' },
    { code: '612', label: '612 - Personas Físicas con Actividades Empresariales' },
    { code: '616', label: '616 - Sin obligaciones fiscales' },
    { code: '621', label: '621 - Incorporación Fiscal' },
    { code: '625', label: '625 - Régimen de las Actividades Empresariales con ingresos' },
    { code: '626', label: '626 - Régimen Simplificado de Confianza' },
  ]

  return (
    <div className="max-w-xl space-y-4">
      <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 className="font-bold text-gray-900">Datos del Emisor</h2>
        <div>
          <label className="text-sm font-medium text-gray-700">RFC del Emisor</label>
          <input value={form.rfc_emisor} onChange={e => set('rfc_emisor', e.target.value.toUpperCase())} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="XAXX010101000" />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Razón Social</label>
          <input value={form.razon_social_emisor} onChange={e => set('razon_social_emisor', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Régimen Fiscal</label>
          <select value={form.regimen_fiscal_emisor} onChange={e => set('regimen_fiscal_emisor', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
            <option value="">Seleccionar...</option>
            {REGIMENES.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Número de Certificado (CSD)</label>
          <input value={form.certificado_no} onChange={e => set('certificado_no', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" />
        </div>
      </div>

      <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 className="font-bold text-gray-900">Proveedor de Certificación (PAC)</h2>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
          Para el timbrado oficial configure sus credenciales PAC (Finkok, SW Sapien, Edicom, etc.)
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">URL del PAC</label>
          <input value={form.pac_url} onChange={e => set('pac_url', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="https://api.finkok.com/..." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Usuario PAC</label>
            <input value={form.pac_user} onChange={e => set('pac_user', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Contraseña PAC</label>
            <input type="password" value={form.pac_password} onChange={e => set('pac_password', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" />
          </div>
        </div>
        <button onClick={handleSave} className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl">Guardar Configuración</button>
      </div>
    </div>
  )
}

function UsersSettings({ showMsg }: any) {
  const { user: currentUser } = useAuthStore()
  const [users, setUsers] = useState<User[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>({})
  const emptyForm = { username: '', password: '', role: 'cajero', name: '', active: true }
  const [form, setForm] = useState<any>(emptyForm)
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const togglePassword = (id: number) => setVisiblePasswords(p => ({ ...p, [id]: !p[id] }))

  useEffect(() => { load() }, [])
  const load = async () => setUsers(await window.api.getUsers() as User[])

  const handleSave = async () => {
    if (!form.name || !form.username) { showMsg('Nombre y usuario son requeridos', 'err'); return }
    if (!editing && !form.password) { showMsg('La contraseña es requerida', 'err'); return }
    const data = { ...form, id: editing?.id }
    const res = editing ? await window.api.updateUser(data) : await window.api.createUser(data)
    if (res.success) {
      showMsg(editing ? 'Usuario actualizado' : 'Usuario creado')
      setShowModal(false); setEditing(null); setForm(emptyForm); load()
    } else {
      showMsg(res.message || 'Error', 'err')
    }
  }

  const handleDelete = async (u: User) => {
    if (u.id === currentUser?.id) { showMsg('No puede eliminar su propio usuario', 'err'); return }
    if (!confirm(`¿Desactivar usuario "${u.name}"?`)) return
    await window.api.deleteUser(u.id)
    showMsg('Usuario desactivado'); load()
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-bold text-gray-900">Gestión de Usuarios</h2>
        <button onClick={() => { setEditing(null); setForm(emptyForm); setShowModal(true) }} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">+ Nuevo Usuario</button>
      </div>
      <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', overflow: 'hidden' }}>
        {users.map((u: any, i: number) => (
          <div key={u.id} style={{ padding: '14px 18px', borderBottom: i < users.length - 1 ? '1px solid var(--nm-shadow-dark)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: u.role === 'admin' ? 'linear-gradient(145deg,#6b9cf0,#4d7ee8)' : 'linear-gradient(145deg,#c8cdd5,#adb4be)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, color: 'white', flexShrink: 0 }}>
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--nm-text)' }}>{u.name}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nm-text-muted)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                  <span>👤 {u.username}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    🔑 {u.plain_password ? (
                      <>
                        <span style={{ fontFamily: 'monospace', letterSpacing: visiblePasswords[u.id] ? '0' : '0.1em' }}>
                          {visiblePasswords[u.id] ? u.plain_password : '••••••••'}
                        </span>
                        <button
                          onClick={() => togglePassword(u.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--nm-accent)', fontWeight: 700, padding: '0 2px' }}
                        >
                          {visiblePasswords[u.id] ? 'Ocultar' : 'Ver'}
                        </button>
                      </>
                    ) : (
                      <span style={{ color: 'var(--nm-warning)', fontWeight: 700 }}>Editar para guardar contraseña</span>
                    )}
                  </span>
                  <span style={{ color: u.role === 'admin' ? 'var(--nm-accent)' : 'var(--nm-text-muted)' }}>
                    {u.role === 'admin' ? 'Administrador' : 'Cajero'}
                  </span>
                </div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 20, background: u.active ? 'rgba(47,168,93,0.12)' : 'rgba(0,0,0,0.06)', color: u.active ? 'var(--nm-success)' : 'var(--nm-text-muted)', marginRight: 4 }}>
                {u.active ? 'Activo' : 'Inactivo'}
              </span>
              <button onClick={() => { setEditing(u); setForm({ username: u.username, password: '', role: u.role, name: u.name, active: !!u.active }); setShowModal(true) }} className="nm-btn" style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, color: 'var(--nm-accent)' }}>Editar</button>
              <button onClick={() => handleDelete(u)} className="nm-btn" style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, color: 'var(--nm-danger)' }}>Desactivar</button>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <Modal title={editing ? 'Editar Usuario' : 'Nuevo Usuario'} onClose={() => { setShowModal(false); setEditing(null) }}>
          <div className="space-y-3">
            <div><label className="text-sm font-medium text-gray-700">Nombre completo *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="text-sm font-medium text-gray-700">Nombre de usuario *</label>
              <input value={form.username} onChange={e => set('username', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="text-sm font-medium text-gray-700">{editing ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="text-sm font-medium text-gray-700">Rol</label>
              <select value={form.role} onChange={e => set('role', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                <option value="cajero">Cajero</option>
                <option value="admin">Administrador</option>
              </select></div>
            {editing && (
              <div className="flex items-center gap-2">
                <input type="checkbox" id="user-active" checked={form.active} onChange={e => set('active', e.target.checked)} />
                <label htmlFor="user-active" className="text-sm text-gray-700">Usuario activo</label>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowModal(false); setEditing(null) }} className="flex-1 border rounded-lg py-2 text-gray-600 text-sm">Cancelar</button>
              <button onClick={handleSave} className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg text-sm">Guardar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function TicketsTab({ showMsg }: any) {
  const { settings, loadSettings } = useSettingsStore()
  const [fontSize, setFontSize] = useState('medium')
  const [showFolio, setShowFolio] = useState(true)
  const [showCashier, setShowCashier] = useState(true)
  const [labelFontSize, setLabelFontSize] = useState('medium')
  const [labelShowPrice, setLabelShowPrice] = useState(true)
  const [labelShowBarcode, setLabelShowBarcode] = useState(true)

  useEffect(() => {
    if (settings) {
      setFontSize(settings.receipt_font_size || 'medium')
      setShowFolio(settings.receipt_show_folio !== '0')
      setShowCashier(settings.receipt_show_cashier !== '0')
      setLabelFontSize(settings.label_font_size || 'medium')
      setLabelShowPrice(settings.label_show_price !== '0')
      setLabelShowBarcode(settings.label_show_barcode !== '0')
    }
  }, [settings])

  const handleSave = async () => {
    await window.api.saveSettings({
      receipt_font_size: fontSize,
      receipt_show_folio: showFolio ? '1' : '0',
      receipt_show_cashier: showCashier ? '1' : '0',
      label_font_size: labelFontSize,
      label_show_price: labelShowPrice ? '1' : '0',
      label_show_barcode: labelShowBarcode ? '1' : '0',
    })
    await loadSettings()
    showMsg('Configuración de tickets guardada')
  }

  // Preview font sizes
  const previewBase = fontSize === 'small' ? 7 : fontSize === 'large' ? 10 : 8.5
  const storeName = settings?.store_name || 'Mi Tienda'
  const storeAddress = settings?.store_address || 'Calle Principal #123'
  const footer = settings?.receipt_footer || 'Gracias por su compra'

  // Label preview font
  const labelBase = labelFontSize === 'small' ? 7 : labelFontSize === 'large' ? 10 : 8.5

  const toggle = (val: boolean, set: (v: boolean) => void, label: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', borderRadius: 12, background: 'var(--nm-bg)', border: '1.5px solid var(--nm-separator)' }}>
      <div
        onClick={() => set(!val)}
        style={{
          width: 36, height: 20, borderRadius: 10, flexShrink: 0,
          background: val ? 'var(--nm-accent)' : 'var(--nm-separator)',
          position: 'relative', transition: 'background 0.2s', cursor: 'pointer',
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: val ? 18 : 2, width: 16, height: 16,
          borderRadius: '50%', background: 'white', transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--nm-text)' }}>{label}</span>
    </label>
  )

  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* Config panel */}
      <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Receipt config */}
        <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--nm-text)' }}>🧾 Ticket de Venta</div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Tamaño de letra
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['small', 'medium', 'large'] as const).map(size => (
                <button
                  key={size}
                  onClick={() => setFontSize(size)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 12, fontSize: 12, fontWeight: 800,
                    border: `2px solid ${fontSize === size ? 'var(--nm-accent)' : 'var(--nm-separator)'}`,
                    background: fontSize === size ? 'rgba(255,45,85,0.07)' : 'var(--nm-bg)',
                    color: fontSize === size ? 'var(--nm-accent)' : 'var(--nm-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {size === 'small' ? 'Pequeño' : size === 'medium' ? 'Mediano' : 'Grande'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {toggle(showFolio, setShowFolio, 'Mostrar número de folio')}
            {toggle(showCashier, setShowCashier, 'Mostrar nombre de cajero')}
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nm-text-muted)', padding: '8px 12px', background: 'rgba(255,45,85,0.04)', borderRadius: 8, lineHeight: 1.5 }}>
            El mensaje al pie del ticket se configura en <b>Información de Tienda</b> → "Mensaje en pie de ticket"
          </div>
        </div>

        {/* Label config */}
        <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--nm-text)' }}>🏷️ Etiquetas de Producto</div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Tamaño de letra
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['small', 'medium', 'large'] as const).map(size => (
                <button
                  key={size}
                  onClick={() => setLabelFontSize(size)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 12, fontSize: 12, fontWeight: 800,
                    border: `2px solid ${labelFontSize === size ? 'var(--nm-accent)' : 'var(--nm-separator)'}`,
                    background: labelFontSize === size ? 'rgba(255,45,85,0.07)' : 'var(--nm-bg)',
                    color: labelFontSize === size ? 'var(--nm-accent)' : 'var(--nm-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {size === 'small' ? 'Pequeño' : size === 'medium' ? 'Mediano' : 'Grande'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {toggle(labelShowPrice, setLabelShowPrice, 'Mostrar precio')}
            {toggle(labelShowBarcode, setLabelShowBarcode, 'Mostrar código de barras')}
          </div>
        </div>

        <button onClick={handleSave} className="nm-btn-accent" style={{ padding: '14px', fontSize: 14, fontWeight: 800 }}>
          Guardar Configuración
        </button>
      </div>

      {/* Previews */}
      <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Receipt preview */}
        <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            Vista previa — Ticket
          </div>
          <div style={{
            background: '#fff', borderRadius: 8, padding: '12px 10px', maxWidth: 200, margin: '0 auto',
            fontFamily: "'Courier New', monospace", color: '#000',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
            fontSize: previewBase, fontWeight: 700, lineHeight: 1.4,
          }}>
            <div style={{ fontSize: previewBase + 2, fontWeight: 900, textAlign: 'center', marginBottom: 2 }}>{storeName}</div>
            <div style={{ fontSize: previewBase - 1, textAlign: 'center', color: '#555' }}>{storeAddress}</div>
            <div style={{ borderTop: '1px solid #000', margin: '4px 0' }} />
            <div>Fecha: 13/04/2026</div>
            {showFolio && <div>Folio: <b>VTA-0042</b></div>}
            {showCashier && <div>Cajero: Admin</div>}
            <div style={{ borderTop: '1px solid #000', margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Coca-Cola 600ml</span><span></span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 4 }}>
              <span style={{ color: '#555' }}>2x$18.00</span><span>$36.00</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sabritas 45g</span><span></span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 4 }}>
              <span style={{ color: '#555' }}>1x$16.00</span><span>$16.00</span>
            </div>
            <div style={{ borderTop: '1px solid #000', margin: '4px 0' }} />
            <div style={{ fontSize: previewBase + 2, fontWeight: 900, display: 'flex', justifyContent: 'space-between' }}>
              <span>TOTAL</span><span>$52.00</span>
            </div>
            <div style={{ borderTop: '1px solid #000', margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Efectivo</span><span>$100.00</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, color: '#1a7a3a' }}><span>CAMBIO</span><span>$48.00</span></div>
            <div style={{ borderTop: '1px solid #000', margin: '4px 0' }} />
            <div style={{ textAlign: 'center', fontSize: previewBase - 1 }}>{footer}</div>
          </div>
        </div>

        {/* Label preview */}
        <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            Vista previa — Etiqueta (50×32mm)
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{
              background: '#fff', borderRadius: 4, border: '1px solid #ccc',
              width: 160, height: 102,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'space-between', padding: '5px 8px',
              overflow: 'hidden',
            }}>
              {/* 1. Name — top, matches ZPL */}
              <div style={{ fontSize: labelBase + 1, fontWeight: 900, textAlign: 'center', color: '#000', width: '100%', lineHeight: 1.2, overflow: 'hidden' }}>
                Coca-Cola 600ml
              </div>
              {/* 2. Barcode — center */}
              {labelShowBarcode && (
                <div style={{ display: 'flex', gap: '1px', alignItems: 'flex-end', justifyContent: 'center', flex: 1, padding: '2px 0' }}>
                  {[2,1,1,2,1,2,1,1,2,1,1,2,1,2,2,1,1,2,1,1,2,1,2,1,2,1,1,2,1,1,2,2,1,2,1,1,2].map((w, i) => (
                    <div key={i} style={{ width: w, height: 28, background: '#000', flexShrink: 0 }} />
                  ))}
                </div>
              )}
              {/* 3. Code number */}
              <div style={{ fontSize: labelBase - 1, fontFamily: 'monospace', fontWeight: 700, color: '#000', textAlign: 'center' }}>
                7501055365082
              </div>
              {/* 4. Price — matches ZPL */}
              {labelShowPrice && (
                <div style={{ fontSize: labelBase + 2, fontWeight: 900, color: '#000', textAlign: 'center' }}>
                  $18.00
                </div>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--nm-text-muted)', fontWeight: 600, marginTop: 8 }}>
            50mm × 32mm · ZPL · 203 DPI
          </div>
        </div>
      </div>
    </div>
  )
}

function BackupsTab({ showMsg }: any) {
  const [backups, setBackups] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)

  useEffect(() => { loadBackups() }, [])
  const loadBackups = async () => setBackups(await window.api.getBackups())

  const handleBackup = async () => {
    setLoading(true)
    const res = await window.api.createBackup()
    setLoading(false)
    if (res.success) { showMsg(`Respaldo creado: ${res.filename}`); loadBackups() }
    else showMsg(`Error: ${res.message}`, 'err')
  }

  const handleExport = async (filename: string) => {
    const res = await (window.api as any).exportBackup(filename)
    if (res.success) showMsg(`Exportado a: ${res.path}`)
    else if (res.message !== 'Cancelado') showMsg(`Error: ${res.message}`, 'err')
  }

  const handleImport = async () => {
    const res = await (window.api as any).importBackup()
    if (res.success) { showMsg(`Respaldo importado: ${res.filename}`); loadBackups() }
    else if (res.message !== 'Cancelado') showMsg(`Error: ${res.message}`, 'err')
  }

  const handleRestore = async (filename: string) => {
    setConfirmRestore(null)
    const res = await (window.api as any).restoreBackup(filename)
    if (res.success) showMsg('Respaldo restaurado. Reinicie la aplicación para aplicar los cambios.')
    else showMsg(`Error: ${res.message}`, 'err')
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatName = (name: string) => {
    const m = name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/)
    if (!m) return name
    return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`
  }

  return (
    <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Info banner */}
      <div style={{ background: 'var(--nm-bg)', borderRadius: 16, boxShadow: 'var(--nm-inset)', padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 22 }}>🛡️</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--nm-text)', marginBottom: 4 }}>Tus datos están protegidos</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--nm-text-muted)', lineHeight: 1.5 }}>
            La base de datos se guarda en una carpeta del sistema que <b>no se borra</b> al reinstalar o actualizar la aplicación. Los respaldos son copias adicionales de seguridad.
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--nm-text)', marginBottom: 4 }}>Respaldos de Base de Datos</div>
        <button
          onClick={handleBackup}
          disabled={loading}
          className="nm-btn-accent"
          style={{ padding: '12px', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          💾 {loading ? 'Creando...' : 'Crear Respaldo Ahora'}
        </button>
        <button
          onClick={handleImport}
          className="nm-btn"
          style={{ padding: '10px', fontSize: 13, fontWeight: 700, color: 'var(--nm-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          📂 Importar Respaldo desde Archivo
        </button>
      </div>

      {/* List */}
      <div style={{ background: 'var(--nm-bg)', borderRadius: 18, boxShadow: 'var(--nm-raised)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--nm-shadow-dark)', fontSize: 11, fontWeight: 900, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--nm-text-muted)' }}>
          Respaldos disponibles ({backups.length})
        </div>
        {backups.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: 'var(--nm-text-light)', fontWeight: 600 }}>
            Sin respaldos — crea uno arriba
          </div>
        )}
        {backups.map((b, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '10px 18px', borderBottom: i < backups.length - 1 ? '1px solid var(--nm-shadow-dark)' : 'none', gap: 12 }}>
            <span style={{ fontSize: 20 }}>💾</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--nm-text)' }}>{formatName(b.name)}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nm-text-muted)' }}>{formatSize(b.size)}</div>
            </div>
            <button
              onClick={() => handleExport(b.name)}
              className="nm-btn"
              style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700 }}
              title="Exportar a carpeta"
            >
              Exportar
            </button>
            <button
              onClick={() => setConfirmRestore(b.name)}
              className="nm-btn"
              style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, color: 'var(--nm-warning)' }}
              title="Restaurar este respaldo"
            >
              Restaurar
            </button>
          </div>
        ))}
      </div>

      {/* Restore confirmation modal */}
      {confirmRestore && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--nm-bg)', borderRadius: 20, boxShadow: 'var(--nm-raised-lg)', padding: '32px 28px', maxWidth: 380, width: '90%', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--nm-text)', marginBottom: 8 }}>¿Restaurar este respaldo?</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--nm-text-muted)', marginBottom: 6 }}>{formatName(confirmRestore)}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--nm-danger)', marginBottom: 24, lineHeight: 1.5 }}>
              Los datos actuales serán reemplazados. Se creará un respaldo automático de seguridad antes de restaurar.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmRestore(null)} className="nm-btn" style={{ flex: 1, padding: '11px', fontSize: 13 }}>Cancelar</button>
              <button onClick={() => handleRestore(confirmRestore)} className="nm-btn-danger" style={{ flex: 1, padding: '11px', fontSize: 13 }}>Restaurar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
