-- ============================================================================
-- 015_blindaje.sql — Blindaje de seguridad de la base de datos
--
-- Hallazgos de la auditoría que corrige este archivo:
--   1. Sin iniciar sesión (solo con la llave pública) se podían llamar casi
--      todas las funciones: meter ventas falsas, cancelar ventas, borrar
--      pedidos, aplicar conteos, leer ventas/utilidad. Postgres da permiso
--      de ejecución a PUBLIC por default.
--   2. Cualquiera podía registrarse como 'admin' (el rol se tomaba de los
--      metadatos que pone el propio usuario al registrarse).
--   3. Una cajera (empleado) podía, llamando directo a la API, cancelar
--      ventas, meter ventas, leer ventas/costos/reportes/movimientos.
--   4. Valores 'NaN' o negativos podían envenenar el stock y los reportes.
--   5. Carreras (dos llamadas al mismo tiempo) podían cancelar o aplicar un
--      conteo dos veces.
--
-- Modelo de permisos después de este archivo:
--   · Sin sesión (anon) ............ NADA (ni leer ni ejecutar).
--   · empleado (cajera, activa) .... leer catálogo/inventario y pedidos;
--                                    crear/editar pedidos.
--   · admin / terminal (POS) ....... todo lo demás (ventas, reportes,
--                                    conteos, inventario, recepción…).
--   · Usuarios con profiles.active = false ya no tienen acceso.
--
-- Idempotente. Pegar completo en el SQL Editor de Supabase y presionar Run.
-- Si algo falla, NO se aplica nada (todo va en una transacción).
-- ============================================================================

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Helpers de rol (ahora respetan profiles.active)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public._is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  -- security definer: evita recursión infinita con la política RLS de profiles.
  select coalesce((select active and role in ('admin','terminal')
                     from public.profiles where id = auth.uid()), false);
$$;

create or replace function public._is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false);
$$;

create or replace function public._require_admin()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin() then
    raise exception 'No tienes permiso para esta acción' using errcode = 'P0001';
  end if;
end $$;

create or replace function public._require_staff()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._is_staff() then
    raise exception 'No tienes permiso para esta acción' using errcode = 'P0001';
  end if;
end $$;

-- search_path fijo en los helpers que no lo tenían (aviso del Security Advisor)
alter function public._actor() set search_path = public;
alter function public._source() set search_path = public;
alter function public.touch_updated_at() set search_path = public;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Alta de usuarios: el rol YA NO se toma de lo que manda el usuario
-- ════════════════════════════════════════════════════════════════════════════
-- raw_user_meta_data lo controla quien se registra → se ignora para el rol.
-- raw_app_meta_data solo lo puede poner el service role (scripts del dueño).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text := coalesce(new.raw_app_meta_data->>'role', 'empleado');
begin
  if v_role not in ('admin','empleado','terminal') then v_role := 'empleado'; end if;
  insert into public.profiles (id, username, name, role)
  values (
    new.id,
    split_part(new.email, '@', 1),
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    v_role
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Ventas del POS: solo terminal/admin, validación de datos, sin carreras
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.commit_pos_sale(p_sale jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_pid bigint; v_before numeric; v_after numeric; v_folio text;
  v_qty numeric; v_price numeric; v_cost numeric; v_disc numeric;
  v_total numeric; v_cost_total numeric; v_recv numeric; v_change numeric;
begin
  perform public._require_admin();          -- solo el POS (terminal) o un admin

  v_folio := nullif(trim(p_sale->>'folio'), '');
  if v_folio is null or length(v_folio) > 64 then raise exception 'Folio inválido'; end if;

  v_total      := (p_sale->>'total')::numeric;
  v_cost_total := coalesce(nullif(p_sale->>'cost_total','')::numeric, 0);
  v_recv       := nullif(p_sale->>'received_amount','')::numeric;
  v_change     := nullif(p_sale->>'change_amount','')::numeric;
  -- "between" rechaza también NaN e infinito
  if v_total is null or not (v_total between 0 and 10000000) then raise exception 'Total de venta inválido'; end if;
  if not (v_cost_total between 0 and 10000000) then raise exception 'Costo de venta inválido'; end if;
  if v_recv is not null and not (v_recv between 0 and 10000000) then raise exception 'Monto recibido inválido'; end if;
  if v_change is not null and not (v_change between 0 and 10000000) then raise exception 'Cambio inválido'; end if;
  if jsonb_typeof(p_sale->'items') is distinct from 'array'
     or jsonb_array_length(p_sale->'items') = 0
     or jsonb_array_length(p_sale->'items') > 500 then
    raise exception 'La venta no tiene productos válidos';
  end if;

  -- Idempotente y a prueba de carreras: si el folio ya existe (reintento) no hace nada.
  insert into public.sales_mirror
    (folio, pos_sale_id, cashier_name, payment_type, total, cost_total, sold_at,
     received_amount, change_amount, payment_details)
  values
    (v_folio, nullif(p_sale->>'pos_sale_id','')::int, left(p_sale->>'cashier_name', 120),
     left(p_sale->>'payment_type', 30), v_total, v_cost_total,
     coalesce((p_sale->>'sold_at')::timestamptz, now()), v_recv, v_change,
     case when jsonb_typeof(p_sale->'payment_details') = 'object' then p_sale->'payment_details' else null end)
  on conflict (folio) do nothing;
  if not found then return; end if;

  -- Se bloquean los productos siempre en el mismo orden (evita interbloqueos).
  for it in select value from jsonb_array_elements(p_sale->'items') order by value->>'code'
  loop
    v_qty   := (it->>'qty')::numeric;
    v_price := (it->>'unit_price')::numeric;
    v_cost  := nullif(it->>'unit_cost','')::numeric;
    v_disc  := coalesce(nullif(it->>'discount','')::numeric, 0);
    if v_qty is null or not (v_qty > 0 and v_qty <= 100000) then
      raise exception 'Cantidad inválida para %', coalesce(it->>'name', it->>'code');
    end if;
    if v_price is null or not (v_price between 0 and 10000000) then
      raise exception 'Precio inválido para %', coalesce(it->>'name', it->>'code');
    end if;
    if v_cost is not null and not (v_cost between 0 and 10000000) then
      raise exception 'Costo inválido para %', coalesce(it->>'name', it->>'code');
    end if;
    if not (v_disc between 0 and 10000000) then
      raise exception 'Descuento inválido para %', coalesce(it->>'name', it->>'code');
    end if;

    select id, stock into v_pid, v_before from public.products
      where code = it->>'code' for update;
    if not found then raise exception 'Producto con codigo % no existe en la nube', it->>'code'; end if;

    v_after := v_before - v_qty;
    if v_after < 0 then
      raise exception 'Stock insuficiente para % (disp %, pedido %)', it->>'name', v_before, v_qty;
    end if;

    update public.products set stock = v_after where id = v_pid;

    insert into public.inventory_movements
      (product_id, type, qty_before, qty_change, qty_after, actor, source, reference)
    values
      (v_pid, 'venta', v_before, -v_qty, v_after, public._actor(), 'pos', v_folio);

    insert into public.sale_items_mirror (folio, product_code, product_name, quantity, unit_price, unit_cost, discount)
    values (v_folio, it->>'code', left(it->>'name', 300), v_qty, v_price, v_cost, v_disc);
  end loop;
end $$;

-- Cancelar: solo terminal/admin; primero "reclama" la cancelación (sin
-- carreras) y regresa al stock EXACTAMENTE lo que la venta descontó según sus
-- movimientos. Las ventas históricas importadas (que nunca descontaron stock
-- en la nube) ya no suman stock al cancelarse.
create or replace function public.cancel_pos_sale(p_folio text)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_before numeric; v_after numeric;
begin
  perform public._require_admin();

  update public.sales_mirror set cancelled = true where folio = p_folio and not cancelled;
  if not found then return; end if;          -- no existe o ya estaba cancelada

  for r in
    select m.product_id, -sum(m.qty_change) as qty
      from public.inventory_movements m
     where m.reference = p_folio and m.type = 'venta'
     group by m.product_id
     order by m.product_id
  loop
    select stock into v_before from public.products where id = r.product_id for update;
    if not found or r.qty <= 0 then continue; end if;
    v_after := v_before + r.qty;
    update public.products set stock = v_after where id = r.product_id;
    insert into public.inventory_movements
      (product_id, type, qty_before, qty_change, qty_after, actor, source, reference)
    values (r.product_id, 'cancelacion', v_before, r.qty, v_after, public._actor(), public._source(), p_folio);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Pedidos de globos: cualquier empleado activo; borrar solo admin
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.order_save(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; it jsonb; v_total numeric; v_anticipo numeric;
begin
  perform public._require_staff();
  if length(p::text) > 50000 then raise exception 'El pedido es demasiado grande'; end if;
  if coalesce(trim(p->>'cliente'),'') = '' then raise exception 'Falta el nombre del cliente'; end if;
  if p->>'fecha_hora' is null then raise exception 'Falta la fecha y hora'; end if;
  if jsonb_typeof(coalesce(p->'items','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p->'items','[]'::jsonb)) > 100 then
    raise exception 'Demasiados renglones en el pedido';
  end if;

  v_total    := coalesce(nullif(p->>'total','')::numeric, 0);
  v_anticipo := coalesce(nullif(p->>'anticipo','')::numeric, 0);
  if not (v_total between 0 and 10000000) then raise exception 'Total inválido'; end if;
  if not (v_anticipo between 0 and 10000000) then raise exception 'Anticipo inválido'; end if;

  if (p->>'id') is null then
    insert into public.balloon_orders
      (telefono, cliente, fecha_hora, pedido, colores, tecnica, texto, total, anticipo, estado, notas, created_by, updated_by)
    values
      (p->>'telefono', p->>'cliente', (p->>'fecha_hora')::timestamptz, p->>'pedido', p->>'colores',
       p->>'tecnica', p->>'texto', v_total, v_anticipo,
       coalesce(p->>'estado','por_aprobar'), p->>'notas', public._actor(), public._actor())
    returning id into v_id;
  else
    v_id := (p->>'id')::bigint;
    update public.balloon_orders set
      telefono = p->>'telefono', cliente = p->>'cliente', fecha_hora = (p->>'fecha_hora')::timestamptz,
      pedido = p->>'pedido', colores = p->>'colores', tecnica = p->>'tecnica', texto = p->>'texto',
      total = v_total, anticipo = v_anticipo,
      estado = coalesce(p->>'estado','por_aprobar'), notas = p->>'notas',
      updated_by = public._actor(), updated_at = now()
    where id = v_id;
    if not found then raise exception 'El pedido % no existe', v_id; end if;
  end if;

  delete from public.balloon_order_items where order_id = v_id;
  for it in select * from jsonb_array_elements(coalesce(p->'items','[]'::jsonb))
  loop
    insert into public.balloon_order_items (order_id, descripcion, cantidad, precio_unit, catalog_id)
    values (v_id, it->>'descripcion', coalesce((it->>'cantidad')::numeric,1),
            coalesce((it->>'precio_unit')::numeric,0), nullif(it->>'catalog_id','')::bigint);
  end loop;

  return v_id;
end $$;

create or replace function public.order_set_estado(p_id bigint, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_staff();
  update public.balloon_orders
    set estado = p_estado, updated_by = public._actor(), updated_at = now()
  where id = p_id;
end $$;

create or replace function public.order_delete(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  delete from public.balloon_orders where id = p_id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Conteos: solo admin (igual que en el portal) y sin carreras
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.count_start(p_name text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public._require_admin();
  insert into public.stock_counts (name, created_by)
  values (
    coalesce(nullif(left(trim(p_name), 120), ''),
             'Conteo ' || to_char(now() at time zone 'America/Monterrey', 'DD/MM/YYYY HH24:MI')),
    public._actor()
  )
  returning id into v_id;

  insert into public.stock_count_participants (count_id, actor) values (v_id, public._actor())
    on conflict (count_id, actor) do nothing;
  return v_id;
end $$;

create or replace function public.count_list_open()
returns table (
  id bigint, name text, created_by text, created_at timestamptz,
  items_count bigint, participants jsonb
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_admin();
  return query
  select c.id, c.name, c.created_by, c.created_at,
    coalesce((select count(*) from public.stock_count_items i where i.count_id = c.id), 0),
    coalesce((select jsonb_agg(jsonb_build_object('actor', p.actor, 'ready', p.ready) order by p.joined_at)
              from public.stock_count_participants p where p.count_id = c.id), '[]'::jsonb)
  from public.stock_counts c
  where c.status = 'abierto'
  order by c.id desc;
end $$;

create or replace function public.count_join(p_count_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  perform 1 from public.stock_counts where id = p_count_id and status = 'abierto' for share;
  if not found then raise exception 'El conteo ya no está abierto'; end if;
  insert into public.stock_count_participants (count_id, actor) values (p_count_id, public._actor())
    on conflict (count_id, actor) do nothing;
end $$;

create or replace function public.count_set_ready(p_count_id bigint, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  perform 1 from public.stock_counts where id = p_count_id and status = 'abierto' for share;
  if not found then raise exception 'El conteo ya no está abierto'; end if;
  insert into public.stock_count_participants (count_id, actor, ready, ready_at)
  values (p_count_id, public._actor(), p_ready, case when p_ready then now() else null end)
  on conflict (count_id, actor) do update
    set ready = excluded.ready, ready_at = excluded.ready_at;
end $$;

create or replace function public.count_add(p_count_id bigint, p_code text, p_qty numeric default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pid bigint; v_name text; v_code text; v_stock numeric; v_total numeric;
begin
  perform public._require_admin();
  if p_qty is null or not (p_qty between -100000 and 100000) then raise exception 'Cantidad inválida'; end if;
  -- "for share": si alguien está finalizando el conteo, espera y luego ve que ya no está abierto.
  perform 1 from public.stock_counts where id = p_count_id and status = 'abierto' for share;
  if not found then raise exception 'El conteo ya no está abierto'; end if;

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
    raise exception 'No existe un producto activo con el código %', left(trim(p_code), 60);
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

create or replace function public.count_finalize(p_count_id bigint, p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_participants int; v_faltan text; v_out jsonb; v_ap jsonb;
begin
  perform public._require_admin();

  -- Bloquea el conteo: nadie más puede capturar ni finalizar mientras tanto.
  perform 1 from public.stock_counts where id = p_count_id and status = 'abierto' for update;
  if not found then raise exception 'El conteo ya no está abierto'; end if;

  select count(*) into v_participants from public.stock_count_participants where count_id = p_count_id;
  if v_participants > 1 then
    select string_agg(actor, ', ') into v_faltan
    from public.stock_count_participants where count_id = p_count_id and not ready;
    if v_faltan is not null then
      raise exception 'Falta que confirmen que terminaron: %', v_faltan;
    end if;
  end if;

  if not exists (select 1 from public.stock_count_items where count_id = p_count_id) then
    raise exception 'El conteo está vacío: captura al menos un producto antes de finalizar';
  end if;

  update public.stock_count_items i
     set system_qty    = p.stock,
         unit_cost     = p.cost,
         category_name = coalesce(c.name, 'Sin categoría')
    from public.products p
    left join public.categories c on c.id = p.category_id
   where p.id = i.product_id and i.count_id = p_count_id;

  update public.stock_counts
     set status = 'finalizado', finished_at = now(), finished_by = public._actor()
   where id = p_count_id;

  select jsonb_build_object(
           'productos',      count(*),
           'con_diferencia', count(*) filter (where counted_qty <> system_qty),
           'sin_diferencia', count(*) filter (where counted_qty = system_qty))
    into v_out
    from public.stock_count_items where count_id = p_count_id;

  if p_apply then
    v_ap := public._count_apply_to_stock(p_count_id);
    v_out := v_out || jsonb_build_object('inventario_actualizado', true) || v_ap;
  else
    v_out := v_out || jsonb_build_object('inventario_actualizado', false);
  end if;
  return v_out;
end $$;

create or replace function public.count_apply_finalized(p_count_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  -- "Reclama" la aplicación de forma atómica: dos clics/llamadas simultáneas no aplican dos veces.
  update public.stock_counts
     set applied_at = now(), applied_by = public._actor()
   where id = p_count_id and status = 'finalizado' and applied_at is null;
  if not found then
    if exists (select 1 from public.stock_counts where id = p_count_id and applied_at is not null) then
      raise exception 'Este conteo ya actualizó el inventario';
    end if;
    raise exception 'Solo se puede actualizar el inventario con un conteo finalizado';
  end if;
  return public._count_apply_to_stock(p_count_id);
end $$;

create or replace function public.count_history()
returns table (
  id bigint, name text, created_by text, created_at timestamptz,
  finished_at timestamptz, finished_by text, participants jsonb,
  items_count bigint, diff_count bigint, faltante numeric, sobrante numeric,
  applied_at timestamptz, applied_by text
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_admin();
  return query
  select c.id, c.name, c.created_by, c.created_at, c.finished_at, c.finished_by,
    coalesce((select jsonb_agg(p.actor order by p.joined_at)
                from public.stock_count_participants p where p.count_id = c.id), '[]'::jsonb),
    (select count(*) from public.stock_count_items i where i.count_id = c.id),
    (select count(*) from public.stock_count_items i
       where i.count_id = c.id and i.counted_qty <> coalesce(i.system_qty, i.counted_qty)),
    coalesce((select sum((i.counted_qty - i.system_qty) * coalesce(i.unit_cost, 0))
                from public.stock_count_items i
               where i.count_id = c.id and i.counted_qty < i.system_qty), 0),
    coalesce((select sum((i.counted_qty - i.system_qty) * coalesce(i.unit_cost, 0))
                from public.stock_count_items i
               where i.count_id = c.id and i.counted_qty > i.system_qty), 0),
    c.applied_at, c.applied_by
  from public.stock_counts c
  where c.status = 'finalizado'
  order by c.finished_at desc nulls last, c.id desc;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Cierre mensual: ya no se puede llamar sin sesión
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.report_generate_month(p_year int, p_month int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_from date := make_date(p_year, p_month, 1);
  v_to   date := (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date;
begin
  -- pg_cron y el SQL Editor corren como 'postgres' y sin usuario; la API (PostgREST)
  -- corre como 'authenticator'. Cualquier llamada con sesión o desde la API exige admin.
  if auth.uid() is not null or session_user <> 'postgres' then perform public._require_admin(); end if;
  if p_year not between 2020 and 2100 then raise exception 'Año inválido'; end if;

  insert into public.monthly_reports (year, month, data, generated_at)
  values (p_year, p_month, public._report_summary(v_from, v_to), now())
  on conflict (year, month) do update set data = excluded.data, generated_at = excluded.generated_at;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Permisos de EJECUCIÓN: se quitan todos y se dan solo los necesarios
-- ════════════════════════════════════════════════════════════════════════════
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         -- usados por las políticas RLS
         '_is_admin', '_is_staff',
         -- catálogo / inventario (cada función revisa el rol por dentro)
         'find_product_by_code', 'adjust_stock', 'upsert_product', 'delete_product',
         'upsert_category', 'delete_category', 'add_barcode', 'delete_barcode',
         -- ventas del POS
         'commit_pos_sale', 'cancel_pos_sale', 'import_pos_sales_bulk', 'backfill_item_costs',
         -- conteos
         'count_start', 'count_list_open', 'count_join', 'count_set_ready', 'count_add',
         'count_set', 'count_remove', 'count_cancel', 'count_finalize', 'count_apply_finalized',
         'count_history',
         -- pedidos y ajustes
         'order_save', 'order_set_estado', 'order_delete', 'set_app_setting',
         -- reportes y etiquetas
         'report_sales_summary', 'report_sales_filtered', 'report_filter_options',
         'report_generate_month', 'label_list_create', 'label_list_set_status'
       ])
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
-- NO se dan a nadie: _count_apply_to_stock, _report_filtered, _report_summary,
-- _require_admin, _require_staff, _actor, _source, handle_new_user,
-- touch_updated_at, count_apply (obsoleta), count_open (obsoleta).

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Tablas: RLS en todas, anon sin acceso, nadie escribe directo
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on table public.%I from anon', t.tablename);
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from authenticated', t.tablename);
  end loop;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Políticas de lectura (se rehacen todas las de estas tablas)
do $$
declare
  t text; pol record;
  staff_tables text[] := array['categories','products','product_barcodes',
                               'order_catalog','balloon_orders','balloon_order_items','app_settings'];
  admin_tables text[] := array['sales_mirror','sale_items_mirror','inventory_movements','monthly_reports',
                               'stock_counts','stock_count_items','stock_count_participants',
                               'label_lists','label_list_items'];
begin
  foreach t in array staff_tables || admin_tables || array['profiles'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('grant select on public.%I to authenticated', t);
  end loop;

  foreach t in array staff_tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('create policy lectura_staff on public.%I for select to authenticated using (public._is_staff())', t);
  end loop;
  foreach t in array admin_tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('create policy lectura_admin on public.%I for select to authenticated using (public._is_admin())', t);
  end loop;
  create policy lectura_propia on public.profiles for select to authenticated
    using (id = auth.uid() or public._is_admin());
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Datos válidos: sin NaN, sin negativos donde no tiene sentido
-- ════════════════════════════════════════════════════════════════════════════
-- Primero se corrigen (con rastro) los productos que ya tengan valores inválidos.
do $$
declare n int;
begin
  insert into public.inventory_movements (product_id, type, qty_before, qty_change, qty_after, actor, source, reference)
  select id, 'ajuste',
         case when stock = 'NaN' then 0 else stock end,
         case when stock = 'NaN' then 0 else -stock end,
         0, 'sistema', 'portal', 'Corrección automática (015): stock inválido'
    from public.products
   where stock = 'NaN' or stock < 0;
  get diagnostics n = row_count;
  if n > 0 then raise notice 'Se corrigió el stock inválido de % producto(s) (quedó en 0, con movimiento de ajuste).', n; end if;
  update public.products set stock = 0 where stock = 'NaN' or stock < 0;

  update public.products set cost = 0 where cost = 'NaN' or cost < 0;
  update public.products set price = 0 where price = 'NaN' or price < 0;
  update public.products set min_stock = 0 where min_stock = 'NaN' or min_stock < 0;
end $$;

alter table public.products drop constraint if exists products_valores_ok;
alter table public.products add constraint products_valores_ok check (
  stock between 0 and 1000000000 and cost between 0 and 1000000000 and
  price between 0 and 1000000000 and min_stock between 0 and 1000000000);

-- En tablas históricas la regla aplica a lo nuevo; se intenta validar lo viejo.
alter table public.sales_mirror drop constraint if exists sales_mirror_valores_ok;
alter table public.sales_mirror add constraint sales_mirror_valores_ok check (
  total between -1000000000 and 1000000000 and cost_total between -1000000000 and 1000000000 and
  (received_amount is null or received_amount between -1000000000 and 1000000000) and
  (change_amount is null or change_amount between -1000000000 and 1000000000)) not valid;

alter table public.sale_items_mirror drop constraint if exists sale_items_mirror_valores_ok;
alter table public.sale_items_mirror add constraint sale_items_mirror_valores_ok check (
  quantity between -1000000000 and 1000000000 and unit_price between -1000000000 and 1000000000 and
  discount between -1000000000 and 1000000000 and
  (unit_cost is null or unit_cost between -1000000000 and 1000000000)) not valid;

alter table public.inventory_movements drop constraint if exists inventory_movements_valores_ok;
alter table public.inventory_movements add constraint inventory_movements_valores_ok check (
  qty_before between -1000000000000 and 1000000000000 and
  qty_change between -1000000000000 and 1000000000000 and
  qty_after  between -1000000000000 and 1000000000000) not valid;

alter table public.stock_count_items drop constraint if exists stock_count_items_valores_ok;
alter table public.stock_count_items add constraint stock_count_items_valores_ok check (
  counted_qty between 0 and 1000000000) not valid;

alter table public.balloon_orders drop constraint if exists balloon_orders_valores_ok;
alter table public.balloon_orders add constraint balloon_orders_valores_ok check (
  total between 0 and 1000000000 and anticipo between 0 and 1000000000) not valid;

alter table public.balloon_order_items drop constraint if exists balloon_order_items_valores_ok;
alter table public.balloon_order_items add constraint balloon_order_items_valores_ok check (
  cantidad between 0 and 1000000 and precio_unit between 0 and 1000000000) not valid;

alter table public.label_list_items drop constraint if exists label_list_items_valores_ok;
alter table public.label_list_items add constraint label_list_items_valores_ok check (
  qty between 1 and 10000) not valid;

do $$
declare c record;
begin
  for c in select conrelid::regclass as tbl, conname from pg_constraint
            where conname like '%_valores_ok' and not convalidated loop
    begin
      execute format('alter table %s validate constraint %I', c.tbl, c.conname);
    exception when others then
      raise notice 'Aviso: % tiene datos viejos fuera de rango; la regla aplica solo a lo nuevo.', c.tbl;
    end;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Índices que faltaban
-- ════════════════════════════════════════════════════════════════════════════
create index if not exists inv_mov_reference_idx on public.inventory_movements (reference);
create index if not exists sci_product_idx on public.stock_count_items (product_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 11. Límite de tiempo por consulta (evita que una consulta pesada acapare la base)
-- ════════════════════════════════════════════════════════════════════════════
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '10s';

commit;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
