-- ============================================================================
-- Kaddo POS ↔ Web — Supabase schema (Fase 0)
-- Proyecto: urvabzjutwaebobpmabw   ·   pegar completo en el SQL Editor de Supabase
-- Idempotente: se puede volver a correr sin romper nada.
-- Ver: pos-system-vault/kaddo-sync-architecture.md
-- ============================================================================

-- ─── Extensiones ────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- ─── Tablas ─────────────────────────────────────────────────────────────────

-- Empleados del portal. 1:1 con auth.users (email sintetico usuario@kaddo.local).
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null,
  name       text not null,
  role       text not null default 'empleado' check (role in ('admin','empleado','terminal')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id         bigint generated always as identity primary key,
  name       text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id         bigint generated always as identity primary key,
  code       text unique not null,                     -- codigo de barras principal; llave entre POS y web
  name       text not null,
  category_id bigint references public.categories(id) on delete set null,
  cost       numeric(12,2) not null default 0,
  price      numeric(12,2) not null default 0,
  stock      numeric(12,3) not null default 0,
  min_stock  numeric(12,3) not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_name_idx on public.products (lower(name));
create index if not exists products_active_idx on public.products (active);

create table if not exists public.product_barcodes (
  id         bigint generated always as identity primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  code       text unique not null,
  label      text,
  created_at timestamptz not null default now()
);
create index if not exists product_barcodes_product_idx on public.product_barcodes (product_id);

create table if not exists public.inventory_movements (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references public.products(id) on delete cascade,
  type        text not null check (type in ('venta','ajuste','recepcion','cancelacion')),
  qty_before  numeric(12,3) not null,
  qty_change  numeric(12,3) not null,
  qty_after   numeric(12,3) not null,
  actor       text not null,                            -- "maria" / "terminal" (username del que hizo el movimiento)
  source      text not null check (source in ('pos','portal')),
  reference   text,                                     -- folio de venta, nota de ajuste, etc.
  created_at  timestamptz not null default now()
);
create index if not exists inv_mov_product_idx on public.inventory_movements (product_id, created_at desc);
create index if not exists inv_mov_created_idx on public.inventory_movements (created_at desc);

-- Espejo de solo lectura de las ventas del POS (para la vista "ventas del dia" del portal).
create table if not exists public.sales_mirror (
  id           bigint generated always as identity primary key,
  folio        text unique not null,
  pos_sale_id  integer,
  cashier_name text,
  payment_type text,
  total        numeric(12,2) not null,
  cost_total   numeric(12,2) not null default 0,
  cancelled    boolean not null default false,
  sold_at      timestamptz not null,
  synced_at    timestamptz not null default now()
);
create index if not exists sales_mirror_sold_idx on public.sales_mirror (sold_at desc);

create table if not exists public.sale_items_mirror (
  id           bigint generated always as identity primary key,
  folio        text not null references public.sales_mirror(folio) on delete cascade,
  product_code text,
  product_name text,
  quantity     numeric(12,3) not null,
  unit_price   numeric(12,2) not null,
  discount     numeric(12,2) not null default 0
);
create index if not exists sale_items_mirror_folio_idx on public.sale_items_mirror (folio);

-- ─── updated_at automatico en products ──────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ─── Alta automatica de profile al crear un usuario en Authentication ────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, name, role)
  values (
    new.id,
    split_part(new.email, '@', 1),
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'empleado')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Helpers internos ──────────────────────────────────────────────────────
create or replace function public._actor()
returns text language sql stable as $$
  select coalesce((select username from public.profiles where id = auth.uid()),
                  split_part(coalesce(auth.jwt() ->> 'email', 'desconocido'), '@', 1));
$$;

create or replace function public._source()
returns text language sql stable as $$
  select case when (select role from public.profiles where id = auth.uid()) = 'terminal'
              then 'pos' else 'portal' end;
$$;

create or replace function public._is_admin()
returns boolean language sql stable as $$
  select coalesce((select role in ('admin','terminal') from public.profiles where id = auth.uid()), false);
$$;

-- ============================================================================
-- RPCs  (unica via de escritura; los clientes NO tienen INSERT/UPDATE directo)
-- ============================================================================

-- Buscar producto por codigo principal o por codigo adicional.
create or replace function public.find_product_by_code(p_code text)
returns setof public.products language sql stable security definer set search_path = public as $$
  select p.* from public.products p
  where p.code = p_code and p.active
  union all
  select p.* from public.products p
  join public.product_barcodes b on b.product_id = p.id
  where b.code = p_code and p.active
  limit 1;
$$;

-- Ajuste / recepcion de stock desde el portal (o el POS).
--   p_mode = 'set'  -> deja el stock en p_qty
--   p_mode = 'add'  -> suma p_qty (puede ser negativo)
--   p_type = 'ajuste' | 'recepcion'
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

-- Alta / edicion de producto. Devuelve el id.
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

-- Borrado suave.
create or replace function public.delete_product(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.products set active = false where id = p_id;
end $$;

-- Codigos adicionales
create or replace function public.add_barcode(p_product_id bigint, p_code text, p_label text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.products where code = p_code)
     or exists (select 1 from public.product_barcodes where code = p_code) then
    raise exception 'El codigo % ya esta en uso', p_code;
  end if;
  insert into public.product_barcodes(product_id, code, label) values (p_product_id, p_code, p_label);
end $$;

create or replace function public.delete_barcode(p_id bigint)
returns void language sql security definer set search_path = public as $$
  delete from public.product_barcodes where id = p_id;
$$;

-- Confirmar una venta del POS: descuenta stock (con guardia), registra movimientos
-- y guarda el espejo de la venta. Todo o nada.
--   p_sale = {folio, pos_sale_id, cashier_name, payment_type, total, cost_total, sold_at,
--             items:[{code, name, qty, unit_price, unit_cost, discount}]}
create or replace function public.commit_pos_sale(p_sale jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb; v_pid bigint; v_before numeric; v_after numeric; v_folio text;
begin
  v_folio := p_sale->>'folio';
  if v_folio is null then raise exception 'falta folio'; end if;
  if exists (select 1 from public.sales_mirror where folio = v_folio) then
    return;                       -- ya sincronizada (reintento idempotente)
  end if;

  -- El encabezado va primero: sale_items_mirror.folio referencia a sales_mirror.folio
  insert into public.sales_mirror
    (folio, pos_sale_id, cashier_name, payment_type, total, cost_total, sold_at)
  values
    (v_folio, (p_sale->>'pos_sale_id')::int, p_sale->>'cashier_name', p_sale->>'payment_type',
     (p_sale->>'total')::numeric, coalesce((p_sale->>'cost_total')::numeric,0),
     coalesce((p_sale->>'sold_at')::timestamptz, now()));

  for it in select * from jsonb_array_elements(coalesce(p_sale->'items','[]'::jsonb))
  loop
    select id, stock into v_pid, v_before from public.products
      where code = it->>'code' for update;
    if not found then raise exception 'Producto con codigo % no existe en la nube', it->>'code'; end if;

    v_after := v_before - (it->>'qty')::numeric;
    if v_after < 0 then
      raise exception 'Stock insuficiente para % (disp %, pedido %)',
        it->>'name', v_before, (it->>'qty')::numeric;
    end if;

    update public.products set stock = v_after where id = v_pid;

    insert into public.inventory_movements
      (product_id, type, qty_before, qty_change, qty_after, actor, source, reference)
    values
      (v_pid, 'venta', v_before, -(it->>'qty')::numeric, v_after, public._actor(), 'pos', v_folio);

    insert into public.sale_items_mirror (folio, product_code, product_name, quantity, unit_price, discount)
    values (v_folio, it->>'code', it->>'name', (it->>'qty')::numeric,
            (it->>'unit_price')::numeric, coalesce((it->>'discount')::numeric,0));
  end loop;
end $$;

-- Cancelar una venta: regresa el stock y marca el espejo.
create or replace function public.cancel_pos_sale(p_folio text)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_before numeric; v_after numeric;
begin
  if not exists (select 1 from public.sales_mirror where folio = p_folio and not cancelled) then
    return;
  end if;
  for r in select * from public.sale_items_mirror where folio = p_folio loop
    select id, stock into r.id, v_before from public.products where code = r.product_code for update;
    if found then
      v_after := v_before + r.quantity;
      update public.products set stock = v_after where code = r.product_code;
      insert into public.inventory_movements
        (product_id, type, qty_before, qty_change, qty_after, actor, source, reference)
      values ((select id from public.products where code = r.product_code),
              'cancelacion', v_before, r.quantity, v_after, public._actor(), public._source(), p_folio);
    end if;
  end loop;
  update public.sales_mirror set cancelled = true where folio = p_folio;
end $$;

-- ============================================================================
-- RLS  +  GRANTS   ("Automatically expose new tables" = OFF, permisos explicitos)
-- ============================================================================

alter table public.profiles           enable row level security;
alter table public.categories         enable row level security;
alter table public.products           enable row level security;
alter table public.product_barcodes   enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.sales_mirror       enable row level security;
alter table public.sale_items_mirror  enable row level security;

-- SELECT para cualquier usuario autenticado (POS o empleado). Sin INSERT/UPDATE/DELETE directo.
do $$
declare t text;
begin
  foreach t in array array['categories','products','product_barcodes',
                           'inventory_movements','sales_mirror','sale_items_mirror']
  loop
    execute format('drop policy if exists sel_auth on public.%I', t);
    execute format('create policy sel_auth on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select to authenticated
  using (id = auth.uid() or public._is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.categories, public.products, public.product_barcodes,
                public.inventory_movements, public.sales_mirror, public.sale_items_mirror,
                public.profiles
  to authenticated;

grant execute on function
  public.find_product_by_code(text),
  public.adjust_stock(bigint,text,numeric,text,text),
  public.upsert_product(bigint,text,text,text,numeric,numeric,numeric,numeric),
  public.delete_product(bigint),
  public.add_barcode(bigint,text,text),
  public.delete_barcode(bigint),
  public.commit_pos_sale(jsonb),
  public.cancel_pos_sale(text)
  to authenticated;

-- ─── Realtime: el POS y el portal se suscriben a estos cambios ──────────────
-- (idempotente: ignora si la tabla ya está en la publicación)
do $$
declare t text;
begin
  foreach t in array array['products','inventory_movements','sales_mirror'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ─── Backfill de profiles ──────────────────────────────────────────────────
-- Por si algún usuario se creó en Authentication ANTES de que existiera el
-- trigger on_auth_user_created. Idempotente.
insert into public.profiles (id, username, name, role)
select u.id, split_part(u.email, '@', 1), split_part(u.email, '@', 1), 'empleado'
from auth.users u
on conflict (id) do nothing;

update public.profiles set role = 'terminal' where username = 'terminal';
update public.profiles set role = 'admin'    where username = 'admin';

-- ─── Refrescar el cache de PostgREST ───────────────────────────────────────
notify pgrst, 'reload schema';
