# POS System — CLAUDE.md

## Project Overview
Desktop Point-of-Sale application for a Mexican retail store (tienda). Built with Electron + Vite + React 19 + TypeScript + Tailwind CSS v4. Database is SQLite via `better-sqlite3`. UI language is Spanish.

## Architecture

```
src/
├── main/               # Electron main process (Node.js)
│   ├── main.ts         # Electron app entry, window setup, auto-updater
│   ├── database.ts     # SQLite init, table creation, migrations, seed data
│   ├── ipc-handlers.ts # All IPC handlers (business logic lives here)
│   ├── preload.ts      # Exposes window.api to renderer via contextBridge
│   └── backup.ts       # DB backup logic
└── renderer/           # React app (browser context)
    ├── App.tsx          # Router, auth guards, CloseGuard, UpdateBanner
    ├── main.tsx         # React entry point
    ├── pages/           # One file per route
    ├── components/      # Shared UI components
    ├── store/           # Zustand stores
    └── types/index.ts   # Shared TypeScript interfaces
```

## IPC Pattern
All data access goes through Electron IPC:
- Main process: `ipcMain.handle('channel:action', handler)` in `ipc-handlers.ts`
- Renderer: `window.api.channelAction(...)` — typed via `preload.ts` + `types/global.d.ts`
- Never import `better-sqlite3` or Node modules in renderer files

## Database
- SQLite at `app.getPath('userData')/pos.db`
- WAL mode, foreign keys ON
- Schema changes go in `runMigrations()` in `database.ts` — use try/catch for additive `ALTER TABLE` columns
- Seed data only runs once (checks if admin user exists)

## Key Data Models (`src/renderer/types/index.ts`)
- `User` — roles: `admin` | `cajero`
- `Product` — has `code` (barcode), `cost`, `price`, `stock`, `min_stock`
- `Shift` — cash register shift (turno), must be open to make sales
- `Sale` — has `folio` (auto-generated), `payment_type` (efectivo/tarjeta/transferencia/mixto)
- `SaleItem` — line items with `unit_price`, `unit_cost`, `discount`
- `CashMovement` — tracks cash in/out per shift
- `InventoryMovement` — tracks stock changes
- `Supplier`, `Promotion`, `Invoice`, `Settings`

## Routes & Access Control
| Route | Access |
|---|---|
| `/ventas` | All authenticated users |
| `/productos` | All authenticated users |
| `/inventario` | All authenticated users |
| `/corte` | All authenticated users |
| `/compras` | Admin only |
| `/facturas` | Admin only |
| `/reportes` | Admin only |
| `/configuracion` | Admin only |

## State Management
- `useAuthStore` (Zustand) — current user + active shift
- `useSettingsStore` (Zustand) — store settings loaded from DB at startup

## Dev Commands
```bash
npm run start        # Electron dev mode (Vite + Electron concurrently)
npm run dev          # Vite renderer only (no Electron)
npm run build        # Production build
npm run dist         # Build + package with electron-builder
npm run rebuild      # Rebuild native modules (better-sqlite3, serialport)
```

## Key Dependencies
- `better-sqlite3` — synchronous SQLite (main process only)
- `electron-pos-printer` — thermal receipt printer
- `serialport` — serial port for hardware (barcode scanners, etc.)
- `exceljs` — Excel export for reports
- `jsbarcode` — barcode generation for labels
- `recharts` — charts in Reports page
- `bcryptjs` — password hashing
- `date-fns` — date formatting
- `electron-updater` — auto-update via electron-builder

## Conventions
- All user-facing text is in Spanish
- Currency is MXN (Mexican Peso), displayed as `$X.XX`
- Dates use `datetime('now','localtime')` in SQLite
- Folios auto-generated as `F{YYYYMMDDHHMMSS}{3-digit-random}`
- Neumorphic design style with CSS variables (`--nm-bg`, `--nm-accent`, etc.)
- `plain_password` stored in DB alongside bcrypt hash (for admin visibility in Settings)

## Default Credentials
- Admin: `admin` / `admin123`
- Cajero: `cajero1` / `cajero123`
