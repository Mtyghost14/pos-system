-- ============================================================================
-- 007_reportes.sql — Reportes de ventas en la nube + cierre mensual automatico
--
--   * import_pos_sales_bulk   : sube ventas historicas del POS al espejo
--                               (solo llena sales_mirror / sale_items_mirror;
--                                NO toca stock ni inventory_movements)
--   * report_sales_summary    : agregados por rango (forma de pago / categoria /
--                               dia / totales) — lo usa el portal
--   * monthly_reports         : snapshot congelado de cada mes cerrado
--   * report_generate_month   : calcula y guarda el snapshot de un mes
--   * pg_cron                 : el dia 1 de cada mes genera el mes anterior
--
-- Idempotente. Pegar completo en el SQL Editor de Supabase.
-- Zona horaria de referencia: America/Monterrey.
-- ============================================================================

-- ─── Backfill de ventas historicas ─────────────────────────────────────────
-- p = arreglo JSON de ventas:
--   [{folio, pos_sale_id, cashier_name, payment_type, total, cost_total,
--     cancelled, sold_at (hora local naive), received_amount, change_amount,
--     payment_details, items:[{code, name, qty, unit_price, discount}]}]
-- Idempotente por folio: las que ya estan en la nube se saltan.
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
       -- sold_at viene como hora local de Monterrey (texto naive) -> se convierte a UTC.
       -- Si ya trae zona (ISO con Z/offset) el ::timestamp la descarta y la reinterpreta
       -- como local; las ventas en vivo entran por commit_pos_sale, no por aqui.
       (s->>'sold_at')::timestamp at time zone 'America/Monterrey',
       nullif(s->>'received_amount','')::numeric,
       nullif(s->>'change_amount','')::numeric,
       case when jsonb_typeof(s->'payment_details') = 'object' then s->'payment_details' else null end);

    for it in select * from jsonb_array_elements(coalesce(s->'items','[]'::jsonb))
    loop
      insert into public.sale_items_mirror (folio, product_code, product_name, quantity, unit_price, discount)
      values (v_folio, it->>'code', it->>'name', (it->>'qty')::numeric,
              (it->>'unit_price')::numeric, coalesce((it->>'discount')::numeric,0));
    end loop;

    v_ins := v_ins + 1;
  end loop;

  return v_ins;
end $$;

-- ─── Agregados de ventas (logica compartida, sin candado de rol) ────────────
create or replace function public._report_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_lo timestamptz := (p_from::timestamp at time zone 'America/Monterrey');
  v_hi timestamptz := ((p_to + 1)::timestamp at time zone 'America/Monterrey');
  v_tot jsonb; v_pago jsonb; v_cat jsonb; v_dia jsonb;
begin
  select jsonb_build_object(
    'ventas',          coalesce(sum(total),0),
    'utilidad',        coalesce(sum(total - cost_total),0),
    'tickets',         count(*),
    'ticket_promedio', coalesce(avg(total),0),
    'margen',          case when coalesce(sum(total),0) > 0
                            then round(sum(total - cost_total) / sum(total) * 100, 1) else 0 end
  ) into v_tot
  from public.sales_mirror
  where not cancelled and sold_at >= v_lo and sold_at < v_hi;

  select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'ventas', v, 'tickets', c) order by v desc), '[]'::jsonb)
  into v_pago
  from (
    select coalesce(payment_type,'—') as forma, sum(total) v, count(*) c
    from public.sales_mirror
    where not cancelled and sold_at >= v_lo and sold_at < v_hi
    group by coalesce(payment_type,'—')
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('categoria', cat, 'ventas', v, 'piezas', q) order by v desc), '[]'::jsonb)
  into v_cat
  from (
    select coalesce(c.name, 'Sin categoría') cat,
           sum(si.quantity * si.unit_price) v,
           sum(si.quantity) q
    from public.sale_items_mirror si
    join public.sales_mirror sm on sm.folio = si.folio
    left join public.products p on p.code = si.product_code
    left join public.categories c on c.id = p.category_id
    where not sm.cancelled and sm.sold_at >= v_lo and sm.sold_at < v_hi
    group by coalesce(c.name, 'Sin categoría')
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('fecha', d, 'ventas', v, 'tickets', c) order by d), '[]'::jsonb)
  into v_dia
  from (
    select (sold_at at time zone 'America/Monterrey')::date d, sum(total) v, count(*) c
    from public.sales_mirror
    where not cancelled and sold_at >= v_lo and sold_at < v_hi
    group by 1
  ) t;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totales', v_tot, 'por_forma_pago', v_pago, 'por_categoria', v_cat, 'por_dia', v_dia
  );
end $$;

-- ─── Reporte por rango para el portal (con candado de rol) ──────────────────
create or replace function public.report_sales_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce((select role in ('admin','terminal') from public.profiles where id = auth.uid()), false) = false then
    raise exception 'Solo un administrador puede ver los reportes';
  end if;
  return public._report_summary(p_from, p_to);
end $$;

-- ─── Snapshot mensual congelado ────────────────────────────────────────────
create table if not exists public.monthly_reports (
  year         int not null,
  month        int not null,
  data         jsonb not null,
  generated_at timestamptz not null default now(),
  primary key (year, month)
);
alter table public.monthly_reports enable row level security;
drop policy if exists sel_auth on public.monthly_reports;
create policy sel_auth on public.monthly_reports for select to authenticated using (true);
grant select on public.monthly_reports to authenticated;

-- Calcula y guarda (o refresca) el snapshot de un mes.
-- Lo puede correr un admin desde el portal, o el job de cron (sin auth.uid()).
create or replace function public.report_generate_month(p_year int, p_month int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_from date := make_date(p_year, p_month, 1);
  v_to   date := (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date;
begin
  if auth.uid() is not null
     and coalesce((select role in ('admin','terminal') from public.profiles where id = auth.uid()), false) = false then
    raise exception 'Solo un administrador puede generar el cierre mensual';
  end if;

  insert into public.monthly_reports (year, month, data, generated_at)
  values (p_year, p_month, public._report_summary(v_from, v_to), now())
  on conflict (year, month) do update set data = excluded.data, generated_at = excluded.generated_at;
end $$;

-- ─── Cron: el dia 1 de cada mes genera el snapshot del mes anterior ─────────
create extension if not exists pg_cron;

select cron.schedule(
  'kaddo-cierre-mensual',
  '0 7 1 * *',   -- dia 1, 07:00 UTC  (~01:00 America/Monterrey)
  $$select public.report_generate_month(
      extract(year  from (((now() at time zone 'America/Monterrey')::date) - interval '1 month'))::int,
      extract(month from (((now() at time zone 'America/Monterrey')::date) - interval '1 month'))::int)$$
);

-- ─── Grants + refresco de PostgREST ───────────────────────────────────────
grant execute on function public.import_pos_sales_bulk(jsonb)      to authenticated;
grant execute on function public.report_sales_summary(date,date)   to authenticated;
grant execute on function public.report_generate_month(int,int)    to authenticated;

notify pgrst, 'reload schema';

-- ─── Semilla: genera los snapshots de los meses ya cerrados ────────────────
-- (se pueden re-correr despues de subir las ventas historicas desde el POS)
do $$
declare y int; m int;
begin
  y := extract(year  from ((now() at time zone 'America/Monterrey')::date))::int;
  m := extract(month from ((now() at time zone 'America/Monterrey')::date))::int;
  -- ultimos 12 meses cerrados
  for i in 1..12 loop
    m := m - 1;
    if m < 1 then m := 12; y := y - 1; end if;
    perform public.report_generate_month(y, m);
  end loop;
end $$;
