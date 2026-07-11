import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import { getDb, checkpointDb, closeDb } from './database'
import bcrypt from 'bcryptjs'
import { join } from 'path'
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { exec } from 'child_process'
import ExcelJS from 'exceljs'

function generateFolio(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `F${date}${time}${rand}`
}

export function registerIpcHandlers() {
  const db = getDb()

  // ─── AUTH ───────────────────────────────────────────────────────────────────
  ipcMain.handle('auth:login', (_, username: string, password: string) => {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username) as any
    if (!user) return { success: false, message: 'Usuario no encontrado' }
    const valid = bcrypt.compareSync(password, user.password_hash)
    if (!valid) return { success: false, message: 'Contraseña incorrecta' }
    const { password_hash, ...safeUser } = user
    return { success: true, user: safeUser }
  })

  ipcMain.handle('auth:getUsers', () => {
    return db.prepare('SELECT id, username, plain_password, role, name, active, created_at FROM users ORDER BY name').all()
  })

  ipcMain.handle('auth:createUser', (_, data: any) => {
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(data.username)
    if (exists) return { success: false, message: 'El nombre de usuario ya existe' }
    const hash = bcrypt.hashSync(data.password, 10)
    const res = db.prepare('INSERT INTO users (username, password_hash, plain_password, role, name) VALUES (?,?,?,?,?)').run(
      data.username, hash, data.password, data.role, data.name
    )
    return { success: true, id: res.lastInsertRowid }
  })

  ipcMain.handle('auth:updateUser', (_, data: any) => {
    if (data.password) {
      const hash = bcrypt.hashSync(data.password, 10)
      db.prepare('UPDATE users SET username=?, password_hash=?, plain_password=?, role=?, name=?, active=? WHERE id=?').run(
        data.username, hash, data.password, data.role, data.name, data.active ? 1 : 0, data.id
      )
    } else {
      db.prepare('UPDATE users SET username=?, role=?, name=?, active=? WHERE id=?').run(
        data.username, data.role, data.name, data.active ? 1 : 0, data.id
      )
    }
    return { success: true }
  })

  ipcMain.handle('auth:deleteUser', (_, id: number) => {
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id)
    return { success: true }
  })

  // ─── CATEGORIES ─────────────────────────────────────────────────────────────
  ipcMain.handle('categories:getAll', () => {
    return db.prepare('SELECT * FROM categories ORDER BY name').all()
  })

  ipcMain.handle('categories:create', (_, name: string) => {
    const exists = db.prepare('SELECT id FROM categories WHERE name = ?').get(name)
    if (exists) return { success: false, message: 'La categoría ya existe' }
    const res = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name)
    return { success: true, id: res.lastInsertRowid }
  })

  ipcMain.handle('categories:update', (_, id: number, name: string) => {
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id)
    return { success: true }
  })

  ipcMain.handle('categories:delete', (_, id: number) => {
    try {
      const used = db.prepare('SELECT id FROM products WHERE category_id = ? AND active = 1 LIMIT 1').get(id)
      if (used) return { success: false, message: 'La categoría tiene productos activos' }
      // Inactive (soft-deleted) products still reference this category — clear them first
      // so the foreign key constraint doesn't block the delete
      db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id)
      db.prepare('DELETE FROM categories WHERE id = ?').run(id)
      return { success: true }
    } catch (e: any) {
      return { success: false, message: e?.message || 'Error al eliminar' }
    }
  })

  // ─── PRODUCTS ───────────────────────────────────────────────────────────────
  ipcMain.handle('products:getAll', (_, query?: string) => {
    if (query) {
      return db.prepare(`
        SELECT p.*, c.name as category_name
        FROM products p LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.active = 1 AND (p.name LIKE ? OR p.code LIKE ?)
        ORDER BY p.name LIMIT 50
      `).all(`%${query}%`, `%${query}%`)
    }
    return db.prepare(`
      SELECT p.*, c.name as category_name
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1 ORDER BY p.name
    `).all()
  })

  ipcMain.handle('products:getByCode', (_, code: string) => {
    // Check main code first, then extra barcodes
    let product = db.prepare(`
      SELECT p.*, c.name as category_name
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.code = ? AND p.active = 1
    `).get(code) as any

    if (!product) {
      // Try product_barcodes table
      const alias = db.prepare(`
        SELECT p.*, c.name as category_name
        FROM product_barcodes pb
        JOIN products p ON pb.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE pb.code = ? AND p.active = 1
      `).get(code) as any
      if (alias) product = alias
    }

    if (!product) return null

    // check promotions
    const now = new Date().toISOString().slice(0, 10)
    const promo = db.prepare(`
      SELECT * FROM promotions
      WHERE product_id = ? AND active = 1
      AND start_date <= ? AND end_date >= ?
      LIMIT 1
    `).get(product.id, now, now) as any
    if (promo) {
      if (promo.discount_type === 'percentage') {
        product.promo_price = product.price * (1 - promo.discount_value / 100)
      } else {
        product.promo_price = product.price - promo.discount_value
      }
      product.promo_name = promo.name
    }
    return product
  })

  ipcMain.handle('products:create', (_, data: any) => {
    // Check if an ACTIVE product already uses this code
    const activeConflict = db.prepare('SELECT id FROM products WHERE code = ? AND active = 1').get(data.code)
    if (activeConflict) return { success: false, message: 'El código ya está en uso por otro producto activo' }

    // If a deleted product had this code, reuse its row instead of inserting a new one
    const deleted = db.prepare('SELECT id FROM products WHERE code = ? AND active = 0').get(data.code) as any
    let res: any
    if (deleted) {
      db.prepare(`
        UPDATE products SET name=?, category_id=?, cost=?, price=?, stock=?, min_stock=?, active=1, updated_at=datetime('now','localtime')
        WHERE id=?
      `).run(data.name, data.category_id, data.cost, data.price, data.stock || 0, data.min_stock || 0, deleted.id)
      res = { lastInsertRowid: deleted.id }
    } else {
      res = db.prepare(`
        INSERT INTO products (code, name, category_id, cost, price, stock, min_stock)
        VALUES (?,?,?,?,?,?,?)
      `).run(data.code, data.name, data.category_id, data.cost, data.price, data.stock || 0, data.min_stock || 0)
    }

    if (data.stock > 0) {
      db.prepare(`
        INSERT INTO inventory_movements (product_id, type, quantity_before, quantity_change, quantity_after, notes, cashier_id)
        VALUES (?,?,?,?,?,?,?)
      `).run(res.lastInsertRowid, 'recepcion', 0, data.stock, data.stock, 'Stock inicial', data.cashier_id || 1)
    }
    return { success: true, id: res.lastInsertRowid }
  })

  ipcMain.handle('products:update', (_, data: any) => {
    // If code is being changed, check it's not taken by another product
    if (data.code) {
      const conflict = db.prepare('SELECT id FROM products WHERE code = ? AND id != ? AND active = 1').get(data.code, data.id) as any
      if (conflict) return { success: false, message: 'Ese código ya está en uso por otro producto' }
      const conflictBarcode = db.prepare('SELECT id FROM product_barcodes WHERE code = ? AND product_id != ?').get(data.code, data.id) as any
      if (conflictBarcode) return { success: false, message: 'Ese código ya está registrado como código adicional de otro producto' }
      db.prepare(`
        UPDATE products SET code=?, name=?, category_id=?, cost=?, price=?, min_stock=?, updated_at=datetime('now','localtime')
        WHERE id=?
      `).run(data.code, data.name, data.category_id, data.cost, data.price, data.min_stock, data.id)
    } else {
      db.prepare(`
        UPDATE products SET name=?, category_id=?, cost=?, price=?, min_stock=?, updated_at=datetime('now','localtime')
        WHERE id=?
      `).run(data.name, data.category_id, data.cost, data.price, data.min_stock, data.id)
    }
    return { success: true }
  })

  // ── Extra barcodes ──────────────────────────────────────────────────────────
  ipcMain.handle('barcodes:getByProduct', (_, productId: number) => {
    return db.prepare('SELECT * FROM product_barcodes WHERE product_id = ? ORDER BY id').all(productId)
  })

  ipcMain.handle('barcodes:add', (_, data: { product_id: number; code: string; label?: string }) => {
    const conflict = db.prepare('SELECT id FROM products WHERE code = ?').get(data.code) as any
    if (conflict) return { success: false, message: 'Ese código ya es el código principal de un producto' }
    const conflictBarcode = db.prepare('SELECT id FROM product_barcodes WHERE code = ?').get(data.code) as any
    if (conflictBarcode) return { success: false, message: 'Ese código ya está registrado en otro producto' }
    db.prepare('INSERT INTO product_barcodes (product_id, code, label) VALUES (?,?,?)').run(data.product_id, data.code, data.label || null)
    return { success: true }
  })

  ipcMain.handle('barcodes:delete', (_, id: number) => {
    db.prepare('DELETE FROM product_barcodes WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('products:delete', (_, id: number) => {
    db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('products:import', (_, rows: any[]) => {
    const insert = db.prepare(`
      INSERT INTO products (code, name, category_id, cost, price, stock, min_stock)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(code) DO UPDATE SET
        name=excluded.name, cost=excluded.cost, price=excluded.price, min_stock=excluded.min_stock,
        active=1, updated_at=datetime('now','localtime')
    `)
    let imported = 0, updated = 0
    for (const row of rows) {
      const catRow = db.prepare('SELECT id FROM categories WHERE name = ?').get(row.category) as any
      const catId = catRow?.id || null
      const exists = db.prepare('SELECT id FROM products WHERE code = ?').get(row.code)
      insert.run(row.code, row.name, catId, row.cost || 0, row.price || 0, row.stock || 0, row.min_stock || 0)
      if (exists) updated++; else imported++
    }
    return { success: true, imported, updated }
  })

  ipcMain.handle('products:export', () => {
    return db.prepare(`
      SELECT p.code, p.name, c.name as category, p.cost, p.price, p.stock, p.min_stock, p.active
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1 ORDER BY p.name
    `).all()
  })

  // ─── SHIFTS ─────────────────────────────────────────────────────────────────
  ipcMain.handle('shifts:getActive', (_, cashierId: number) => {
    return db.prepare("SELECT * FROM shifts WHERE cashier_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(cashierId)
  })

  ipcMain.handle('shifts:open', (_, data: any) => {
    // Close any previously open shifts for this cashier
    db.prepare("UPDATE shifts SET status='closed', ended_at=datetime('now','localtime') WHERE cashier_id=? AND status='open'").run(data.cashier_id)
    const res = db.prepare('INSERT INTO shifts (cashier_id, opening_cash) VALUES (?,?)').run(data.cashier_id, data.opening_cash)
    return { success: true, id: res.lastInsertRowid }
  })

  ipcMain.handle('shifts:close', (_, data: any) => {
    const summary = getShiftSummaryData(data.shift_id)
    db.prepare(`
      UPDATE shifts SET status='closed', ended_at=datetime('now','localtime'),
      closing_cash=?, expected_cash=? WHERE id=?
    `).run(data.closing_cash, summary.expected_cash, data.shift_id)
    return { success: true, summary }
  })

  ipcMain.handle('shifts:getSummary', (_, shiftId: number) => {
    return getShiftSummaryData(shiftId)
  })

  ipcMain.handle('shifts:getCashBalance', (_, shiftId: number) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as any
    if (!shift) return 0
    const cashSales = (db.prepare(`
      SELECT COALESCE(SUM(total),0) as total FROM sales WHERE shift_id=? AND payment_type='efectivo' AND cancelled=0
    `).get(shiftId) as any).total
    // Efectivo portion of mixto sales — stored as JSON in payment_details
    const mixtoCash = (db.prepare(`
      SELECT COALESCE(SUM(json_extract(payment_details,'$.efectivo')),0) as total
      FROM sales WHERE shift_id=? AND payment_type='mixto' AND cancelled=0
    `).get(shiftId) as any).total
    const entradas = (db.prepare(`
      SELECT COALESCE(SUM(amount),0) as total FROM cash_movements WHERE shift_id=? AND type='entrada'
    `).get(shiftId) as any).total
    const salidas = (db.prepare(`
      SELECT COALESCE(SUM(amount),0) as total FROM cash_movements WHERE shift_id=? AND type='salida'
    `).get(shiftId) as any).total
    // Cancelled sales are already excluded above, so no separate devolucion term is needed.
    return shift.opening_cash + cashSales + mixtoCash + entradas - salidas
  })

  function getShiftSummaryData(shiftId: number) {
    const shift = db.prepare(`
      SELECT s.*, u.name as cashier_name FROM shifts s
      JOIN users u ON s.cashier_id = u.id WHERE s.id = ?
    `).get(shiftId) as any

    const sales = db.prepare(`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(total),0) as total,
        COALESCE(SUM(cost_total),0) as cost_total,
        COALESCE(SUM(CASE WHEN payment_type='efectivo' THEN total ELSE 0 END),0) as efectivo,
        COALESCE(SUM(CASE WHEN payment_type='tarjeta' THEN total ELSE 0 END),0) as tarjeta,
        COALESCE(SUM(CASE WHEN payment_type='transferencia' THEN total ELSE 0 END),0) as transferencia,
        COALESCE(SUM(CASE WHEN payment_type='mixto' THEN total ELSE 0 END),0) as mixto
      FROM sales WHERE shift_id = ? AND cancelled = 0
    `).get(shiftId) as any

    const movements = db.prepare(`
      SELECT type, COALESCE(SUM(amount),0) as total
      FROM cash_movements WHERE shift_id = ?
      GROUP BY type
    `).all(shiftId) as any[]

    const entradas = movements.find(m => m.type === 'entrada')?.total || 0
    const salidas = movements.find(m => m.type === 'salida')?.total || 0
    const devoluciones = movements.find(m => m.type === 'devolucion')?.total || 0

    // Efectivo portion of mixto sales (non-cancelled) — must count toward cash in drawer
    const mixtoCash = (db.prepare(`
      SELECT COALESCE(SUM(json_extract(payment_details,'$.efectivo')),0) as total
      FROM sales WHERE shift_id=? AND payment_type='mixto' AND cancelled=0
    `).get(shiftId) as any).total

    // Cancelled sales are excluded from sales.efectivo/mixtoCash, so no devolucion term is needed.
    const expected_cash = (shift?.opening_cash || 0) + sales.efectivo + mixtoCash + entradas - salidas

    const salesByCategory = db.prepare(`
      SELECT
        COALESCE(c.name, 'Sin categoría') as category,
        SUM(si.quantity * si.unit_price) as total,
        SUM(si.quantity * si.unit_cost) as cost
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE s.shift_id = ? AND s.cancelled = 0
      GROUP BY c.name ORDER BY total DESC
    `).all(shiftId)

    const movementDetails = db.prepare(`
      SELECT type, concept, amount FROM cash_movements WHERE shift_id = ? ORDER BY id ASC
    `).all(shiftId) as any[]

    return {
      shift, sales, entradas, salidas, devoluciones, mixtoCash, expected_cash, salesByCategory,
      movementDetails,
      utility: sales.total - sales.cost_total,
    }
  }

  // ─── CASH MOVEMENTS ─────────────────────────────────────────────────────────
  ipcMain.handle('cash:addMovement', (_, data: any) => {
    const res = db.prepare(`
      INSERT INTO cash_movements (shift_id, type, amount, concept, cashier_id)
      VALUES (?,?,?,?,?)
    `).run(data.shift_id, data.type, data.amount, data.concept, data.cashier_id)
    return { success: true, id: res.lastInsertRowid }
  })

  ipcMain.handle('cash:getMovements', (_, shiftId: number) => {
    return db.prepare(`
      SELECT cm.*, u.name as cashier_name FROM cash_movements cm
      LEFT JOIN users u ON cm.cashier_id = u.id
      WHERE cm.shift_id = ? ORDER BY cm.timestamp DESC
    `).all(shiftId)
  })

  // ─── SALES ──────────────────────────────────────────────────────────────────
  ipcMain.handle('sales:create', (_, data: any) => {
    const folio = generateFolio()

    const saleStmt = db.prepare(`
      INSERT INTO sales (folio, cashier_id, payment_type, total, cost_total, received_amount, change_amount, payment_details, shift_id)
      VALUES (?,?,?,?,?,?,?,?,?)
    `)

    const itemStmt = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, discount)
      VALUES (?,?,?,?,?,?)
    `)

    const updateStockStmt = db.prepare(`
      UPDATE products SET stock = stock - ?, updated_at = datetime('now','localtime') WHERE id = ?
    `)

    const invMovStmt = db.prepare(`
      INSERT INTO inventory_movements (product_id, type, quantity_before, quantity_change, quantity_after, cashier_id, reference_id, notes)
      VALUES (?,?,?,?,?,?,?,?)
    `)

    // Validate stock before deducting
    for (const item of data.items) {
      const p = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(item.product_id) as any
      if (p && p.stock < item.quantity) {
        return { success: false, message: `Stock insuficiente: "${p.name}" (disponible: ${p.stock}, solicitado: ${item.quantity})` }
      }
    }

    let costTotal = 0
    for (const item of data.items) {
      const p = db.prepare('SELECT cost, stock FROM products WHERE id = ?').get(item.product_id) as any
      if (p) costTotal += (p.cost || 0) * item.quantity
    }

    // Determine effective payment type and cash amount
    const paymentDetails: Record<string, number> = data.payment_details || {}
    const hasMixed = Object.keys(paymentDetails).length > 1
    const effectiveType = hasMixed ? 'mixto' : (data.payment_type || 'efectivo')
    const cashAmount = paymentDetails['efectivo'] ?? (data.payment_type === 'efectivo' ? data.total : 0)
    const detailsJson = hasMixed ? JSON.stringify(paymentDetails) : null

    const tx = db.transaction(() => {
      const saleRes = saleStmt.run(
        folio, data.cashier_id, effectiveType, data.total, costTotal,
        data.received_amount || data.total, data.change_amount || 0,
        detailsJson, data.shift_id
      )
      const saleId = saleRes.lastInsertRowid

      for (const item of data.items) {
        const p = db.prepare('SELECT cost, stock FROM products WHERE id = ?').get(item.product_id) as any
        itemStmt.run(saleId, item.product_id, item.quantity, item.unit_price, p?.cost || 0, item.discount || 0)

        const stockBefore = p?.stock || 0
        const stockAfter = stockBefore - item.quantity
        updateStockStmt.run(item.quantity, item.product_id)
        invMovStmt.run(item.product_id, 'venta', stockBefore, -item.quantity, stockAfter, data.cashier_id, saleId, `Venta ${folio}`)
      }

      // Record cash movement only for the efectivo portion
      if (cashAmount > 0) {
        db.prepare(`
          INSERT INTO cash_movements (shift_id, type, amount, concept, cashier_id)
          VALUES (?,?,?,?,?)
        `).run(data.shift_id, 'venta', cashAmount, `Venta ${folio}`, data.cashier_id)
      }

      return saleId
    })

    const saleId = tx()
    return { success: true, folio, id: saleId }
  })

  ipcMain.handle('sales:getAll', (_, filters: any) => {
    let query = `
      SELECT s.*, u.name as cashier_name FROM sales s
      LEFT JOIN users u ON s.cashier_id = u.id
      WHERE 1=1
    `
    const params: any[] = []

    if (filters?.from) { query += " AND DATE(s.timestamp,'localtime') >= ?"; params.push(filters.from) }
    if (filters?.to) { query += " AND DATE(s.timestamp,'localtime') <= ?"; params.push(filters.to) }
    if (filters?.shift_id) { query += ' AND s.shift_id = ?'; params.push(filters.shift_id) }
    if (filters?.cashier_id) { query += ' AND s.cashier_id = ?'; params.push(filters.cashier_id) }
    query += ' ORDER BY s.timestamp DESC'
    if (filters?.limit) {
      const lim = Math.max(0, Math.floor(Number(filters.limit)) || 0)
      if (lim > 0) { query += ' LIMIT ?'; params.push(lim) }
    }

    const sales = db.prepare(query).all(...params) as any[]

    // If includeItems requested
    if (filters?.includeItems) {
      for (const sale of sales) {
        sale.items = db.prepare(`
          SELECT si.*, p.name as product_name, p.code as product_code, c.name as category_name
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE si.sale_id = ?
        `).all(sale.id)
      }
    }
    return sales
  })

  ipcMain.handle('sales:getById', (_, id: number) => {
    const sale = db.prepare(`
      SELECT s.*, u.name as cashier_name FROM sales s
      LEFT JOIN users u ON s.cashier_id = u.id WHERE s.id = ?
    `).get(id) as any
    if (!sale) return null
    sale.items = db.prepare(`
      SELECT si.*, p.name as product_name, p.code as product_code
      FROM sale_items si JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `).all(id)
    return sale
  })

  ipcMain.handle('sales:cancel', (_, { sale_id, reason, cancelled_by }: { sale_id: number; reason: string; cancelled_by: number }) => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(sale_id) as any
    if (!sale) return { success: false, message: 'Venta no encontrada' }
    if (sale.cancelled) return { success: false, message: 'Esta venta ya fue cancelada' }

    const cancelSale = db.transaction(() => {
      // Mark sale as cancelled
      db.prepare(`
        UPDATE sales SET cancelled=1, cancelled_at=datetime('now','localtime'),
        cancelled_by=?, cancel_reason=? WHERE id=?
      `).run(cancelled_by, reason || 'Error del cajero', sale_id)

      // Restore stock for each item
      const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale_id) as any[]
      for (const item of items) {
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id)
      }

      // If cash involved, record as devolucion to subtract from cash balance
      const cashAmount = (() => {
        if (sale.payment_type === 'efectivo') return sale.total
        if (sale.payment_type === 'mixto' && sale.payment_details) {
          try { return JSON.parse(sale.payment_details).efectivo || 0 } catch { return 0 }
        }
        return 0
      })()

      if (cashAmount > 0 && sale.shift_id) {
        db.prepare(`
          INSERT INTO cash_movements (shift_id, type, amount, concept, cashier_id)
          VALUES (?, 'devolucion', ?, ?, ?)
        `).run(sale.shift_id, cashAmount, `Cancelación ${sale.folio}`, cancelled_by)
      }
    })

    try {
      cancelSale()
      return { success: true }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  })

  // ─── INVENTORY ──────────────────────────────────────────────────────────────
  ipcMain.handle('inventory:adjust', (_, data: any) => {
    const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(data.product_id) as any
    if (!product) return { success: false, message: 'Producto no encontrado' }

    const before = product.stock
    let after: number

    if (data.mode === 'set') {
      after = data.quantity
    } else {
      after = before + data.quantity
    }

    if (after < 0) return { success: false, message: 'El stock no puede ser negativo' }

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE products SET stock = ?, cost = COALESCE(?, cost), price = COALESCE(?, price),
        updated_at = datetime('now','localtime') WHERE id = ?
      `).run(after, data.new_cost || null, data.new_price || null, data.product_id)

      db.prepare(`
        INSERT INTO inventory_movements (product_id, type, quantity_before, quantity_change, quantity_after, cashier_id, notes)
        VALUES (?,?,?,?,?,?,?)
      `).run(data.product_id, 'ajuste', before, after - before, after, data.cashier_id, data.notes)
    })
    tx()

    return { success: true }
  })

  ipcMain.handle('inventory:getLowStock', () => {
    return db.prepare(`
      SELECT p.*, c.name as category_name FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1 AND p.stock <= p.min_stock
      ORDER BY (p.stock - p.min_stock) ASC
    `).all()
  })

  ipcMain.handle('inventory:getReport', () => {
    return db.prepare(`
      SELECT p.code, p.name, c.name as category_name, p.stock, p.cost, p.price,
             (p.stock * p.cost) as total_value
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1 ORDER BY p.name
    `).all()
  })

  ipcMain.handle('inventory:getMovements', (_, filters: any) => {
    let query = `
      SELECT im.*, p.name as product_name, p.code as product_code,
             c.name as category_name, u.name as cashier_name
      FROM inventory_movements im
      JOIN products p ON im.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN users u ON im.cashier_id = u.id
      WHERE 1=1
    `
    const params: any[] = []
    if (filters?.product_id) { query += ' AND im.product_id = ?'; params.push(filters.product_id) }
    if (filters?.type) { query += ' AND im.type = ?'; params.push(filters.type) }
    if (filters?.from) { query += ' AND DATE(im.timestamp) >= ?'; params.push(filters.from) }
    if (filters?.to) { query += ' AND DATE(im.timestamp) <= ?'; params.push(filters.to) }
    query += ' ORDER BY im.timestamp DESC'
    return db.prepare(query).all(...params)
  })

  // ─── PROMOTIONS ─────────────────────────────────────────────────────────────
  ipcMain.handle('promotions:getAll', () => {
    return db.prepare(`
      SELECT pr.*, p.name as product_name, p.code as product_code
      FROM promotions pr LEFT JOIN products p ON pr.product_id = p.id
      ORDER BY pr.id DESC
    `).all()
  })

  ipcMain.handle('promotions:create', (_, data: any) => {
    const res = db.prepare(`
      INSERT INTO promotions (name, product_id, discount_type, discount_value, start_date, end_date, active)
      VALUES (?,?,?,?,?,?,?)
    `).run(data.name, data.product_id, data.discount_type, data.discount_value, data.start_date, data.end_date, data.active ? 1 : 0)
    return { success: true, id: res.lastInsertRowid }
  })

  ipcMain.handle('promotions:update', (_, data: any) => {
    db.prepare(`
      UPDATE promotions SET name=?, product_id=?, discount_type=?, discount_value=?,
      start_date=?, end_date=?, active=? WHERE id=?
    `).run(data.name, data.product_id, data.discount_type, data.discount_value, data.start_date, data.end_date, data.active ? 1 : 0, data.id)
    return { success: true }
  })

  ipcMain.handle('promotions:delete', (_, id: number) => {
    db.prepare('DELETE FROM promotions WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('promotions:getActiveForProduct', (_, productId: number) => {
    const now = new Date().toISOString().slice(0, 10)
    return db.prepare(`
      SELECT * FROM promotions WHERE product_id = ? AND active = 1
      AND start_date <= ? AND end_date >= ?
    `).all(productId, now, now)
  })

  // ─── SUPPLIERS ──────────────────────────────────────────────────────────────
  ipcMain.handle('suppliers:getAll', () => {
    return db.prepare('SELECT * FROM suppliers ORDER BY name').all()
  })

  ipcMain.handle('suppliers:create', (_, data: any) => {
    const res = db.prepare(`
      INSERT INTO suppliers (name, contact_name, phone, email, address, products_supplied, notes)
      VALUES (?,?,?,?,?,?,?)
    `).run(data.name, data.contact_name, data.phone, data.email, data.address, data.products_supplied, data.notes)
    return { success: true, id: res.lastInsertRowid }
  })

  ipcMain.handle('suppliers:update', (_, data: any) => {
    db.prepare(`
      UPDATE suppliers SET name=?, contact_name=?, phone=?, email=?, address=?, products_supplied=?, notes=?
      WHERE id=?
    `).run(data.name, data.contact_name, data.phone, data.email, data.address, data.products_supplied, data.notes, data.id)
    return { success: true }
  })

  ipcMain.handle('suppliers:delete', (_, id: number) => {
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)
    return { success: true }
  })

  // ─── REPORTS ────────────────────────────────────────────────────────────────
  ipcMain.handle('reports:getDashboard', () => {
    const now = new Date()
    const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const todayStr = localDate(now)
    const yd = new Date(now); yd.setDate(yd.getDate() - 1)
    const yestStr = localDate(yd)
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    const dayKpis = (from: string, to: string) => db.prepare(`
      SELECT COALESCE(SUM(total),0) as sales, COALESCE(SUM(total-cost_total),0) as profit,
             COUNT(*) as transactions, COALESCE(AVG(total),0) as avg_ticket,
             COALESCE(SUM(total-cost_total)/NULLIF(SUM(total),0)*100,0) as margin
      FROM sales WHERE DATE(timestamp,'localtime') BETWEEN ? AND ?
    `).get(from, to) as any

    const today    = dayKpis(todayStr, todayStr)
    const yesterday = dayKpis(yestStr, yestStr)
    const thisMonth = dayKpis(monthStart, todayStr)
    const lastMonth = dayKpis(localDate(lmStart), localDate(lmEnd))

    const trend30 = db.prepare(`
      SELECT DATE(timestamp,'localtime') as date,
             COALESCE(SUM(total),0) as total,
             COALESCE(SUM(total-cost_total),0) as profit,
             COUNT(*) as transactions
      FROM sales
      WHERE DATE(timestamp,'localtime') >= DATE('now','localtime','-29 days')
      GROUP BY DATE(timestamp,'localtime') ORDER BY date
    `).all()

    // Fill missing days with zeros
    const trendMap = new Map((trend30 as any[]).map((r: any) => [r.date, r]))
    const trend: any[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i)
      const key = localDate(d)
      trend.push(trendMap.get(key) || { date: key, total: 0, profit: 0, transactions: 0 })
    }

    const topToday = db.prepare(`
      SELECT p.name, SUM(si.quantity) as qty, SUM(si.quantity*si.unit_price) as revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id=s.id
      JOIN products p ON si.product_id=p.id
      WHERE DATE(s.timestamp,'localtime')=?
      GROUP BY p.id ORDER BY revenue DESC LIMIT 8
    `).all(todayStr)

    const recentSales = db.prepare(`
      SELECT s.folio, s.timestamp, s.total, s.payment_type, u.name as cashier_name,
             COUNT(si.id) as items
      FROM sales s
      LEFT JOIN users u ON s.cashier_id=u.id
      LEFT JOIN sale_items si ON si.sale_id=s.id
      WHERE DATE(s.timestamp,'localtime')=?
      GROUP BY s.id ORDER BY s.timestamp DESC LIMIT 10
    `).all(todayStr)

    const lowStock = db.prepare(`
      SELECT id, code, name, stock, min_stock, price
      FROM products WHERE stock <= min_stock AND active=1
      ORDER BY (stock - min_stock) ASC LIMIT 15
    `).all()

    const byDayOfWeek = db.prepare(`
      SELECT CAST(strftime('%w', timestamp, 'localtime') AS INTEGER) as dow,
             COALESCE(SUM(total),0) as total, COUNT(*) as count
      FROM sales
      WHERE DATE(timestamp,'localtime') >= DATE('now','localtime','-90 days')
      GROUP BY dow ORDER BY dow
    `).all()
    const DOW_LABELS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
    const dowFull = Array.from({ length: 7 }, (_, i) => {
      const d = (byDayOfWeek as any[]).find((r: any) => r.dow === i)
      return { dow: DOW_LABELS[i], total: d?.total || 0, count: d?.count || 0 }
    })

    const inventoryValue = db.prepare(`
      SELECT COALESCE(SUM(stock*cost),0) as cost_value, COALESCE(SUM(stock*price),0) as sell_value,
             COUNT(*) as total_products, SUM(CASE WHEN stock<=0 THEN 1 ELSE 0 END) as out_of_stock
      FROM products WHERE active=1
    `).get() as any

    const slowMovers = db.prepare(`
      SELECT p.id, p.name, p.code, p.stock, p.price,
             COALESCE(SUM(si.quantity),0) as sold_30d
      FROM products p
      LEFT JOIN sale_items si ON si.product_id=p.id
        AND si.sale_id IN (SELECT id FROM sales WHERE DATE(timestamp,'localtime')>=DATE('now','localtime','-30 days'))
      WHERE p.active=1 AND p.stock > 0
      GROUP BY p.id HAVING sold_30d=0
      ORDER BY p.stock DESC LIMIT 10
    `).all()

    return { today, yesterday, thisMonth, lastMonth, trend, topToday, recentSales, lowStock, byDayOfWeek: dowFull, inventoryValue, slowMovers }
  })

  ipcMain.handle('reports:get', (_, filters: any) => {
    const { from, to } = filters

    const kpis = db.prepare(`
      SELECT
        COUNT(*) as transactions,
        COALESCE(SUM(total),0) as total_sales,
        COALESCE(SUM(total - cost_total),0) as total_profit,
        COALESCE(AVG(total),0) as avg_ticket,
        COALESCE(AVG(CASE WHEN total > 0 THEN (total - cost_total)/total * 100 ELSE 0 END),0) as avg_margin
      FROM sales WHERE DATE(timestamp,'localtime') BETWEEN ? AND ?
    `).get(from, to) as any

    const byDay = db.prepare(`
      SELECT DATE(timestamp,'localtime') as date, SUM(total) as total, SUM(total - cost_total) as profit
      FROM sales WHERE DATE(timestamp,'localtime') BETWEEN ? AND ?
      GROUP BY DATE(timestamp,'localtime') ORDER BY date
    `).all(from, to)

    const byPayment = db.prepare(`
      SELECT payment_type, SUM(total) as total, COUNT(*) as count
      FROM sales WHERE DATE(timestamp,'localtime') BETWEEN ? AND ?
      GROUP BY payment_type
    `).all(from, to)

    const byCategory = db.prepare(`
      SELECT c.name as category,
             SUM(si.quantity * si.unit_price) as total,
             SUM(si.quantity * si.unit_price - si.quantity * si.unit_cost) as profit,
             SUM(si.quantity) as qty
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE DATE(s.timestamp,'localtime') BETWEEN ? AND ? AND (s.cancelled IS NULL OR s.cancelled = 0)
      GROUP BY c.name ORDER BY total DESC
    `).all(from, to)

    const topProducts = db.prepare(`
      SELECT p.code, p.name, c.name as category,
             SUM(si.quantity) as total_qty,
             SUM(si.quantity * si.unit_price) as total_revenue,
             SUM(si.quantity * (si.unit_price - si.unit_cost)) as total_profit
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE DATE(s.timestamp,'localtime') BETWEEN ? AND ?
      GROUP BY p.id ORDER BY total_revenue DESC LIMIT 10
    `).all(from, to)

    const topProfit = db.prepare(`
      SELECT p.code, p.name, c.name as category,
             SUM(si.quantity) as total_qty,
             SUM(si.quantity * si.unit_price) as total_revenue,
             SUM(si.quantity * (si.unit_price - si.unit_cost)) as total_profit,
             AVG(CASE WHEN si.unit_price > 0 THEN (si.unit_price - si.unit_cost)/si.unit_price * 100 ELSE 0 END) as margin
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE DATE(s.timestamp,'localtime') BETWEEN ? AND ?
      GROUP BY p.id ORDER BY total_profit DESC LIMIT 10
    `).all(from, to)

    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', timestamp, 'localtime') AS INTEGER) as hour, SUM(total) as total, COUNT(*) as count
      FROM sales WHERE DATE(timestamp,'localtime') BETWEEN ? AND ?
      GROUP BY hour ORDER BY hour
    `).all(from, to)

    return { kpis, byDay, byPayment, byCategory, topProducts, topProfit, byHour }
  })

  ipcMain.handle('reports:getDailyCorte', () => {
    const sales = db.prepare(`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(total),0) as total,
        COALESCE(SUM(cost_total),0) as cost_total,
        COALESCE(SUM(CASE WHEN payment_type='efectivo'      THEN total ELSE 0 END),0) as efectivo,
        COALESCE(SUM(CASE WHEN payment_type='tarjeta'       THEN total ELSE 0 END),0) as tarjeta,
        COALESCE(SUM(CASE WHEN payment_type='transferencia' THEN total ELSE 0 END),0) as transferencia,
        COALESCE(SUM(CASE WHEN payment_type='mixto'         THEN total ELSE 0 END),0) as mixto
      FROM sales
      WHERE DATE(timestamp,'localtime') = DATE('now','localtime') AND cancelled = 0
    `).get() as any

    const byCashier = db.prepare(`
      SELECT u.name as cashier, COUNT(s.id) as count, COALESCE(SUM(s.total),0) as total
      FROM sales s JOIN users u ON s.cashier_id = u.id
      WHERE DATE(s.timestamp,'localtime') = DATE('now','localtime') AND s.cancelled = 0
      GROUP BY s.cashier_id ORDER BY total DESC
    `).all() as any[]

    const byCategory = db.prepare(`
      SELECT COALESCE(c.name,'Sin categoría') as category,
             SUM(si.quantity * si.unit_price) as total,
             SUM(si.quantity * si.unit_cost) as cost
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE DATE(s.timestamp,'localtime') = DATE('now','localtime') AND s.cancelled = 0
      GROUP BY c.name ORDER BY total DESC
    `).all() as any[]

    const shifts = db.prepare(`
      SELECT COUNT(*) as count,
        COALESCE((SELECT opening_cash FROM shifts WHERE DATE(started_at,'localtime') = DATE('now','localtime') ORDER BY started_at ASC LIMIT 1), 0) as opening_cash
      FROM shifts
      WHERE DATE(started_at,'localtime') = DATE('now','localtime')
    `).get() as any

    const cashMovements = db.prepare(`
      SELECT cm.type, cm.concept, cm.amount
      FROM cash_movements cm
      JOIN shifts sh ON cm.shift_id = sh.id
      WHERE DATE(sh.started_at,'localtime') = DATE('now','localtime')
      ORDER BY cm.id ASC
    `).all() as any[]

    const entradas = cashMovements.filter((m: any) => m.type === 'entrada').reduce((s: number, m: any) => s + (m.amount || 0), 0)
    const salidas  = cashMovements.filter((m: any) => m.type === 'salida').reduce((s: number, m: any) => s + (m.amount || 0), 0)

    // Efectivo portion of mixto sales (non-cancelled) for today — must count toward cash in drawer
    const mixtoCash = (db.prepare(`
      SELECT COALESCE(SUM(json_extract(payment_details,'$.efectivo')),0) as total
      FROM sales WHERE DATE(timestamp,'localtime') = DATE('now','localtime') AND payment_type='mixto' AND cancelled=0
    `).get() as any).total

    const salesTotal = sales?.total || 0
    const costTotal  = sales?.cost_total || 0
    const openingCash = shifts?.opening_cash || 0
    const expectedCash = openingCash + (sales?.efectivo || 0) + mixtoCash + entradas - salidas

    return {
      sales,
      byCashier,
      byCategory,
      movementDetails: cashMovements,
      shiftsCount: shifts?.count || 0,
      entradas,
      salidas,
      mixtoCash,
      openingCash,
      expectedCash,
      utility: salesTotal - costTotal,
      date: new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' }),
    }
  })

  ipcMain.handle('reports:salesByPeriod', (_, filters: any) => {
    let query = `
      SELECT s.folio, s.timestamp, s.payment_type, s.total, s.cost_total,
             u.name as cashier_name,
             p.code as product_code, p.name as product_name, c.name as category_name,
             si.quantity, si.unit_price, si.discount
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN users u ON s.cashier_id = u.id
      WHERE 1=1
    `
    const params: any[] = []
    if (filters?.from) { query += " AND DATE(s.timestamp,'localtime') >= ?"; params.push(filters.from) }
    if (filters?.to) { query += " AND DATE(s.timestamp,'localtime') <= ?"; params.push(filters.to) }
    query += ' ORDER BY s.timestamp DESC'
    return db.prepare(query).all(...params)
  })

  // ─── INVOICES ───────────────────────────────────────────────────────────────
  ipcMain.handle('invoices:getAll', () => {
    return db.prepare(`
      SELECT i.*, s.folio as sale_folio FROM invoices i
      LEFT JOIN sales s ON i.sale_id = s.id
      ORDER BY i.timestamp DESC
    `).all()
  })

  ipcMain.handle('invoices:create', (_, data: any) => {
    const folio_fiscal = generateFolioFiscal()
    const xml = generateCFDIXml({ ...data, folio_fiscal })
    const res = db.prepare(`
      INSERT INTO invoices (sale_id, folio_fiscal, rfc_receptor, razon_social, cfdi_use, total, status, xml_content)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(data.sale_id || null, folio_fiscal, data.rfc_receptor, data.razon_social, data.cfdi_use, data.total, 'draft', xml)
    return { success: true, id: res.lastInsertRowid, folio_fiscal, xml }
  })

  ipcMain.handle('invoices:update', (_, data: any) => {
    db.prepare('UPDATE invoices SET status=? WHERE id=?').run(data.status, data.id)
    return { success: true }
  })

  // ─── SETTINGS ───────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => {
    const rows = db.prepare('SELECT key, value FROM settings').all() as any[]
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  })

  ipcMain.handle('settings:save', (_, data: any) => {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    for (const [key, value] of Object.entries(data)) {
      stmt.run(key, value as string)
    }
    return { success: true }
  })

  // ─── PRINTER ────────────────────────────────────────────────────────────────
  ipcMain.handle('printer:getPorts', async () => {
    try {
      const { SerialPort } = await import('serialport')
      const ports = await SerialPort.list()
      return ports.map(p => p.path)
    } catch {
      return []
    }
  })

  ipcMain.handle('printer:getSystemPrinters', async () => {
    if (process.platform === 'win32') {
      // Use PowerShell to enumerate ALL installed printers including Zebra/raw-driver printers
      // that Chromium's print service silently excludes.
      return new Promise<{ name: string; isDefault: boolean }[]>(resolve => {
        exec(
          `powershell -NoProfile -Command "Get-Printer | Select-Object Name,Default | ConvertTo-Json -Compress"`,
          (err, stdout) => {
            if (err || !stdout.trim()) { resolve([]); return }
            try {
              const raw = JSON.parse(stdout.trim())
              const list = Array.isArray(raw) ? raw : [raw]
              resolve(list.map((p: any) => ({ name: String(p.Name), isDefault: p.Default === true })))
            } catch { resolve([]) }
          }
        )
      })
    }
    try {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return []
      const printers = await win.webContents.getPrintersAsync()
      return printers.map((p: any) => ({ name: p.name, isDefault: p.isDefault ?? false }))
    } catch {
      return []
    }
  })

  ipcMain.handle('printer:printZPL', async (_, { zpl, printerName }: { zpl: string; printerName: string }) => {
    const winName  = printerName.trim()
    const cupsName = winName.replace(/ /g, '_')
    const tmpFile  = join(tmpdir(), `labels_${Date.now()}.zpl`)
    const tryCmd   = (cmd: string) => new Promise<void>((resolve, reject) => {
      exec(cmd, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message))
        else resolve()
      })
    })
    try {
      writeFileSync(tmpFile, zpl, 'utf8')

      if (process.platform === 'win32') {
        // Windows: send raw ZPL via the Windows Spooler API (winspool.drv).
        // This works for ALL port types: USB (USB001), LPT, TCP/IP network printers.
        // The old \\.\USBxxx file-open approach only works for LPT/COM — not USB.
        const psFile = join(tmpdir(), `zpl_print_${Date.now()}.ps1`)
        const safeWinName = winName.replace(/'/g, "''")
        const safeTmpFile = tmpFile.replace(/'/g, "''")
        const psScript = [
          `$ErrorActionPreference = 'Stop'`,
          `$pName = '${safeWinName}'`,
          `$fPath = '${safeTmpFile}'`,
          `$bytes = [System.IO.File]::ReadAllBytes($fPath)`,
          ``,
          `Add-Type -TypeDefinition @"`,
          `using System;`,
          `using System.Runtime.InteropServices;`,
          `[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]`,
          `public struct DOCINFOA {`,
          `    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;`,
          `    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;`,
          `    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;`,
          `}`,
          `public class WinSpool {`,
          `    [DllImport("winspool.Drv", CharSet=CharSet.Ansi, SetLastError=true)]`,
          `    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);`,
          `    [DllImport("winspool.Drv", SetLastError=true)]`,
          `    public static extern bool ClosePrinter(IntPtr hPrinter);`,
          `    [DllImport("winspool.Drv", CharSet=CharSet.Ansi, SetLastError=true)]`,
          `    public static extern int StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOA di);`,
          `    [DllImport("winspool.Drv", SetLastError=true)]`,
          `    public static extern bool EndDocPrinter(IntPtr hPrinter);`,
          `    [DllImport("winspool.Drv", SetLastError=true)]`,
          `    public static extern bool StartPagePrinter(IntPtr hPrinter);`,
          `    [DllImport("winspool.Drv", SetLastError=true)]`,
          `    public static extern bool EndPagePrinter(IntPtr hPrinter);`,
          `    [DllImport("winspool.Drv", SetLastError=true)]`,
          `    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);`,
          `}`,
          `"@ -Language CSharp`,
          ``,
          `$hPrinter = [IntPtr]::Zero`,
          `if (-not [WinSpool]::OpenPrinter($pName, [ref]$hPrinter, [IntPtr]::Zero)) {`,
          `    throw "No se pudo abrir la impresora: $pName"`,
          `}`,
          `$di = New-Object DOCINFOA`,
          `$di.pDocName = 'ZPL Label'`,
          `$di.pOutputFile = $null`,
          `$di.pDataType = 'RAW'`,
          `[WinSpool]::StartDocPrinter($hPrinter, 1, [ref]$di) | Out-Null`,
          `[WinSpool]::StartPagePrinter($hPrinter) | Out-Null`,
          `$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)`,
          `[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)`,
          `$written = 0`,
          `[WinSpool]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref]$written) | Out-Null`,
          `[System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)`,
          `[WinSpool]::EndPagePrinter($hPrinter) | Out-Null`,
          `[WinSpool]::EndDocPrinter($hPrinter) | Out-Null`,
          `[WinSpool]::ClosePrinter($hPrinter) | Out-Null`,
          `exit 0`,
        ].join('\n')
        writeFileSync(psFile, psScript, 'utf8')
        try {
          await tryCmd(`powershell -ExecutionPolicy Bypass -File "${psFile}"`)
          try { unlinkSync(tmpFile) } catch {}
          try { unlinkSync(psFile)  } catch {}
          return { success: true }
        } catch (e: any) {
          try { unlinkSync(tmpFile) } catch {}
          try { unlinkSync(psFile)  } catch {}
          return { success: false, message: e.message }
        }
      }

      // macOS / Linux: lp → lpr fallback
      let lastErr = ''
      for (const cmd of [
        `lp -d "${cupsName}" -o raw "${tmpFile}"`,
        `lpr -P "${cupsName}" -l "${tmpFile}"`,
      ]) {
        try { await tryCmd(cmd); try { unlinkSync(tmpFile) } catch {}; return { success: true } }
        catch (e: any) { lastErr = e.message }
      }
      try { unlinkSync(tmpFile) } catch {}
      return { success: false, message: lastErr }
    } catch (err: any) {
      try { unlinkSync(tmpFile) } catch {}
      return { success: false, message: err.message }
    }
  })

  // Helper: write HTML to a temp file and print it in a hidden BrowserWindow.
  // Using loadFile() instead of loadURL('data:...') avoids Windows URL-length/encoding issues.
  function printHtmlFile(html: string, printerName: string, winOpts: { width: number; height: number }): Promise<{ success: boolean; message?: string }> {
    const htmlFile = join(tmpdir(), `print_${Date.now()}.html`)
    writeFileSync(htmlFile, html, 'utf8')
    let resolved = false
    return new Promise((resolve) => {
      const done = (result: { success: boolean; message?: string }) => {
        if (resolved) return
        resolved = true
        resolve(result)
      }
      const win = new BrowserWindow({
        ...winOpts,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      })

      const doPrint = () => {
        // Wait for the renderer to fully paint (Windows needs more time)
        setTimeout(() => {
          if (resolved) return
          // pageSize overrides the Windows printer default (Letter) at the job level.
          // 72mm x Recibo = 71882 x 3002788 microns — matches the Star TSP100 driver's supported size.
          const printOpts: any = { silent: !!printerName, printBackground: true, margins: { marginType: 'none' }, pageSize: { width: 71882, height: 3002788 } }
          if (printerName) printOpts.deviceName = printerName
          win.webContents.print(printOpts, (success, reason) => {
            done(success ? { success: true } : { success: false, message: reason || 'Impresión falló' })
            win.destroy()
            try { unlinkSync(htmlFile) } catch {}
          })
        }, 1500)
      }

      win.loadFile(htmlFile)
      win.webContents.on('did-finish-load', doPrint)

      // Timeout safety: if nothing happens in 10s, fail gracefully
      setTimeout(() => {
        if (!resolved) {
          try { win.destroy() } catch {}
          try { unlinkSync(htmlFile) } catch {}
          done({ success: false, message: 'Timeout: la ventana de impresión no respondió' })
        }
      }, 10000)

      win.on('closed', () => {
        try { unlinkSync(htmlFile) } catch {}
        done({ success: false, message: 'Ventana cerrada' })
      })
    })
  }

  // Send raw bytes to a Windows printer using Win32 WritePrinter (RAW data type).
  // Bypasses GDI/PDF rendering pipeline — required for ESC/POS thermal printers.
  function printRawBytes(printerName: string, data: Buffer): Promise<{ success: boolean; message?: string }> {
    const tmpBin = join(tmpdir(), `escpos_${Date.now()}.bin`)
    const tmpPs  = join(tmpdir(), `escpos_${Date.now()}.ps1`)
    writeFileSync(tmpBin, data)
    const safeName = printerName.replace(/'/g, "''")
    const safeBin  = tmpBin.replace(/'/g, "''")
    const ps = [
      `$ErrorActionPreference='Stop'`,
      `Add-Type -TypeDefinition @"`,
      `using System; using System.Runtime.InteropServices;`,
      `public class RawPrint {`,
      `  [DllImport("winspool.drv",CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);`,
      `  [DllImport("winspool.drv")] public static extern bool ClosePrinter(IntPtr h);`,
      `  [DllImport("winspool.drv",CharSet=CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h,int lv,ref DOCINFO i);`,
      `  [DllImport("winspool.drv")] public static extern bool EndDocPrinter(IntPtr h);`,
      `  [DllImport("winspool.drv")] public static extern bool StartPagePrinter(IntPtr h);`,
      `  [DllImport("winspool.drv")] public static extern bool EndPagePrinter(IntPtr h);`,
      `  [DllImport("winspool.drv")] public static extern bool WritePrinter(IntPtr h,byte[] b,int c,out int w);`,
      `  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct DOCINFO {`,
      `    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;`,
      `    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;`,
      `    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; } }`,
      `"@`,
      `$bytes=[System.IO.File]::ReadAllBytes('${safeBin}')`,
      `$h=[IntPtr]::Zero`,
      `[RawPrint]::OpenPrinter('${safeName}',[ref]$h,[IntPtr]::Zero)|Out-Null`,
      `$doc=New-Object RawPrint+DOCINFO`,
      `$doc.pDocName='Receipt'; $doc.pDataType='RAW'`,
      `[RawPrint]::StartDocPrinter($h,1,[ref]$doc)|Out-Null`,
      `[RawPrint]::StartPagePrinter($h)|Out-Null`,
      `$w=0; [RawPrint]::WritePrinter($h,$bytes,$bytes.Length,[ref]$w)|Out-Null`,
      `[RawPrint]::EndPagePrinter($h)|Out-Null`,
      `[RawPrint]::EndDocPrinter($h)|Out-Null`,
      `[RawPrint]::ClosePrinter($h)|Out-Null`,
    ].join('\n')
    writeFileSync(tmpPs, ps, 'utf8')
    return new Promise((resolve) => {
      exec(`powershell -ExecutionPolicy Bypass -File "${tmpPs}"`, (err, _out, stderr) => {
        try { unlinkSync(tmpBin) } catch {}
        try { unlinkSync(tmpPs)  } catch {}
        if (err) resolve({ success: false, message: stderr || err.message })
        else     resolve({ success: true })
      })
    })
  }

  ipcMain.handle('printer:printReceipt', async (_, data: any) => {
    const settingsRows = db.prepare('SELECT key, value FROM settings').all() as any[]
    const stored = Object.fromEntries(settingsRows.map(r => [r.key, r.value]))
    const mergedData = { ...stored, ...data }
    const printerName = (mergedData.printerName || mergedData.printer_port || '').trim()
    if (process.platform === 'win32' && printerName) {
      return printRawBytes(printerName, buildReceiptESCPOS(mergedData))
    }
    return printHtmlFile(buildReceiptHTML(mergedData), printerName, { width: 320, height: 800 })
  })

  ipcMain.handle('printer:printShift', async (_, data: any) => {
    const settingsRows = db.prepare('SELECT key, value FROM settings').all() as any[]
    const stored = Object.fromEntries(settingsRows.map(r => [r.key, r.value]))
    const mergedData = { ...stored, ...data }
    const printerName = (mergedData.printerName || mergedData.printer_port || '').trim()
    if (process.platform === 'win32' && printerName) {
      return printRawBytes(printerName, buildShiftESCPOS(mergedData))
    }
    return printHtmlFile(buildShiftHTML(mergedData), printerName, { width: 320, height: 900 })
  })

  ipcMain.handle('printer:printDailyCorte', async (_, dailyData: any) => {
    const settingsRows = db.prepare('SELECT key, value FROM settings').all() as any[]
    const stored = Object.fromEntries(settingsRows.map(r => [r.key, r.value]))
    const printerName = (stored.printer_port || '').trim()
    if (process.platform === 'win32' && printerName) {
      return printRawBytes(printerName, buildDailyCorteESCPOS(dailyData, stored))
    }
    return printHtmlFile(buildDailyCorteHTML(dailyData, stored), printerName, { width: 320, height: 900 })
  })

  // ─── EXCEL ──────────────────────────────────────────────────────────────────
  ipcMain.handle('excel:export', async (_, data: any) => {
    try {
      const { filePath } = await dialog.showSaveDialog({
        title: 'Guardar Excel',
        defaultPath: data.filename || 'export.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })
      if (!filePath) return { success: false, message: 'Cancelado' }

      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet(data.sheetName || 'Datos')

      if (data.columns) sheet.columns = data.columns
      if (data.rows) {
        for (const row of data.rows) sheet.addRow(row)
      }

      // Style header
      if (data.columns) {
        const header = sheet.getRow(1)
        header.font = { bold: true }
        header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e40af' } }
        header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      }

      await workbook.xlsx.writeFile(filePath)
      return { success: true, filePath }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  })

  ipcMain.handle('excel:exportMulti', async (_, data: { filename: string; sheets: Array<{ name: string; columns: any[]; rows: any[] }> }) => {
    try {
      const { filePath } = await dialog.showSaveDialog({
        title: 'Guardar Reporte Excel',
        defaultPath: data.filename || 'reporte.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })
      if (!filePath) return { success: false, message: 'Cancelado' }

      const workbook = new ExcelJS.Workbook()
      for (const sheetDef of data.sheets) {
        const ws = workbook.addWorksheet(sheetDef.name)
        ws.columns = sheetDef.columns
        for (const row of sheetDef.rows) ws.addRow(row)
        const header = ws.getRow(1)
        header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF2D55' } }
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheetDef.columns.length } }
      }

      await workbook.xlsx.writeFile(filePath)
      return { success: true, filePath }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  })

  ipcMain.handle('dialog:showSave', async (_, opts: any) => {
    return dialog.showSaveDialog(opts)
  })

  ipcMain.handle('dialog:showOpen', async (_, opts: any) => {
    return dialog.showOpenDialog(opts)
  })

  ipcMain.handle('excel:readFile', async (_, filePath: string) => {
    try {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(filePath)
      const sheet = workbook.worksheets[0]
      const rows: any[] = []
      let headers: string[] = []

      sheet.eachRow((row, idx) => {
        const values = (row.values as any[]).slice(1)
        if (idx === 1) {
          headers = values.map(v => String(v || '').trim().toLowerCase())
        } else {
          const obj: any = {}
          headers.forEach((h, i) => { obj[h] = values[i] })
          rows.push(obj)
        }
      })

      return { success: true, headers, rows }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  })

  // ─── BACKUP ─────────────────────────────────────────────────────────────────
  ipcMain.handle('backup:create', () => {
    try {
      const userDataPath = app.getPath('userData')
      const backupsDir = join(userDataPath, 'backups')
      const { mkdirSync, copyFileSync, existsSync } = require('fs')
      if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true })
      const srcPath = join(userDataPath, 'pos.db')
      // Flush the WAL into pos.db so the copied file includes the latest data
      checkpointDb()
      const now = new Date()
      const name = `pos_backup_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}.db`
      const destPath = join(backupsDir, name)
      copyFileSync(srcPath, destPath)
      return { success: true, filename: name }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  })

  ipcMain.handle('backup:list', () => {
    try {
      const userDataPath = app.getPath('userData')
      const backupsDir = join(userDataPath, 'backups')
      const { readdirSync, existsSync, statSync } = require('fs')
      if (!existsSync(backupsDir)) return []
      return readdirSync(backupsDir)
        .filter((f: string) => f.endsWith('.db'))
        .map((f: string) => ({ name: f, size: statSync(join(backupsDir, f)).size, path: join(backupsDir, f) }))
        .reverse()
    } catch {
      return []
    }
  })

  ipcMain.handle('backup:restore', async (_e, filename: string) => {
    try {
      const { copyFileSync, existsSync, rmSync } = require('fs')
      const userDataPath = app.getPath('userData')
      const backupPath = join(userDataPath, 'backups', filename)
      const dbPath = join(userDataPath, 'pos.db')
      if (!existsSync(backupPath)) return { success: false, message: 'Archivo no encontrado' }

      // Flush WAL into pos.db so the safety backup is complete
      checkpointDb()

      // Create safety backup of the current DB before restoring
      const now = new Date()
      const safetyName = `pre_restore_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}.db`
      copyFileSync(dbPath, join(userDataPath, 'backups', safetyName))

      // Close the live connection before overwriting the file, and remove the
      // stale WAL/SHM sidecar files so they don't shadow the restored data.
      closeDb()
      for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
        try { if (existsSync(sidecar)) rmSync(sidecar) } catch { /* ignore */ }
      }

      copyFileSync(backupPath, dbPath)

      // Relaunch so the app reopens against the restored database with a fresh
      // connection (all IPC handlers captured the original db reference).
      app.relaunch()
      app.exit(0)
      return { success: true }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  })

  ipcMain.handle('backup:export', async (_e, filename: string) => {
    try {
      const { dialog } = require('electron')
      const { copyFileSync, existsSync } = require('fs')
      const userDataPath = app.getPath('userData')
      const backupPath = join(userDataPath, 'backups', filename)
      if (!existsSync(backupPath)) return { success: false, message: 'Archivo no encontrado' }
      const { filePath } = await dialog.showSaveDialog({
        title: 'Exportar respaldo',
        defaultPath: filename,
        filters: [{ name: 'Base de datos', extensions: ['db'] }],
      })
      if (!filePath) return { success: false, message: 'Cancelado' }
      copyFileSync(backupPath, filePath)
      return { success: true, path: filePath }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  })

  ipcMain.handle('backup:import', async () => {
    try {
      const { dialog } = require('electron')
      const { copyFileSync, mkdirSync, existsSync } = require('fs')
      const { filePaths } = await dialog.showOpenDialog({
        title: 'Importar respaldo',
        filters: [{ name: 'Base de datos', extensions: ['db'] }],
        properties: ['openFile'],
      })
      if (!filePaths?.length) return { success: false, message: 'Cancelado' }
      const userDataPath = app.getPath('userData')
      const backupsDir = join(userDataPath, 'backups')
      if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true })
      const src = filePaths[0]
      const name = `imported_${require('path').basename(src)}`
      copyFileSync(src, join(backupsDir, name))
      return { success: true, filename: name }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  })
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function generateFolioFiscal(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  const seg = (n: number) => Array.from({ length: n }, hex).join('')
  return `${seg(8)}-${seg(4)}-${seg(4)}-${seg(4)}-${seg(12)}`.toUpperCase()
}

function generateCFDIXml(data: any): string {
  const now = new Date().toISOString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  Version="4.0" Serie="A" Folio="${data.folio_fiscal}"
  Fecha="${now}" SubTotal="${data.total}" Total="${data.total}"
  Moneda="MXN" TipoDeComprobante="I" MetodoPago="PUE" FormaPago="01"
  LugarExpedicion="00000">
  <cfdi:Receptor Rfc="${data.rfc_receptor}" Nombre="${data.razon_social}"
    DomicilioFiscalReceptor="00000" RegimenFiscalReceptor="616"
    UsoCFDI="${data.cfdi_use}"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="01010101" Cantidad="1" ClaveUnidad="ACT"
      Descripcion="${data.description || 'Compra'}" ValorUnitario="${data.total}"
      Importe="${data.total}" ObjetoImp="01"/>
  </cfdi:Conceptos>
</cfdi:Comprobante>`
}

function buildReceiptESCPOS(data: any): Buffer {
  const fmt  = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
  const norm = (s: string)  => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?')
  const COLS = 42
  const ESC = 0x1b, GS = 0x1d, LF = 0x0a

  const parts: Buffer[] = []
  const raw  = (...b: number[]) => parts.push(Buffer.from(b))
  const text = (s: string)      => parts.push(Buffer.from(norm(s).substring(0, COLS), 'ascii'))
  const line = (s: string)      => { text(s); raw(LF) }
  const div  = ()               => line('-'.repeat(COLS))
  const two  = (l: string, r: string) => {
    const right = norm(r)
    const left  = norm(l).substring(0, COLS - right.length - 1)
    const pad   = COLS - left.length - right.length
    parts.push(Buffer.from(left + ' '.repeat(Math.max(1, pad)) + right, 'ascii'))
    raw(LF)
  }

  raw(ESC, 0x40)                          // initialize

  raw(ESC, 0x61, 0x01, ESC, 0x45, 0x01, ESC, 0x21, 0x10)  // center + bold + 2x height
  line(data.storeName || data.store_name || 'Mi Tienda')
  raw(ESC, 0x21, 0x00, ESC, 0x45, 0x00)  // normal

  raw(ESC, 0x61, 0x01)
  if (data.storeAddress || data.store_address) line(data.storeAddress || data.store_address)
  if (data.storePhone   || data.store_phone)   line(`Tel: ${data.storePhone || data.store_phone}`)

  raw(ESC, 0x61, 0x00)                    // left align
  div()
  line(`Fecha: ${data.date}`)
  if (data.receipt_show_folio   !== '0') line(`Folio: ${data.folio}`)
  if (data.receipt_show_cashier !== '0') line(`Cajero: ${data.cashierName || ''}`)
  div()

  for (const item of (data.items || [])) {
    two(`${item.qty}x ${item.name}`, fmt(item.qty * item.price))
    if (item.discount > 0) line(`  Desc: -${fmt(item.discount * item.qty)}`)
  }
  div()

  raw(ESC, 0x45, 0x01, ESC, 0x21, 0x10)  // bold + 2x height
  two('TOTAL', fmt(data.total))
  raw(ESC, 0x21, 0x00, ESC, 0x45, 0x00)
  div()

  if (data.isMixed && data.activePayments) {
    for (const [method, amount] of Object.entries(data.activePayments as Record<string, number>)) {
      two(method.charAt(0).toUpperCase() + method.slice(1), fmt(amount))
    }
  } else {
    const lbl = (data.paymentType || 'Efectivo')
    two(lbl.charAt(0).toUpperCase() + lbl.slice(1), fmt(data.received || data.total))
  }
  if ((data.change ?? 0) > 0) {
    raw(ESC, 0x45, 0x01)
    two('CAMBIO', fmt(data.change))
    raw(ESC, 0x45, 0x00)
  }
  div()

  raw(ESC, 0x61, 0x01)
  line(data.footer || data.receipt_footer || 'Gracias por su compra!')

  raw(ESC, 0x64, 4)             // feed 4 lines
  raw(GS, 0x56, 0x00)          // full cut

  return Buffer.concat(parts)
}

function buildReceiptHTML(data: any): string {
  const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

  // Font size scaling
  const sizeKey = data.receipt_font_size || 'medium'
  const fontBase = sizeKey === 'small' ? 18 : sizeKey === 'large' ? 26 : 22
  const fontH1 = fontBase + 4
  const fontSub = fontBase - 4
  const fontMeta = fontBase - 4
  const fontTotal = fontBase + 4

  const showFolio = data.receipt_show_folio !== '0'
  const showCashier = data.receipt_show_cashier !== '0'

  const itemRows = (data.items || []).map((item: any) => `
    <tr>
      <td style="padding:2px 0;font-size:${fontBase}px">${item.name}</td>
      <td style="text-align:right;white-space:nowrap;padding:2px 0 2px 8px;font-size:${fontBase}px">${item.qty}x${fmt(item.price)}</td>
      <td style="text-align:right;white-space:nowrap;padding:2px 0 2px 8px;font-size:${fontBase}px;font-weight:900">${fmt(item.qty * item.price)}</td>
    </tr>
    ${item.discount > 0 ? `<tr><td colspan="3" style="font-size:${fontMeta}px;color:#888;padding-bottom:2px"> Desc: -${fmt(item.discount * item.qty)}</td></tr>` : ''}
  `).join('')

  let paymentRows = ''
  if (data.isMixed && data.activePayments) {
    for (const [method, amount] of Object.entries(data.activePayments as Record<string, number>)) {
      const label = method.charAt(0).toUpperCase() + method.slice(1)
      paymentRows += `<div style="display:flex;justify-content:space-between;font-size:${fontBase - 1}px"><span>${label}</span><span>${fmt(amount as number)}</span></div>`
    }
  } else {
    const label = (data.paymentType || 'efectivo').charAt(0).toUpperCase() + (data.paymentType || 'efectivo').slice(1)
    paymentRows = `<div style="display:flex;justify-content:space-between;font-size:${fontBase - 1}px"><span>${label}</span><span>${fmt(data.received || data.total)}</span></div>`
  }

  const changeRow = (data.change ?? 0) > 0
    ? `<div style="display:flex;justify-content:space-between;font-size:${fontBase + 2}px;font-weight:900;color:#1a7a3a"><span>CAMBIO</span><span>${fmt(data.change)}</span></div>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: ${fontBase}px;
    font-weight: 700;
    color: #000;
    background: #fff;
    width: 68mm;
    padding: 3mm;
  }
  h1 { font-size: ${fontH1}px; text-align: center; font-weight: 900; margin-bottom: 1px; }
  .sub { font-size: ${fontSub}px; text-align: center; color: #444; font-weight: 700; }
  .meta { font-size: ${fontMeta}px; margin: 1px 0; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0; }
  .divider { border-top: 1px solid #000; margin: 4px 0; }
  .total-row { font-size: ${fontTotal}px; font-weight: 900; display: flex; justify-content: space-between; padding: 3px 0; }
  @media print {
    @page { margin: 0; }
    body { padding: 2mm; }
  }
</style>
</head>
<body>
  <h1>${data.storeName || data.store_name || 'Mi Tienda'}</h1>
  ${(data.storeAddress || data.store_address) ? `<div class="sub">${data.storeAddress || data.store_address}</div>` : ''}
  ${(data.storePhone || data.store_phone) ? `<div class="sub">Tel: ${data.storePhone || data.store_phone}</div>` : ''}
  <div class="divider"></div>
  <div class="meta">Fecha: ${data.date}</div>
  ${showFolio ? `<div class="meta">Folio: <b>${data.folio}</b></div>` : ''}
  ${showCashier ? `<div class="meta">Cajero: ${data.cashierName || ''}</div>` : ''}
  <div class="divider"></div>
  <table>${itemRows}</table>
  <div class="divider"></div>
  <div class="total-row"><span>TOTAL</span><span>${fmt(data.total)}</span></div>
  <div class="divider"></div>
  ${paymentRows}
  ${changeRow}
  <div class="divider"></div>
  <div style="text-align:center;font-size:${fontMeta}px;margin-top:3px">${data.footer || data.receipt_footer || '¡Gracias por su compra!'}</div>
</body>
</html>`
}

function buildReceiptPrintData(data: any): any[] {
  const fmt = (n: number) => `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
  const lines: any[] = [
    { type: 'text', value: data.storeName || 'Mi Tienda', style: { textAlign: 'center', fontWeight: '700', fontSize: '16px' } },
    { type: 'text', value: data.storeAddress || '', style: { textAlign: 'center', fontSize: '11px' } },
    { type: 'text', value: data.storePhone || '', style: { textAlign: 'center', fontSize: '11px' } },
    { type: 'text', value: '--------------------------------', style: { textAlign: 'center' } },
    { type: 'text', value: `Fecha: ${data.date}`, style: { fontSize: '11px' } },
    { type: 'text', value: `Folio: ${data.folio}`, style: { fontSize: '11px' } },
    { type: 'text', value: `Cajero: ${data.cashierName}`, style: { fontSize: '11px' } },
    { type: 'text', value: '--------------------------------', style: { textAlign: 'center' } },
  ]

  for (const item of data.items || []) {
    lines.push({ type: 'text', value: item.name, style: { fontSize: '11px', fontWeight: '700' } })
    lines.push({
      type: 'text',
      value: `  ${item.qty} x ${fmt(item.price)}  ${fmt(item.qty * item.price)}`,
      style: { fontSize: '11px' },
    })
  }

  lines.push({ type: 'text', value: '--------------------------------', style: { textAlign: 'center' } })
  lines.push({ type: 'text', value: `TOTAL: ${fmt(data.total)}`, style: { fontWeight: '700', fontSize: '14px' } })
  if (data.isMixed && data.activePayments) {
    for (const [method, amount] of Object.entries(data.activePayments as Record<string, number>)) {
      const label = method.charAt(0).toUpperCase() + method.slice(1)
      lines.push({ type: 'text', value: `  ${label}: ${fmt(amount)}`, style: { fontSize: '11px' } })
    }
  } else {
    const method = data.paymentType || 'Efectivo'
    const label = method.charAt(0).toUpperCase() + method.slice(1)
    lines.push({ type: 'text', value: `Pago (${label}): ${fmt(data.received || data.total)}`, style: { fontSize: '11px' } })
  }
  if ((data.change ?? 0) > 0) {
    lines.push({ type: 'text', value: `Cambio: ${fmt(data.change)}`, style: { fontSize: '11px', fontWeight: '700' } })
  }
  lines.push({ type: 'text', value: '--------------------------------', style: { textAlign: 'center' } })
  lines.push({ type: 'text', value: data.footer || 'Gracias por su compra', style: { textAlign: 'center', fontSize: '11px' } })
  lines.push({ type: 'text', value: ' ', style: {} })

  return lines
}

function buildShiftESCPOS(data: any): Buffer {
  const fmt  = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
  const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?')
  const COLS = 42
  const ESC = 0x1b, GS = 0x1d, LF = 0x0a

  const parts: Buffer[] = []
  const raw  = (...b: number[]) => parts.push(Buffer.from(b))
  const line = (s: string) => { parts.push(Buffer.from(norm(s).substring(0, COLS), 'ascii')); raw(LF) }
  const cline = (s: string) => {
    const n = norm(s).substring(0, COLS)
    const pad = Math.floor((COLS - n.length) / 2)
    parts.push(Buffer.from(' '.repeat(Math.max(0, pad)) + n, 'ascii')); raw(LF)
  }
  const two = (l: string, r: string) => {
    const right = norm(r); const left = norm(l).substring(0, COLS - right.length - 1)
    parts.push(Buffer.from(left + ' '.repeat(Math.max(1, COLS - left.length - right.length)) + right, 'ascii')); raw(LF)
  }
  const div     = () => line('-'.repeat(COLS))
  const section = (t: string) => { raw(LF, ESC, 0x45, 0x01); cline(`== ${norm(t)} ==`); raw(ESC, 0x45, 0x00) }
  const total   = (l: string, v: string) => { raw(ESC, 0x45, 0x01); two(l, `= ${v}`); raw(ESC, 0x45, 0x00) }

  raw(ESC, 0x40)

  // Header
  raw(ESC, 0x61, 0x01, ESC, 0x45, 0x01, ESC, 0x21, 0x10)
  line(data.storeName || data.store_name || 'Mi Tienda')
  raw(ESC, 0x21, 0x00, ESC, 0x45, 0x00)
  raw(ESC, 0x61, 0x01)
  if (data.storePhone   || data.store_phone)   line(data.storePhone || data.store_phone)
  if (data.storeSocial  || data.store_social)  line(data.storeSocial || data.store_social)
  if (data.storeAddress || data.store_address) line(data.storeAddress || data.store_address)

  raw(ESC, 0x61, 0x00)
  div()
  raw(ESC, 0x61, 0x01, ESC, 0x45, 0x01); line('CORTE DE TURNO'); raw(ESC, 0x45, 0x00, ESC, 0x61, 0x00)
  line(`TURNO #${data.shiftId || ''}`)
  line(`Realizado: ${data.endedAt || ''}`)
  line(`Cajero: ${norm(data.cashierName || '')}`)
  div()
  two('Ventas Totales:', fmt(data.sales?.total))
  line(`N Ventas en el turno: ${data.sales?.count || 0}`)

  section('DINERO EN CAJA')
  two('Fondo de Caja:', fmt(data.openingCash || 0))
  two('Ventas Efectivo:', `+${fmt((data.sales?.efectivo || 0) + (data.mixtoCash || 0))}`)
  two('Entradas:', `+${fmt(data.entradas || 0)}`)
  two('Salidas:', `-${fmt(data.salidas || 0)}`)
  total('Efectivo en Caja:', fmt(data.expectedCash || 0))

  const entradas   = (data.movementDetails || []).filter((m: any) => m.type === 'entrada')
  const salidasLst = (data.movementDetails || []).filter((m: any) => m.type === 'salida')

  section('ENTRADAS EFECTIVO')
  if (entradas.length === 0) line('Sin entradas')
  else entradas.forEach((m: any) => two(norm(m.concept || 'Entrada'), fmt(m.amount)))
  total('Total Entradas:', fmt(data.entradas || 0))

  section('SALIDAS EFECTIVO')
  if (salidasLst.length === 0) line('Sin salidas')
  else salidasLst.forEach((m: any) => two(norm(m.concept || 'Retiro'), fmt(m.amount)))
  total('Total Salidas:', fmt(data.salidas || 0))

  section('VENTAS')
  two('En Efectivo:', fmt(data.sales?.efectivo || 0))
  two('Con Tarjeta:', fmt(data.sales?.tarjeta || 0))
  two('Transferencia:', fmt(data.sales?.transferencia || 0))
  if ((data.sales?.mixto || 0) > 0) two('Mixto:', fmt(data.sales?.mixto))
  total('Total Ventas:', fmt(data.sales?.total || 0))

  section('VENTAS POR DEPTO')
  if (!(data.salesByCategory || []).length) line('Sin datos')
  else (data.salesByCategory || []).forEach((c: any) => two(norm(c.category || 'Sin cat.'), fmt(c.total)))

  section('GANANCIA POR DEPTO')
  if (!(data.salesByCategory || []).length) line('Sin datos')
  else (data.salesByCategory || []).forEach((c: any) => two(norm(c.category || 'Sin cat.'), fmt((c.total || 0) - (c.cost || 0))))
  total('Utilidad Total:', fmt(data.utility || 0))

  section('RESUMEN CAJA')
  two('Efectivo Esperado:', fmt(data.expectedCash || 0))
  if (data.countedCash !== undefined) {
    two('Contado:', fmt(data.countedCash))
    raw(ESC, 0x45, 0x01)
    two('Diferencia:', fmt((data.countedCash || 0) - (data.expectedCash || 0)))
    raw(ESC, 0x45, 0x00)
  }

  raw(LF); div()
  raw(ESC, 0x61, 0x01); line(data.endedAt || new Date().toLocaleString('es-MX')); raw(ESC, 0x61, 0x00)
  raw(ESC, 0x64, 14, GS, 0x56, 0x00)  // feed + full cut (extra feed so nothing gets cut off)
  return Buffer.concat(parts)
}

function buildDailyCorteESCPOS(data: any, stored: any): Buffer {
  const fmt  = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
  const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?')
  const COLS = 42
  const ESC = 0x1b, GS = 0x1d, LF = 0x0a

  const parts: Buffer[] = []
  const raw  = (...b: number[]) => parts.push(Buffer.from(b))
  const line = (s: string) => { parts.push(Buffer.from(norm(s).substring(0, COLS), 'ascii')); raw(LF) }
  const cline = (s: string) => {
    const n = norm(s).substring(0, COLS)
    const pad = Math.floor((COLS - n.length) / 2)
    parts.push(Buffer.from(' '.repeat(Math.max(0, pad)) + n, 'ascii')); raw(LF)
  }
  const two = (l: string, r: string) => {
    const right = norm(r); const left = norm(l).substring(0, COLS - right.length - 1)
    parts.push(Buffer.from(left + ' '.repeat(Math.max(1, COLS - left.length - right.length)) + right, 'ascii')); raw(LF)
  }
  const div     = () => line('-'.repeat(COLS))
  const section = (t: string) => { raw(LF, ESC, 0x45, 0x01); cline(`== ${norm(t)} ==`); raw(ESC, 0x45, 0x00) }
  const total   = (l: string, v: string) => { raw(ESC, 0x45, 0x01); two(l, `= ${v}`); raw(ESC, 0x45, 0x00) }

  raw(ESC, 0x40)

  // Header
  raw(ESC, 0x61, 0x01, ESC, 0x45, 0x01, ESC, 0x21, 0x10)
  line(stored.store_name || 'Mi Tienda')
  raw(ESC, 0x21, 0x00, ESC, 0x45, 0x00)
  raw(ESC, 0x61, 0x01)
  if (stored.store_phone)   line(stored.store_phone)
  if (stored.store_social)  line(stored.store_social)
  if (stored.store_address) line(stored.store_address)

  raw(ESC, 0x61, 0x00)
  div()
  raw(ESC, 0x61, 0x01, ESC, 0x45, 0x01); line('CORTE DEL DIA'); raw(ESC, 0x45, 0x00, ESC, 0x61, 0x00)
  line(data.date || new Date().toLocaleDateString('es-MX'))
  div()
  two('Turnos trabajados:', String(data.shiftsCount || 0))
  two('Transacciones:', String(data.sales?.count || 0))

  section('VENTAS')
  two('En Efectivo:', fmt(data.sales?.efectivo || 0))
  two('Con Tarjeta:', fmt(data.sales?.tarjeta || 0))
  two('Transferencia:', fmt(data.sales?.transferencia || 0))
  if ((data.sales?.mixto || 0) > 0) two('Mixto:', fmt(data.sales?.mixto))
  total('Total Ventas:', fmt(data.sales?.total || 0))

  section('POR CAJERO')
  if (!(data.byCashier || []).length) line('Sin datos')
  else (data.byCashier || []).forEach((c: any) => two(norm(c.cashier || ''), `${c.count} vtas · ${fmt(c.total)}`))

  section('VENTAS POR DEPTO')
  if (!(data.byCategory || []).length) line('Sin datos')
  else (data.byCategory || []).forEach((c: any) => two(norm(c.category || 'Sin cat.'), fmt(c.total)))

  section('GANANCIA POR DEPTO')
  if (!(data.byCategory || []).length) line('Sin datos')
  else (data.byCategory || []).forEach((c: any) => two(norm(c.category || 'Sin cat.'), fmt((c.total || 0) - (c.cost || 0))))
  total('Utilidad Total:', fmt(data.utility || 0))

  const entradas   = (data.movementDetails || []).filter((m: any) => m.type === 'entrada')
  const salidasLst = (data.movementDetails || []).filter((m: any) => m.type === 'salida')

  section('ENTRADAS EFECTIVO')
  if (entradas.length === 0) line('Sin entradas')
  else entradas.forEach((m: any) => two(norm(m.concept || 'Entrada'), fmt(m.amount)))
  total('Total Entradas:', fmt(data.entradas || 0))

  section('SALIDAS EFECTIVO')
  if (salidasLst.length === 0) line('Sin salidas')
  else salidasLst.forEach((m: any) => two(norm(m.concept || 'Retiro'), fmt(m.amount)))
  total('Total Salidas:', fmt(data.salidas || 0))

  section('RESUMEN CAJA')
  two('Ef. inicial (primer turno):', fmt(data.openingCash || 0))
  two('Ventas efectivo:', fmt((data.sales?.efectivo || 0) + (data.mixtoCash || 0)))
  two('+ Entradas:', fmt(data.entradas || 0))
  two('- Salidas:', fmt(data.salidas || 0))
  total('Esperado en Caja:', fmt(data.expectedCash || 0))

  raw(LF); div()
  raw(ESC, 0x61, 0x01); line(new Date().toLocaleString('es-MX')); raw(ESC, 0x61, 0x00)
  raw(ESC, 0x64, 14, GS, 0x56, 0x00)  // feed + full cut (extra feed so nothing gets cut off)
  return Buffer.concat(parts)
}

function buildShiftHTML(data: any): string {
  const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

  const sizeKey = data.receipt_font_size || 'medium'
  const fontBase = sizeKey === 'small' ? 23 : sizeKey === 'large' ? 29 : 26

  const section = (title: string) =>
    `<div class="section">${title}</div>`

  const row = (label: string, value: string, bold = false) =>
    `<div class="row ${bold ? 'bold' : ''}">${label} ${value}</div>`

  const total = (label: string, value: string) =>
    `<div class="total">${label}: ${value}</div>`

  // Categories — ventas + ganancia
  const catVentasRows = (data.salesByCategory || []).map((c: any) =>
    row(c.category || 'Sin cat.', fmt(c.total))
  ).join('')

  const catGananciaRows = (data.salesByCategory || []).map((c: any) => {
    const profit = (c.total || 0) - (c.cost || 0)
    return row(c.category || 'Sin cat.', fmt(profit))
  }).join('')

  // Cash movements
  const entradas = (data.movementDetails || []).filter((m: any) => m.type === 'entrada')
  const salidas  = (data.movementDetails || []).filter((m: any) => m.type === 'salida')

  const entradaRows = entradas.length
    ? entradas.map((m: any) => row(m.concept || 'Entrada', fmt(m.amount))).join('')
    : `<div class="note">Sin entradas</div>`

  const salidaRows = salidas.length
    ? salidas.map((m: any) => row(m.concept || 'Retiro', fmt(m.amount))).join('')
    : `<div class="note">Sin salidas</div>`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: ${fontBase}px;
    font-weight: 400;
    line-height: 1.5;
    text-align: center;
    color: #000;
    background: #fff;
    width: 68mm;
    margin: 0 auto;
    padding: 4mm;
  }
  .store   { font-size: ${fontBase + 6}px; font-weight: 700; margin-bottom: 3px; }
  .sub     { font-size: ${fontBase - 2}px; font-weight: 600; color: #333; }
  .divider { border-top: 1px solid #000; margin: 6px 0; }
  .title   { font-size: ${fontBase + 4}px; font-weight: 700; margin: 5px 0; }
  .section { font-size: ${fontBase}px; font-weight: 700; margin: 8px 0 3px; text-decoration: underline; }
  .row     { font-size: ${fontBase}px; font-weight: 500; padding: 2px 0; }
  .row.bold{ font-weight: 700; font-size: ${fontBase + 1}px; }
  .note    { font-size: ${fontBase - 2}px; font-weight: 500; color: #555; padding: 2px 0; }
  .total   { font-size: ${fontBase + 2}px; font-weight: 700; padding: 4px 0; border-top: 1px solid #000; margin-top: 3px; }
  @media print {
    @page { margin: 0; }
    body  { padding: 3mm 3mm 40mm; }
  }
</style>
</head>
<body>
  <div class="store">${data.storeName || 'Mi Tienda'}</div>
  ${data.storeAddress ? `<div class="sub">${data.storeAddress}</div>` : ''}
  ${data.storePhone   ? `<div class="sub">${data.storePhone}</div>` : ''}
  ${data.storeSocial  ? `<div class="sub">${data.storeSocial}</div>` : ''}
  <div class="divider"></div>
  <div class="title">CORTE DE CAJERO</div>
  <div class="divider"></div>
  ${row('Cajero:', data.cashierName || '')}
  ${row('Turno #:', String(data.shiftId || ''))}
  ${row('Inicio:', data.startedAt)}
  ${row('Cierre:', data.endedAt || '')}
  ${row('N° ventas:', String(data.sales?.count || 0))}

  ${section('VENTAS')}
  ${row('Efectivo:', fmt(data.sales?.efectivo))}
  ${row('Tarjeta:', fmt(data.sales?.tarjeta))}
  ${row('Transferencia:', fmt(data.sales?.transferencia))}
  ${(data.sales?.mixto || 0) > 0 ? row('Mixto:', fmt(data.sales?.mixto)) : ''}
  ${total('TOTAL VENTAS', fmt(data.sales?.total))}

  ${section('VENTAS POR DEPTO')}
  ${catVentasRows || `<div class="note">Sin datos</div>`}

  ${section('GANANCIA POR DEPTO')}
  ${catGananciaRows || `<div class="note">Sin datos</div>`}
  ${total('UTILIDAD TOTAL', fmt(data.utility || 0))}

  ${section('ENTRADAS EFECTIVO')}
  ${entradaRows}
  ${total('TOTAL ENTRADAS', fmt(data.entradas || 0))}

  ${section('SALIDAS EFECTIVO')}
  ${salidaRows}
  ${total('TOTAL SALIDAS', fmt(data.salidas || 0))}

  ${section('RESUMEN CAJA')}
  ${row('Inicial:', fmt(data.openingCash || 0))}
  ${row('Ventas efectivo:', fmt((data.sales?.efectivo || 0) + (data.mixtoCash || 0)))}
  ${row('+ Entradas:', fmt(data.entradas || 0))}
  ${row('- Salidas:', fmt(data.salidas || 0))}
  ${total('ESPERADO EN CAJA', fmt(data.expectedCash || 0))}
  ${data.countedCash !== undefined ? `
  ${row('Contado:', fmt(data.countedCash))}
  ${row('Diferencia:', fmt((data.countedCash || 0) - (data.expectedCash || 0)))}
  ` : ''}
  <div class="divider"></div>
  <div class="note">${data.endedAt || new Date().toLocaleString('es-MX')}</div>
  <div style="height:40mm"></div>
</body>
</html>`
}

function buildShiftPrintData(data: any): any[] {
  const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
  return [
    { type: 'text', value: data.storeName || 'Mi Tienda', style: { textAlign: 'center', fontWeight: '700', fontSize: '16px' } },
    { type: 'text', value: 'CORTE DE CAJA', style: { textAlign: 'center', fontWeight: '700' } },
    { type: 'text', value: '--------------------------------', style: { textAlign: 'center' } },
    { type: 'text', value: `Cajero: ${data.cashierName}`, style: { fontSize: '11px' } },
    { type: 'text', value: `Apertura: ${data.startedAt}`, style: { fontSize: '11px' } },
    { type: 'text', value: `Cierre: ${data.endedAt}`, style: { fontSize: '11px' } },
    { type: 'text', value: '--------------------------------', style: { textAlign: 'center' } },
    { type: 'text', value: `Ventas Efectivo: ${fmt(data.efectivo)}`, style: { fontSize: '11px' } },
    { type: 'text', value: `Ventas Tarjeta: ${fmt(data.tarjeta)}`, style: { fontSize: '11px' } },
    { type: 'text', value: `Ventas Transferencia: ${fmt(data.transferencia)}`, style: { fontSize: '11px' } },
    { type: 'text', value: `TOTAL VENTAS: ${fmt(data.total)}`, style: { fontWeight: '700' } },
    { type: 'text', value: '--------------------------------', style: { textAlign: 'center' } },
    { type: 'text', value: `Efectivo Inicial: ${fmt(data.openingCash)}`, style: { fontSize: '11px' } },
    { type: 'text', value: `Entradas: ${fmt(data.entradas)}`, style: { fontSize: '11px' } },
    { type: 'text', value: `Retiros: ${fmt(data.salidas)}`, style: { fontSize: '11px' } },
    { type: 'text', value: `Efectivo Esperado: ${fmt(data.expectedCash)}`, style: { fontWeight: '700' } },
    { type: 'text', value: `Efectivo Contado: ${fmt(data.countedCash)}`, style: { fontWeight: '700' } },
    { type: 'text', value: `Diferencia: ${fmt(data.countedCash - data.expectedCash)}`, style: { fontWeight: '700' } },
    { type: 'text', value: ' ', style: {} },
  ]
}

function buildDailyCorteHTML(data: any, stored: any): string {
  const fmt = (n: number) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
  const sizeKey = stored.receipt_font_size || 'medium'
  const fontBase = sizeKey === 'small' ? 23 : sizeKey === 'large' ? 29 : 26

  const section = (t: string) => `<div class="section">${t}</div>`
  const row = (l: string, v: string, bold = false) =>
    `<div class="row ${bold ? 'bold' : ''}">${l} ${v}</div>`
  const total = (l: string, v: string) =>
    `<div class="total">${l}: ${v}</div>`

  const cashierRows = (data.byCashier || []).map((c: any) =>
    row(c.cashier, `${c.count} vtas · ${fmt(c.total)}`)
  ).join('')

  const catVentasRows = (data.byCategory || []).map((c: any) =>
    row(c.category || 'Sin cat.', fmt(c.total))
  ).join('')

  const catGananciaRows = (data.byCategory || []).map((c: any) => {
    const profit = (c.total || 0) - (c.cost || 0)
    return row(c.category || 'Sin cat.', fmt(profit))
  }).join('')

  const entradas = (data.movementDetails || []).filter((m: any) => m.type === 'entrada')
  const salidas  = (data.movementDetails || []).filter((m: any) => m.type === 'salida')

  const entradaRows = entradas.length
    ? entradas.map((m: any) => row(m.concept || 'Entrada', fmt(m.amount))).join('')
    : `<div class="note">Sin entradas</div>`

  const salidaRows = salidas.length
    ? salidas.map((m: any) => row(m.concept || 'Retiro', fmt(m.amount))).join('')
    : `<div class="note">Sin salidas</div>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Courier New',Courier,monospace; font-size:${fontBase}px; font-weight:500; line-height:1.5; text-align:center; color:#000; background:#fff; width:68mm; margin:0 auto; padding:4mm; }
  .store   { font-size:${fontBase+6}px; font-weight:700; margin-bottom:3px; }
  .sub     { font-size:${fontBase-2}px; font-weight:600; color:#333; }
  .divider { border-top:1px solid #000; margin:6px 0; }
  .title   { font-size:${fontBase+4}px; font-weight:700; margin:5px 0; }
  .section { font-size:${fontBase}px; font-weight:700; margin:8px 0 3px; text-decoration:underline; }
  .row     { font-size:${fontBase}px; font-weight:500; padding:2px 0; }
  .row.bold{ font-weight:700; font-size:${fontBase+1}px; }
  .note    { font-size:${fontBase-2}px; font-weight:500; color:#555; padding:2px 0; }
  .total   { font-size:${fontBase+2}px; font-weight:700; padding:4px 0; border-top:1px solid #000; margin-top:3px; }
  @media print { @page { margin:0; } body { padding:3mm 3mm 40mm; } }
</style></head><body>
  <div class="store">${stored.store_name || 'Mi Tienda'}</div>
  ${stored.store_address ? `<div class="sub">${stored.store_address}</div>` : ''}
  ${stored.store_phone   ? `<div class="sub">${stored.store_phone}</div>` : ''}
  <div class="divider"></div>
  <div class="title">CORTE DEL DÍA</div>
  <div class="note">${data.date || ''}</div>
  <div class="divider"></div>
  ${row('Turnos trabajados:', String(data.shiftsCount || 0))}
  ${row('N° transacciones:', String(data.sales?.count || 0))}

  ${section('VENTAS')}
  ${row('Efectivo:', fmt(data.sales?.efectivo))}
  ${row('Tarjeta:', fmt(data.sales?.tarjeta))}
  ${row('Transferencia:', fmt(data.sales?.transferencia))}
  ${(data.sales?.mixto || 0) > 0 ? row('Mixto:', fmt(data.sales?.mixto)) : ''}
  ${total('TOTAL VENTAS', fmt(data.sales?.total))}

  ${section('POR CAJERO')}
  ${cashierRows || '<div class="note">Sin datos</div>'}

  ${section('VENTAS POR DEPTO')}
  ${catVentasRows || '<div class="note">Sin datos</div>'}

  ${section('GANANCIA POR DEPTO')}
  ${catGananciaRows || '<div class="note">Sin datos</div>'}
  ${total('UTILIDAD TOTAL', fmt(data.utility || 0))}

  ${section('ENTRADAS EFECTIVO')}
  ${entradaRows}
  ${total('TOTAL ENTRADAS', fmt(data.entradas || 0))}

  ${section('SALIDAS EFECTIVO')}
  ${salidaRows}
  ${total('TOTAL SALIDAS', fmt(data.salidas || 0))}

  ${section('RESUMEN CAJA')}
  ${row('Ef. inicial (primer turno):', fmt(data.openingCash || 0))}
  ${row('Ventas efectivo:', fmt((data.sales?.efectivo || 0) + (data.mixtoCash || 0)))}
  ${row('+ Entradas:', fmt(data.entradas || 0))}
  ${row('- Salidas:', fmt(data.salidas || 0))}
  ${total('ESPERADO EN CAJA', fmt(data.expectedCash || 0))}

  <div class="divider"></div>
  <div class="note">${new Date().toLocaleString('es-MX')}</div>
  <div style="height:40mm"></div>
</body></html>`
}
