import { useState, useEffect, useRef, useCallback } from 'react'
import JsBarcode from 'jsbarcode'
import type { Product, Category, Promotion } from '../types'
import Modal from '../components/Modal'
import PageShell from '../components/PageShell'
import { useAuthStore } from '../store/useAuthStore'
import { useSettingsStore } from '../store/useSettingsStore'

const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
const today = () => new Date().toISOString().slice(0, 10)

type Tab = 'catalogo' | 'agregar' | 'modificar' | 'eliminar' | 'categorias' | 'ventas' | 'promociones' | 'importar' | 'exportar' | 'etiquetas'

const CASHIER_TABS: Tab[] = ['agregar', 'categorias', 'etiquetas']

export default function Products() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [tab, setTab] = useState<Tab>(isAdmin ? 'catalogo' : 'agregar')
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok')

  useEffect(() => { loadCategories(); loadProducts() }, [])

  const showMsg = (m: string, type: 'ok' | 'err' = 'ok') => {
    setMsg(m); setMsgType(type)
    setTimeout(() => setMsg(''), 3000)
  }

  const loadProducts = async (q?: string) => {
    setLoading(true)
    const res = await window.api.getProducts(q)
    setProducts(res)
    setLoading(false)
  }

  const loadCategories = async () => {
    const res = await window.api.getCategories()
    setCategories(res)
  }

  const allTabs: { id: Tab; label: string }[] = [
    { id: 'catalogo', label: 'Catálogo' },
    { id: 'agregar', label: 'Agregar Producto' },
    { id: 'modificar', label: 'Modificar' },
    { id: 'eliminar', label: 'Eliminar' },
    { id: 'categorias', label: 'Departamentos' },
    { id: 'ventas', label: 'Ventas por Período' },
    { id: 'promociones', label: 'Promociones' },
    { id: 'importar', label: 'Importar' },
    { id: 'exportar', label: 'Exportar' },
    { id: 'etiquetas', label: 'Etiquetas' },
  ]
  const tabs = isAdmin ? allTabs : allTabs.filter(t => CASHIER_TABS.includes(t.id))

  return (
    <PageShell
      title="Productos"
      tabs={tabs}
      activeTab={tab}
      onTabChange={id => setTab(id as Tab)}
      message={msg}
      messageType={msgType}
    >
      {tab === 'catalogo' && <CatalogTab products={products} categories={categories} loadProducts={loadProducts} loading={loading} />}
      {tab === 'agregar' && <AddProductTab categories={categories} reload={loadProducts} showMsg={showMsg} userId={user?.id} />}
      {tab === 'modificar' && <ModifyProductTab categories={categories} showMsg={showMsg} />}
      {tab === 'eliminar' && <DeleteProductTab showMsg={showMsg} reload={loadProducts} />}
      {tab === 'categorias' && <CategoriesTab categories={categories} reload={loadCategories} showMsg={showMsg} />}
      {tab === 'ventas' && <SalesByPeriodTab />}
      {tab === 'promociones' && <PromotionsTab products={products} />}
      {tab === 'importar' && <ImportTab reload={loadProducts} showMsg={showMsg} categories={categories} />}
      {tab === 'exportar' && <ExportTab products={products} />}
      {tab === 'etiquetas' && <LabelsTab products={products} />}
    </PageShell>
  )
}

// ─── CATALOG TAB ─────────────────────────────────────────────────────────────
function CatalogTab({ products, categories, loadProducts, loading }: any) {
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  const filtered = products
    .filter((p: Product) => {
      if (catFilter && String(p.category_id) !== catFilter) return false
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.code.includes(search)) return false
      return true
    })
    .sort((a: any, b: any) => {
      const av = a[sortKey]; const bv = b[sortKey]
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : (av || 0) - (bv || 0)
      return sortDir === 'asc' ? cmp : -cmp
    })

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const sortable = (key: string, label: string) => (
    <th
      className="px-3 py-2 text-left text-xs font-bold text-gray-500 cursor-pointer hover:text-gray-800 select-none"
      onClick={() => { if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('asc') } }}
    >
      {label} {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  )

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} placeholder="Buscar..." className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1" />
        <select value={catFilter} onChange={e => { setCatFilter(e.target.value); setPage(0) }} className="border rounded-lg px-3 py-2 text-sm focus:outline-none">
          <option value="">Todas las categorías</option>
          {categories.map((c: Category) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-sm text-gray-400 self-center">{filtered.length} productos</span>
      </div>
      <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", overflow: "hidden" }}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {sortable('code', 'Código')}
              {sortable('name', 'Nombre')}
              {sortable('category_name', 'Categoría')}
              {sortable('cost', 'Costo')}
              {sortable('price', 'Precio')}
              {sortable('stock', 'Stock')}
              {sortable('min_stock', 'Stock Mín.')}
              <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && <tr><td colSpan={8} className="text-center py-8 text-gray-400">Cargando...</td></tr>}
            {!loading && paged.map((p: Product) => (
              <tr key={p.id} className="hover:bg-blue-50">
                <td className="px-3 py-2 font-mono text-xs text-gray-500">{p.code}</td>
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 text-gray-500">{p.category_name || '—'}</td>
                <td className="px-3 py-2">{fmt(p.cost)}</td>
                <td className="px-3 py-2 font-bold text-blue-700">{fmt(p.price)}</td>
                <td className={`px-3 py-2 font-bold ${p.stock <= p.min_stock ? 'text-red-600' : 'text-green-700'}`}>{p.stock}</td>
                <td className="px-3 py-2 text-gray-500">{p.min_stock}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${p.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {p.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex gap-2 justify-center">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 border rounded text-sm disabled:opacity-40">←</button>
          <span className="text-sm text-gray-600">{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 border rounded text-sm disabled:opacity-40">→</button>
        </div>
      )}
    </div>
  )
}

// ─── ADD PRODUCT TAB ─────────────────────────────────────────────────────────
function AddProductTab({ categories, reload, showMsg, userId }: any) {
  const [form, setForm] = useState({ code: '', name: '', category_id: '', cost: '', price: '', stock: '', min_stock: '' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code || !form.name || !form.price) { showMsg('Código, nombre y precio son requeridos', 'err'); return }
    const res = await window.api.createProduct({
      code: form.code,
      name: form.name,
      category_id: form.category_id ? parseInt(form.category_id) : null,
      cost: parseFloat(form.cost) || 0,
      price: parseFloat(form.price),
      stock: parseFloat(form.stock) || 0,
      min_stock: parseFloat(form.min_stock) || 0,
      cashier_id: userId,
    })
    if (res.success) {
      showMsg('Producto creado correctamente')
      setForm({ code: '', name: '', category_id: '', cost: '', price: '', stock: '', min_stock: '' })
      reload()
    } else {
      showMsg(res.message, 'err')
    }
  }

  return (
    <div className="max-w-lg">
      <div style={{ background: "var(--nm-bg)", borderRadius: 18, boxShadow: "var(--nm-raised)", padding: 24 }}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Agregar Producto</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Código de barras *</label>
            <div className="relative mt-1">
              <input autoFocus value={form.code} onChange={e => set('code', e.target.value)} className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" placeholder="Escanear o escribir código" />
              <span className="absolute left-2.5 top-2 text-gray-400 text-base pointer-events-none">📷</span>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Nombre *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Nombre del producto" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Categoría</label>
            <select value={form.category_id} onChange={e => set('category_id', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">Sin categoría</option>
              {categories.map((c: Category) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Costo</label>
              <input type="number" value={form.cost} onChange={e => set('cost', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.00" step="0.01" min="0" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Precio de venta *</label>
              <input type="number" value={form.price} onChange={e => set('price', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.00" step="0.01" min="0" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Stock inicial</label>
              <input type="number" value={form.stock} onChange={e => set('stock', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="0" step="1" min="0" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Stock mínimo</label>
              <input type="number" value={form.min_stock} onChange={e => set('min_stock', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="0" step="1" min="0" />
            </div>
          </div>
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg mt-2">
            Guardar Producto
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── MODIFY PRODUCT TAB ──────────────────────────────────────────────────────
type PendingBarcode = { code: string; label: string; _key: number }

function ModifyProductTab({ categories, showMsg }: any) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [selected, setSelected] = useState<Product | null>(null)
  const [form, setForm] = useState({ code: '', name: '', category_id: '', cost: '', price: '', min_stock: '' })

  // Saved barcodes (in DB)
  const [barcodes, setBarcodes] = useState<any[]>([])

  // Pending barcodes (not yet saved to DB)
  const [pending, setPending] = useState<PendingBarcode[]>([])
  const [newBarcode, setNewBarcode] = useState('')
  const [newBarcodeLabel, setNewBarcodeLabel] = useState('')
  const [showBarcodeInput, setShowBarcodeInput] = useState(false)
  const [savingBarcodes, setSavingBarcodes] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const newBarcodeRef = useRef<HTMLInputElement>(null)
  const pendingKeyRef = useRef(0)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const loadBarcodes = async (productId: number) => {
    const res = await window.api.getProductBarcodes(productId)
    setBarcodes(res)
  }

  const resetBarcodeInput = () => {
    setNewBarcode('')
    setNewBarcodeLabel('')
  }

  const selectProduct = useCallback((p: Product) => {
    setSelected(p)
    setForm({ code: p.code, name: p.name, category_id: String(p.category_id || ''), cost: String(p.cost), price: String(p.price), min_stock: String(p.min_stock) })
    setSearch('')
    setResults([])
    setPending([])
    resetBarcodeInput()
    setShowBarcodeInput(false)
    loadBarcodes(p.id)
  }, [])

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

  const handleSave = async () => {
    if (!selected || !form.code.trim()) return
    const res = await window.api.updateProduct({
      id: selected.id,
      code: form.code.trim(),
      name: form.name,
      category_id: form.category_id ? parseInt(form.category_id) : null,
      cost: parseFloat(form.cost) || 0,
      price: parseFloat(form.price),
      min_stock: parseFloat(form.min_stock) || 0,
    })
    if (res.success) {
      showMsg('Producto actualizado')
      setSelected(null); setBarcodes([]); setPending([]); setResults([])
      setTimeout(() => searchRef.current?.focus(), 50)
    } else showMsg(res.message || 'Error al actualizar', 'err')
  }

  // Add code to the pending queue (no DB call yet)
  const handleQueueBarcode = () => {
    const code = newBarcode.trim()
    if (!code) return
    // Prevent duplicates within pending list
    if (pending.some(p => p.code === code)) {
      showMsg('Ese código ya está en la lista pendiente', 'err')
      return
    }
    // Prevent duplicates against saved barcodes and main code
    if (barcodes.some((b: any) => b.code === code) || code === form.code) {
      showMsg('Ese código ya existe en este producto', 'err')
      return
    }
    setPending(prev => [...prev, { code, label: newBarcodeLabel.trim(), _key: pendingKeyRef.current++ }])
    resetBarcodeInput()
    // Keep focus on input so user can scan/type the next one immediately
    setTimeout(() => newBarcodeRef.current?.focus(), 30)
  }

  // Save the entire pending queue to DB
  const handleSavePending = async () => {
    if (!selected || pending.length === 0) return
    setSavingBarcodes(true)
    let errors = 0
    for (const p of pending) {
      const res = await window.api.addProductBarcode({
        product_id: selected.id,
        code: p.code,
        label: p.label || undefined,
      })
      if (!res.success) errors++
    }
    await loadBarcodes(selected.id)
    setPending([])
    setSavingBarcodes(false)
    if (errors === 0) showMsg(`${pending.length === 1 ? '1 código guardado' : `${pending.length} códigos guardados`}`)
    else showMsg(`${errors} código(s) con error (posibles duplicados)`, 'err')
  }

  const handleDeleteBarcode = async (id: number) => {
    await window.api.deleteProductBarcode(id)
    if (selected) loadBarcodes(selected.id)
  }

  const removePending = (key: number) => {
    setPending(prev => prev.filter(p => p._key !== key))
  }

  return (
    <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Search */}
      <div style={{ background: 'var(--nm-surface)', borderRadius: 16, boxShadow: 'var(--nm-raised)', padding: 16 }}>
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
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
            <span className="absolute left-2.5 top-2 text-gray-400 text-base pointer-events-none">📷</span>
          </div>
          <button onClick={() => handleSearch()} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Buscar</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--nm-text-light)', marginTop: 6, fontWeight: 500 }}>
          Escanea el código principal o cualquier código adicional del producto
        </p>
        {results.length > 0 && (
          <div style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--nm-raised-sm)' }}>
            {results.slice(0, 10).map(p => (
              <div key={p.id} onClick={() => selectProduct(p)}
                style={{ padding: '9px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--nm-surface)', borderBottom: '1px solid var(--nm-separator)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,45,85,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--nm-surface)')}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--nm-text)' }}>{p.name}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--nm-text-muted)', fontFamily: 'monospace' }}>{p.code}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <>
          {/* Product fields */}
          <div style={{ background: 'var(--nm-surface)', borderRadius: 16, boxShadow: 'var(--nm-raised)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 className="font-bold text-gray-900">Editando: {selected.name}</h3>

            <div>
              <label className="text-sm font-medium text-gray-700">Código principal</label>
              <div style={{ position: 'relative', marginTop: 4 }}>
                <input
                  value={form.code}
                  onChange={e => set('code', e.target.value)}
                  className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 font-mono"
                  placeholder="Código de barras"
                />
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, pointerEvents: 'none', opacity: 0.45 }}>📷</span>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Nombre</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Categoría</label>
              <select value={form.category_id} onChange={e => set('category_id', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">Sin categoría</option>
                {categories.map((c: Category) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Costo</label>
                <input type="number" value={form.cost} onChange={e => set('cost', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" step="0.01" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Precio</label>
                <input type="number" value={form.price} onChange={e => set('price', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" step="0.01" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Stock Mín.</label>
                <input type="number" value={form.min_stock} onChange={e => set('min_stock', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" step="1" />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setSelected(null); setBarcodes([]); setPending([]); setTimeout(() => searchRef.current?.focus(), 50) }}
                className="flex-1 border rounded-lg py-2 text-sm text-gray-600"
              >Cancelar</button>
              <button onClick={handleSave} className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg text-sm">Guardar Cambios</button>
            </div>
          </div>

          {/* Extra barcodes */}
          <div style={{ background: 'var(--nm-surface)', borderRadius: 16, boxShadow: 'var(--nm-raised)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--nm-text)', letterSpacing: '-0.01em' }}>Códigos adicionales</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--nm-text-muted)', marginTop: 2 }}>
                  Agrega varios a la vez — todos apuntan a este producto
                </div>
              </div>
              {!showBarcodeInput && (
                <button
                  onClick={() => { setShowBarcodeInput(true); setTimeout(() => newBarcodeRef.current?.focus(), 50) }}
                  className="nm-btn-accent"
                  style={{ padding: '7px 14px', fontSize: 12 }}
                >
                  + Agregar códigos
                </button>
              )}
            </div>

            {/* Input area — stays open until user explicitly closes it */}
            {showBarcodeInput && (
              <div style={{
                background: 'var(--nm-bg)', borderRadius: 12,
                border: '1.5px solid rgba(255,45,85,0.2)',
                padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--nm-accent)', letterSpacing: '0.03em' }}>
                  Escanea o escribe un código → Enter para agregar a la lista
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ position: 'relative', flex: 2 }}>
                    <input
                      ref={newBarcodeRef}
                      value={newBarcode}
                      onChange={e => setNewBarcode(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleQueueBarcode() }}
                      placeholder="Escanear o escribir código..."
                      className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pink-400"
                    />
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, pointerEvents: 'none', opacity: 0.45 }}>📷</span>
                  </div>
                  <input
                    value={newBarcodeLabel}
                    onChange={e => setNewBarcodeLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleQueueBarcode() }}
                    placeholder="Etiqueta (ej: Diseño Rojo)"
                    className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
                  />
                  <button
                    onClick={handleQueueBarcode}
                    disabled={!newBarcode.trim()}
                    className="nm-btn-accent"
                    style={{ padding: '0 14px', fontSize: 18, fontWeight: 900, opacity: !newBarcode.trim() ? 0.4 : 1 }}
                    title="Agregar a lista (Enter)"
                  >+</button>
                </div>

                {/* Pending queue */}
                {pending.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Por guardar ({pending.length})
                    </div>
                    {pending.map(p => (
                      <div key={p._key} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: 'rgba(255,45,85,0.05)', borderRadius: 8, padding: '7px 10px',
                        border: '1px solid rgba(255,45,85,0.15)',
                      }}>
                        <span style={{ fontSize: 12, opacity: 0.5 }}>📷</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--nm-text)', flex: 1 }}>{p.code}</span>
                        {p.label && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, color: 'var(--nm-accent)',
                            background: 'rgba(255,45,85,0.1)', padding: '2px 7px', borderRadius: 5,
                          }}>{p.label}</span>
                        )}
                        <button
                          onClick={() => removePending(p._key)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--nm-text-light)', fontWeight: 900, padding: '1px 4px' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--nm-danger)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--nm-text-light)')}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => { setShowBarcodeInput(false); setPending([]); resetBarcodeInput() }}
                    className="nm-btn"
                    style={{ flex: 1, padding: '8px', fontSize: 12, color: 'var(--nm-text-muted)' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSavePending}
                    disabled={pending.length === 0 || savingBarcodes}
                    className="nm-btn-accent"
                    style={{ flex: 2, padding: '8px', fontSize: 13, fontWeight: 800, opacity: pending.length === 0 ? 0.4 : 1 }}
                  >
                    {savingBarcodes ? 'Guardando...' : `Guardar ${pending.length} código${pending.length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            )}

            {/* Saved barcode list */}
            {barcodes.length === 0 && !showBarcodeInput && (
              <div style={{ textAlign: 'center', padding: '16px', fontSize: 12, fontWeight: 500, color: 'var(--nm-text-light)' }}>
                Sin códigos adicionales — solo se usa el código principal
              </div>
            )}
            {barcodes.map((b: any) => (
              <div key={b.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--nm-bg)', borderRadius: 10,
                border: '1px solid var(--nm-separator)',
                padding: '9px 12px',
              }}>
                <span style={{ fontSize: 14, opacity: 0.4 }}>📷</span>
                <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--nm-text)', flex: 1 }}>{b.code}</span>
                {b.label && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--nm-accent)',
                    background: 'rgba(255,45,85,0.08)', padding: '2px 8px', borderRadius: 6,
                  }}>{b.label}</span>
                )}
                <button
                  onClick={() => handleDeleteBarcode(b.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--nm-text-light)', fontWeight: 900, transition: 'color 0.15s', padding: '2px 4px' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--nm-danger)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--nm-text-light)')}
                  title="Eliminar código"
                >✕</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── DELETE PRODUCT TAB ──────────────────────────────────────────────────────
function DeleteProductTab({ showMsg, reload }: any) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [confirm, setConfirm] = useState<Product | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!search.trim()) { setResults([]); return }
    const timer = setTimeout(async () => {
      const res = await window.api.getProducts(search.trim())
      setResults(res)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])

  const handleDelete = async () => {
    if (!confirm) return
    const res = await window.api.deleteProduct(confirm.id)
    if (res.success) {
      showMsg('Producto eliminado')
      setConfirm(null)
      reload()
      // Refresh results without clearing search
      if (search.trim()) {
        const updated = await window.api.getProducts(search.trim())
        setResults(updated)
      }
    } else showMsg('Error al eliminar', 'err')
  }

  return (
    <div className="max-w-lg space-y-4">
      <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", padding: 16 }}>
        <h2 className="font-bold text-gray-900 mb-3">Eliminar Producto</h2>
        <div className="relative">
          <input
            ref={searchRef}
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o código..."
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <span className="absolute left-2.5 top-2 text-gray-400 text-base pointer-events-none">🔍</span>
        </div>
        {results.length > 0 && (
          <div className="mt-3 border rounded-lg overflow-hidden">
            {results.slice(0, 15).map(p => (
              <div key={p.id} className="px-3 py-2 border-b last:border-0 flex justify-between items-center hover:bg-red-50">
                <div>
                  <span className="font-medium text-sm">{p.name}</span>
                  <span className="text-xs text-gray-400 font-mono ml-2">{p.code}</span>
                </div>
                <button onClick={() => setConfirm(p)} className="text-red-500 hover:text-red-700 text-sm font-bold">Eliminar</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {confirm && (
        <Modal title="Confirmar Eliminación" onClose={() => setConfirm(null)} size="sm">
          <div className="text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <p className="text-gray-700">¿Eliminar <strong>{confirm.name}</strong>?</p>
            <p className="text-sm text-gray-400">El producto se marcará como inactivo.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirm(null)} className="flex-1 border rounded-lg py-2 text-gray-600">Cancelar</button>
              <button onClick={handleDelete} className="flex-1 bg-red-600 text-white font-bold py-2 rounded-lg">Eliminar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── CATEGORIES TAB ──────────────────────────────────────────────────────────
function CategoriesTab({ categories, reload, showMsg }: any) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<Category | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmCat, setConfirmCat] = useState<Category | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const handleAdd = async () => {
    if (!newName.trim()) return
    const res = await window.api.createCategory(newName.trim())
    if (res.success) { showMsg('Categoría creada'); setNewName(''); reload() }
    else showMsg(res.message, 'err')
  }

  const handleEdit = async () => {
    if (!editing || !editName.trim()) return
    const res = await window.api.updateCategory(editing.id, editName.trim())
    if (res.success) { showMsg('Categoría actualizada'); setEditing(null); reload() }
  }

  const handleDelete = async () => {
    if (!confirmCat) return
    try {
      const res = await window.api.deleteCategory(confirmCat.id)
      if (res.success) {
        setConfirmCat(null)
        setDeleteError('')
        showMsg('Categoría eliminada')
        reload()
      } else {
        setDeleteError(res.message || 'No se pudo eliminar')
      }
    } catch {
      setDeleteError('Error al eliminar la categoría')
    }
  }

  return (
    <div className="max-w-md space-y-4">
      {confirmCat && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'var(--nm-bg)', borderRadius: 16, padding: 28, maxWidth: 340, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>¿Eliminar categoría?</p>
            <p style={{ fontSize: 13, color: 'var(--nm-text-muted)', marginBottom: deleteError ? 12 : 20 }}>Se eliminará <strong>{confirmCat.name}</strong>. Esta acción no se puede deshacer.</p>
            {deleteError && (
              <p style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginBottom: 16, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8 }}>
                ⚠️ {deleteError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setConfirmCat(null); setDeleteError('') }} className="nm-btn" style={{ padding: '8px 18px', fontSize: 13 }}>Cancelar</button>
              {!deleteError && <button onClick={handleDelete} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 10, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer' }}>Eliminar</button>}
            </div>
          </div>
        </div>
      )}
      <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", padding: 16 }}>
        <h2 className="font-bold text-gray-900 mb-3">Nueva Categoría</h2>
        <div className="flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} placeholder="Nombre de categoría" className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Agregar</button>
        </div>
      </div>
      <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", overflow: "hidden" }}>
        {categories.map((c: Category) => (
          <div key={c.id} className="flex items-center px-4 py-3 border-b last:border-0 hover:bg-gray-50">
            {editing?.id === c.id ? (
              <>
                <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleEdit()} className="flex-1 border rounded px-2 py-1 text-sm mr-2" />
                <button onClick={handleEdit} className="text-blue-600 text-sm font-medium mr-2">Guardar</button>
                <button onClick={() => setEditing(null)} className="text-gray-400 text-sm">Cancelar</button>
              </>
            ) : (
              <>
                <span className="flex-1 font-medium">{c.name}</span>
                <button onClick={() => { setEditing(c); setEditName(c.name) }} className="text-blue-500 text-sm mr-3 hover:text-blue-700">Editar</button>
                <button onClick={() => setConfirmCat(c)} className="text-red-500 text-sm hover:text-red-700">Eliminar</button>
              </>
            )}
          </div>
        ))}
        {categories.length === 0 && <div className="text-center py-8 text-gray-400">Sin categorías</div>}
      </div>
    </div>
  )
}

// ─── SALES BY PERIOD TAB ─────────────────────────────────────────────────────
function SalesByPeriodTab() {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

  const setPreset = (p: string) => {
    const now = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    if (p === 'hoy') { setFrom(iso(now)); setTo(iso(now)) }
    if (p === 'semana') {
      const d = new Date(now); d.setDate(d.getDate() - d.getDay())
      setFrom(iso(d)); setTo(iso(now))
    }
    if (p === 'mes') {
      setFrom(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`); setTo(iso(now))
    }
  }

  const load = async () => {
    setLoading(true)
    const res = await window.api.getSalesByPeriod({ from, to })
    setRows(res)
    setLoading(false)
  }

  const handleExport = async () => {
    await window.api.exportToExcel({
      filename: `ventas_${from}_${to}.xlsx`,
      sheetName: 'Ventas',
      columns: [
        { header: 'Folio', key: 'folio', width: 20 },
        { header: 'Fecha', key: 'timestamp', width: 20 },
        { header: 'Cajero', key: 'cashier_name', width: 20 },
        { header: 'Producto', key: 'product_name', width: 30 },
        { header: 'Categoría', key: 'category_name', width: 15 },
        { header: 'Cantidad', key: 'quantity', width: 10 },
        { header: 'Precio', key: 'unit_price', width: 12 },
        { header: 'Forma Pago', key: 'payment_type', width: 12 },
      ],
      rows: rows.map(r => [r.folio, r.timestamp, r.cashier_name, r.product_name, r.category_name, r.quantity, r.unit_price, r.payment_type]),
    })
  }

  const totals = rows.reduce((s, r) => ({ total: s.total + r.unit_price * r.quantity, qty: s.qty + r.quantity }), { total: 0, qty: 0 })

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-3 items-end">
        <div className="flex gap-2">
          {['hoy', 'semana', 'mes'].map(p => (
            <button key={p} onClick={() => setPreset(p)} className="px-3 py-1.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 capitalize">{p === 'hoy' ? 'Hoy' : p === 'semana' ? 'Esta semana' : 'Este mes'}</button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
          <span className="text-gray-400">—</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
        </div>
        <button onClick={load} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium">Buscar</button>
        {rows.length > 0 && <button onClick={handleExport} className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium">Exportar Excel</button>}
      </div>
      {rows.length > 0 && (
        <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", overflow: "hidden" }}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Folio', 'Fecha', 'Cajero', 'Producto', 'Categoría', 'Cantidad', 'Precio', 'Importe', 'Pago'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-bold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.slice(0, 500).map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-mono text-xs">{r.folio}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-500">{r.timestamp?.slice(0, 16)}</td>
                  <td className="px-3 py-1.5 text-xs">{r.cashier_name}</td>
                  <td className="px-3 py-1.5">{r.product_name}</td>
                  <td className="px-3 py-1.5 text-gray-500 text-xs">{r.category_name}</td>
                  <td className="px-3 py-1.5 text-right">{r.quantity}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(r.unit_price)}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{fmt(r.unit_price * r.quantity)}</td>
                  <td className="px-3 py-1.5 text-xs capitalize">{r.payment_type}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t font-bold">
              <tr>
                <td colSpan={5} className="px-3 py-2 text-right text-sm">TOTALES:</td>
                <td className="px-3 py-2 text-right">{totals.qty.toFixed(0)}</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right text-blue-700">{fmt(totals.total)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {rows.length === 0 && !loading && <div className="text-center text-gray-400 py-16">Seleccione un período y presione Buscar</div>}
    </div>
  )
}

// ─── PROMOTIONS TAB ──────────────────────────────────────────────────────────
function PromotionsTab({ products }: any) {
  const [promos, setPromos] = useState<Promotion[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [confirmPromoId, setConfirmPromoId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', product_id: '', discount_type: 'percentage', discount_value: '', start_date: new Date().toISOString().slice(0, 10), end_date: '', active: true })
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

  useEffect(() => { loadPromos() }, [])

  const loadPromos = async () => {
    const res = await window.api.getPromotions()
    setPromos(res)
  }

  const handleAdd = async () => {
    if (!form.name || !form.product_id || !form.discount_value || !form.end_date) return
    await window.api.createPromotion({
      name: form.name,
      product_id: parseInt(form.product_id),
      discount_type: form.discount_type,
      discount_value: parseFloat(form.discount_value),
      start_date: form.start_date,
      end_date: form.end_date,
      active: form.active,
    })
    setShowAdd(false)
    setForm({ name: '', product_id: '', discount_type: 'percentage', discount_value: '', start_date: new Date().toISOString().slice(0, 10), end_date: '', active: true })
    loadPromos()
  }

  const toggleActive = async (p: Promotion) => {
    await window.api.updatePromotion({ ...p, active: !p.active })
    loadPromos()
  }

  const handleDelete = async () => {
    if (confirmPromoId === null) return
    await window.api.deletePromotion(confirmPromoId)
    setConfirmPromoId(null)
    loadPromos()
  }

  const now = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-4">
      {confirmPromoId !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'var(--nm-bg)', borderRadius: 16, padding: 28, maxWidth: 340, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>¿Eliminar promoción?</p>
            <p style={{ fontSize: 13, color: 'var(--nm-text-muted)', marginBottom: 20 }}>Esta acción no se puede deshacer.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmPromoId(null)} className="nm-btn" style={{ padding: '8px 18px', fontSize: 13 }}>Cancelar</button>
              <button onClick={handleDelete} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 10, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer' }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center">
        <h2 className="font-bold text-gray-900">Promociones</h2>
        <button onClick={() => setShowAdd(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">+ Nueva Promoción</button>
      </div>
      <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", overflow: "hidden" }}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['Nombre', 'Producto', 'Descuento', 'Inicio', 'Fin', 'Estado', 'Acciones'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-bold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {promos.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 text-sm text-gray-600">{p.product_name}</td>
                <td className="px-3 py-2">{p.discount_type === 'percentage' ? `${p.discount_value}%` : fmt(p.discount_value)}</td>
                <td className="px-3 py-2 text-sm">{p.start_date}</td>
                <td className="px-3 py-2 text-sm">{p.end_date}</td>
                <td className="px-3 py-2">
                  <button onClick={() => toggleActive(p)} className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.active && p.end_date >= now ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {p.active && p.end_date >= now ? 'Activa' : 'Inactiva'}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => setConfirmPromoId(p.id)} className="text-red-500 text-xs hover:text-red-700">Eliminar</button>
                </td>
              </tr>
            ))}
            {promos.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin promociones</td></tr>}
          </tbody>
        </table>
      </div>
      {showAdd && (
        <Modal title="Nueva Promoción" onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Nombre de la promoción</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Producto</label>
              <select value={form.product_id} onChange={e => set('product_id', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">Seleccionar producto</option>
                {products.map((p: Product) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Tipo de descuento</label>
                <select value={form.discount_type} onChange={e => set('discount_type', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="percentage">Porcentaje (%)</option>
                  <option value="fixed">Monto fijo ($)</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Valor del descuento</label>
                <input type="number" value={form.discount_value} onChange={e => set('discount_value', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" step="0.01" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Fecha inicio</label>
                <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Fecha fin</label>
                <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="active-promo" checked={form.active} onChange={e => set('active', e.target.checked)} />
              <label htmlFor="active-promo" className="text-sm text-gray-700">Activa</label>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowAdd(false)} className="flex-1 border rounded-lg py-2 text-gray-600 text-sm">Cancelar</button>
              <button onClick={handleAdd} className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg text-sm">Guardar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── IMPORT TAB ──────────────────────────────────────────────────────────────
function ImportTab({ reload, showMsg, categories }: any) {
  const [preview, setPreview] = useState<any[] | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [filePath, setFilePath] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>({})

  const requiredFields = ['code', 'name', 'price']
  const optionalFields = ['cost', 'stock', 'min_stock', 'category']

  const handleSelectFile = async () => {
    const result = await window.api.showOpenDialog({ filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }] })
    if (result.canceled || !result.filePaths[0]) return
    const fp = result.filePaths[0]
    setFilePath(fp)
    const data = await window.api.readExcelFile(fp)
    if (!data.success) { showMsg(data.message, 'err'); return }
    setHeaders(data.headers)
    setPreview(data.rows.slice(0, 5))
    // auto-map
    const autoMap: Record<string, string> = {}
    const allFields = [...requiredFields, ...optionalFields]
    for (const f of allFields) {
      const match = data.headers.find((h: string) => h.toLowerCase().includes(f) || h === f)
      if (match) autoMap[f] = match
    }
    setMapping(autoMap)
  }

  const handleImport = async () => {
    if (!filePath) return
    const data = await window.api.readExcelFile(filePath)
    if (!data.success) { showMsg(data.message, 'err'); return }
    const rows = data.rows.map((row: any) => {
      const mapped: any = {}
      for (const [field, header] of Object.entries(mapping)) {
        mapped[field] = row[header as string]
      }
      return mapped
    }).filter((r: any) => r.code && r.name && r.price)

    const res = await window.api.importProducts(rows)
    if (res.success) {
      showMsg(`Importados: ${res.imported}, Actualizados: ${res.updated}`)
      setPreview(null); setFilePath('')
      reload()
    } else {
      showMsg('Error al importar', 'err')
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", padding: 16 }}>
        <h2 className="font-bold text-gray-900 mb-3">Importar Productos desde Excel</h2>
        <p className="text-sm text-gray-500 mb-3">El archivo debe tener columnas: código, nombre, precio. Opcionales: costo, stock, min_stock, categoría.</p>
        <button onClick={handleSelectFile} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Seleccionar archivo Excel</button>
      </div>
      {preview && headers.length > 0 && (
        <div style={{ background: "var(--nm-bg)", borderRadius: 16, boxShadow: "var(--nm-raised)", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <h3 className="font-bold text-gray-900">Mapeo de columnas</h3>
          <div className="grid grid-cols-2 gap-3">
            {[...requiredFields, ...optionalFields].map(f => (
              <div key={f}>
                <label className="text-sm font-medium text-gray-700 capitalize">{f} {requiredFields.includes(f) ? '*' : ''}</label>
                <select value={mapping[f] || ''} onChange={e => setMapping(m => ({ ...m, [f]: e.target.value }))} className="mt-1 w-full border rounded-lg px-3 py-1.5 text-sm">
                  <option value="">No mapear</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-2">Vista previa (primeras 5 filas):</h4>
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>{headers.map(h => <th key={h} className="border px-2 py-1 bg-gray-50 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i}>{headers.map(h => <td key={h} className="border px-2 py-1">{String(r[h] ?? '')}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <button onClick={handleImport} className="w-full bg-green-600 text-white font-bold py-2 rounded-lg text-sm">Importar Productos</button>
        </div>
      )}
    </div>
  )
}

// ─── EXPORT TAB ──────────────────────────────────────────────────────────────
function ExportTab({ products }: any) {
  const handleExport = async () => {
    await window.api.exportToExcel({
      filename: 'productos.xlsx',
      sheetName: 'Productos',
      columns: [
        { header: 'Código', key: 'code', width: 20 },
        { header: 'Nombre', key: 'name', width: 35 },
        { header: 'Categoría', key: 'category_name', width: 20 },
        { header: 'Costo', key: 'cost', width: 12 },
        { header: 'Precio', key: 'price', width: 12 },
        { header: 'Stock', key: 'stock', width: 10 },
        { header: 'Stock Mínimo', key: 'min_stock', width: 12 },
      ],
      rows: products.map((p: Product) => [p.code, p.name, p.category_name || '', p.cost, p.price, p.stock, p.min_stock]),
    })
  }

  return (
    <div className="max-w-md">
      <div className="bg-white rounded-xl shadow p-6 text-center">
        <div className="text-5xl mb-4">📊</div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Exportar Catálogo</h2>
        <p className="text-gray-500 text-sm mb-4">{products.length} productos activos</p>
        <button onClick={handleExport} className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-3 rounded-xl">
          Exportar a Excel
        </button>
      </div>
    </div>
  )
}

// ─── LABELS TAB ───────────────────────────────────────────────────────────────
type LabelItem = { product: Product; code: string; label: string; qty: number }

// LP 2824 Plus: 203 DPI → 1mm ≈ 8 dots. Max width 57mm (456 dots).
const LABEL_SIZES = {
  pequeño: { wMm: 50, hMm: 25, wDots: 400, hDots: 200, name: 'Pequeño (50×25mm)' },
  mediano: { wMm: 50, hMm: 32, wDots: 400, hDots: 256, name: 'Mediano (50×32mm)' },
  grande:  { wMm: 50, hMm: 50, wDots: 400, hDots: 400, name: 'Grande (50×50mm)' },
} as const
type LabelSize = keyof typeof LABEL_SIZES

// Strip accents/diacritics so ZPL ASCII printers render correctly
// e.g. "Jabón" → "Jabon", "Ñoño" → "Nono"
function toAscii(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove combining diacritical marks
    .replace(/[^\x00-\x7E]/g, '?')   // replace anything still non-ASCII with ?
}

type LabelSettings = { showPrice: boolean; showBarcode: boolean; fontSize: string }

// ZPL generator — pure text, no DOM required
// Layout (top→bottom): name, barcode, code number, price
function buildZPL(items: LabelItem[], size: LabelSize, settings: LabelSettings = { showPrice: true, showBarcode: true, fontSize: 'medium' }): string {
  const { wDots, hDots } = LABEL_SIZES[size]
  const fontMult = settings.fontSize === 'small' ? 0.8 : settings.fontSize === 'large' ? 1.25 : 1.0

  const topMargin = 6
  const nameLines = 2

  // Compute proportional element heights
  let nameFontH  = Math.round(hDots * 0.14 * fontMult)
  let barcodeH   = settings.showBarcode ? Math.round(hDots * 0.32) : 0
  let codeFontH  = Math.round(hDots * 0.10 * fontMult)
  let priceFontH = settings.showPrice   ? Math.round(hDots * 0.19 * fontMult) : 0

  // Fixed gaps that don't scale: top + after-name + after-barcode + after-code
  const fixedGaps = topMargin + 6 + (settings.showBarcode ? 2 : 0) + 6
  const totalContent = nameFontH * nameLines + barcodeH + codeFontH + priceFontH

  // Scale all elements down if they overflow the label height (12-dot bottom margin)
  if (totalContent + fixedGaps > hDots - 12) {
    const scale = (hDots - fixedGaps - 12) / totalContent
    nameFontH  = Math.max(8,  Math.round(nameFontH  * scale))
    barcodeH   = Math.max(20, Math.round(barcodeH   * scale))
    codeFontH  = Math.max(6,  Math.round(codeFontH  * scale))
    priceFontH = Math.max(8,  Math.round(priceFontH * scale))
  }

  let nameFontW  = Math.round(nameFontH  * 0.7)
  let codeFontW  = Math.round(codeFontH  * 0.65)
  let priceFontW = Math.round(priceFontH * 0.75)

  // Stack Y positions after scaling
  let curY = topMargin

  const nameY  = curY
  curY += nameFontH * nameLines + 6

  const barcodeY = curY
  if (settings.showBarcode) curY += barcodeH + 2

  const codeY = curY
  curY += codeFontH + 6

  const priceY = curY

  return items.flatMap(item =>
    Array.from({ length: item.qty }, () => {
      const price = `$${(item.product.price || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
      const rawName = toAscii(item.label)
      const charsPerLine = Math.floor(wDots / (nameFontW * 0.6))
      const name = rawName.length > charsPerLine * 2
        ? rawName.slice(0, charsPerLine * 2 - 1) + '.'
        : rawName

      const lines = [
        '^XA',
        '^MMT',
        `^PW${wDots}`,
        `^LL${hDots}`,
        // Product name — always shown, centered, up to 2 lines
        `^FO0,${nameY}^FB${wDots},${nameLines},2,C^A0N,${nameFontH},${nameFontW}^FD${name}^FS`,
      ]

      if (settings.showBarcode) {
        // Center the barcode. Fill target 60% leaves room for the printer's
        // own quiet zones (which are added on top of our estimate and caused
        // the barcode to overflow the left edge when byW was too large).
        const codeModules = 11 * (item.code.length + 2) + 13 + 20
        const byW = Math.max(2, Math.floor((wDots * 0.60) / codeModules))
        const estW = codeModules * byW
        const barcodeX = Math.max(20, Math.floor((wDots - estW) / 2))
        lines.push(`^FO${barcodeX},${barcodeY}^BY${byW}^BCN,${barcodeH},N,N,N^FD${item.code}^FS`)
      }
      // Always show the code number (small text)
      lines.push(`^FO0,${codeY}^FB${wDots},1,,C^A0N,${codeFontH},${codeFontW}^FD${item.code}^FS`)

      if (settings.showPrice) {
        lines.push(`^FO0,${priceY}^FB${wDots},1,,C^A0N,${priceFontH},${priceFontW}^FD${price}^FS`)
      }

      lines.push('^XZ')
      return lines.join('\n')
    })
  ).join('\n')
}

// SVG barcode only used for on-screen preview
function generateBarcodeSVG(code: string, height: number): string {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(svg, code, {
      format: 'CODE128',
      height,
      displayValue: false,
      margin: 2,
      lineColor: '#000000',
      background: '#ffffff',
    })
    return new XMLSerializer().serializeToString(svg)
  } catch {
    return ''
  }
}

function LabelsTab({ products: allProducts }: { products: Product[] }) {
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [items, setItems] = useState<LabelItem[]>([])
  const [size, setSize] = useState<LabelSize>('mediano')
  const [printing, setPrinting] = useState(false)
  const [printMsg, setPrintMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [zebraPrinter, setZebraPrinter] = useState('')
  const [labelSettings, setLabelSettings] = useState({ showPrice: true, showBarcode: true, fontSize: 'medium' })
  const searchRef = useRef<HTMLInputElement>(null)

  // Load label settings from DB on mount
  useEffect(() => {
    window.api.getSettings().then((s: any) => {
      setZebraPrinter(s?.label_printer?.trim() || '')
      setLabelSettings({
        showPrice:   s?.label_show_price   !== '0',
        showBarcode: s?.label_show_barcode !== '0',
        fontSize:    s?.label_font_size    || 'medium',
      })
    })
  }, [])

  const handleSearch = (q: string) => {
    setSearch(q)
    if (!q.trim()) { setSearchResults([]); return }
    const lower = q.toLowerCase()
    setSearchResults(
      allProducts.filter(p =>
        p.name.toLowerCase().includes(lower) || p.code.includes(q)
      ).slice(0, 8)
    )
  }

  const addProduct = async (p: Product) => {
    setSearch('')
    setSearchResults([])
    // main code
    const newItems: LabelItem[] = []
    const alreadyMain = items.find(i => i.product.id === p.id && i.code === p.code)
    if (!alreadyMain) {
      newItems.push({ product: p, code: p.code, label: p.name, qty: 1 })
    }
    // extra barcodes
    const extras = await window.api.getProductBarcodes(p.id)
    for (const b of extras) {
      const already = items.find(i => i.code === b.code)
      if (!already) {
        newItems.push({ product: p, code: b.code, label: b.label ? `${p.name} — ${b.label}` : p.name, qty: 1 })
      }
    }
    if (newItems.length === 0) {
      // product already fully added — bump main qty instead
      setItems(prev => prev.map(i => i.product.id === p.id && i.code === p.code ? { ...i, qty: i.qty + 1 } : i))
    } else {
      setItems(prev => [...prev, ...newItems])
    }
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  const updateQty = (idx: number, delta: number) => {
    setItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], qty: Math.max(0, next[idx].qty + delta) }
      return next.filter(i => i.qty > 0)
    })
  }

  const setQty = (idx: number, val: string) => {
    const n = parseInt(val) || 0
    if (n <= 0) {
      setItems(prev => prev.filter((_, i) => i !== idx))
    } else {
      setItems(prev => prev.map((item, i) => i === idx ? { ...item, qty: n } : item))
    }
  }

  const totalLabels = items.reduce((s, i) => s + i.qty, 0)

  const handlePrint = async () => {
    // Always fetch fresh settings so a newly saved printer is picked up without page reload
    const freshSettings = await window.api.getSettings()
    const freshPrinter = (freshSettings?.label_printer || zebraPrinter || '').trim()
    const printerName = freshPrinter
    if (!printerName) {
      setPrintMsg({ ok: false, text: 'Configura la impresora Zebra en Configuración → Tickets y Etiquetas' })
      return
    }
    setPrinting(true)
    setPrintMsg(null)
    const zpl = buildZPL(items, size, labelSettings)
    const res = await (window.api as any).printZPL({ zpl, printerName })
    setPrinting(false)
    if (res.success) {
      setPrintMsg({ ok: true, text: `✓ ${totalLabels} etiqueta${totalLabels !== 1 ? 's' : ''} enviada${totalLabels !== 1 ? 's' : ''} a ${freshPrinter}` })
    } else {
      setPrintMsg({ ok: false, text: res.message || 'Error al imprimir' })
    }
  }

  // Live preview
  const previewItem = items[0]
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!previewRef.current || !previewItem || !labelSettings.showBarcode) return
    const { hMm } = LABEL_SIZES[size]
    const svgStr = generateBarcodeSVG(previewItem.code, Math.round(hMm * 1.1))
    const el = previewRef.current.querySelector('.preview-barcode')
    if (el) el.innerHTML = svgStr
  }, [previewItem, size, labelSettings])

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', maxWidth: 860 }}>
      {/* Left: controls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Search */}
        <div style={{ background: 'var(--nm-bg)', borderRadius: 16, boxShadow: 'var(--nm-raised)', padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--nm-text)', marginBottom: 10 }}>
            🏷️ Imprimir Etiquetas
          </div>
          <div style={{ position: 'relative' }}>
            <input
              ref={searchRef}
              autoFocus
              value={search}
              onChange={e => handleSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && searchResults.length === 1) addProduct(searchResults[0]) }}
              placeholder="Escanear código o buscar por nombre..."
              className="nm-input"
              style={{ width: '100%', paddingLeft: 36, paddingRight: 12 }}
            />
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, opacity: 0.4, pointerEvents: 'none' }}>📷</span>
          </div>
          {searchResults.length > 0 && (
            <div style={{ marginTop: 6, borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--nm-raised-sm)' }}>
              {searchResults.map(p => (
                <div key={p.id} onClick={() => addProduct(p)}
                  style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', background: 'var(--nm-bg)', borderBottom: '1px solid rgba(0,0,0,0.04)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(91,141,238,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--nm-bg)')}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--nm-text)' }}>{p.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--nm-text-muted)', fontFamily: 'monospace' }}>{p.code}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Printer + Size */}
        <div style={{ background: 'var(--nm-surface)', borderRadius: 16, boxShadow: 'var(--nm-raised)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🦓 Impresora Zebra</div>
            {zebraPrinter ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(52,199,89,0.07)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(52,199,89,0.18)' }}>
                <span style={{ fontSize: 13 }}>🖨️</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#1A8F3A', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{zebraPrinter}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,149,0,0.07)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(255,149,0,0.2)' }}>
                <span style={{ fontSize: 12, color: '#B87000', fontWeight: 600 }}>⚠️ Sin configurar — ve a <strong>Configuración → Impresora</strong> y agrega la impresora Zebra</span>
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tamaño de etiqueta</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(Object.keys(LABEL_SIZES) as LabelSize[]).map(k => (
                <button key={k} onClick={() => setSize(k)}
                  className={size === k ? 'nm-btn-accent' : 'nm-btn'}
                  style={{ flex: 1, padding: '8px 4px', fontSize: 11, fontWeight: 800, borderRadius: 10 }}
                >
                  {LABEL_SIZES[k].name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Items list */}
        {items.length > 0 && (
          <div style={{ background: 'var(--nm-bg)', borderRadius: 16, boxShadow: 'var(--nm-raised)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--nm-text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Etiquetas a imprimir
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--nm-text-muted)' }}>
                Total: {totalLabels} etiqueta{totalLabels !== 1 ? 's' : ''}
              </span>
            </div>
            {items.map((item, idx) => (
              <div key={`${item.product.id}-${item.code}`}
                style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(0,0,0,0.04)', background: idx === 0 ? 'rgba(91,141,238,0.04)' : 'var(--nm-bg)' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--nm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--nm-text-muted)', fontFamily: 'monospace', marginTop: 1 }}>{item.code}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => updateQty(idx, -1)} className="nm-btn"
                    style={{ width: 26, height: 26, fontSize: 14, fontWeight: 900, borderRadius: 8, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                  <input
                    type="number"
                    value={item.qty}
                    onChange={e => setQty(idx, e.target.value)}
                    min={0}
                    className="nm-input"
                    style={{ width: 44, textAlign: 'center', padding: '4px 0', fontSize: 13, fontWeight: 800 }}
                  />
                  <button onClick={() => updateQty(idx, 1)} className="nm-btn"
                    style={{ width: 26, height: 26, fontSize: 14, fontWeight: 900, borderRadius: 8, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                </div>
                <button onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, opacity: 0.4, padding: '2px 4px', color: 'var(--nm-danger)' }}
                >✕</button>
              </div>
            ))}
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {printMsg && (
                <div style={{
                  fontSize: 12, fontWeight: 600, padding: '8px 12px', borderRadius: 10,
                  background: printMsg.ok ? 'rgba(52,199,89,0.08)' : 'rgba(255,59,48,0.08)',
                  border: `1px solid ${printMsg.ok ? 'rgba(52,199,89,0.2)' : 'rgba(255,59,48,0.2)'}`,
                  color: printMsg.ok ? '#1A8F3A' : 'var(--nm-danger)',
                }}>
                  {printMsg.text}
                </div>
              )}
              <button
                onClick={handlePrint}
                disabled={totalLabels === 0 || printing}
                className="nm-btn-accent"
                style={{ width: '100%', padding: '13px', fontSize: 14, fontWeight: 900, opacity: (totalLabels === 0 || printing) ? 0.4 : 1 }}
              >
                {printing ? 'Enviando...' : `🖨️ Imprimir ${totalLabels} etiqueta${totalLabels !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {items.length === 0 && (
          <div style={{
            background: 'var(--nm-bg)', borderRadius: 16, boxShadow: 'var(--nm-inset)',
            padding: '32px 16px', textAlign: 'center',
            color: 'var(--nm-text-muted)', fontSize: 13, fontWeight: 700,
          }}>
            Busca un producto para agregar sus etiquetas
          </div>
        )}
      </div>

      {/* Right: preview */}
      <div style={{ width: 260, flexShrink: 0 }}>
        <div style={{ background: 'var(--nm-bg)', borderRadius: 16, boxShadow: 'var(--nm-raised)', padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--nm-text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Vista previa
          </div>
          {previewItem ? (
            <div ref={previewRef}
              style={{
                width: `${LABEL_SIZES[size].wMm * 2.5}px`,
                height: `${LABEL_SIZES[size].hMm * 2.5}px`,
                border: '1px solid #ccc',
                borderRadius: 4,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '5px 6px',
                background: '#fff',
                overflow: 'hidden',
                margin: '0 auto',
              }}
            >
              {/* 1. Name — top */}
              <div style={{ fontSize: 7, fontWeight: 900, textAlign: 'center', color: '#000', width: '100%', lineHeight: 1.2, overflow: 'hidden', maxHeight: '2.6em' }}>
                {previewItem.label.length > 40 ? previewItem.label.slice(0, 39) + '…' : previewItem.label}
              </div>
              {/* 2. Barcode — middle */}
              {labelSettings.showBarcode && (
                <div className="preview-barcode"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', overflow: 'hidden', padding: '2px 0' }}
                />
              )}
              {/* 3. Code number */}
              <div style={{ fontSize: 8, fontFamily: 'monospace', fontWeight: 700, textAlign: 'center', color: '#000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {previewItem.code}
              </div>
              {/* 4. Price */}
              {labelSettings.showPrice && (
                <div style={{ fontSize: 13, fontWeight: 900, textAlign: 'center', color: '#000' }}>
                  ${(previewItem.product.price || 0).toFixed(2)}
                </div>
              )}
            </div>
          ) : (
            <div style={{
              width: `${LABEL_SIZES[size].wMm * 2.5}px`, height: `${LABEL_SIZES[size].hMm * 2.5}px`,
              border: '1.5px dashed var(--nm-shadow-dark)', borderRadius: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--nm-bg)', color: 'var(--nm-text-muted)', fontSize: 11, fontWeight: 700,
              margin: '0 auto',
            }}>
              Sin producto
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 10, fontWeight: 700, color: 'var(--nm-text-muted)', textAlign: 'center' }}>
            {LABEL_SIZES[size].wMm}mm × {LABEL_SIZES[size].hMm}mm · ZPL · 203 DPI
          </div>
        </div>
      </div>
    </div>
  )
}
