// ─────────────────────────────────────────────────────────────────────────────
// Recepción de mercancía por Excel: SUMA cantidades al inventario de la nube.
//   · código que ya existe (principal o adicional) → suma al stock (movimiento "recepcion")
//   · código nuevo                                → crea el producto y le da esa cantidad
//   · código repetido dentro del archivo          → las cantidades se suman entre sí
// La nube es la fuente de verdad; al final se refresca la copia local.
// ─────────────────────────────────────────────────────────────────────────────
import { ipcMain } from 'electron'
import { basename } from 'path'
import { getCloudClient, cloudRpc, isCloudReady, syncCatalogToLocal } from './cloud'

type RecvInput = {
  code: any; quantity: any; name?: any; price?: any; cost?: any; category?: any; min_stock?: any; row?: number
}

type PlanItem = {
  code: string
  quantity: number
  status: 'existente' | 'nuevo' | 'reactivar' | 'error'
  message?: string
  productId?: number
  name: string
  price: number
  cost: number
  category: string | null
  min_stock: number
  stockActual?: number
  stockNuevo?: number
}

const REF_PREFIX = 'Recepción Excel: '

function plain(v: any): any {
  // celdas de ExcelJS con fórmula / texto enriquecido
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result
    if ('text' in v) return v.text
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('')
  }
  return v
}

function toNum(v: any): number | null {
  v = plain(v)
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

function toStr(v: any): string {
  v = plain(v)
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

async function fetchAll(table: string, columns: string): Promise<any[]> {
  const client = getCloudClient()
  if (!client) throw new Error('Sin conexión con la nube')
  const out: any[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await client.from(table).select(columns).range(from, from + page - 1)
    if (error) throw new Error(`No se pudo leer ${table}: ${error.message}`)
    out.push(...(data || []))
    if (!data || data.length < page) break
  }
  return out
}

async function buildPlan(rows: RecvInput[]) {
  // 1) Agrupar por código (las repetidas se suman) y validar cantidades
  const grouped = new Map<string, PlanItem & { repeats: number }>()
  const errors: PlanItem[] = []
  let repeatedRows = 0

  for (const r of rows) {
    const code = toStr(r.code)
    const qtyRaw = plain(r.quantity)
    if (!code && (qtyRaw === null || qtyRaw === undefined || qtyRaw === '')) continue // renglón vacío
    const label = `Fila ${r.row ?? '?'}`
    if (!code) {
      errors.push({ code: '(sin código)', quantity: 0, status: 'error', message: `${label}: falta el código`, name: toStr(r.name), price: 0, cost: 0, category: null, min_stock: 0 })
      continue
    }
    const qty = toNum(r.quantity)
    if (qty === null || qty <= 0) {
      errors.push({ code, quantity: 0, status: 'error', message: `${label}: cantidad inválida (debe ser mayor a 0)`, name: toStr(r.name), price: 0, cost: 0, category: null, min_stock: 0 })
      continue
    }
    const cur = grouped.get(code)
    if (cur) {
      cur.quantity += qty
      cur.repeats++
      repeatedRows++
      // completar datos faltantes con lo que traiga esta fila
      if (!cur.name) cur.name = toStr(r.name)
      if (!cur.price) cur.price = toNum(r.price) ?? 0
      if (!cur.cost) cur.cost = toNum(r.cost) ?? 0
      if (!cur.category) cur.category = toStr(r.category) || null
      if (!cur.min_stock) cur.min_stock = toNum(r.min_stock) ?? 0
    } else {
      grouped.set(code, {
        code, quantity: qty, status: 'nuevo', repeats: 1,
        name: toStr(r.name), price: toNum(r.price) ?? 0, cost: toNum(r.cost) ?? 0,
        category: toStr(r.category) || null, min_stock: toNum(r.min_stock) ?? 0,
      })
    }
  }

  // 2) Comparar contra la nube
  const [products, barcodes, cats] = await Promise.all([
    fetchAll('products', 'id,code,name,category_id,cost,price,stock,min_stock,active'),
    fetchAll('product_barcodes', 'product_id,code'),
    fetchAll('categories', 'id,name'),
  ])
  const byCode = new Map(products.map(p => [String(p.code), p]))
  const byId = new Map(products.map(p => [p.id, p]))
  const byBarcode = new Map(barcodes.map(b => [String(b.code), b.product_id]))
  const catName = new Map(cats.map(c => [c.id, c.name]))

  const items: PlanItem[] = []
  for (const g of grouped.values()) {
    let p = byCode.get(g.code)
    if (!p) {
      const pid = byBarcode.get(g.code)
      if (pid != null) p = byId.get(pid)
    }

    if (p && p.active) {
      const actual = Number(p.stock) || 0
      items.push({
        ...g, status: 'existente', productId: p.id, name: p.name,
        price: Number(p.price) || 0, cost: Number(p.cost) || 0,
        category: catName.get(p.category_id) ?? null, min_stock: Number(p.min_stock) || 0,
        stockActual: actual, stockNuevo: actual + g.quantity,
      })
      continue
    }

    if (p && !p.active) {
      // producto dado de baja con ese código: se reactiva con sus datos (o los del Excel si vienen)
      const name = g.name || p.name
      const price = g.price || Number(p.price) || 0
      if (!name || price <= 0) {
        items.push({ ...g, status: 'error', message: 'Producto dado de baja: faltan nombre/precio para reactivarlo', name, price, category: g.category })
        continue
      }
      items.push({
        ...g, status: 'reactivar', productId: p.id, name, price,
        cost: g.cost || Number(p.cost) || 0,
        category: g.category ?? catName.get(p.category_id) ?? null,
        min_stock: g.min_stock || Number(p.min_stock) || 0,
        stockActual: Number(p.stock) || 0, stockNuevo: (Number(p.stock) || 0) + g.quantity,
      })
      continue
    }

    // código nuevo
    if (!g.name || g.price <= 0) {
      items.push({ ...g, status: 'error', message: 'Producto nuevo: faltan nombre y/o precio (mayor a 0) para darlo de alta' })
      continue
    }
    items.push({ ...g, status: 'nuevo', stockActual: 0, stockNuevo: g.quantity })
  }

  return { items: [...items, ...errors], repeatedRows }
}

async function wasImportedBefore(fileName: string) {
  const client = getCloudClient()
  if (!client) return null
  const esc = fileName.replace(/[\\%_]/g, m => '\\' + m)
  const { data } = await client.from('inventory_movements')
    .select('created_at')
    .eq('type', 'recepcion')
    .ilike('reference', `${REF_PREFIX}${esc}%`)
    .order('created_at', { ascending: false })
    .limit(1)
  return data && data.length ? (data[0] as any).created_at as string : null
}

export function registerReceiveHandlers() {
  // Vista previa: no modifica nada.
  ipcMain.handle('products:receivePreview', async (_e, rows: RecvInput[], filePath: string) => {
    try {
      if (!isCloudReady()) return { success: false, message: 'Sin conexión con la nube' }
      const fileName = basename(filePath || 'archivo.xlsx')
      const plan = await buildPlan(rows)
      const previous = await wasImportedBefore(fileName)
      return { success: true, ...plan, fileName, previousImportAt: previous }
    } catch (e: any) {
      return { success: false, message: e?.message || 'Error al revisar el archivo' }
    }
  })

  // Aplica: suma al inventario.
  ipcMain.handle('products:receive', async (_e, rows: RecvInput[], filePath: string, userName: string) => {
    try {
      if (!isCloudReady()) return { success: false, message: 'Sin conexión con la nube' }
      const fileName = basename(filePath || 'archivo.xlsx')
      const reference = `${REF_PREFIX}${fileName}${userName ? ` (${userName})` : ''}`
      const { items } = await buildPlan(rows)

      let added = 0, created = 0, reactivated = 0, units = 0
      const errors: string[] = items.filter(i => i.status === 'error').map(i => `${i.code}: ${i.message}`)

      for (const it of items) {
        if (it.status === 'error') continue
        try {
          let productId = it.productId
          if (it.status === 'nuevo' || it.status === 'reactivar') {
            // p_stock = 0: el stock entra con adjust_stock para que el movimiento quede bien (antes → después)
            productId = await cloudRpc<number>('upsert_product', {
              p_id: null, p_code: it.code, p_name: it.name, p_category: it.category,
              p_cost: it.cost, p_price: it.price, p_min_stock: it.min_stock, p_stock: 0,
            })
          }
          await cloudRpc('adjust_stock', {
            p_product_id: productId, p_mode: 'add', p_qty: it.quantity,
            p_type: 'recepcion', p_reference: reference,
          })
          if (it.status === 'nuevo') created++
          else if (it.status === 'reactivar') reactivated++
          else added++
          units += it.quantity
        } catch (e: any) {
          errors.push(`${it.code}: ${e?.message || 'error'}`)
        }
      }

      await syncCatalogToLocal()
      return {
        success: errors.length === 0,
        added, created, reactivated, units,
        errors: errors.slice(0, 30), errorCount: errors.length,
      }
    } catch (e: any) {
      return { success: false, message: e?.message || 'Error al recibir la mercancía' }
    }
  })
}
