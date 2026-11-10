-- ============================================================================
-- 016_limite_solicitudes.sql — Protección contra floods (exceso de solicitudes)
--
-- Antes de cada solicitud a la API, la base cuenta cuántas lleva ese usuario
-- (o esa IP, si no inició sesión) en el minuto actual. Si se pasa del límite,
-- responde "429 Demasiadas solicitudes" sin ejecutar nada.
--
--   · Con sesión (POS, portal) ... 1500 por minuto por usuario
--       (el POS normal usa ~30/min; una recepción grande de Excel ~400/min)
--   · Sin sesión ................. 120 por minuto por IP
--
-- Cuenta las operaciones que ESCRIBEN (ventas, ajustes, conteos, pedidos…).
-- Las lecturas ya están acotadas por: máximo 1000 filas por consulta, límite
-- de tiempo por consulta (015) y permisos (015: sin sesión no se lee nada).
--
-- A prueba de fallas: si el contador mismo tuviera un error, la solicitud
-- PASA (nunca bloquea la caja por un problema del contador).
--
-- Requiere 015_blindaje.sql. Idempotente. Pegar en el SQL Editor y Run.
--
-- PARA DESACTIVARLO (si algún día hiciera falta), correr solo esto:
--     alter role authenticator reset pgrst.db_pre_request;
--     notify pgrst, 'reload config';
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- "unlogged": rápido y sin llenar el log de la base; si se reinicia, se vacía (no importa).
create unlogged table if not exists private.request_counts (
  bucket text   not null,
  win    bigint not null,           -- minuto (época / 60)
  n      int    not null default 0,
  primary key (bucket, win)
);
revoke all on private.request_counts from public, anon, authenticated;

create or replace function public.request_guard()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_claims jsonb; v_role text; v_sub text; v_bucket text;
  v_win bigint; v_n int := 0; v_limit int;
begin
  begin
    v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    v_role   := coalesce(v_claims->>'role', 'anon');
    if v_role = 'service_role' then return; end if;

    v_sub := v_claims->>'sub';
    v_win := floor(extract(epoch from clock_timestamp()) / 60)::bigint;
    if v_role = 'authenticated' and v_sub is not null then
      v_bucket := 'u:' || v_sub;
      v_limit  := 1500;
    else
      v_bucket := 'ip:' || coalesce(nullif(trim(split_part(
                    coalesce(current_setting('request.headers', true), '{}')::jsonb->>'x-forwarded-for',
                    ',', 1)), ''), 'desconocida');
      v_limit  := 120;
    end if;

    insert into private.request_counts as r (bucket, win, n)
    values (v_bucket, v_win, 1)
    on conflict (bucket, win) do update set n = r.n + 1
    returning n into v_n;
  exception when others then
    -- Lecturas (transacción de solo lectura) o cualquier falla del contador: dejar pasar.
    return;
  end;

  if v_n > v_limit then
    raise sqlstate 'PT429' using
      message = 'Demasiadas solicitudes. Espera un minuto e intenta de nuevo.',
      hint    = 'Límite de seguridad contra exceso de solicitudes.';
  end if;
end $$;

revoke execute on function public.request_guard() from public;
grant execute on function public.request_guard() to anon, authenticated;

-- Limpieza: cada 10 minutos borra los contadores viejos.
do $$
begin
  perform cron.schedule('kaddo-limpia-limites', '*/10 * * * *',
    $c$delete from private.request_counts where win < floor(extract(epoch from now()) / 60)::bigint - 5$c$);
exception when others then
  raise notice 'No se pudo programar la limpieza automática (pg_cron): %', sqlerrm;
end $$;

-- Activar: PostgREST llama a request_guard() antes de cada solicitud.
alter role authenticator set pgrst.db_pre_request = 'public.request_guard';
notify pgrst, 'reload config';
