// ─────────────────────────────────────────────────────────────────────────────
// Quién tiene la sesión abierta en el POS (lo sabe el proceso principal, no la
// pantalla). Las funciones de administrador lo revisan aquí: antes solo se
// ocultaban en el menú, y con las herramientas de desarrollador una cajera
// podía llamarlas directo (p. ej. ver las contraseñas de todos).
// ─────────────────────────────────────────────────────────────────────────────

type SessionUser = { id: number; role: string; name: string }

let current: SessionUser | null = null

export function setSessionUser(u: SessionUser | null) { current = u }
export function getSessionUser(): SessionUser | null { return current }
export function isAdminSession(): boolean { return current?.role === 'admin' }

/** Respuesta estándar cuando alguien que no es admin intenta una acción de admin. */
export const NOT_ADMIN = {
  success: false,
  ok: false,
  message: 'Solo un administrador puede hacer esto.',
} as const
