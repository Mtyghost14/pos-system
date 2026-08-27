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
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements' }, payload => {
      win?.webContents.send('cloud:changed', { table: 'inventory_movements', new: payload.new })
    })
    .subscribe(status => {
      win?.webContents.send('cloud:realtime', { status })
    })
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
