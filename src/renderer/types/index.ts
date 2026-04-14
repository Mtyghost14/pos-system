export interface User {
  id: number
  username: string
  role: 'admin' | 'cajero'
  name: string
  active: number
  created_at: string
}

export interface Category {
  id: number
  name: string
  created_at: string
}

export interface Product {
  id: number
  code: string
  name: string
  category_id: number
  category_name?: string
  cost: number
  price: number
  stock: number
  min_stock: number
  active: number
  promo_price?: number
  promo_name?: string
}

export interface Shift {
  id: number
  cashier_id: number
  opening_cash: number
  closing_cash?: number
  expected_cash?: number
  started_at: string
  ended_at?: string
  status: 'open' | 'closed'
}

export interface Sale {
  id: number
  folio: string
  cashier_id: number
  cashier_name?: string
  payment_type: 'efectivo' | 'tarjeta' | 'transferencia'
  total: number
  cost_total: number
  received_amount: number
  change_amount: number
  shift_id: number
  timestamp: string
  items?: SaleItem[]
}

export interface SaleItem {
  id: number
  sale_id: number
  product_id: number
  product_name?: string
  product_code?: string
  category_name?: string
  quantity: number
  unit_price: number
  unit_cost: number
  discount: number
}

export interface CashMovement {
  id: number
  shift_id: number
  type: 'entrada' | 'salida' | 'venta' | 'devolucion'
  amount: number
  concept?: string
  timestamp: string
  cashier_id: number
  cashier_name?: string
}

export interface InventoryMovement {
  id: number
  product_id: number
  product_name?: string
  product_code?: string
  category_name?: string
  type: 'venta' | 'ajuste' | 'recepcion'
  quantity_before: number
  quantity_change: number
  quantity_after: number
  cashier_id: number
  cashier_name?: string
  reference_id?: number
  timestamp: string
  notes?: string
}

export interface Supplier {
  id: number
  name: string
  contact_name?: string
  phone?: string
  email?: string
  address?: string
  products_supplied?: string
  notes?: string
  created_at: string
}

export interface Promotion {
  id: number
  name: string
  product_id: number
  product_name?: string
  product_code?: string
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  start_date: string
  end_date: string
  active: number
}

export interface Invoice {
  id: number
  sale_id?: number
  sale_folio?: string
  folio_fiscal?: string
  rfc_receptor: string
  razon_social: string
  cfdi_use: string
  total: number
  timestamp: string
  status: 'draft' | 'stamped' | 'cancelled'
  xml_content?: string
  pdf_path?: string
}

export interface Settings {
  store_name: string
  store_address: string
  store_phone: string
  store_rfc: string
  printer_port: string
  receipt_footer: string
  rfc_emisor: string
  razon_social_emisor: string
  regimen_fiscal_emisor: string
  certificado_no: string
  pac_url: string
  pac_user: string
  pac_password: string
}

export interface CartItem {
  product_id: number
  code: string
  name: string
  quantity: number
  unit_price: number
  unit_cost: number
  discount: number
  promo_name?: string
}
