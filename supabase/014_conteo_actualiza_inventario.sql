-- ============================================================================
-- 014_conteo_actualiza_inventario.sql — Opción de que el conteo ACTUALICE el
-- inventario, pero SOLO de los productos que se contaron.
--
--   · Los productos que no se capturaron en el conteo NUNCA se tocan
--     (no hay "poner en 0 lo no contado").
--   · Es opcional y se decide: al finalizar (casilla) o después, desde el
--     historial, revisando las diferencias.
--   · Se ajusta por la DIFERENCIA hallada (contado − lo que decía el sistema al
--     finalizar), no pisando el número: si hubo ventas/recepciones después del
--     conteo, no se pierden. Si nada se movió, el stock queda igual a lo contado.
--   · Cada ajuste deja su movimiento ('ajuste', ref "Conteo #N") en Movimientos.
--   · Solo administradores. Un conteo solo puede actualizar el inventario una vez.
--
-- Idempotente. Pegar completo en el SQL Editor de Supabase.
-- ============================================================================

-- Interno: aplica un conteo FINALIZADO (con foto) al stock, solo renglones contados.
create or replace function public._count_apply_to_stock(p_count_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; v_now numeric; v_new numeric;
  v_ajustados int := 0; v_sin_cambio int := 0; v_ref text := 'Conteo #' || p_count_id;
begin
  for r in
    select i.product_id, i.counted_qty, i.system_qty
      from public.stock_count_items i
     where i.count_id = p_count_id and i.system_qty is not null
  loop
    if r.counted_qty = r.system_qty then v_sin_cambio := v_sin_cambio + 1; continue; end if;

    select stock into v_now from public.products where id = r.product_id for update;
    if v_now is null then continue; end if;

    v_new := greatest(0, v_now + (r.counted_qty - r.system_qty));
    if v_new = v_now then v_sin_cambio := v_sin_cambio + 1; continue; end if;

    update public.products set stock = v_new where id = r.product_id;
    insert into public.inventory_movements
      (product_id, type, qty_before, qty_change, qty_after, actor, source, reference)
    values
      (r.product_id, 'ajuste', v_now, v_new - v_now, v_new, public._actor(), public._source(), v_ref);
    v_ajustados := v_ajustados + 1;
  end loop;

  update public.stock_counts set applied_at = now(), applied_by = public._actor() where id = p_count_id;
  return jsonb_build_object('ajustados', v_ajustados, 'sin_cambio', v_sin_cambio);
end $$;

-- Finalizar (ahora con opción de actualizar inventario). Se reemplaza la versión de 1 parámetro.
drop function if exists public.count_finalize(bigint);

create or replace function public.count_finalize(p_count_id bigint, p_apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_participants int; v_faltan text; v_out jsonb; v_ap jsonb;
begin
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
  end if;
  if p_apply then perform public._require_admin(); end if;

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

-- Actualizar el inventario DESPUÉS, desde el historial, con un conteo ya finalizado.
create or replace function public.count_apply_finalized(p_count_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'finalizado') then
    raise exception 'Solo se puede actualizar el inventario con un conteo finalizado';
  end if;
  if exists (select 1 from public.stock_counts where id = p_count_id and applied_at is not null) then
    raise exception 'Este conteo ya actualizó el inventario';
  end if;
  return public._count_apply_to_stock(p_count_id);
end $$;

-- Historial: ahora indica si ya actualizó el inventario.
drop function if exists public.count_history();

create or replace function public.count_history()
returns table (
  id bigint, name text, created_by text, created_at timestamptz,
  finished_at timestamptz, finished_by text, participants jsonb,
  items_count bigint, diff_count bigint, faltante numeric, sobrante numeric,
  applied_at timestamptz, applied_by text
) language sql stable security definer set search_path = public as $$
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
$$;

grant execute on function
  public.count_finalize(bigint, boolean),
  public.count_apply_finalized(bigint),
  public.count_history()
  to authenticated;

notify pgrst, 'reload schema';
