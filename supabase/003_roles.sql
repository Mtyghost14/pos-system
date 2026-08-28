-- ============================================================================
-- 003_roles.sql — candado de rol: solo 'admin' y 'terminal' pueden ESCRIBIR.
-- Los 'empleado' (cajeros) solo pueden LEER inventario (RLS ya lo permite).
-- Pegar completo en el SQL Editor. Idempotente.
-- ============================================================================

create or replace function public._require_admin()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','terminal')
  ) then
    raise exception 'No tienes permiso para modificar el inventario' using errcode = 'P0001';
  end if;
end $$;

-- adjust_stock
create or replace function public.adjust_stock(
  p_product_id bigint,
  p_mode       text,
  p_qty        numeric,
  p_type       text default 'ajuste',
  p_reference  text default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_before numeric; v_after numeric; v_delta numeric;
begin
  perform public._require_admin();
  if p_mode not in ('set','add') then raise exception 'p_mode invalido: %', p_mode; end if;
  if p_type not in ('ajuste','recepcion') then raise exception 'p_type invalido: %', p_type; end if;

  select stock into v_before from public.products where id = p_product_id for update;
  if not found then raise exception 'Producto % no existe', p_product_id; end if;

  v_after := case when p_mode = 'set' then p_qty else v_before + p_qty end;
  if v_after < 0 then raise exception 'El stock no puede quedar negativo (% -> %)', v_before, v_after; end if;
  v_delta := v_after - v_before;

  update public.products set stock = v_after where id = p_product_id;

  insert into public.inventory_movements
    (product_id, type, qty_before, qty_change, qty_after, actor, source, reference)
  values
    (p_product_id, p_type, v_before, v_delta, v_after, public._actor(), public._source(), p_reference);

  return v_after;
end $$;

-- upsert_product
create or replace function public.upsert_product(
  p_id         bigint,        -- null = alta
  p_code       text,
  p_name       text,
  p_category   text,          -- nombre de categoria (se crea si no existe); null = sin categoria
  p_cost       numeric,
  p_price      numeric,
  p_min_stock  numeric default 0,
  p_stock      numeric default null   -- solo se usa en alta
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_cat bigint; v_id bigint; v_before numeric;
begin
  perform public._require_admin();
  if p_category is not null and length(trim(p_category)) > 0 then
    insert into public.categories(name) values (trim(p_category))
      on conflict (name) do update set name = excluded.name
      returning id into v_cat;
  end if;

  if p_id is null then
    insert into public.products (code, name, category_id, cost, price, min_stock, stock, active)
    values (p_code, p_name, v_cat, coalesce(p_cost,0), coalesce(p_price,0),
            coalesce(p_min_stock,0), coalesce(p_stock,0), true)
    on conflict (code) do update set                       -- revive un producto borrado con el mismo codigo
      name = excluded.name, category_id = excluded.category_id,
      cost = excluded.cost, price = excluded.price, min_stock = excluded.min_stock, active = true
    returning id into v_id;

    if coalesce(p_stock,0) <> 0 then
      insert into public.inventory_movements
        (product_id, type, qty_before, qty_change, qty_after, actor, source, reference)
      values (v_id, 'recepcion', 0, p_stock, p_stock, public._actor(), public._source(), 'Alta de producto');
    end if;
  else
    update public.products
      set code = p_code, name = p_name, category_id = v_cat,
          cost = coalesce(p_cost,0), price = coalesce(p_price,0), min_stock = coalesce(p_min_stock,0)
      where id = p_id
      returning id into v_id;
    if v_id is null then raise exception 'Producto % no existe', p_id; end if;
  end if;

  return v_id;
end $$;

-- delete_product
create or replace function public.delete_product(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  update public.products set active = false where id = p_id;
end $$;

-- upsert_category
create or replace function public.upsert_category(p_id bigint, p_name text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public._require_admin();
  if p_id is null then
    insert into public.categories(name) values (trim(p_name))
      on conflict (name) do update set name = excluded.name
      returning id into v_id;
  else
    update public.categories set name = trim(p_name) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Categoría % no existe', p_id; end if;
  end if;
  return v_id;
end $$;

-- delete_category
create or replace function public.delete_category(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if exists (select 1 from public.products where category_id = p_id and active) then
    raise exception 'La categoría tiene productos activos';
  end if;
  update public.products set category_id = null where category_id = p_id;
  delete from public.categories where id = p_id;
end $$;

-- add_barcode
create or replace function public.add_barcode(p_product_id bigint, p_code text, p_label text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if exists (select 1 from public.products where code = p_code)
     or exists (select 1 from public.product_barcodes where code = p_code) then
    raise exception 'El codigo % ya esta en uso', p_code;
  end if;
  insert into public.product_barcodes(product_id, code, label) values (p_product_id, p_code, p_label);
end $$;

-- delete_barcode
create or replace function public.delete_barcode(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  delete from public.product_barcodes where id = p_id;
end $$;

-- count_open
create or replace function public.count_open(p_name text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public._require_admin();
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

-- count_add
create or replace function public.count_add(p_count_id bigint, p_code text, p_qty numeric default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pid bigint; v_name text; v_code text; v_stock numeric; v_total numeric;
begin
  perform public._require_admin();
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

-- count_set
create or replace function public.count_set(p_count_id bigint, p_product_id bigint, p_qty numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
  end if;
  update public.stock_count_items
    set counted_qty = p_qty, last_actor = public._actor(), updated_at = now()
    where count_id = p_count_id and product_id = p_product_id;
end $$;

-- count_remove
create or replace function public.count_remove(p_count_id bigint, p_product_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
  end if;
  delete from public.stock_count_items where count_id = p_count_id and product_id = p_product_id;
end $$;

-- count_cancel
create or replace function public.count_cancel(p_count_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  update public.stock_counts set status = 'cancelado' where id = p_count_id and status = 'abierto';
end $$;

-- count_apply
create or replace function public.count_apply(p_count_id bigint, p_zero_uncounted boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_before numeric; v_applied int := 0; v_unchanged int := 0; v_zeroed int := 0; v_ref text;
begin
  perform public._require_admin();
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

grant execute on function public._require_admin() to authenticated;

notify pgrst, 'reload schema';
