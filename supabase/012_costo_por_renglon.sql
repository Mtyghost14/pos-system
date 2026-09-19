-- ============================================================================
-- 012_costo_por_renglon.sql — Utilidad por categoría y por producto.
--
-- El espejo de ventas solo guardaba el costo total del ticket. Ahora cada
-- renglón guarda su costo unitario (el que tenía el producto AL VENDER, igual
-- que en el POS), así el reporte puede dar utilidad por categoría / producto
-- y funciona también cuando se filtra por categoría.
--
--   · sale_items_mirror.unit_cost   (null = costo desconocido)
--   · commit_pos_sale               → guarda unit_cost (el POS ya lo enviaba)
--   · import_pos_sales_bulk         → guarda unit_cost al subir ventas históricas
--   · backfill_item_costs           → rellena el costo de renglones ya subidos
--                                     (el POS lo hace solo al conectarse)
--   · _report_filtered              → utilidad por categoría y por producto
--
-- Idempotente. Pegar completo en el SQL Editor de Supabase.
-- ============================================================================

alter table public.sale_items_mirror add column if not exists unit_cost numeric(12,2);

-- ─── Venta en vivo: ahora también guarda el costo de cada renglón ───────────
create or replace function public.commit_pos_sale(p_sale jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb; v_pid bigint; v_before numeric; v_after numeric; v_folio text;
begin
  v_folio := p_sale->>'folio';
  if v_folio is null then raise exception 'falta folio'; end if;
  if exists (select 1 from public.sales_mirror where folio = v_folio) then
    return;                       -- ya sincronizada (reintento idempotente)
  end if;

  insert into public.sales_mirror
    (folio, pos_sale_id, cashier_name, payment_type, total, cost_total, sold_at,
     received_amount, change_amount, payment_details)
  values
    (v_folio, (p_sale->>'pos_sale_id')::int, p_sale->>'cashier_name', p_sale->>'payment_type',
     (p_sale->>'total')::numeric, coalesce((p_sale->>'cost_total')::numeric,0),
     coalesce((p_sale->>'sold_at')::timestamptz, now()),
     nullif(p_sale->>'received_amount','')::numeric,
     nullif(p_sale->>'change_amount','')::numeric,
     case when jsonb_typeof(p_sale->'payment_details') = 'object' then p_sale->'payment_details' else null end);

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

    insert into public.sale_items_mirror (folio, product_code, product_name, quantity, unit_price, unit_cost, discount)
    values (v_folio, it->>'code', it->>'name', (it->>'qty')::numeric,
            (it->>'unit_price')::numeric, nullif(it->>'unit_cost','')::numeric,
            coalesce((it->>'discount')::numeric,0));
  end loop;
end $$;

-- ─── Ventas históricas del POS: también con costo ───────────────────────────
create or replace function public.import_pos_sales_bulk(p jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare s jsonb; it jsonb; v_folio text; v_ins int := 0;
begin
  if coalesce((select role in ('admin','terminal') from public.profiles where id = auth.uid()), false) = false then
    raise exception 'Solo un administrador o la terminal pueden importar ventas';
  end if;

  for s in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb))
  loop
    v_folio := s->>'folio';
    if v_folio is null then continue; end if;
    if exists (select 1 from public.sales_mirror where folio = v_folio) then continue; end if;

    insert into public.sales_mirror
      (folio, pos_sale_id, cashier_name, payment_type, total, cost_total, cancelled, sold_at,
       received_amount, change_amount, payment_details)
    values
      (v_folio, (s->>'pos_sale_id')::int, s->>'cashier_name', s->>'payment_type',
       (s->>'total')::numeric, coalesce((s->>'cost_total')::numeric,0),
       coalesce((s->>'cancelled')::boolean, false),
       (s->>'sold_at')::timestamp at time zone 'America/Monterrey',
       nullif(s->>'received_amount','')::numeric,
       nullif(s->>'change_amount','')::numeric,
       case when jsonb_typeof(s->'payment_details') = 'object' then s->'payment_details' else null end);

    for it in select * from jsonb_array_elements(coalesce(s->'items','[]'::jsonb))
    loop
      insert into public.sale_items_mirror (folio, product_code, product_name, quantity, unit_price, unit_cost, discount)
      values (v_folio, it->>'code', it->>'name', (it->>'qty')::numeric,
              (it->>'unit_price')::numeric, nullif(it->>'unit_cost','')::numeric,
              coalesce((it->>'discount')::numeric,0));
    end loop;

    v_ins := v_ins + 1;
  end loop;

  return v_ins;
end $$;

-- ─── Rellenar el costo de renglones que ya estaban en la nube ───────────────
-- p = [{folio, code, unit_cost}, ...]. Solo toca renglones con unit_cost null
-- (idempotente; nunca pisa un costo ya guardado). Devuelve cuántos actualizó.
create or replace function public.backfill_item_costs(p jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce((select role in ('admin','terminal') from public.profiles where id = auth.uid()), false) = false then
    raise exception 'Solo un administrador o la terminal pueden actualizar costos';
  end if;

  with x as (
    select * from jsonb_to_recordset(coalesce(p, '[]'::jsonb)) as t(folio text, code text, unit_cost numeric)
  ), u as (
    update public.sale_items_mirror m
       set unit_cost = x.unit_cost
      from x
     where m.folio = x.folio and m.product_code = x.code
       and m.unit_cost is null and x.unit_cost is not null
    returning 1
  )
  select count(*) into n from u;
  return coalesce(n, 0);
end $$;

-- ─── Reporte: utilidad por categoría y por producto ─────────────────────────
-- Utilidad de un renglón = cantidad × (precio − costo), como en el POS.
-- Renglones sin costo (ventas no actualizadas todavía) NO cuentan en la utilidad
-- y se reportan en "sin_costo" para saber que el dato es parcial.
create or replace function public._report_filtered(
  p_from date, p_to date,
  p_categorias text[] default null,
  p_cajeros    text[] default null,
  p_pagos      text[] default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_lo  timestamptz := (p_from::timestamp at time zone 'America/Monterrey');
  v_hi  timestamptz := ((p_to + 1)::timestamp at time zone 'America/Monterrey');
  v_cat boolean := coalesce(cardinality(p_categorias), 0) > 0;
  v_out jsonb;
begin
  with s as (
    select sm.folio, sm.payment_type, sm.total, sm.cost_total,
           (sm.sold_at at time zone 'America/Monterrey')::date as dia
    from public.sales_mirror sm
    where not sm.cancelled and sm.sold_at >= v_lo and sm.sold_at < v_hi
      and (coalesce(cardinality(p_cajeros), 0) = 0 or sm.cashier_name = any(p_cajeros))
      and (coalesce(cardinality(p_pagos),   0) = 0 or sm.payment_type = any(p_pagos))
  ),
  it as (
    select s.folio, s.payment_type, s.dia,
           coalesce(c.name, 'Sin categoría') as cat,
           si.product_code as codigo,
           coalesce(p.name, si.product_name, si.product_code) as producto,
           si.quantity,
           si.quantity * si.unit_price as importe,
           (si.unit_cost is not null) as con_costo,
           si.quantity * (si.unit_price - si.unit_cost) as utilidad
    from s
    join public.sale_items_mirror si on si.folio = s.folio
    left join public.products p on p.code = si.product_code
    left join public.categories c on c.id = p.category_id
    where (not v_cat or coalesce(c.name, 'Sin categoría') = any(p_categorias))
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'utilidad_disponible', true,

    'totales', case when v_cat then
      (select jsonb_build_object(
          'ventas', coalesce(sum(importe), 0),
          'utilidad', case when count(*) filter (where con_costo) = 0 then null
                           else coalesce(sum(utilidad) filter (where con_costo), 0) end,
          'tickets', count(distinct folio),
          'ticket_promedio', coalesce(sum(importe) / nullif(count(distinct folio), 0), 0),
          'margen', case when coalesce(sum(importe) filter (where con_costo), 0) > 0
                         then round(sum(utilidad) filter (where con_costo)
                                    / sum(importe) filter (where con_costo) * 100, 1) else null end,
          'sin_costo', count(*) filter (where not con_costo)) from it)
    else
      (select jsonb_build_object(
          'ventas', coalesce(sum(total), 0),
          'utilidad', coalesce(sum(total - cost_total), 0),
          'tickets', count(*),
          'ticket_promedio', coalesce(avg(total), 0),
          'margen', case when coalesce(sum(total), 0) > 0
                         then round(sum(total - cost_total) / sum(total) * 100, 1) else 0 end,
          'sin_costo', 0) from s)
    end,

    'por_forma_pago', case when v_cat then
      (select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'ventas', v, 'tickets', c) order by v desc), '[]'::jsonb)
         from (select coalesce(payment_type, '—') as forma, sum(importe) as v, count(distinct folio) as c
                 from it group by coalesce(payment_type, '—')) t)
    else
      (select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'ventas', v, 'tickets', c) order by v desc), '[]'::jsonb)
         from (select coalesce(payment_type, '—') as forma, sum(total) as v, count(*) as c
                 from s group by coalesce(payment_type, '—')) t)
    end,

    'por_categoria',
      (select coalesce(jsonb_agg(jsonb_build_object(
                'categoria', cat, 'ventas', v, 'piezas', q, 'utilidad', u, 'sin_costo', sc) order by v desc), '[]'::jsonb)
         from (select cat, sum(importe) as v, sum(quantity) as q,
                      case when count(*) filter (where con_costo) = 0 then null
                           else sum(utilidad) filter (where con_costo) end as u,
                      count(*) filter (where not con_costo) as sc
                 from it group by cat) t),

    'por_producto',
      (select coalesce(jsonb_agg(jsonb_build_object(
                'codigo', codigo, 'producto', producto, 'categoria', cat,
                'ventas', v, 'piezas', q, 'utilidad', u, 'sin_costo', sc) order by v desc), '[]'::jsonb)
         from (select codigo, max(producto) as producto, max(cat) as cat,
                      sum(importe) as v, sum(quantity) as q,
                      case when count(*) filter (where con_costo) = 0 then null
                           else sum(utilidad) filter (where con_costo) end as u,
                      count(*) filter (where not con_costo) as sc
                 from it group by codigo) t),

    'por_dia', case when v_cat then
      (select coalesce(jsonb_agg(jsonb_build_object('fecha', d, 'ventas', v, 'tickets', c) order by d), '[]'::jsonb)
         from (select dia as d, sum(importe) as v, count(distinct folio) as c from it group by dia) t)
    else
      (select coalesce(jsonb_agg(jsonb_build_object('fecha', d, 'ventas', v, 'tickets', c) order by d), '[]'::jsonb)
         from (select dia as d, sum(total) as v, count(*) as c from s group by dia) t)
    end
  ) into v_out;

  return v_out;
end $$;

grant execute on function
  public.backfill_item_costs(jsonb)
  to authenticated;

notify pgrst, 'reload schema';
