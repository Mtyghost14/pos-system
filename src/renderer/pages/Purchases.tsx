import { useState, useEffect } from 'react'
import type { Supplier } from '../types'
import Modal from '../components/Modal'
import PageShell from '../components/PageShell'

const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

type Tab = 'sugerencias' | 'proveedores'

export default function Purchases() {
  const [tab, setTab] = useState<Tab>('sugerencias')
  const [msg, setMsg] = useState('')
  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const tabs = [
    { id: 'sugerencias' as Tab, label: 'Sugerencias de Compra' },
    { id: 'proveedores' as Tab, label: 'Proveedores' },
  ]

  return (
    <PageShell
      title="Compras"
      tabs={tabs}
      activeTab={tab}
      onTabChange={id => setTab(id as Tab)}
      message={msg}
      messageType="ok"
    >
      {tab === 'sugerencias' && <SuggestionsTab />}
      {tab === 'proveedores' && <SuppliersTab showMsg={showMsg} />}
    </PageShell>
  )
}

function SuggestionsTab() {
  const [products, setProducts] = useState<any[]>([])

  useEffect(() => {
    window.api.getLowStockProducts().then(setProducts)
  }, [])

  const suggestions = products.map(p => ({
    ...p,
    suggested_qty: Math.max(0, p.min_stock * 2 - p.stock),
  }))

  const handleExport = async () => {
    await window.api.exportToExcel({
      filename: 'sugerencias_compra.xlsx',
      sheetName: 'Sugerencias',
      columns: [
        { header: 'Código', key: 'code', width: 20 },
        { header: 'Producto', key: 'name', width: 30 },
        { header: 'Categoría', key: 'category_name', width: 20 },
        { header: 'Stock Actual', key: 'stock', width: 12 },
        { header: 'Stock Mínimo', key: 'min_stock', width: 12 },
        { header: 'Sugerido a Pedir', key: 'suggested_qty', width: 15 },
      ],
      rows: suggestions.map(p => [p.code, p.name, p.category_name, p.stock, p.min_stock, p.suggested_qty]),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-bold text-gray-900">Sugerencias de Compra ({suggestions.length} productos)</h2>
        {suggestions.length > 0 && (
          <button onClick={handleExport} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Exportar Excel</button>
        )}
      </div>
      {suggestions.length === 0 && (
        <div className="text-center text-gray-400 py-16 text-4xl">
          ✅
          <div className="text-sm mt-2">Todos los productos tienen stock suficiente</div>
        </div>
      )}
      {suggestions.length > 0 && (
        <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", overflow: "hidden" }}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Código', 'Producto', 'Categoría', 'Stock Actual', 'Stock Mín.', 'Cantidad a Pedir'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-bold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {suggestions.map(p => (
                <tr key={p.id} className="hover:bg-yellow-50">
                  <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2 text-gray-500">{p.category_name}</td>
                  <td className="px-3 py-2 font-bold text-red-600">{p.stock}</td>
                  <td className="px-3 py-2 text-gray-600">{p.min_stock}</td>
                  <td className="px-3 py-2 font-bold text-blue-700 text-lg">{p.suggested_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SuppliersTab({ showMsg }: any) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [viewSupplier, setViewSupplier] = useState<Supplier | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null)
  const emptyForm = { name: '', contact_name: '', phone: '', email: '', address: '', products_supplied: '', notes: '' }
  const [form, setForm] = useState(emptyForm)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => { load() }, [])
  const load = async () => setSuppliers(await window.api.getSuppliers())

  const handleSave = async () => {
    if (!form.name) return
    if (editing) {
      await window.api.updateSupplier({ ...form, id: editing.id })
    } else {
      await window.api.createSupplier(form)
    }
    showMsg(editing ? 'Proveedor actualizado' : 'Proveedor creado')
    setShowAdd(false); setEditing(null); setForm(emptyForm); load()
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    await window.api.deleteSupplier(deleteTarget.id)
    showMsg('Proveedor eliminado'); setDeleteTarget(null); load()
  }

  const openEdit = (s: Supplier) => {
    setEditing(s)
    setForm({ name: s.name, contact_name: s.contact_name || '', phone: s.phone || '', email: s.email || '', address: s.address || '', products_supplied: s.products_supplied || '', notes: s.notes || '' })
    setShowAdd(true)
  }

  const SupplierForm = () => (
    <div className="space-y-3">
      <div><label className="text-sm font-medium text-gray-700">Nombre *</label>
        <input value={form.name} onChange={e => set('name', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm font-medium text-gray-700">Contacto</label>
          <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" /></div>
        <div><label className="text-sm font-medium text-gray-700">Teléfono</label>
          <input value={form.phone} onChange={e => set('phone', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" /></div>
      </div>
      <div><label className="text-sm font-medium text-gray-700">Email</label>
        <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" /></div>
      <div><label className="text-sm font-medium text-gray-700">Dirección</label>
        <input value={form.address} onChange={e => set('address', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" /></div>
      <div><label className="text-sm font-medium text-gray-700">Productos que suministra</label>
        <textarea value={form.products_supplied} onChange={e => set('products_supplied', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" rows={2} /></div>
      <div><label className="text-sm font-medium text-gray-700">Notas</label>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" rows={2} /></div>
      <div className="flex gap-3 pt-2">
        <button onClick={() => { setShowAdd(false); setEditing(null); setForm(emptyForm) }} className="flex-1 border rounded-lg py-2 text-sm text-gray-600">Cancelar</button>
        <button onClick={handleSave} className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg text-sm">Guardar</button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-bold text-gray-900">Proveedores ({suppliers.length})</h2>
        <button onClick={() => { setEditing(null); setForm(emptyForm); setShowAdd(true) }} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">+ Nuevo Proveedor</button>
      </div>
      <div className="grid gap-3">
        {suppliers.map(s => (
          <div key={s.id} className="bg-white rounded-xl shadow p-4 flex items-start gap-4">
            <div className="text-3xl">🏭</div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-gray-900">{s.name}</div>
              {s.contact_name && <div className="text-sm text-gray-500">👤 {s.contact_name}</div>}
              <div className="flex gap-4 mt-1 text-sm text-gray-500">
                {s.phone && <span>📞 {s.phone}</span>}
                {s.email && <span>✉️ {s.email}</span>}
              </div>
              {s.products_supplied && (
                <div className="text-xs text-gray-400 mt-1 truncate">Productos: {s.products_supplied}</div>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setViewSupplier(s)} className="text-blue-500 text-sm hover:text-blue-700">Ver</button>
              <button onClick={() => openEdit(s)} className="text-blue-500 text-sm hover:text-blue-700">Editar</button>
              <button onClick={() => setDeleteTarget(s)} className="text-red-500 text-sm hover:text-red-700">Eliminar</button>
            </div>
          </div>
        ))}
        {suppliers.length === 0 && (
          <div className="text-center text-gray-400 py-16">Sin proveedores registrados</div>
        )}
      </div>

      {showAdd && (
        <Modal title={editing ? 'Editar Proveedor' : 'Nuevo Proveedor'} onClose={() => { setShowAdd(false); setEditing(null) }}>
          <SupplierForm />
        </Modal>
      )}

      {viewSupplier && (
        <Modal title={viewSupplier.name} onClose={() => setViewSupplier(null)} size="sm">
          <div className="space-y-2 text-sm">
            {viewSupplier.contact_name && <div><span className="font-medium">Contacto:</span> {viewSupplier.contact_name}</div>}
            {viewSupplier.phone && <div><span className="font-medium">Teléfono:</span> {viewSupplier.phone}</div>}
            {viewSupplier.email && <div><span className="font-medium">Email:</span> {viewSupplier.email}</div>}
            {viewSupplier.address && <div><span className="font-medium">Dirección:</span> {viewSupplier.address}</div>}
            {viewSupplier.products_supplied && <div><span className="font-medium">Productos:</span> {viewSupplier.products_supplied}</div>}
            {viewSupplier.notes && <div><span className="font-medium">Notas:</span> {viewSupplier.notes}</div>}
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Eliminar Proveedor" onClose={() => setDeleteTarget(null)} size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-700">¿Eliminar proveedor "{deleteTarget.name}"?</p>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 border rounded-lg py-2 text-sm text-gray-600">Cancelar</button>
              <button onClick={confirmDelete} className="flex-1 bg-red-600 text-white font-bold py-2 rounded-lg text-sm">Eliminar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
