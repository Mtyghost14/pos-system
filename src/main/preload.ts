import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Auth
  login: (username: string, password: string) =>
    ipcRenderer.invoke('auth:login', username, password),
  getUsers: () => ipcRenderer.invoke('auth:getUsers'),
  createUser: (data: any) => ipcRenderer.invoke('auth:createUser', data),
  updateUser: (data: any) => ipcRenderer.invoke('auth:updateUser', data),
  deleteUser: (id: number) => ipcRenderer.invoke('auth:deleteUser', id),

  // Products
  getProducts: (query?: string) => ipcRenderer.invoke('products:getAll', query),
  getProductByCode: (code: string) => ipcRenderer.invoke('products:getByCode', code),
  createProduct: (data: any) => ipcRenderer.invoke('products:create', data),
  updateProduct: (data: any) => ipcRenderer.invoke('products:update', data),
  deleteProduct: (id: number) => ipcRenderer.invoke('products:delete', id),
  importProducts: (rows: any[]) => ipcRenderer.invoke('products:import', rows),
  exportProducts: () => ipcRenderer.invoke('products:export'),

  // Extra barcodes
  getProductBarcodes: (productId: number) => ipcRenderer.invoke('barcodes:getByProduct', productId),
  addProductBarcode: (data: { product_id: number; code: string; label?: string }) => ipcRenderer.invoke('barcodes:add', data),
  deleteProductBarcode: (id: number) => ipcRenderer.invoke('barcodes:delete', id),

  // Categories
  getCategories: () => ipcRenderer.invoke('categories:getAll'),
  createCategory: (name: string) => ipcRenderer.invoke('categories:create', name),
  updateCategory: (id: number, name: string) => ipcRenderer.invoke('categories:update', id, name),
  deleteCategory: (id: number) => ipcRenderer.invoke('categories:delete', id),

  // Sales
  createSale: (data: any) => ipcRenderer.invoke('sales:create', data),
  getSales: (filters: any) => ipcRenderer.invoke('sales:getAll', filters),
  getSaleById: (id: number) => ipcRenderer.invoke('sales:getById', id),
  cancelSale: (data: { sale_id: number; reason: string; cancelled_by: number }) => ipcRenderer.invoke('sales:cancel', data),

  // Shifts
  getActiveShift: (cashierId: number) => ipcRenderer.invoke('shifts:getActive', cashierId),
  openShift: (data: any) => ipcRenderer.invoke('shifts:open', data),
  closeShift: (data: any) => ipcRenderer.invoke('shifts:close', data),
  getShiftSummary: (shiftId: number) => ipcRenderer.invoke('shifts:getSummary', shiftId),
  getCashBalance: (shiftId: number) => ipcRenderer.invoke('shifts:getCashBalance', shiftId),

  // Cash movements
  addCashMovement: (data: any) => ipcRenderer.invoke('cash:addMovement', data),
  getCashMovements: (shiftId: number) => ipcRenderer.invoke('cash:getMovements', shiftId),

  // Inventory
  getInventoryMovements: (filters: any) => ipcRenderer.invoke('inventory:getMovements', filters),
  adjustInventory: (data: any) => ipcRenderer.invoke('inventory:adjust', data),
  getLowStockProducts: () => ipcRenderer.invoke('inventory:getLowStock'),
  getInventoryReport: () => ipcRenderer.invoke('inventory:getReport'),

  // Promotions
  getPromotions: () => ipcRenderer.invoke('promotions:getAll'),
  createPromotion: (data: any) => ipcRenderer.invoke('promotions:create', data),
  updatePromotion: (data: any) => ipcRenderer.invoke('promotions:update', data),
  deletePromotion: (id: number) => ipcRenderer.invoke('promotions:delete', id),
  getActivePromotionsForProduct: (productId: number) =>
    ipcRenderer.invoke('promotions:getActiveForProduct', productId),

  // Suppliers
  getSuppliers: () => ipcRenderer.invoke('suppliers:getAll'),
  createSupplier: (data: any) => ipcRenderer.invoke('suppliers:create', data),
  updateSupplier: (data: any) => ipcRenderer.invoke('suppliers:update', data),
  deleteSupplier: (id: number) => ipcRenderer.invoke('suppliers:delete', id),

  // Reports
  getReports: (filters: any) => ipcRenderer.invoke('reports:get', filters),
  getDashboard: () => ipcRenderer.invoke('reports:getDashboard'),
  getSalesByPeriod: (filters: any) => ipcRenderer.invoke('reports:salesByPeriod', filters),

  // Invoices
  getInvoices: () => ipcRenderer.invoke('invoices:getAll'),
  createInvoice: (data: any) => ipcRenderer.invoke('invoices:create', data),
  updateInvoice: (data: any) => ipcRenderer.invoke('invoices:update', data),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (data: any) => ipcRenderer.invoke('settings:save', data),

  // Printer
  printReceipt: (data: any) => ipcRenderer.invoke('printer:printReceipt', data),
  printShiftSummary: (data: any) => ipcRenderer.invoke('printer:printShift', data),
  getPrinterPorts: () => ipcRenderer.invoke('printer:getPorts'),
  getSystemPrinters: () => ipcRenderer.invoke('printer:getSystemPrinters'),
  printZPL: (data: { zpl: string; printerName: string }) => ipcRenderer.invoke('printer:printZPL', data),

  // Excel
  exportToExcel: (data: any) => ipcRenderer.invoke('excel:export', data),
  exportToExcelMulti: (data: any) => ipcRenderer.invoke('excel:exportMulti', data),
  showSaveDialog: (opts: any) => ipcRenderer.invoke('dialog:showSave', opts),
  showOpenDialog: (opts: any) => ipcRenderer.invoke('dialog:showOpen', opts),
  readExcelFile: (path: string) => ipcRenderer.invoke('excel:readFile', path),

  // Backup
  createBackup: () => ipcRenderer.invoke('backup:create'),
  getBackups: () => ipcRenderer.invoke('backup:list'),
  restoreBackup: (filename: string) => ipcRenderer.invoke('backup:restore', filename),
  exportBackup: (filename: string) => ipcRenderer.invoke('backup:export', filename),
  importBackup: () => ipcRenderer.invoke('backup:import'),
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
