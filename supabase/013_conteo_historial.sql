-- ============================================================================
-- 013_conteo_historial.sql — El conteo YA NO corrige el inventario.
--
-- El conteo es una medida de control: compara lo contado contra lo que decía el
-- sistema. Al FINALIZAR (todos los participantes deben confirmar) queda guardado
-- en el historial con una FOTO de lo que decía el sistema en ese momento
-- (inventario, costo y categoría), para poder ver las diferencias después aunque
-- el inventario cambie, y para exportarlas a Excel.
--
--   · count_finalize(id)  → valida participantes, guarda la foto, status='finalizado'.
--                           NO toca products ni inventory_movements.
--   · count_history()     → lista de conteos finalizados con sus totales.
--   · count_apply         → deshabilitado (ya no se corrige inventario desde el conteo).
--
-- Idempotente. Pegar completo en el SQL Editor de Supabase.
-- ============================================================================

alter table public.stock_counts add column if not exists finished_at timestamptz;
alter table public.stock_counts add column if not exists finished_by text;

alter table public.stock_counts drop constraint if exists stock_counts_status_check;
alter table public.stock_counts add constraint stock_counts_status_check
  check (status in ('abierto','aplicado','finalizado','cancelado'));

-- Foto al finalizar
alter table public.stock_count_items add column if not exists system_qty    numeric(12,3);
alter table public.stock_count_items add column if not exists unit_cost     numeric(12,2);
alter table public.stock_count_items add column if not exists category_name text;

-- ─── Finalizar: guarda el conteo en el historial (sin modificar inventario) ─
create or replace function public.count_finalize(p_count_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_participants int; v_faltan text; v_out jsonb;
begin
  if not exists (select 1 from public.stock_counts where id = p_count_id and status = 'abierto') then
    raise exception 'El conteo ya no está abierto';
  end if;

  -- Si participan 2 o más personas, TODAS deben haber marcado "terminé".
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

  -- Foto de lo que decía el sistema en este momento
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
  return v_out;
end $$;

-- ─── El conteo ya no corrige el inventario ──────────────────────────────────
create or replace function public.count_apply(p_count_id bigint, p_zero_uncounted boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'El conteo ya no corrige el inventario. Usa count_finalize para guardarlo en el historial.';
end $$;

-- ─── Historial de conteos finalizados ───────────────────────────────────────
create or replace function public.count_history()
returns table (
  id bigint, name text, created_by text, created_at timestamptz,
  finished_at timestamptz, finished_by text, participants jsonb,
  items_count bigint, diff_count bigint, faltante numeric, sobrante numeric
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
               where i.count_id = c.id and i.counted_qty > i.system_qty), 0)
  from public.stock_counts c
  where c.status = 'finalizado'
  order by c.finished_at desc nulls last, c.id desc;
$$;

grant execute on function
  public.count_finalize(bigint),
  public.count_apply(bigint, boolean),
  public.count_history()
  to authenticated;

notify pgrst, 'reload schema';
