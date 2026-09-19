-- ============================================================================
-- 009_conteo_multi.sql — varios conteos abiertos a la vez + "unirse" +
-- confirmación de TODOS los participantes antes de aplicar.
--
-- Antes: solo podía haber UN conteo abierto (count_open reutilizaba el
-- mismo siempre). Ahora:
--   · count_start   -> siempre crea un conteo NUEVO, aparte de los que ya
--                      estén abiertos (para "iniciar otro aparte").
--   · count_list_open -> lista todos los conteos abiertos, con quién
--                      participa en cada uno y si ya se marcó listo.
--   · count_join    -> unirse a un conteo abierto ya existente.
--   · count_set_ready -> marcar (o desmarcar) "ya terminé mi parte".
--   · count_apply   -> si el conteo tiene MÁS de un participante, exige que
--                      TODOS estén "listo" antes de aplicar (si solo lo hizo
--                      una persona, se aplica igual que antes).
--
-- Idempotente. Pegar completo en el SQL Editor de Supabase.
-- ============================================================================

create table if not exists public.stock_count_participants (
  count_id  bigint not null references public.stock_counts(id) on delete cascade,
  actor     text not null,
  joined_at timestamptz not null default now(),
  ready     boolean not null default false,
  ready_at  timestamptz,
  primary key (count_id, actor)
);
create index if not exists scp_count_idx on public.stock_count_participants (count_id);

-- ─── Iniciar SIEMPRE un conteo nuevo, aparte de los que ya estén abiertos ───
create or replace function public.count_start(p_name text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.stock_counts (name, created_by)
  values (
    coalesce(nullif(trim(p_name), ''),
             'Conteo ' || to_char(now() at time zone 'America/Monterrey', 'DD/MM/YYYY HH24:MI')),
    public._actor()
  )
  returning id into v_id;

  insert into public.stock_count_participants (count_id, actor) values (v_id, public._actor())
    on conflict (count_id, actor) do nothing;

  return v_id;
end $$;

-- ─── Lista de conteos abiertos, con participantes y si ya están listos ──────
create or replace function public.count_list_open()
returns table (
  id bigint, name text, created_by text, created_at timestamptz,
  items_count bigint, participants jsonb
) language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.created_by, c.created_at,
    coalesce((select count(*) from public.stock_count_items i where i.count_id = c.id), 0),
    coalesce((select jsonb_agg(jsonb_build_object('actor', p.actor, 'ready', p.ready) order by p.joined_at)
              from public.stock_count_participants p where p.count_id = c.id), '[]'::jsonb)
  from public.stock_counts c
  where c.status = 'abierto'
  order by c.id desc;
$$;

-- ─── Unirse a un conteo abierto (idempotente) ───────────────────────────────
create or replace function public.count_join(p_count_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
  end if;
  insert into public.stock_count_participants (count_id, actor) values (p_count_id, public._actor())
    on conflict (count_id, actor) do nothing;
end $$;

-- ─── Marcar / desmarcar "ya terminé mi parte" ───────────────────────────────
create or replace function public.count_set_ready(p_count_id bigint, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
  end if;
  insert into public.stock_count_participants (count_id, actor, ready, ready_at)
  values (p_count_id, public._actor(), p_ready, case when p_ready then now() else null end)
  on conflict (count_id, actor) do update
    set ready = excluded.ready, ready_at = excluded.ready_at;
end $$;

-- ─── count_add: además de sumar la cantidad, registra a quien captura como
-- participante (por si llegó a capturar sin haber pasado por count_join) ────
create or replace function public.count_add(p_count_id bigint, p_code text, p_qty numeric default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pid bigint; v_name text; v_code text; v_stock numeric; v_total numeric;
begin
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
  end if;

  insert into public.stock_count_participants (count_id, actor) values (p_count_id, public._actor())
    on conflict (count_id, actor) do nothing;

  select p.id, p.name, p.code, p.stock into v_pid, v_name, v_code, v_stock
  from public.products p where p.code = trim(p_code) and p.active;

  if v_pid is null then
    select p.id, p.name, p.code, p.stock into v_pid, v_name, v_code, v_stock
    from public.product_barcodes b join public.products p on p.id = b.product_id
    where b.code = trim(p_code) and p.active;
  end if;

  if v_pid is null then
    raise exception 'No existe un producto activo con el código %', trim(p_code);
  end if;

  insert into public.stock_count_items (count_id, product_id, counted_qty, entries, last_actor, updated_at)
  values (p_count_id, v_pid, p_qty, 1, public._actor(), now())
  on conflict (count_id, product_id) do update
    set counted_qty = public.stock_count_items.counted_qty + excluded.counted_qty,
        entries     = public.stock_count_items.entries + 1,
        last_actor  = excluded.last_actor,
        updated_at  = now()
  returning counted_qty into v_total;

  return jsonb_build_object(
    'product_id', v_pid, 'code', v_code, 'name', v_name,
    'system_stock', v_stock, 'counted', v_total, 'added', p_qty
  );
end $$;

-- ─── count_apply: si hay más de un participante, TODOS deben estar listos ───
create or replace function public.count_apply(p_count_id bigint, p_zero_uncounted boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; v_before numeric; v_applied int := 0; v_unchanged int := 0; v_zeroed int := 0; v_ref text;
  v_participants int; v_faltan text;
begin
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
  end if;

  select count(*) into v_participants from public.stock_count_participants where count_id = p_count_id;
  if v_participants > 1 then
    select string_agg(actor, ', ') into v_faltan
    from public.stock_count_participants where count_id = p_count_id and not ready;
    if v_faltan is not null then
      raise exception 'Falta que confirmen que terminaron: %', v_faltan;
    end if;
  end if;

  v_ref := 'Conteo #' || p_count_id;

  for r in select i.product_id, i.counted_qty from public.stock_count_items i where i.count_id = p_count_id
  loop
    select stock into v_before from public.products where id = r.product_id for update;
    if v_before is null then continue; end if;
    if v_before = r.counted_qty then v_unchanged := v_unchanged + 1; continue; end if;

    update public.products set stock = r.counted_qty where id = r.product_id;
    insert into public.inventory_movements
      (product_id, type, qty_before, qty_change, qty_after, actor, source, reference)
    values
      (r.product_id, 'ajuste', v_before, r.counted_qty - v_before, r.counted_qty,
       public._actor(), public._source(), v_ref);
    v_applied := v_applied + 1;
  end loop;

  if p_zero_uncounted then
    for r in
      select p.id as product_id from public.products p
      where p.active and p.stock <> 0
        and not exists (select 1 from public.stock_count_items i
                        where i.count_id = p_count_id and i.product_id = p.id)
    loop
      select stock into v_before from public.products where id = r.product_id for update;
      update public.products set stock = 0 where id = r.product_id;
      insert into public.inventory_movements
        (product_id, type, qty_before, qty_change, qty_after, actor, source, reference)
      values
        (r.product_id, 'ajuste', v_before, -v_before, 0,
         public._actor(), public._source(), v_ref || ' (no contado)');
      v_zeroed := v_zeroed + 1;
    end loop;
  end if;

  update public.stock_counts
    set status = 'aplicado', applied_at = now(), applied_by = public._actor()
    where id = p_count_id;

  return jsonb_build_object('applied', v_applied, 'unchanged', v_unchanged, 'zeroed', v_zeroed);
end $$;

-- ─── RLS + permisos ─────────────────────────────────────────────────────────
alter table public.stock_count_participants enable row level security;
drop policy if exists sel_auth on public.stock_count_participants;
create policy sel_auth on public.stock_count_participants for select to authenticated using (true);
grant select on public.stock_count_participants to authenticated;

grant execute on function
  public.count_start(text),
  public.count_list_open(),
  public.count_join(bigint),
  public.count_set_ready(bigint,boolean),
  public.count_add(bigint,text,numeric),
  public.count_set(bigint,bigint,numeric),
  public.count_remove(bigint,bigint),
  public.count_cancel(bigint),
  public.count_apply(bigint,boolean)
  to authenticated;

-- ─── Realtime: participantes + (por si 008 no se corrió) counts/items ───────
do $$
declare t text;
begin
  foreach t in array array['stock_counts','stock_count_items','stock_count_participants'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
