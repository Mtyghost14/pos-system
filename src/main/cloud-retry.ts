// ─────────────────────────────────────────────────────────────────────────────
// Reintentos para llamadas a la nube (RPC de Supabase).
//
// Caso real: PostgREST responde PGRST002 "Could not query the database for the
// schema cache. Retrying." (HTTP 503) mientras reconstruye su caché. En ese
// caso la petición NO se ejecutó, así que reintentar es seguro para cualquier
// RPC. Normalmente se resuelve en segundos; si dura minutos hay que reiniciar
// el proyecto en Supabase (Settings → General → Restart project).
//
// Un fallo de RED es distinto: no sabemos si la petición llegó. Solo se
// reintenta en RPC idempotentes (se pueden repetir sin duplicar efectos).
// Este archivo no importa electron, para poder probarlo solo.
// ─────────────────────────────────────────────────────────────────────────────

/** RPC que se pueden repetir sin duplicar efectos (idempotentes por folio / solo rellenan vacíos). */
export const IDEMPOTENT_RPCS = new Set([
  'commit_pos_sale',        // si el folio ya existe, no hace nada
  'cancel_pos_sale',        // solo cancela si no estaba cancelada
  'import_pos_sales_bulk',  // salta folios existentes
  'backfill_item_costs',    // solo rellena costos vacíos
])

export type RpcResult = {
  data: any
  error: { message: string; code?: string } | null
  status?: number
}

export const CLOUD_BUSY_MESSAGE =
  'La nube no está respondiendo en este momento. Espera unos segundos y vuelve a intentar — el carrito se conserva.'

/** El gateway/PostgREST no pudo atender (caché de esquema, 502/503/504): la petición NO se ejecutó. */
export function isGatewayTransient(r: RpcResult): boolean {
  const e = r.error
  if (!e) return false
  return e.code === 'PGRST002' || /schema cache/i.test(e.message || '') || [502, 503, 504].includes(r.status ?? 0)
}

/** Falló la conexión: no se sabe si la petición llegó a ejecutarse. */
export function isNetworkFailure(r: RpcResult): boolean {
  const e = r.error
  if (!e) return false
  return (r.status === 0 || r.status === undefined) &&
    /fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout/i.test(e.message || '')
}

export async function callWithRetry(
  call: () => PromiseLike<RpcResult>,
  fn: string,
  opts: { delaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RpcResult & { attempts: number }> {
  const delays = opts.delaysMs ?? [1000, 2000, 4000]         // hasta 4 intentos, ~7 s de espera en total
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  let attempts = 0
  for (;;) {
    const r = await call()
    attempts++
    const retriable = isGatewayTransient(r) || (IDEMPOTENT_RPCS.has(fn) && isNetworkFailure(r))
    if (!r.error || !retriable || attempts > delays.length) return { ...r, attempts }
    await sleep(delays[attempts - 1])
  }
}
