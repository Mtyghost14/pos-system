import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '../store/useAuthStore'
import { useSettingsStore } from '../store/useSettingsStore'
import type { CartItem, Product } from '../types'
import Modal from '../components/Modal'
import SearchInput from '../components/SearchInput'

const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
const fmtDate = (d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Sales() {
  const { user, shift, setShift } = useAuthStore()
  const { settings } = useSettingsStore()
  const [cart, setCart] = useState<CartItem[]>([])
  const [codeInput, setCodeInput] = useState('')
  const [mixedMode, setMixedMode] = useState(false)
  const [payments, setPayments] = useState({ efectivo: '', tarjeta: '', transferencia: '' })
  const [paymentEnabled, setPaymentEnabled] = useState({ efectivo: true, tarjeta: false, transferencia: false })
  const [cashBalance, setCashBalance] = useState(0)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingQty, setEditingQty] = useState('')
  const [editingPriceIndex, setEditingPriceIndex] = useState<number | null>(null)
  const [editingPrice, setEditingPrice] = useState('')
  const [showPayModal, setShowPayModal] = useState(false)
  const [showMovModal, setShowMovModal] = useState<'entrada' | 'salida' | null>(null)
  const [movAmount, setMovAmount] = useState('')
  const [movConcept, setMovConcept] = useState('')
  const [lastSale, setLastSale] = useState<any>(null)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [saleStatus, setSaleStatus] = useState('')
  const [showCancelPanel, setShowCancelPanel] = useState(false)
  const [todaySales, setTodaySales] = useState<any[]>([])
  const [cancelTarget, setCancelTarget] = useState<any>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelLoading, setCancelLoading] = useState(false)
  const [heldCarts, setHeldCarts] = useState<{ id: number; items: CartItem[]; label: string }[]>([])
  const [showDailySales, setShowDailySales] = useState(false)
  const [dailySales, setDailySales] = useState<any[]>([])
  const codeRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (shift) {
      loadCashBalance()
      // Restore persisted cart
      try {
        const savedCart = localStorage.getItem(`cart_${shift.id}`)
        if (savedCart) { const p = JSON.parse(savedCart); if (Array.isArray(p) && p.length) setCart(p) }
        const savedHeld = localStorage.getItem(`held_${shift.id}`)
        if (savedHeld) { const p = JSON.parse(savedHeld); if (Array.isArray(p)) setHeldCarts(p) }
      } catch {}
    }
  }, [shift?.id])

  // Persist cart to localStorage whenever it changes
  useEffect(() => {
    if (!shift) return
    try { localStorage.setItem(`cart_${shift.id}`, JSON.stringify(cart)) } catch {}
  }, [cart, shift?.id])

  // Persist held carts to localStorage
  useEffect(() => {
    if (!shift) return
    try { localStorage.setItem(`held_${shift.id}`, JSON.stringify(heldCarts)) } catch {}
  }, [heldCarts, shift?.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); codeRef.current?.focus() }
      if (e.key === 'F2') { e.preventDefault(); handleNewSale() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [cart])

  const loadCashBalance = async () => {
    if (!shift) return
    const bal = await window.api.getCashBalance(shift.id)
    setCashBalance(bal)
  }

  const handleCodeSubmit = async (code: string) => {
    if (!code.trim()) return
    const product = await window.api.getProductByCode(code.trim())
    if (product) {
      addToCart(product)
    } else {
      setSaleStatus(`Producto no encontrado: ${code}`)
      setTimeout(() => setSaleStatus(''), 3000)
    }
    setCodeInput('')
    codeRef.current?.focus()
  }

  const addToCart = (product: Product) => {
    const idx = cart.findIndex(i => i.product_id === product.id)
    const currentQty = idx >= 0 ? cart[idx].quantity : 0
    if (product.stock !== undefined && product.stock !== null && currentQty + 1 > product.stock) {
      setSaleStatus(`⚠ Stock insuficiente: ${product.name} (${product.stock} disponibles)`)
      setTimeout(() => setSaleStatus(''), 3000)
      return
    }
    const price = product.promo_price ?? product.price
    setCart(prev => {
      const i2 = prev.findIndex(i => i.product_id === product.id)
      if (i2 >= 0) {
        const updated = [...prev]
        updated[i2] = { ...updated[i2], quantity: updated[i2].quantity + 1 }
        return updated
      }
      return [...prev, {
        product_id: product.id,
        code: product.code,
        name: product.name,
        quantity: 1,
        unit_price: price,
        unit_cost: product.cost,
        discount: product.promo_price ? product.price - product.promo_price : 0,
        promo_name: product.promo_name,
        stock: product.stock,
      }]
    })
    setSaleStatus(`✓ ${product.name} agregado`)
    setTimeout(() => setSaleStatus(''), 1500)
  }

  const handleNewSale = () => {
    if (cart.length > 0) {
      const label = `Ticket ${heldCarts.length + 1} (${cart.length} art.)`
      setHeldCarts(prev => [...prev, { id: Date.now(), items: cart, label }])
    }
    setCart([])
    setCodeInput('')
    setMixedMode(false)
    setPayments({ efectivo: '', tarjeta: '', transferencia: '' })
    setPaymentEnabled({ efectivo: true, tarjeta: false, transferencia: false })
    setLastSale(null)
    codeRef.current?.focus()
  }

  const switchToHeldCart = (heldId: number) => {
    const held = heldCarts.find(h => h.id === heldId)
    if (!held) return
    if (cart.length > 0) {
      const label = `Ticket ${heldCarts.filter(h => h.id !== heldId).length + 1} (${cart.length} art.)`
      setHeldCarts(prev => [...prev.filter(h => h.id !== heldId), { id: Date.now(), items: cart, label }])
    } else {
      setHeldCarts(prev => prev.filter(h => h.id !== heldId))
    }
    setCart(held.items)
    setCodeInput('')
    setMixedMode(false)
    setPayments({ efectivo: '', tarjeta: '', transferencia: '' })
    setPaymentEnabled({ efectivo: true, tarjeta: false, transferencia: false })
    codeRef.current?.focus()
  }

  const discardHeldCart = (heldId: number) => {
    setHeldCarts(prev => prev.filter(h => h.id !== heldId))
  }

  const loadDailySales = async () => {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const res = await window.api.getSales({ from: today, to: today, includeItems: true })
    setDailySales(res)
  }

  const openDailySales = async () => {
    await loadDailySales()
    setShowDailySales(true)
  }

  const removeFromCart = (idx: number) => {
    setCart(prev => prev.filter((_, i) => i !== idx))
  }

  const saveEditQty = (idx: number) => {
    const qty = parseFloat(editingQty)
    if (!isNaN(qty) && qty > 0) {
      setCart(prev => { const u = [...prev]; u[idx] = { ...u[idx], quantity: qty }; return u })
    } else if (qty === 0) {
      removeFromCart(idx)
    }
    setEditingIndex(null)
    setEditingQty('')
  }

  const saveEditPrice = (idx: number) => {
    const price = parseFloat(editingPrice)
    if (!isNaN(price) && price >= 0) {
      setCart(prev => {
        const u = [...prev]
        const changed = price !== u[idx].unit_price
        u[idx] = { ...u[idx], unit_price: price, price_overridden: changed || u[idx].price_overridden }
        return u
      })
    }
    setEditingPriceIndex(null)
    setEditingPrice('')
  }

  const subtotal = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const totalDiscount = cart.reduce((s, i) => s + i.discount * i.quantity, 0)
  const total = subtotal

  const cashAmt = parseFloat(payments.efectivo) || 0
  // Non-cash is capped at the sale total — card/transfer never give change
  const nonCashRaw = (['tarjeta', 'transferencia'] as const)
    .filter(k => paymentEnabled[k])
    .reduce((s, k) => s + (parseFloat(payments[k]) || 0), 0)
  const nonCashEffective = Math.min(nonCashRaw, total)
  const cashNeeded = Math.max(0, total - nonCashEffective)
  const change = paymentEnabled.efectivo && cashAmt > cashNeeded
    ? cashAmt - cashNeeded
    : 0
  const pending = cashNeeded - cashAmt          // negative means overpaid (change due)
  const assigned = nonCashEffective + (paymentEnabled.efectivo ? cashAmt : 0)
  const canCharge = cart.length > 0 && nonCashEffective + (paymentEnabled.efectivo ? cashAmt : 0) >= total - 0.005

  const activeMethod = !mixedMode
    ? (paymentEnabled.tarjeta ? 'tarjeta' : paymentEnabled.transferencia ? 'transferencia' : 'efectivo')
    : 'mixto'

  const setPayment = (k: keyof typeof payments, v: string) =>
    setPayments(p => ({ ...p, [k]: v }))

  const toggleMethod = (k: keyof typeof paymentEnabled) => {
    if (!mixedMode) {
      setPaymentEnabled({ efectivo: k === 'efectivo', tarjeta: k === 'tarjeta', transferencia: k === 'transferencia' })
      setPayments({ efectivo: '', tarjeta: '', transferencia: '' })
    } else {
      setPaymentEnabled(p => ({ ...p, [k]: !p[k] }))
      if (paymentEnabled[k]) setPayment(k, '')
    }
  }

  const handlePayment = async () => {
    if (!shift || !user || cart.length === 0) return
    if (!canCharge) { setSaleStatus('Monto insuficiente'); return }

    // Build payment breakdown using capped non-cash amounts
    const activePayments: Record<string, number> = {}
    let nonCashRemaining = nonCashEffective
    for (const k of ['tarjeta', 'transferencia'] as const) {
      if (paymentEnabled[k] && parseFloat(payments[k]) > 0 && nonCashRemaining > 0) {
        const charge = Math.min(parseFloat(payments[k]) || 0, nonCashRemaining)
        if (charge > 0.005) { activePayments[k] = charge; nonCashRemaining -= charge }
      }
    }
    if (paymentEnabled.efectivo && cashAmt > 0) activePayments.efectivo = cashAmt
    const isMixed = Object.keys(activePayments).filter(k => activePayments[k] > 0).length > 1
    const singleType = Object.keys(activePayments)[0] || 'efectivo'

    setShowPayModal(false)
    const res = await window.api.createSale({
      cashier_id: user.id,
      shift_id: shift.id,
      payment_type: isMixed ? 'mixto' : singleType,
      payment_details: isMixed ? activePayments : undefined,
      total,
      items: cart.map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        discount: i.discount,
      })),
      received_amount: cashAmt || total,
      change_amount: change,
    })

    if (res.success) {
      const saleData = { ...res, items: cart, total, change, activeMethod, activePayments, isMixed }
      setLastSale(saleData)
      setShowReceiptModal(true)
      // Clear cart and its localStorage snapshot
      setCart([])
      try { if (shift) localStorage.removeItem(`cart_${shift.id}`) } catch {}
      setCodeInput('')
      setMixedMode(false)
      setPayments({ efectivo: '', tarjeta: '', transferencia: '' })
      setPaymentEnabled({ efectivo: true, tarjeta: false, transferencia: false })
      loadCashBalance()
    } else {
      setSaleStatus('Error: ' + (res.message || 'Error al procesar venta'))
      setTimeout(() => setSaleStatus(''), 4000)
    }
  }

  const handleCashMovement = async () => {
    if (!shift || !user || !movAmount || !movConcept) return
    await window.api.addCashMovement({
      shift_id: shift.id,
      type: showMovModal!,
      amount: parseFloat(movAmount),
      concept: movConcept,
      cashier_id: user.id,
    })
    setShowMovModal(null)
    setMovAmount('')
    setMovConcept('')
    loadCashBalance()
  }

  const loadTodaySales = async () => {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const res = await window.api.getSales({ from: today, to: today, includeItems: true })
    setTodaySales(res)
  }

  const openCancelPanel = async () => {
    await loadTodaySales()
    setShowCancelPanel(true)
  }

  const handleCancelSale = async () => {
    if (!cancelTarget || !user) return
    setCancelLoading(true)
    const res = await (window.api as any).cancelSale({
      sale_id: cancelTarget.id,
      reason: cancelReason || 'Error del cajero',
      cancelled_by: user.id,
    })
    setCancelLoading(false)
    if (res.success) {
      setCancelTarget(null)
      setCancelReason('')
      await loadTodaySales()
      loadCashBalance()
      setSaleStatus('✓ Venta cancelada')
      setTimeout(() => setSaleStatus(''), 3000)
    } else {
      setSaleStatus('Error: ' + (res.message || 'No se pudo cancelar'))
      setTimeout(() => setSaleStatus(''), 4000)
    }
  }

  const handlePrintReceipt = async () => {
    if (!lastSale) return
    const res = await window.api.printReceipt({
      storeName: settings?.store_name,
      storeAddress: settings?.store_address,
      storePhone: settings?.store_phone,
      footer: settings?.receipt_footer,
      date: fmtDate(),
      folio: lastSale.folio,
      cashierName: user?.name,
      items: lastSale.items.map((i: CartItem) => ({
        name: i.name,
        qty: i.quantity,
        price: i.unit_price,
        discount: i.discount,
      })),
      total: lastSale.total,
      paymentType: lastSale.activeMethod,
      isMixed: lastSale.isMixed,
      activePayments: lastSale.activePayments,
      received: lastSale.received_amount ?? lastSale.total,
      change: lastSale.change,
      printerName: settings?.printer_port || '',
    })
    if (!res?.success && res?.message) {
      setSaleStatus('Error impresora: ' + res.message.slice(0, 40))
      setTimeout(() => setSaleStatus(''), 4000)
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--nm-bg)' }}>
      {/* Header */}
      <div style={{
        background: 'var(--nm-bg)',
        boxShadow: '0 3px 10px var(--nm-shadow-dark), 0 -1px 4px var(--nm-shadow-light)',
        padding: '10px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexShrink: 0,
        zIndex: 5,
      }}>
        <span style={{ fontWeight: 900, fontSize: 15, color: 'var(--nm-text)', letterSpacing: '0.06em' }}>VENTAS</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--nm-text-muted)' }}>{fmtDate()}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--nm-text-muted)' }}>Cajero: {user?.name}</span>
        {shift && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--nm-text-muted)' }}>Turno #{shift.id}</span>}
        <div style={{ flex: 1 }} />
        {saleStatus && (
          <span style={{
            padding: '4px 14px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            background: saleStatus.startsWith('✓') ? 'linear-gradient(145deg, #46cf80, #2fa85d)' : 'linear-gradient(145deg, #e8504c, #cc2f2a)',
            color: 'white',
            boxShadow: saleStatus.startsWith('✓')
              ? '2px 2px 6px rgba(47,168,93,0.35)'
              : '2px 2px 6px rgba(204,47,42,0.35)',
          }}>
            {saleStatus}
          </span>
        )}
        <div style={{
          padding: '5px 14px',
          borderRadius: 10,
          background: 'var(--nm-bg)',
          boxShadow: 'var(--nm-raised-sm)',
          fontSize: 13,
          fontWeight: 800,
          color: 'var(--nm-accent)',
        }}>
          Caja: {fmt(cashBalance)}
        </div>
        <button
          onClick={openDailySales}
          className="nm-btn"
          style={{ padding: '6px 14px', fontSize: 12, fontWeight: 800 }}
        >
          📋 Ventas del Día
        </button>
        <button
          onClick={openCancelPanel}
          className="nm-btn"
          style={{ padding: '6px 14px', fontSize: 12, fontWeight: 800, color: '#cc2f2a' }}
        >
          ✕ Cancelar Venta
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: 12, padding: 12 }}>
        {/* Left: Cart */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 10 }}>
          {/* Held carts tabs */}
          {heldCarts.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {heldCarts.map(h => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 0, borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--nm-raised-sm)' }}>
                  <button
                    onClick={() => switchToHeldCart(h.id)}
                    style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, background: 'var(--nm-bg)', border: 'none', cursor: 'pointer', color: 'var(--nm-accent)' }}
                  >
                    🛒 {h.label}
                  </button>
                  <button
                    onClick={() => discardHeldCart(h.id)}
                    style={{ padding: '6px 8px', fontSize: 12, background: 'var(--nm-bg)', border: 'none', cursor: 'pointer', color: 'var(--nm-text-muted)', borderLeft: '1px solid var(--nm-separator)' }}
                    title="Descartar ticket en espera"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Search bar */}
          <div style={{
            background: 'var(--nm-bg)',
            borderRadius: 16,
            boxShadow: 'var(--nm-raised)',
            padding: '10px 12px',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}>
            {/* Barcode input */}
            <div style={{ flex: 1, position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                fontSize: 14, pointerEvents: 'none', opacity: 0.45,
              }}>📷</span>
              <input
                ref={codeRef}
                value={codeInput}
                onChange={e => setCodeInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCodeSubmit(codeInput) }}
                placeholder="Código de barras (F1)"
                className="nm-input"
                style={{ width: '100%', padding: '10px 12px 10px 36px', fontSize: 14, fontFamily: 'monospace' }}
                autoFocus
              />
            </div>
            {/* Text search */}
            <div style={{ flex: 1 }}>
              <SearchInput onSelect={addToCart} placeholder="Buscar por nombre..." />
            </div>
            {/* +1 btn */}
            <button
              onClick={() => {
                if (cart.length > 0) {
                  setCart(prev => {
                    const u = [...prev]
                    u[u.length - 1] = { ...u[u.length - 1], quantity: u[u.length - 1].quantity + 1 }
                    return u
                  })
                }
              }}
              className="nm-btn"
              style={{ padding: '9px 14px', fontSize: 13 }}
              title="+1 al último artículo"
            >
              +1
            </button>
            <button
              onClick={handleNewSale}
              className="nm-btn"
              style={{ padding: '9px 14px', fontSize: 13, whiteSpace: 'nowrap' }}
              title={cart.length > 0 ? 'Poner en espera y abrir nuevo ticket (F2)' : 'Nueva venta (F2)'}
            >
              {cart.length > 0 ? '⏸ En espera (F2)' : 'Nueva (F2)'}
            </button>
          </div>

          {/* Cart table */}
          <div style={{
            background: 'var(--nm-bg)',
            borderRadius: 16,
            boxShadow: 'var(--nm-raised)',
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '5fr 2fr 2fr 2fr 1fr',
              padding: '10px 14px',
              boxShadow: '0 2px 0 var(--nm-shadow-light), 0 3px 0 var(--nm-shadow-dark)',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.08em',
              color: 'var(--nm-text-muted)',
              textTransform: 'uppercase',
            }}>
              <div>Producto</div>
              <div style={{ textAlign: 'center' }}>Cant.</div>
              <div style={{ textAlign: 'right' }}>Precio</div>
              <div style={{ textAlign: 'right' }}>Subtotal</div>
              <div style={{ textAlign: 'center' }}>✕</div>
            </div>

            {/* Cart rows */}
            <div className="nm-scroll" style={{ flex: 1, overflowY: 'auto' }}>
              {cart.length === 0 && (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', height: '100%', padding: 40,
                  color: 'var(--nm-text-light)',
                }}>
                  <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>🛒</div>
                  <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.6 }}>
                    Escanee o busque un producto
                  </div>
                </div>
              )}
              {cart.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '5fr 2fr 2fr 2fr 1fr',
                    padding: '9px 14px',
                    alignItems: 'center',
                    borderBottom: idx < cart.length - 1
                      ? '1px solid transparent'
                      : 'none',
                    boxShadow: idx < cart.length - 1
                      ? '0 1px 0 var(--nm-shadow-light), 0 2px 0 rgba(184,190,199,0.3)'
                      : 'none',
                    background: idx === cart.length - 1
                      ? 'linear-gradient(145deg, rgba(91,141,238,0.04), rgba(91,141,238,0.01))'
                      : 'transparent',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--nm-text)' }}>{item.name}</div>
                    {item.promo_name && (
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        color: 'var(--nm-success)', background: 'rgba(56,193,114,0.12)',
                        padding: '1px 6px', borderRadius: 4,
                      }}>{item.promo_name}</span>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--nm-text-light)', fontWeight: 600 }}>{item.code}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    {editingIndex === idx ? (
                      <input
                        autoFocus
                        type="number"
                        value={editingQty}
                        onChange={e => setEditingQty(e.target.value)}
                        onBlur={() => saveEditQty(idx)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEditQty(idx) }}
                        className="nm-input"
                        style={{ width: 60, textAlign: 'center', padding: '4px 6px', fontSize: 13 }}
                        min="0"
                      />
                    ) : (
                      <span
                        onClick={() => { setEditingIndex(idx); setEditingQty(String(item.quantity)) }}
                        style={{
                          cursor: 'pointer',
                          padding: '3px 10px',
                          borderRadius: 8,
                          fontWeight: 800,
                          fontSize: 14,
                          color: 'var(--nm-text)',
                          background: 'var(--nm-bg)',
                          boxShadow: 'var(--nm-raised-sm)',
                          display: 'inline-block',
                        }}
                      >
                        {item.quantity}
                      </span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {editingPriceIndex === idx ? (
                      <input
                        autoFocus
                        type="number"
                        value={editingPrice}
                        onChange={e => setEditingPrice(e.target.value)}
                        onBlur={() => saveEditPrice(idx)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEditPrice(idx) }}
                        className="nm-input"
                        style={{ width: 80, textAlign: 'right', padding: '4px 6px', fontSize: 13 }}
                        step="0.01"
                        min="0"
                      />
                    ) : (
                      <span
                        onClick={() => { setEditingPriceIndex(idx); setEditingPrice(String(item.unit_price)) }}
                        style={{ cursor: 'pointer', fontSize: 13, color: 'var(--nm-text-muted)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}
                        title="Editar precio (solo esta venta)"
                      >
                        {item.price_overridden && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--nm-accent)' }} title="Precio editado">✎</span>
                        )}
                        {fmt(item.unit_price)}
                      </span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 800, color: 'var(--nm-text)' }}>
                    {fmt(item.unit_price * item.quantity)}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => removeFromCart(idx)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--nm-text-light)', fontWeight: 900, fontSize: 15,
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--nm-danger)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--nm-text-light)')}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Cart footer */}
            <div style={{
              padding: '8px 14px',
              boxShadow: '0 -2px 0 var(--nm-shadow-light), 0 -3px 0 rgba(184,190,199,0.4)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--nm-text-muted)',
            }}>
              {cart.length} artículo(s) · Click en cantidad o precio para editar
            </div>
          </div>
        </div>

        {/* Right: Payment panel */}
        <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
          {/* Totals + Payment */}
          <div style={{
            background: 'var(--nm-bg)',
            borderRadius: 18,
            boxShadow: 'var(--nm-raised)',
            padding: '16px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            {/* Subtotal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--nm-text-muted)' }}>
              <span>Subtotal</span>
              <span>{fmt(subtotal)}</span>
            </div>
            {totalDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: 'var(--nm-success)' }}>
                <span>Descuentos</span>
                <span>−{fmt(totalDiscount)}</span>
              </div>
            )}

            {/* Total */}
            <div style={{
              background: 'var(--nm-bg)',
              borderRadius: 14,
              boxShadow: 'var(--nm-inset)',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'flex-end',
              gap: 4,
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--nm-text-muted)' }}>TOTAL</span>
              <span style={{ fontSize: 30, fontWeight: 900, color: 'var(--nm-text)', letterSpacing: '-0.02em' }}>
                {fmt(total)}
              </span>
            </div>

            {/* Mode toggle */}
            <div style={{
              display: 'flex',
              gap: 6,
              background: 'var(--nm-bg)',
              borderRadius: 12,
              padding: 4,
              boxShadow: 'var(--nm-inset-sm)',
            }}>
              {[{ id: false, label: 'Pago Simple' }, { id: true, label: 'Pago Mixto' }].map(m => (
                <button
                  key={String(m.id)}
                  onClick={() => {
                    if (m.id) {
                      setMixedMode(true)
                      setPayments({ efectivo: '', tarjeta: '', transferencia: '' })
                      setPaymentEnabled({ efectivo: true, tarjeta: true, transferencia: false })
                    } else {
                      setMixedMode(false)
                      setPayments({ efectivo: '', tarjeta: '', transferencia: '' })
                      setPaymentEnabled({ efectivo: true, tarjeta: false, transferencia: false })
                    }
                  }}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 9,
                    fontSize: 11, fontWeight: 800, border: 'none', cursor: 'pointer',
                    transition: 'all 0.18s ease',
                    background: mixedMode === m.id ? 'var(--nm-bg)' : 'transparent',
                    boxShadow: mixedMode === m.id ? 'var(--nm-raised-sm)' : 'none',
                    color: mixedMode === m.id ? 'var(--nm-accent)' : 'var(--nm-text-muted)',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Payment rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([
                { key: 'efectivo', icon: '💵', label: 'EFECTIVO' },
                { key: 'tarjeta', icon: '💳', label: 'TARJETA' },
                { key: 'transferencia', icon: '📱', label: 'TRANSFER' },
              ] as const).map(({ key, icon, label }) => {
                const isOn = paymentEnabled[key]
                return (
                  <div
                    key={key}
                    style={{
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: 'var(--nm-bg)',
                      boxShadow: isOn ? 'var(--nm-inset-sm)' : 'var(--nm-raised-sm)',
                      transition: 'box-shadow 0.2s ease',
                    }}
                  >
                    <button
                      onClick={() => toggleMethod(key)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 12px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 800,
                        color: isOn ? 'var(--nm-accent)' : 'var(--nm-text-muted)',
                        fontFamily: 'Nunito, sans-serif',
                        transition: 'color 0.15s',
                      }}
                    >
                      <span
                        style={{
                          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 900,
                          background: isOn ? 'linear-gradient(145deg, #6b9cf0, #4d7ee8)' : 'var(--nm-bg)',
                          boxShadow: isOn
                            ? '2px 2px 5px rgba(77,126,232,0.4)'
                            : 'var(--nm-inset-sm)',
                          color: 'white',
                          transition: 'all 0.18s',
                        }}
                      >
                        {isOn ? '✓' : ''}
                      </span>
                      <span>{icon} {label}</span>
                    </button>
                    {isOn && (
                      <div style={{ padding: '0 12px 10px' }}>
                        <input
                          type="number"
                          value={payments[key]}
                          onChange={e => setPayment(key, e.target.value)}
                          placeholder={!mixedMode && pending > 0 ? fmt(pending).replace('$', '') : '0.00'}
                          className="nm-input"
                          style={{
                            width: '100%', padding: '8px 12px',
                            textAlign: 'right', fontSize: 16, fontWeight: 800,
                          }}
                          step="0.01"
                          min="0"
                        />
                        {key === 'efectivo' && change > 0 && (
                          <div style={{
                            textAlign: 'right', fontSize: 12, fontWeight: 800,
                            color: 'var(--nm-success)', marginTop: 4,
                          }}>
                            Cambio: {fmt(change)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Pending indicator (mixed mode) */}
            {mixedMode && (
              <div style={{
                borderRadius: 10,
                padding: '8px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                fontWeight: 800,
                background: 'var(--nm-bg)',
                boxShadow: pending <= 0.005
                  ? 'inset 2px 2px 6px rgba(47,168,93,0.2), inset -2px -2px 5px rgba(255,255,255,0.7)'
                  : 'inset 2px 2px 6px rgba(204,47,42,0.2), inset -2px -2px 5px rgba(255,255,255,0.7)',
                color: pending <= 0.005 ? 'var(--nm-success)' : 'var(--nm-danger)',
              }}>
                <span>{pending <= 0.005 ? '✓ Cubierto' : 'Pendiente:'}</span>
                <span>{pending <= 0.005 ? fmt(total) : fmt(pending)}</span>
              </div>
            )}

            {/* Charge button */}
            <button
              onClick={() => { if (canCharge) setShowPayModal(true) }}
              disabled={!canCharge}
              className={canCharge ? 'nm-btn-success' : 'nm-btn'}
              style={{
                width: '100%',
                padding: '16px',
                fontSize: 17,
                letterSpacing: '0.06em',
                opacity: !canCharge ? 0.45 : 1,
                cursor: !canCharge ? 'not-allowed' : 'pointer',
              }}
            >
              COBRAR
            </button>
          </div>

          {/* Cash movements */}
          <div style={{
            background: 'var(--nm-bg)',
            borderRadius: 16,
            boxShadow: 'var(--nm-raised)',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
              color: 'var(--nm-text-muted)', textTransform: 'uppercase', marginBottom: 2,
            }}>
              Movimientos de Caja
            </div>
            <button
              onClick={() => setShowMovModal('entrada')}
              disabled={!shift}
              className="nm-btn"
              style={{
                width: '100%', padding: '9px', fontSize: 12,
                color: 'var(--nm-accent)',
              }}
            >
              + ENTRADA DE EFECTIVO
            </button>
            <button
              onClick={() => setShowMovModal('salida')}
              disabled={!shift}
              className="nm-btn"
              style={{
                width: '100%', padding: '9px', fontSize: 12,
                color: 'var(--nm-danger)',
              }}
            >
              − RETIRO DE EFECTIVO
            </button>
            <div style={{
              textAlign: 'center', fontSize: 11, fontWeight: 600,
              color: 'var(--nm-text-muted)', paddingTop: 2,
            }}>
              En caja: <span style={{ fontWeight: 800, color: 'var(--nm-text)' }}>{fmt(cashBalance)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* CONFIRM PAYMENT MODAL */}
      {showPayModal && (
        <Modal title="Confirmar Pago" onClose={() => setShowPayModal(false)} size="sm">
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--nm-accent)' }}>{fmt(total)}</div>
            {mixedMode ? (
              <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(payments).filter(([k]) => paymentEnabled[k as keyof typeof paymentEnabled] && parseFloat(payments[k as keyof typeof payments]) > 0).map(([k, v]) => (
                  <div key={k} style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: 13, fontWeight: 700,
                    background: 'var(--nm-bg)',
                    boxShadow: 'var(--nm-inset-sm)',
                    borderRadius: 10, padding: '8px 12px',
                    color: 'var(--nm-text)',
                  }}>
                    <span style={{ color: 'var(--nm-text-muted)', textTransform: 'capitalize' }}>
                      {k === 'efectivo' ? '💵 Efectivo' : k === 'tarjeta' ? '💳 Tarjeta' : '📱 Transferencia'}
                    </span>
                    <span>{fmt(parseFloat(v) || 0)}</span>
                  </div>
                ))}
                {change > 0 && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(52,199,89,0.08)', borderRadius: 10, padding: '10px 12px',
                    border: '1px solid rgba(52,199,89,0.2)', marginTop: 2,
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#1A8F3A' }}>CAMBIO (efectivo)</span>
                    <span style={{ fontSize: 18, fontWeight: 900, color: '#1A8F3A' }}>{fmt(change)}</span>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--nm-text-muted)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span>Forma de pago: <strong style={{ color: 'var(--nm-text)' }}>{activeMethod.toUpperCase()}</strong></span>
                {paymentEnabled.efectivo && cashAmt > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div>Recibido: {fmt(cashAmt)}</div>
                    {change > 0 && <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--nm-success)' }}>Cambio: {fmt(change)}</div>}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
              <button onClick={() => setShowPayModal(false)} className="nm-btn" style={{ flex: 1, padding: '12px', fontSize: 14, color: 'var(--nm-text-muted)' }}>
                Cancelar
              </button>
              <button onClick={handlePayment} className="nm-btn-success" style={{ flex: 1, padding: '12px', fontSize: 14 }}>
                Confirmar ✓
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* CASH MOVEMENT MODAL */}
      {showMovModal && (
        <Modal title={showMovModal === 'entrada' ? '+ Entrada de Efectivo' : '− Retiro de Efectivo'} onClose={() => setShowMovModal(null)} size="sm">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--nm-text-muted)', marginBottom: 6 }}>Monto</label>
              <input
                type="number"
                value={movAmount}
                onChange={e => setMovAmount(e.target.value)}
                className="nm-input"
                style={{ width: '100%', padding: '12px 14px', fontSize: 22, textAlign: 'right', fontWeight: 900 }}
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--nm-text-muted)', marginBottom: 6 }}>Concepto</label>
              <input
                type="text"
                value={movConcept}
                onChange={e => setMovConcept(e.target.value)}
                className="nm-input"
                style={{ width: '100%', padding: '10px 14px', fontSize: 14 }}
                placeholder="Descripción del movimiento"
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowMovModal(null)} className="nm-btn" style={{ flex: 1, padding: '11px', fontSize: 13, color: 'var(--nm-text-muted)' }}>
                Cancelar
              </button>
              <button
                onClick={handleCashMovement}
                disabled={!movAmount || !movConcept}
                className={showMovModal === 'entrada' ? 'nm-btn-accent' : 'nm-btn-danger'}
                style={{ flex: 1, padding: '11px', fontSize: 13 }}
              >
                Guardar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* RECEIPT MODAL */}
      {showReceiptModal && lastSale && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(242,242,247,0.8)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#FFFFFF',
            borderRadius: 28,
            boxShadow: '0 24px 60px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.07)',
            padding: '32px 36px',
            width: 400,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
          }}>
            {/* Success icon */}
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: 'linear-gradient(160deg, #4CD964, #34C759)',
              boxShadow: '0 6px 20px rgba(52,199,89,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, marginBottom: 16,
            }}>✓</div>

            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--nm-text-muted)', marginBottom: 4 }}>Venta Completada</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: 'var(--nm-text)', letterSpacing: '-0.03em', marginBottom: 2 }}>
              {fmt(lastSale.total)}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--nm-text-muted)', marginBottom: 20 }}>
              Folio: <span style={{ color: 'var(--nm-accent)', fontWeight: 700 }}>{lastSale.folio}</span>
            </div>

            {/* Payment breakdown */}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {lastSale.isMixed
                ? Object.entries(lastSale.activePayments as Record<string, number>).map(([k, v]) => (
                  <div key={k} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'var(--nm-bg)', borderRadius: 10, padding: '9px 14px',
                    border: '1px solid var(--nm-separator)',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--nm-text-muted)', textTransform: 'capitalize' }}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--nm-text)' }}>{fmt(v)}</span>
                  </div>
                ))
                : (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'var(--nm-bg)', borderRadius: 10, padding: '9px 14px',
                    border: '1px solid var(--nm-separator)',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--nm-text-muted)', textTransform: 'capitalize' }}>
                      {lastSale.activeMethod}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--nm-text)' }}>
                      {fmt(lastSale.received_amount ?? lastSale.total)}
                    </span>
                  </div>
                )
              }
              {lastSale.change > 0 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: 'rgba(52,199,89,0.08)', borderRadius: 10, padding: '10px 14px',
                  border: '1px solid rgba(52,199,89,0.2)',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#1A8F3A', letterSpacing: '0.04em' }}>CAMBIO</span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: '#1A8F3A', letterSpacing: '-0.02em' }}>{fmt(lastSale.change)}</span>
                </div>
              )}
            </div>

            {/* Buttons */}
            <button
              onClick={async () => { await handlePrintReceipt(); setShowReceiptModal(false); setLastSale(null); codeRef.current?.focus() }}
              className="nm-btn-accent"
              style={{ width: '100%', padding: '16px', fontSize: 16, fontWeight: 800, marginBottom: 10, borderRadius: 14 }}
              autoFocus
            >
              🖨️ Imprimir Ticket
            </button>
            <button
              onClick={() => { setShowReceiptModal(false); setLastSale(null); codeRef.current?.focus() }}
              className="nm-btn"
              style={{ width: '100%', padding: '13px', fontSize: 14, color: 'var(--nm-text-muted)', borderRadius: 14 }}
            >
              Sin Ticket
            </button>
          </div>
        </div>
      )}

      {/* ── VENTAS DEL DÍA PANEL ─────────────────────────────────── */}
      {showDailySales && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'flex-end',
        }} onClick={e => { if (e.target === e.currentTarget) setShowDailySales(false) }}>
          <div style={{
            background: 'var(--nm-bg)', borderRadius: '24px 24px 0 0',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
            width: '100%', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--nm-separator)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--nm-text)' }}>Ventas del Día</div>
                <div style={{ fontSize: 12, color: 'var(--nm-text-muted)', marginTop: 2 }}>
                  {dailySales.filter(s => !s.cancelled).length} ventas · Total: {fmt(dailySales.filter(s => !s.cancelled).reduce((a, s) => a + s.total, 0))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={async () => { await loadDailySales() }} className="nm-btn" style={{ padding: '6px 12px', fontSize: 12, color: 'var(--nm-accent)' }}>
                  ↺ Actualizar
                </button>
                <button onClick={() => setShowDailySales(false)} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--nm-bg)', boxShadow: 'var(--nm-raised-sm)', cursor: 'pointer', fontSize: 16, color: 'var(--nm-text-muted)' }}>✕</button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
              {dailySales.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--nm-text-muted)', padding: '40px 0', fontSize: 13 }}>Sin ventas hoy</div>
              )}
              {dailySales.map(sale => {
                const isCancelled = !!sale.cancelled
                return (
                  <div key={sale.id} style={{
                    border: `1.5px solid ${isCancelled ? 'transparent' : 'var(--nm-separator)'}`,
                    borderRadius: 14, padding: '12px 16px', marginBottom: 8,
                    background: isCancelled ? 'rgba(0,0,0,0.03)' : 'var(--nm-surface)',
                    opacity: isCancelled ? 0.5 : 1,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--nm-text-muted)' }}>{sale.folio}</span>
                        {isCancelled && <span style={{ fontSize: 10, fontWeight: 800, color: '#cc2f2a', background: 'rgba(204,47,42,0.1)', padding: '2px 8px', borderRadius: 6 }}>CANCELADA</span>}
                      </div>
                      <span style={{ fontSize: 16, fontWeight: 900, color: isCancelled ? 'var(--nm-text-muted)' : 'var(--nm-text)' }}>{fmt(sale.total)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--nm-text-muted)' }}>
                        🕐 {new Date(sale.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--nm-text-muted)', textTransform: 'capitalize' }}>💳 {sale.payment_type}</span>
                      <span style={{ fontSize: 11, color: 'var(--nm-text-muted)' }}>👤 {sale.cashier_name}</span>
                      <span style={{ fontSize: 11, color: 'var(--nm-text-muted)' }}>📦 {sale.items?.length || 0} artículos</span>
                    </div>
                    {sale.items?.length > 0 && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--nm-separator)' }}>
                        {sale.items.map((item: any, i: number) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '1px 0', color: 'var(--nm-text-muted)' }}>
                            <span>{item.product_name} × {item.quantity}</span>
                            <span>{fmt(item.unit_price * item.quantity)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── CANCEL PANEL ─────────────────────────────────────────── */}
      {showCancelPanel && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'flex-end',
        }} onClick={e => { if (e.target === e.currentTarget) { setShowCancelPanel(false); setCancelTarget(null); setCancelReason('') } }}>
          <div style={{
            background: 'var(--nm-bg)', borderRadius: '24px 24px 0 0',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
            width: '100%', maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--nm-separator)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--nm-text)' }}>Cancelar Venta</div>
                <div style={{ fontSize: 12, color: 'var(--nm-text-muted)', marginTop: 2 }}>Ventas de hoy — selecciona la que deseas cancelar</div>
              </div>
              <button onClick={() => { setShowCancelPanel(false); setCancelTarget(null); setCancelReason('') }}
                style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--nm-bg)', boxShadow: 'var(--nm-raised-sm)', cursor: 'pointer', fontSize: 16, color: 'var(--nm-text-muted)' }}>✕</button>
            </div>

            {/* Sales list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
              {todaySales.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--nm-text-muted)', padding: '40px 0', fontSize: 13 }}>Sin ventas hoy</div>
              )}
              {todaySales.map(sale => {
                const isCancelled = !!sale.cancelled
                const isSelected = cancelTarget?.id === sale.id
                return (
                  <div key={sale.id}
                    onClick={() => !isCancelled && setCancelTarget(isSelected ? null : sale)}
                    style={{
                      border: `2px solid ${isSelected ? '#cc2f2a' : isCancelled ? 'transparent' : 'var(--nm-separator)'}`,
                      borderRadius: 14, padding: '12px 16px', marginBottom: 8,
                      cursor: isCancelled ? 'default' : 'pointer',
                      background: isCancelled ? 'rgba(0,0,0,0.03)' : isSelected ? 'rgba(204,47,42,0.05)' : 'var(--nm-surface)',
                      opacity: isCancelled ? 0.5 : 1,
                      transition: 'all 0.15s',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--nm-text-muted)' }}>
                          {sale.folio}
                        </div>
                        {isCancelled && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: '#cc2f2a', background: 'rgba(204,47,42,0.1)', padding: '2px 8px', borderRadius: 6 }}>CANCELADA</span>
                        )}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: isCancelled ? 'var(--nm-text-muted)' : 'var(--nm-text)' }}>
                        {fmt(sale.total)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--nm-text-muted)' }}>
                        {new Date(sale.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--nm-text-muted)', textTransform: 'capitalize' }}>{sale.payment_type}</span>
                      <span style={{ fontSize: 11, color: 'var(--nm-text-muted)' }}>{sale.cashier_name}</span>
                      <span style={{ fontSize: 11, color: 'var(--nm-text-muted)' }}>{sale.items?.length || 0} artículos</span>
                    </div>
                    {isSelected && sale.items?.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--nm-separator)' }}>
                        {sale.items.map((item: any, i: number) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0', color: 'var(--nm-text-muted)' }}>
                            <span>{item.product_name} × {item.quantity}</span>
                            <span>{fmt(item.unit_price * item.quantity)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Confirm area */}
            {cancelTarget && (
              <div style={{ padding: '16px 24px 28px', borderTop: '1px solid var(--nm-separator)', background: 'var(--nm-surface)', flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--nm-text-muted)', marginBottom: 8 }}>
                  Motivo de cancelación (opcional)
                </div>
                <input
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder="Ej: Error en el precio, producto incorrecto..."
                  className="nm-input"
                  style={{ width: '100%', marginBottom: 12, padding: '10px 14px', fontSize: 13 }}
                  onKeyDown={e => { if (e.key === 'Enter') handleCancelSale() }}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => { setCancelTarget(null); setCancelReason('') }} className="nm-btn"
                    style={{ flex: 1, padding: '13px', fontSize: 13, color: 'var(--nm-text-muted)' }}>
                    Regresar
                  </button>
                  <button onClick={handleCancelSale} disabled={cancelLoading}
                    style={{
                      flex: 2, padding: '13px', fontSize: 14, fontWeight: 800, borderRadius: 12, border: 'none', cursor: 'pointer',
                      background: cancelLoading ? 'rgba(204,47,42,0.5)' : 'linear-gradient(145deg, #e8504c, #cc2f2a)',
                      color: 'white', boxShadow: '0 4px 14px rgba(204,47,42,0.35)',
                    }}>
                    {cancelLoading ? 'Cancelando...' : `✕ Cancelar venta ${fmt(cancelTarget.total)}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
