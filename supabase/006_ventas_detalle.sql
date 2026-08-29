-- ============================================================================
-- 006_ventas_detalle.sql — Detalle de pago en el espejo de ventas.
-- Agrega recibido/cambio/desglose mixto a sales_mirror y actualiza
-- commit_pos_sale para guardarlos. Pegar en el SQL Editor. Idempotente.
-- (Las ventas anteriores no tendrán estos datos; las nuevas sí, tras
--  actualizar el POS a la versión que los envía.)
-- ============================================================================

alter table public.sales_mirror add column if not exists received_amount numeric(12,2);
alter table public.sales_mirror add column if not exists change_amount   numeric(12,2);
alter table public.sales_mirror add column if not exists payment_details jsonb;

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

    insert into public.sale_items_mirror (folio, product_code, product_name, quantity, unit_price, discount)
    values (v_folio, it->>'code', it->>'name', (it->>'qty')::numeric,
            (it->>'unit_price')::numeric, coalesce((it->>'discount')::numeric,0));
  end loop;
end $$;

notify pgrst, 'reload schema';
