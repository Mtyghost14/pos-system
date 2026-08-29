-- ============================================================================
-- 005_aprobacion.sql — Flujo de aprobación por anticipo en los pedidos.
-- Pegar en el SQL Editor. Idempotente.
-- ============================================================================

-- Estados: por_aprobar (inicial) -> aprobado -> en_proceso -> listo -> entregado (+ cancelado)
alter table public.balloon_orders drop constraint if exists balloon_orders_estado_check;
update public.balloon_orders set estado = 'por_aprobar' where estado = 'pendiente';
alter table public.balloon_orders
  add constraint balloon_orders_estado_check
  check (estado in ('por_aprobar','aprobado','en_proceso','listo','entregado','cancelado'));
alter table public.balloon_orders alter column estado set default 'por_aprobar';

-- Ajustes del portal (clave/valor). Ej: datos_pago para el mensaje de WhatsApp.
create table if not exists public.app_settings (
  key   text primary key,
  value text not null default ''
);
insert into public.app_settings (key, value) values ('datos_pago', '')
  on conflict (key) do nothing;

create or replace function public.set_app_setting(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','terminal')) then
    raise exception 'Solo un administrador puede cambiar los ajustes' using errcode = 'P0001';
  end if;
  insert into public.app_settings (key, value) values (p_key, coalesce(p_value,''))
    on conflict (key) do update set value = excluded.value;
end $$;

alter table public.app_settings enable row level security;
drop policy if exists sel_auth on public.app_settings;
create policy sel_auth on public.app_settings for select to authenticated using (true);
grant select on public.app_settings to authenticated;
grant execute on function public.set_app_setting(text, text) to authenticated;

notify pgrst, 'reload schema';
