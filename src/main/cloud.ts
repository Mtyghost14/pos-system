// ─────────────────────────────────────────────────────────────────────────────
// Conexión con Supabase (nube) — Fase 0.
// El POS inicia sesión como el usuario "terminal" y desde ahí lee/escribe el
// inventario compartido con el portal web. Ver: pos-system-vault/kaddo-sync-architecture.md
// ─────────────────────────────────────────────────────────────────────────────
import { ipcMain, BrowserWindow } from 'electron'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import WS from 'ws'
import { getDb } from './database'

let client: SupabaseClient | null = null
let ready = false
let win: BrowserWindow | null = null
let channel: ReturnType<SupabaseClient['channel']> | null = null

const CFG_KEYS = ['supabase_url', 'supabase_anon_key', 'cloud_terminal_user', 'cloud_terminal_pass'] as const

function readCfg(): Record<string, string> {
  const rows = getDb()
    .prepare(`SELECT key, value FROM settings WHERE key IN (${CFG_KEYS.map(() => '?').join(',')})`)
    .all(...CFG_KEYS) as { key: string; value: string }[]
  return Object.fromEntries(rows.map(r => [r.key, r.value ?? '']))
}

function emailFor(user: string): string {
  return user.includes('@') ? user.trim() : `${user.trim()}@kaddo.local`
}

export function isCloudReady(): boolean { return ready }
export function getCloudClient(): SupabaseClient | null { return ready ? client : null }

/** Llama a un RPC de la nube. Lanza si no hay conexión o si el RPC devuelve error. */
export async function cloudRpc<T = any>(fn: string, args: Record<string, any>): Promise<T> {
  if (!ready || !client) throw new Error('Sin conexión con la nube')
  const { data, error } = await client.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

/** (Re)crea el cliente, inicia sesión como "terminal" y abre el canal realtime. */
export async function reloadCloud(): Promise<{ ok: boolean; message?: string }> {
  ready = false
  try { if (channel) { await client?.removeChannel(channel) } } catch { /* ignore */ }
  channel = null

  const cfg = readCfg()
  if (!cfg.supabase_url || !cfg.supabase_anon_key || !cfg.cloud_terminal_user || !cfg.cloud_terminal_pass) {
    client = null
    return { ok: false, message: 'Faltan datos de conexión (URL, llave o usuario/contraseña terminal).' }
  }

  try {
    client = createClient(cfg.supabase_url, cfg.supabase_anon_key, {
      auth: { persistSession: false, autoRefreshToken: true },
      // Electron main (Node) has no global WebSocket — supply `ws` for realtime.
      realtime: { transport: WS as unknown as typeof WebSocket },
    })
    const { error } = await client.auth.signInWithPassword({
      email: emailFor(cfg.cloud_terminal_user),
      password: cfg.cloud_terminal_pass,
    })
    if (error) { client = null; return { ok: false, message: `Login terminal: ${error.message}` } }

    ready = true
    subscribeRealtime()
    void syncCatalogToLocal()
    if (periodicTimer) clearInterval(periodicTimer)
    periodicTimer = setInterval(() => { if (ready) void syncCatalogToLocal() }, 60_000)
    return { ok: true }
  } catch (e: any) {
    client = null
    return { ok: false, message: e?.message || 'Error inesperado al conectar' }
  }
}

function subscribeRealtime() {
  if (!client || !win) return
  channel = client
    .channel('pos-inventory')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, payload => {
      win?.webContents.send('cloud:changed', { table: 'products', new: payload.new, old: payload.old })
      scheduleSync()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements' }, payload => {
      win?.webContents.send('cloud:changed', { table: 'inventory_movements', new: payload.new })
    })
    .subscribe(status => {
      win?.webContents.send('cloud:realtime', { status })
    })
}

// ─── Cache local del catálogo ───────────────────────────────────────────────
// La nube es la fuente de verdad; el POS mantiene una copia local de
// categories / products / product_barcodes para leer rápido y offline.
// Se refresca al conectar, cada 60 s, y ante cualquier cambio realtime.

let syncTimer: NodeJS.Timeout | null = null
let periodicTimer: NodeJS.Timeout | null = null
let syncing = false

function scheduleSync(delayMs = 400) {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => { void syncCatalogToLocal() }, delayMs)
}

export async function syncCatalogToLocal(): Promise<{ ok: boolean; message?: string; products?: number }> {
  if (!ready || !client) return { ok: false, message: 'Sin conexión con la nube' }
  if (syncing) return { ok: true }
  syncing = true
  try {
    const [cats, prods, bcs] = await Promise.all([
      client.from('categories').select('id,name'),
      client.from('products').select('id,code,name,category_id,cost,price,stock,min_stock,active'),
      client.from('product_barcodes').select('id,product_id,code,label'),
    ])
    const err = cats.error || prods.error || bcs.error
    if (err) return { ok: false, message: err.message }

    const db = getDb()
    // Upsert por clave natural (code / name) conservando el id local (los renglones
    // de venta históricos lo referencian). `cloud_id` mapea al id de la nube.
    const tx = db.transaction(() => {
      const upCat = db.prepare(`INSERT INTO categories (name, cloud_id) VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET cloud_id = excluded.cloud_id`)
      for (const c of cats.data as any[]) upCat.run(c.name, c.id)

      db.prepare('UPDATE products SET active = 0 WHERE cloud_id IS NOT NULL').run()
      const upProd = db.prepare(`INSERT INTO products
          (code, name, category_id, cost, price, stock, min_stock, active, cloud_id, updated_at)
          VALUES (@code, @name,
                  (SELECT id FROM categories WHERE cloud_id = @cat),
                  @cost, @price, @stock, @min_stock, @active, @cid, datetime('now','localtime'))
          ON CONFLICT(code) DO UPDATE SET
            name = excluded.name, category_id = excluded.category_id,
            cost = excluded.cost, price = excluded.price, stock = excluded.stock,
            min_stock = excluded.min_stock, active = excluded.active,
            cloud_id = excluded.cloud_id, updated_at = excluded.updated_at`)
      for (const p of prods.data as any[]) upProd.run({
        code: String(p.code), name: p.name, cat: p.category_id,
        cost: p.cost ?? 0, price: p.price ?? 0, stock: p.stock ?? 0, min_stock: p.min_stock ?? 0,
        active: p.active ? 1 : 0, cid: p.id,
      })

      db.prepare('DELETE FROM product_barcodes WHERE cloud_id IS NOT NULL').run()
      const upBc = db.prepare(`INSERT INTO product_barcodes (product_id, code, label, cloud_id)
          VALUES ((SELECT id FROM products WHERE cloud_id = ?), ?, ?, ?)
          ON CONFLICT(code) DO UPDATE SET
            product_id = excluded.product_id, label = excluded.label, cloud_id = excluded.cloud_id`)
      for (const b of bcs.data as any[]) upBc.run(b.product_id, String(b.code), b.label ?? null, b.id)
    })
    tx()

    win?.webContents.send('cloud:catalog-synced', { products: (prods.data as any[]).length })
    return { ok: true, products: (prods.data as any[]).length }
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Error al sincronizar catálogo' }
  } finally {
    syncing = false
  }
}

export function initCloud(browserWindow: BrowserWindow) {
  win = browserWindow
  registerCloudHandlers()
  // No bloquear el arranque; conectar en segundo plano.
  void reloadCloud().then(r => win?.webContents.send('cloud:status', { ready: r.ok, message: r.message }))
}

let handlersRegistered = false
function registerCloudHandlers() {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle('cloud:status', () => {
    const cfg = readCfg()
    const configured = !!(cfg.supabase_url && cfg.supabase_anon_key && cfg.cloud_terminal_user && cfg.cloud_terminal_pass)
    return { ready, configured }
  })

  ipcMain.handle('cloud:syncNow', () => syncCatalogToLocal())

  // Guarda credenciales y reconecta; devuelve un conteo de productos como prueba real.
  ipcMain.handle('cloud:test', async () => {
    const r = await reloadCloud()
    if (!r.ok) return r
    const { count, error } = await client!.from('products').select('*', { count: 'exact', head: true })
    if (error) return { ok: false, message: error.message }
    return { ok: true, count: count ?? 0 }
  })

  // Migración única: sube el catálogo local que aún no exista en la nube.
  ipcMain.handle('cloud:migrateCatalog', async () => {
    if (!ready || !client) {
      const r = await reloadCloud()
      if (!r.ok) return { ok: false, message: r.message }
    }
    const db = getDb()
    const localProducts = db.prepare(`
      SELECT p.code, p.name, c.name AS category, p.cost, p.price, p.stock, p.min_stock
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1
    `).all() as any[]
    const localBarcodes = db.prepare(`
      SELECT pb.code, pb.label, p.code AS product_code
      FROM product_barcodes pb JOIN products p ON pb.product_id = p.id
      WHERE p.active = 1
    `).all() as any[]

    // Solo subir lo que no exista ya en la nube (idempotente / reanudable).
    const { data: existing, error: exErr } = await client!.from('products').select('code')
    if (exErr) return { ok: false, message: `No se pudo leer la nube: ${exErr.message}` }
    const have = new Set((existing || []).map((r: any) => r.code))

    let uploaded = 0, skipped = 0
    const errors: string[] = []
    for (const p of localProducts) {
      if (have.has(p.code)) { skipped++; continue }
      const { error } = await client!.rpc('upsert_product', {
        p_id: null,
        p_code: String(p.code),
        p_name: p.name,
        p_category: p.category ?? null,
        p_cost: p.cost ?? 0,
        p_price: p.price ?? 0,
        p_min_stock: p.min_stock ?? 0,
        p_stock: p.stock ?? 0,
      })
      if (error) errors.push(`${p.code}: ${error.message}`)
      else uploaded++
    }

    // Códigos de barras adicionales
    const { data: cloudProducts } = await client!.from('products').select('id, code')
    const idByCode = new Map((cloudProducts || []).map((r: any) => [r.code, r.id]))
    let barcodesUploaded = 0
    for (const b of localBarcodes) {
      const pid = idByCode.get(b.product_code)
      if (!pid) continue
      const { error } = await client!.rpc('add_barcode', { p_product_id: pid, p_code: String(b.code), p_label: b.label ?? null })
      if (!error) barcodesUploaded++
      else if (!/ya est[aá] en uso/i.test(error.message)) errors.push(`código ${b.code}: ${error.message}`)
    }

    return {
      ok: errors.length === 0,
      uploaded, skipped, barcodesUploaded,
      total: localProducts.length,
      errors: errors.slice(0, 25),
    }
  })
}
