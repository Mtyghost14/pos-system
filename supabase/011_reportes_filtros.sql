-- ============================================================================
-- 011_reportes_filtros.sql — Reportes del portal con filtros:
--   · categorías (departamentos)   · cajero / admin   · forma de pago
-- Cada filtro es una LISTA; vacío/null = sin filtrar (se incluye todo).
--
-- Reglas:
--   · Filtros de cajero y forma de pago se aplican a la VENTA (ticket).
--   · Filtro de categoría se aplica a los RENGLONES: solo cuentan los
--     productos de esas categorías (importe = cantidad × precio, igual que
--     el desglose por categoría). Tickets = ventas que tienen al menos un
--     renglón de esas categorías; la forma de pago es la del ticket.
--   · Con filtro de categoría NO hay utilidad ni margen (el espejo de
--     ventas no guarda el costo por renglón) → se devuelven en null.
--   · Nunca cuenta ventas canceladas.
-- Idempotente. Pegar completo en el SQL Editor de Supabase.
-- ============================================================================

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
           si.quantity, si.quantity * si.unit_price as importe
    from s
    join public.sale_items_mirror si on si.folio = s.folio
    left join public.products p on p.code = si.product_code
    left join public.categories c on c.id = p.category_id
    where (not v_cat or coalesce(c.name, 'Sin categoría') = any(p_categorias))
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'utilidad_disponible', not v_cat,

    'totales', case when v_cat then
      (select jsonb_build_object(
          'ventas', coalesce(sum(importe), 0),
          'utilidad', null,
          'tickets', count(distinct folio),
          'ticket_promedio', coalesce(sum(importe) / nullif(count(distinct folio), 0), 0),
          'margen', null) from it)
    else
      (select jsonb_build_object(
          'ventas', coalesce(sum(total), 0),
          'utilidad', coalesce(sum(total - cost_total), 0),
          'tickets', count(*),
          'ticket_promedio', coalesce(avg(total), 0),
          'margen', case when coalesce(sum(total), 0) > 0
                         then round(sum(total - cost_total) / sum(total) * 100, 1) else 0 end) from s)
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
      (select coalesce(jsonb_agg(jsonb_build_object('categoria', cat, 'ventas', v, 'piezas', q) order by v desc), '[]'::jsonb)
         from (select cat, sum(importe) as v, sum(quantity) as q from it group by cat) t),

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

-- El cierre mensual (007) y report_sales_summary siguen igual: ahora son "sin filtros".
create or replace function public._report_summary(p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select public._report_filtered(p_from, p_to, null, null, null);
$$;

-- Reporte con filtros para el portal (con candado de rol).
create or replace function public.report_sales_filtered(
  p_from date, p_to date,
  p_categorias text[] default null,
  p_cajeros    text[] default null,
  p_pagos      text[] default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce((select role in ('admin','terminal') from public.profiles where id = auth.uid()), false) = false then
    raise exception 'Solo un administrador puede ver los reportes';
  end if;
  return public._report_filtered(p_from, p_to, p_categorias, p_cajeros, p_pagos);
end $$;

-- Opciones para los filtros: categorías, cajeros/admins que han vendido y formas de pago.
create or replace function public.report_filter_options()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce((select role in ('admin','terminal') from public.profiles where id = auth.uid()), false) = false then
    raise exception 'Solo un administrador puede ver los reportes';
  end if;
  return jsonb_build_object(
    'categorias', (select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
                     from (select name from public.categories
                           union select 'Sin categoría') t),
    'cajeros',    (select coalesce(jsonb_agg(n order by n), '[]'::jsonb)
                     from (select distinct cashier_name as n from public.sales_mirror
                           where cashier_name is not null and trim(cashier_name) <> '') t),
    'pagos',      (select coalesce(jsonb_agg(p order by p), '[]'::jsonb)
                     from (select distinct payment_type as p from public.sales_mirror
                           where payment_type is not null) t)
  );
end $$;

grant execute on function
  public.report_sales_filtered(date, date, text[], text[], text[]),
  public.report_filter_options()
  to authenticated;

notify pgrst, 'reload schema';
