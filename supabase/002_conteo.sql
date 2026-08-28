-- ============================================================================
-- Conteo físico de inventario (toma de inventario)
-- Pegar completo en el SQL Editor de Supabase. Idempotente.
--
-- Flujo: se abre UN conteo (solo uno abierto a la vez). Se va capturando
-- código + cantidad; si el mismo código se captura otra vez, la cantidad SE
-- SUMA a lo ya contado (el mismo producto puede estar en varios lugares de la
-- tienda). Al final se comparan las cantidades contadas contra el stock del
-- sistema y, si se aplica, el stock del sistema queda igual al contado.
-- ============================================================================

create table if not exists public.stock_counts (
  id          bigint generated always as identity primary key,
  name        text not null,
  status      text not null default 'abierto' check (status in ('abierto','aplicado','cancelado')),
  created_by  text not null,
  created_at  timestamptz not null default now(),
  applied_by  text,
  applied_at  timestamptz
);
create index if not exists stock_counts_status_idx on public.stock_counts (status, id desc);

create table if not exists public.stock_count_items (
  id          bigint generated always as identity primary key,
  count_id    bigint not null references public.stock_counts(id) on delete cascade,
  product_id  bigint not null references public.products(id) on delete cascade,
  counted_qty numeric(12,3) not null default 0,
  entries     integer not null default 0,          -- cuántas veces se capturó este producto
  last_actor  text,
  updated_at  timestamptz not null default now(),
  unique (count_id, product_id)
);
create index if not exists sci_count_idx on public.stock_count_items (count_id, updated_at desc);

-- ─── RPCs ───────────────────────────────────────────────────────────────────

-- Devuelve el conteo abierto; si no hay, crea uno. Nunca hay dos abiertos.
create or replace function public.count_open(p_name text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select id into v_id from public.stock_counts where status = 'abierto' order by id desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.stock_counts (name, created_by)
  values (
    coalesce(nullif(trim(p_name), ''),
             'Conteo ' || to_char(now() at time zone 'America/Monterrey', 'DD/MM/YYYY HH24:MI')),
    public._actor()
  )
  returning id into v_id;
  return v_id;
end $$;

-- Captura: suma p_qty a lo ya contado de ese producto (busca por código
-- principal o código adicional).
create or replace function public.count_add(p_count_id bigint, p_code text, p_qty numeric default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pid bigint; v_name text; v_code text; v_stock numeric; v_total numeric;
begin
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
  end if;

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

-- Corregir el total contado de un producto (sin sumar).
create or replace function public.count_set(p_count_id bigint, p_product_id bigint, p_qty numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
  end if;
  update public.stock_count_items
    set counted_qty = p_qty, last_actor = public._actor(), updated_at = now()
    where count_id = p_count_id and product_id = p_product_id;
end $$;

-- Quitar un producto del conteo.
create or replace function public.count_remove(p_count_id bigint, p_product_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
  end if;
  delete from public.stock_count_items where count_id = p_count_id and product_id = p_product_id;
end $$;

create or replace function public.count_cancel(p_count_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.stock_counts set status = 'cancelado' where id = p_count_id and status = 'abierto';
end $$;

-- Aplicar: deja el stock del sistema igual al contado y registra un movimiento
-- de ajuste por cada producto que cambió.
--   p_zero_uncounted = true  -> además pone en 0 los productos activos que NO
--   se capturaron (solo tiene sentido si se contó TODA la tienda).
create or replace function public.count_apply(p_count_id bigint, p_zero_uncounted boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_before numeric; v_applied int := 0; v_unchanged int := 0; v_zeroed int := 0; v_ref text;
begin
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
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
alter table public.stock_counts       enable row level security;
alter table public.stock_count_items  enable row level security;

drop policy if exists sel_auth on public.stock_counts;
create policy sel_auth on public.stock_counts for select to authenticated using (true);
drop policy if exists sel_auth on public.stock_count_items;
create policy sel_auth on public.stock_count_items for select to authenticated using (true);

grant select on public.stock_counts, public.stock_count_items to authenticated;

grant execute on function
  public.count_open(text),
  public.count_add(bigint,text,numeric),
  public.count_set(bigint,bigint,numeric),
  public.count_remove(bigint,bigint),
  public.count_cancel(bigint),
  public.count_apply(bigint,boolean)
  to authenticated;

notify pgrst, 'reload schema';
