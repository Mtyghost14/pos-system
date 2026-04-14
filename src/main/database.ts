import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import bcrypt from 'bcryptjs'

let db: Database.Database

export function getDb(): Database.Database {
  return db
}

export function initDatabase() {
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'pos.db')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  createTables()
  runMigrations()
  seedData()
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','cajero')),
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      cost REAL DEFAULT 0,
      price REAL NOT NULL,
      stock REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashier_id INTEGER REFERENCES users(id),
      opening_cash REAL DEFAULT 0,
      closing_cash REAL,
      expected_cash REAL,
      started_at TEXT DEFAULT (datetime('now','localtime')),
      ended_at TEXT,
      status TEXT DEFAULT 'open' CHECK(status IN ('open','closed'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folio TEXT UNIQUE NOT NULL,
      cashier_id INTEGER REFERENCES users(id),
      payment_type TEXT NOT NULL CHECK(payment_type IN ('efectivo','tarjeta','transferencia')),
      total REAL NOT NULL,
      cost_total REAL DEFAULT 0,
      received_amount REAL DEFAULT 0,
      change_amount REAL DEFAULT 0,
      shift_id INTEGER REFERENCES shifts(id),
      timestamp TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER REFERENCES sales(id),
      product_id INTEGER REFERENCES products(id),
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      unit_cost REAL DEFAULT 0,
      discount REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER REFERENCES shifts(id),
      type TEXT NOT NULL CHECK(type IN ('entrada','salida','venta','devolucion')),
      amount REAL NOT NULL,
      concept TEXT,
      timestamp TEXT DEFAULT (datetime('now','localtime')),
      cashier_id INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      type TEXT NOT NULL CHECK(type IN ('venta','ajuste','recepcion')),
      quantity_before REAL NOT NULL,
      quantity_change REAL NOT NULL,
      quantity_after REAL NOT NULL,
      cashier_id INTEGER REFERENCES users(id),
      reference_id INTEGER,
      timestamp TEXT DEFAULT (datetime('now','localtime')),
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      products_supplied TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      product_id INTEGER REFERENCES products(id),
      discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage','fixed')),
      discount_value REAL NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER REFERENCES sales(id),
      folio_fiscal TEXT,
      rfc_receptor TEXT NOT NULL,
      razon_social TEXT NOT NULL,
      cfdi_use TEXT NOT NULL,
      total REAL NOT NULL,
      timestamp TEXT DEFAULT (datetime('now','localtime')),
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','stamped','cancelled')),
      xml_content TEXT,
      pdf_path TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)
}

function runMigrations() {
  // Allow 'mixto' as payment_type — recreate sales table without CHECK constraint if needed
  try {
    db.prepare("INSERT INTO sales (folio, cashier_id, payment_type, total, shift_id) VALUES ('__migration_test__', 1, 'mixto', 0, 1)").run()
    db.prepare("DELETE FROM sales WHERE folio = '__migration_test__'").run()
  } catch {
    // CHECK constraint still exists — recreate table without it
    db.exec(`
      CREATE TABLE IF NOT EXISTS sales_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folio TEXT UNIQUE NOT NULL,
        cashier_id INTEGER REFERENCES users(id),
        payment_type TEXT NOT NULL,
        total REAL NOT NULL,
        cost_total REAL DEFAULT 0,
        received_amount REAL DEFAULT 0,
        change_amount REAL DEFAULT 0,
        payment_details TEXT,
        shift_id INTEGER REFERENCES shifts(id),
        timestamp TEXT DEFAULT (datetime('now','localtime'))
      );
      INSERT OR IGNORE INTO sales_v2
        (id, folio, cashier_id, payment_type, total, cost_total, received_amount, change_amount, shift_id, timestamp)
      SELECT id, folio, cashier_id, payment_type, total, cost_total, received_amount, change_amount, shift_id, timestamp
      FROM sales;
      DROP TABLE sales;
      ALTER TABLE sales_v2 RENAME TO sales;
    `)
  }

  // Add payment_details column to existing sales table if it doesn't have it
  try {
    db.exec('ALTER TABLE sales ADD COLUMN payment_details TEXT')
  } catch { /* already exists */ }

  // Product barcodes table (multiple barcodes per product)
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_barcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      code TEXT UNIQUE NOT NULL,
      label TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_product_barcodes_code ON product_barcodes(code);
  `)

  // Add cancellation columns to sales table
  try { db.exec('ALTER TABLE sales ADD COLUMN cancelled INTEGER DEFAULT 0') } catch { /* exists */ }
  try { db.exec('ALTER TABLE sales ADD COLUMN cancelled_at TEXT') } catch { /* exists */ }
  try { db.exec('ALTER TABLE sales ADD COLUMN cancelled_by INTEGER REFERENCES users(id)') } catch { /* exists */ }
  try { db.exec('ALTER TABLE sales ADD COLUMN cancel_reason TEXT') } catch { /* exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN plain_password TEXT') } catch { /* exists */ }
  // Backfill plain_password for known seed users that were created before this feature
  db.prepare(`UPDATE users SET plain_password = 'admin123' WHERE username = 'admin' AND plain_password IS NULL`).run()
  db.prepare(`UPDATE users SET plain_password = 'cajero123' WHERE username = 'cajero1' AND plain_password IS NULL`).run()
}

function seedData() {
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
  if (adminExists) return

  const adminHash = bcrypt.hashSync('admin123', 10)
  const cashierHash = bcrypt.hashSync('cajero123', 10)

  db.prepare(`INSERT INTO users (username, password_hash, plain_password, role, name) VALUES (?,?,?,?,?)`)
    .run('admin', adminHash, 'admin123', 'admin', 'Administrador')

  db.prepare(`INSERT INTO users (username, password_hash, plain_password, role, name) VALUES (?,?,?,?,?)`)
    .run('cajero1', cashierHash, 'cajero123', 'cajero', 'Juan García')

  const cats = ['Abarrotes', 'Bebidas', 'Lácteos', 'Carnes', 'Frutas y Verduras', 'Limpieza', 'Personal']
  const catIds: Record<string, number> = {}
  for (const cat of cats) {
    const res = db.prepare('INSERT INTO categories (name) VALUES (?)').run(cat)
    catIds[cat] = res.lastInsertRowid as number
  }

  const products = [
    { code: '7501055300081', name: 'Coca-Cola 600ml', cat: 'Bebidas', cost: 12, price: 18, stock: 50, min: 10 },
    { code: '7501055300098', name: 'Coca-Cola 2L', cat: 'Bebidas', cost: 22, price: 32, stock: 30, min: 5 },
    { code: '7500478000518', name: 'Sabritas Original 45g', cat: 'Abarrotes', cost: 11, price: 16, stock: 40, min: 10 },
    { code: '7501000125543', name: 'Bimbo Pan Blanco', cat: 'Abarrotes', cost: 38, price: 52, stock: 15, min: 5 },
    { code: '7501065900036', name: 'Leche Lala 1L', cat: 'Lácteos', cost: 20, price: 27, stock: 20, min: 6 },
    { code: '7501055365082', name: 'Agua Ciel 1L', cat: 'Bebidas', cost: 8, price: 14, stock: 60, min: 15 },
    { code: '7501055365075', name: 'Agua Ciel 600ml', cat: 'Bebidas', cost: 5, price: 9, stock: 80, min: 20 },
    { code: '7501008011559', name: 'Jabón Palmolive', cat: 'Personal', cost: 18, price: 26, stock: 25, min: 5 },
    { code: '7501037104007', name: 'Detergente Ariel 1kg', cat: 'Limpieza', cost: 65, price: 88, stock: 12, min: 3 },
    { code: '7500435053305', name: 'Arroz SOS 1kg', cat: 'Abarrotes', cost: 22, price: 30, stock: 8, min: 5 },
  ]

  const insertProduct = db.prepare(`
    INSERT INTO products (code, name, category_id, cost, price, stock, min_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  for (const p of products) {
    insertProduct.run(p.code, p.name, catIds[p.cat], p.cost, p.price, p.stock, p.min)
  }

  // Default settings
  const defaults: [string, string][] = [
    ['store_name', 'Mi Tienda'],
    ['store_address', 'Calle Principal #123, Col. Centro'],
    ['store_phone', '555-0000'],
    ['store_rfc', 'XAXX010101000'],
    ['printer_port', ''],
    ['receipt_footer', 'Gracias por su compra'],
    ['rfc_emisor', 'XAXX010101000'],
    ['razon_social_emisor', 'Mi Tienda SA de CV'],
    ['regimen_fiscal_emisor', '616'],
    ['certificado_no', ''],
    ['pac_url', ''],
    ['pac_user', ''],
    ['pac_password', ''],
  ]

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
  for (const [k, v] of defaults) {
    insertSetting.run(k, v)
  }
}
