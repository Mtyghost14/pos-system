-- ============================================================================
-- 008_conteo_realtime.sql — el conteo de inventario se refresca solo en todos
-- los dispositivos conectados.
--
-- El conteo YA soportaba que varias personas capturen al mismo tiempo desde
-- distintos teléfonos (count_open siempre reusa el único conteo "abierto";
-- count_add suma la cantidad de forma atómica en la base de datos, código por
-- código). Lo único que faltaba: si una persona capturaba algo, la lista y los
-- totales de la OTRA persona no se actualizaban solos. Este script agrega
-- stock_counts / stock_count_items a la publicación de Realtime para que sí.
-- Idempotente. Pegar en el SQL Editor de Supabase.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['stock_counts','stock_count_items'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
