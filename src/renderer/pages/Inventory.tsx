import { useState, useEffect, useRef, useCallback } from 'react'
import type { Product, Category, InventoryMovement } from '../types'
import { useAuthStore } from '../store/useAuthStore'
import PageShell from '../components/PageShell'

const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

type Tab = 'ajustes' | 'bajos' | 'reporte' | 'movimientos'

export default function Inventory() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [tab, setTab] = useState<Tab>('ajustes')
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok')

  const showMsg = (m: string, type: 'ok' | 'err' = 'ok') => {
    setMsg(m); setMsgType(type)
    setTimeout(() => setMsg(''), 3000)
  }

  const allTabs = [
    { id: 'ajustes' as Tab, label: 'Ajustes de Inventario' },
    { id: 'bajos' as Tab, label: 'Productos Bajos' },
    { id: 'reporte' as Tab, label: 'Reporte de Inventario' },
    { id: 'movimientos' as Tab, label: 'Movimientos' },
  ]
  const tabs = isAdmin ? allTabs : allTabs.filter(t => t.id === 'ajustes')

  return (
    <PageShell
      title="Inventario"
      tabs={tabs}
      activeTab={tab}
      onTabChange={id => setTab(id as Tab)}
      message={msg}
      messageType={msgType}
    >
      {tab === 'ajustes' && <AdjustTab showMsg={showMsg} />}
      {tab === 'bajos' && <LowStockTab />}
      {tab === 'reporte' && <InventoryReport />}
      {tab === 'movimientos' && <MovementsTab />}
    </PageShell>
  )
}

function AdjustTab({ showMsg }: any) {
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [selected, setSelected] = useState<Product | null>(null)
  const [mode, setMode] = useState<'set' | 'delta'>('set')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [newCost, setNewCost] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const selectProduct = useCallback((p: Product, currentMode = mode) => {
    setSelected(p)
    setQuantity(currentMode === 'set' ? String(p.stock) : '0')
    setNewCost(String(p.cost))
    setNewPrice(String(p.price))
    setSearch('')
    setResults([])
  }, [mode])

  useEffect(() => {
    if (!search.trim()) { setResults([]); return }
    const timer = setTimeout(async () => {
      const byCode = await window.api.getProductByCode(search.trim())
      if (byCode) { selectProduct(byCode); return }
      const res = await window.api.getProducts(search.trim())
      setResults(res)
      if (res.length === 1) selectProduct(res[0])
    }, 250)
    return () => clearTimeout(timer)
  }, [search, selectProduct])

  const handleSearch = useCallback(async (q = search) => {
    if (!q.trim()) return
    const byCode = await window.api.getProductByCode(q.trim())
    if (byCode) { selectProduct(byCode); return }
    const res = await window.api.getProducts(q.trim())
    setResults(res)
    if (res.length === 1) { selectProduct(res[0]); return }
  }, [search, selectProduct])

  const previewQty = () => {
    const q = parseFloat(quantity) || 0
    if (mode === 'set') return q
    return (selected?.stock || 0) + q
  }

  const handleSave = async () => {
    if (!selected || !notes.trim()) { showMsg('El concepto es requerido', 'err'); return }
    const q = parseFloat(quantity)
    if (isNaN(q)) { showMsg('Cantidad inválida', 'err'); return }
    const res = await window.api.adjustInventory({
      product_id: selected.id,
      mode,
      quantity: q,
      notes,
      cashier_id: user?.id,
      new_cost: newCost ? parseFloat(newCost) : null,
      new_price: newPrice ? parseFloat(newPrice) : null,
    })
    if (res.success) {
      showMsg('Inventario actualizado')
      setSelected(null); setQuantity(''); setNotes(''); setSearch('')
      setTimeout(() => searchRef.current?.focus(), 50)
    } else {
      showMsg(res.message || 'Error', 'err')
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", padding: 16 }}>
        <h2 className="font-bold text-gray-900 mb-3">Buscar Producto</h2>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              ref={searchRef}
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Escanear código o escribir nombre..."
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute left-2.5 top-2 text-gray-400 text-base pointer-events-none">📷</span>
          </div>
          <button onClick={() => handleSearch()} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Buscar</button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">Escanea el código de barras o escribe el nombre y presiona Enter</p>
        {results.length > 0 && (
          <div className="mt-3 border rounded-lg overflow-hidden">
            {results.slice(0, 10).map(p => (
              <div key={p.id} onClick={() => selectProduct(p)} className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b last:border-0 flex justify-between">
                <div>
                  <span className="font-medium text-sm">{p.name}</span>
                  <span className="text-xs text-gray-400 font-mono ml-2">{p.code}</span>
                </div>
                <span className={`text-sm font-bold ${p.stock <= p.min_stock ? 'text-red-600' : 'text-green-700'}`}>Stock: {p.stock}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-bold text-gray-900">{selected.name}</h3>
              <div className="text-sm text-gray-500">{selected.code}</div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-gray-900">{selected.stock}</div>
              <div className="text-xs text-gray-400">stock actual</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => { setMode('set'); setQuantity(String(selected.stock)) }} className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'set' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Establecer cantidad</button>
            <button onClick={() => { setMode('delta'); setQuantity('0') }} className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'delta' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Agregar / Quitar</button>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">
              {mode === 'set' ? 'Nueva cantidad' : 'Cantidad a sumar/restar (negativo para quitar)'}
            </label>
            <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-lg text-right font-bold focus:outline-none focus:ring-2 focus:ring-blue-500" step="1" />
            {mode === 'delta' && (
              <div className="text-sm text-gray-500 mt-1 text-right">
                Resultado: <span className={`font-bold ${previewQty() < 0 ? 'text-red-600' : 'text-green-600'}`}>{previewQty()}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Actualizar costo (opcional)</label>
              <input type="number" value={newCost} onChange={e => setNewCost(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" step="0.01" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Actualizar precio (opcional)</label>
              <input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" step="0.01" />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Concepto / Notas *</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ej: Recepción de mercancía, Merma, Corrección..." />
          </div>

          <div className="flex gap-3">
            <button onClick={() => setSelected(null)} className="flex-1 border rounded-lg py-2 text-sm text-gray-600">Cancelar</button>
            <button onClick={handleSave} className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg text-sm">Guardar Ajuste</button>
          </div>
        </div>
      )}
    </div>
  )
}

function LowStockTab() {
  const [products, setProducts] = useState<any[]>([])

  useEffect(() => {
    window.api.getLowStockProducts().then(setProducts)
  }, [])

  const handleExport = async () => {
    await window.api.exportToExcel({
      filename: 'productos_bajos.xlsx',
      sheetName: 'Stock Bajo',
      columns: [
        { header: 'Código', key: 'code', width: 20 },
        { header: 'Nombre', key: 'name', width: 30 },
        { header: 'Categoría', key: 'category_name', width: 20 },
        { header: 'Precio', key: 'price', width: 12 },
        { header: 'Stock Actual', key: 'stock', width: 12 },
        { header: 'Stock Mínimo', key: 'min_stock', width: 12 },
      ],
      rows: products.map(p => [p.code, p.name, p.category_name, p.price, p.stock, p.min_stock]),
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="font-bold text-gray-900">Productos con Stock Bajo ({products.length})</h2>
        {products.length > 0 && (
          <button onClick={handleExport} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Exportar Excel</button>
        )}
      </div>
      <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", overflow: "hidden" }}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['Código', 'Nombre', 'Categoría', 'Precio', 'Stock Actual', 'Stock Mín.', 'Diferencia'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-bold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {products.map(p => (
              <tr key={p.id} className="hover:bg-red-50">
                <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 text-gray-500">{p.category_name}</td>
                <td className="px-3 py-2">{fmt(p.price)}</td>
                <td className="px-3 py-2 font-bold text-red-600">{p.stock}</td>
                <td className="px-3 py-2">{p.min_stock}</td>
                <td className="px-3 py-2 text-red-500 font-medium">{p.stock - p.min_stock}</td>
              </tr>
            ))}
            {products.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin productos bajo mínimo ✓</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InventoryReport() {
  const [rows, setRows] = useState<any[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState('')

  useEffect(() => {
    window.api.getInventoryReport().then(setRows)
    window.api.getCategories().then(setCategories)
  }, [])

  const filteredRows = categoryId
    ? rows.filter(r => String(r.category_id) === categoryId)
    : rows

  const totals = filteredRows.reduce((s, r) => ({ value: s.value + r.total_value, units: s.units + r.stock }), { value: 0, units: 0 })

  const handleExport = async () => {
    const catName = categoryId ? categories.find(c => String(c.id) === categoryId)?.name : null
    await window.api.exportToExcel({
      filename: catName ? `inventario-${catName}.xlsx` : 'inventario.xlsx',
      sheetName: 'Inventario',
      columns: [
        { header: 'Código', key: 'code', width: 20 },
        { header: 'Nombre', key: 'name', width: 30 },
        { header: 'Categoría', key: 'category_name', width: 20 },
        { header: 'Stock', key: 'stock', width: 10 },
        { header: 'Costo', key: 'cost', width: 12 },
        { header: 'Precio', key: 'price', width: 12 },
        { header: 'Valor Total', key: 'total_value', width: 14 },
      ],
      rows: filteredRows.map(r => [r.code, r.name, r.category_name, r.stock, r.cost, r.price, r.total_value]),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-600">Categoría:</label>
        <select
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">Todas las categorías</option>
          {categories.map(c => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="text-2xl font-bold text-blue-800">{fmt(totals.value)}</div>
          <div className="text-sm font-medium text-blue-600 mt-1">Valor total al costo</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="text-2xl font-bold text-green-800">{filteredRows.length}</div>
          <div className="text-sm font-medium text-green-600 mt-1">SKUs activos</div>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
          <div className="text-2xl font-bold text-purple-800">{totals.units.toFixed(0)}</div>
          <div className="text-sm font-medium text-purple-600 mt-1">Total unidades</div>
        </div>
      </div>
      <div className="flex justify-end">
        <button onClick={handleExport} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Exportar Excel</button>
      </div>
      <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", overflow: "hidden" }}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['Código', 'Nombre', 'Categoría', 'Stock', 'Costo', 'Precio', 'Valor Total'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-bold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filteredRows.map(r => (
              <tr key={r.code} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-gray-500">{r.category_name}</td>
                <td className="px-3 py-2 text-center">{r.stock}</td>
                <td className="px-3 py-2">{fmt(r.cost)}</td>
                <td className="px-3 py-2">{fmt(r.price)}</td>
                <td className="px-3 py-2 font-bold text-blue-700">{fmt(r.total_value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t font-bold">
            <tr>
              <td colSpan={3} className="px-3 py-2 text-sm">TOTAL</td>
              <td className="px-3 py-2 text-center">{totals.units.toFixed(0)}</td>
              <td colSpan={2}></td>
              <td className="px-3 py-2 text-blue-700">{fmt(totals.value)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function MovementsTab() {
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [type, setType] = useState('')
  const [rows, setRows] = useState<InventoryMovement[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    let productId = undefined
    if (search) {
      const prods = await window.api.getProducts(search)
      if (prods.length === 1) productId = prods[0].id
    }
    const res = await window.api.getInventoryMovements({ product_id: productId, type: type || undefined, from: from || undefined, to: to || undefined })
    setRows(res)
    setLoading(false)
  }

  const handleExport = async () => {
    await window.api.exportToExcel({
      filename: 'movimientos_inventario.xlsx',
      sheetName: 'Movimientos',
      columns: [
        { header: 'Fecha', key: 'timestamp', width: 20 },
        { header: 'Código', key: 'product_code', width: 20 },
        { header: 'Producto', key: 'product_name', width: 30 },
        { header: 'Tipo', key: 'type', width: 12 },
        { header: 'Antes', key: 'quantity_before', width: 10 },
        { header: 'Cambio', key: 'quantity_change', width: 10 },
        { header: 'Después', key: 'quantity_after', width: 10 },
        { header: 'Usuario', key: 'cashier_name', width: 20 },
        { header: 'Notas', key: 'notes', width: 30 },
      ],
      rows: rows.map(r => [r.timestamp, r.product_code, r.product_name, r.type, r.quantity_before, r.quantity_change, r.quantity_after, r.cashier_name, r.notes]),
    })
  }

  const typeLabel = (t: string) => ({ venta: 'Venta', ajuste: 'Ajuste', recepcion: 'Recepción' }[t] || t)
  const typeColor = (t: string) => ({ venta: 'bg-red-100 text-red-700', ajuste: 'bg-yellow-100 text-yellow-700', recepcion: 'bg-green-100 text-green-700' }[t] || '')

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-3 items-end">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Producto..." className="border rounded-lg px-3 py-2 text-sm focus:outline-none flex-1 min-w-32" />
        <select value={type} onChange={e => setType(e.target.value)} className="border rounded-lg px-3 py-2 text-sm focus:outline-none">
          <option value="">Todos los tipos</option>
          <option value="venta">Venta</option>
          <option value="ajuste">Ajuste</option>
          <option value="recepcion">Recepción</option>
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        <span className="text-gray-400">—</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        <button onClick={load} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Buscar</button>
        {rows.length > 0 && <button onClick={handleExport} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Exportar</button>}
      </div>
      {rows.length > 0 && (
        <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", overflow: "hidden" }}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Fecha', 'Código', 'Producto', 'Categoría', 'Tipo', 'Antes', 'Cambio', 'Después', 'Usuario', 'Notas'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-bold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-500">{r.timestamp?.slice(0, 16)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.product_code}</td>
                  <td className="px-3 py-2 font-medium">{r.product_name}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{r.category_name}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColor(r.type)}`}>{typeLabel(r.type)}</span></td>
                  <td className="px-3 py-2 text-center">{r.quantity_before}</td>
                  <td className={`px-3 py-2 text-center font-bold ${r.quantity_change > 0 ? 'text-green-600' : 'text-red-600'}`}>{r.quantity_change > 0 ? '+' : ''}{r.quantity_change}</td>
                  <td className="px-3 py-2 text-center font-bold">{r.quantity_after}</td>
                  <td className="px-3 py-2 text-xs">{r.cashier_name}</td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 0 && !loading && (
        <div className="text-center text-gray-400 py-16">Ingrese filtros y presione Buscar</div>
      )}
    </div>
  )
}
