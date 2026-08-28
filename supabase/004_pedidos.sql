-- ============================================================================
-- 004_pedidos.sql — Calendario de pedidos de globos (agenda)
-- Lo usan TODOS los usuarios del portal (admin y cajero). Pegar en SQL Editor.
-- Idempotente. Ver: pos-system-vault/kaddo-sync-architecture.md
-- ============================================================================

-- Catálogo de globos/paquetes (precios fijos, aparte del inventario del POS).
create table if not exists public.order_catalog (
  id       bigint generated always as identity primary key,
  categoria text not null default 'Individual',   -- Individual | Paquete | Temporada | ...
  nombre    text not null,
  precio    numeric(12,2) not null default 0,
  activo    boolean not null default true,
  orden     int not null default 0
);

-- Pedidos (una fila por arreglo / cita).
create table if not exists public.balloon_orders (
  id          bigint generated always as identity primary key,
  telefono    text,
  cliente     text not null,
  fecha_hora  timestamptz not null,
  pedido      text,          -- resumen / texto libre
  colores     text,
  tecnica     text,
  texto       text,          -- el texto que lleva el globo
  total       numeric(12,2) not null default 0,
  anticipo    numeric(12,2) not null default 0,
  pendiente   numeric(12,2) generated always as (total - anticipo) stored,
  estado      text not null default 'pendiente'
              check (estado in ('pendiente','en_proceso','listo','entregado','cancelado')),
  notas       text,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create index if not exists balloon_orders_fecha_idx  on public.balloon_orders (fecha_hora);
create index if not exists balloon_orders_estado_idx on public.balloon_orders (estado);

create table if not exists public.balloon_order_items (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.balloon_orders(id) on delete cascade,
  descripcion text not null,
  cantidad    numeric(12,3) not null default 1,
  precio_unit numeric(12,2) not null default 0,
  catalog_id  bigint references public.order_catalog(id) on delete set null
);
create index if not exists balloon_order_items_order_idx on public.balloon_order_items (order_id);

-- ─── RPCs (escritura; stampan el usuario; SIN _require_admin: es para todos) ──

-- Guardar (alta o edición) un pedido con sus renglones. p = {id?, telefono, cliente,
-- fecha_hora, pedido, colores, tecnica, texto, total, anticipo, estado, notas,
-- items:[{descripcion, cantidad, precio_unit, catalog_id?}]}
create or replace function public.order_save(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; it jsonb;
begin
  if coalesce(trim(p->>'cliente'),'') = '' then raise exception 'Falta el nombre del cliente'; end if;
  if p->>'fecha_hora' is null then raise exception 'Falta la fecha y hora'; end if;

  if (p->>'id') is null then
    insert into public.balloon_orders
      (telefono, cliente, fecha_hora, pedido, colores, tecnica, texto, total, anticipo, estado, notas, created_by, updated_by)
    values
      (p->>'telefono', p->>'cliente', (p->>'fecha_hora')::timestamptz, p->>'pedido', p->>'colores',
       p->>'tecnica', p->>'texto', coalesce((p->>'total')::numeric,0), coalesce((p->>'anticipo')::numeric,0),
       coalesce(p->>'estado','pendiente'), p->>'notas', public._actor(), public._actor())
    returning id into v_id;
  else
    v_id := (p->>'id')::bigint;
    update public.balloon_orders set
      telefono = p->>'telefono', cliente = p->>'cliente', fecha_hora = (p->>'fecha_hora')::timestamptz,
      pedido = p->>'pedido', colores = p->>'colores', tecnica = p->>'tecnica', texto = p->>'texto',
      total = coalesce((p->>'total')::numeric,0), anticipo = coalesce((p->>'anticipo')::numeric,0),
      estado = coalesce(p->>'estado','pendiente'), notas = p->>'notas',
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
  update public.balloon_orders
    set estado = p_estado, updated_by = public._actor(), updated_at = now()
  where id = p_id;
end $$;

create or replace function public.order_delete(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.balloon_orders where id = p_id;
end $$;

-- ─── Seed del catálogo (solo si está vacío) ─────────────────────────────────
insert into public.order_catalog (categoria, nombre, precio, orden)
select * from (values
  ('Individual', 'Burbuja 18" (pintura/papelitos, 2 motitas)', 420, 1),
  ('Individual', 'Burbuja 24" (pintura/papelitos, 4 motitas)', 560, 2),
  ('Individual', 'Esfera 15" impresa',                          320, 3),
  ('Individual', 'Esfera 15" lisa/personalizada',               380, 4),
  ('Individual', 'Globo metálico (estrella/corazón/impreso)',    95, 5),
  ('Individual', 'Globo látex',                                   45, 6),
  ('Individual', 'Globo chrome',                                  55, 7),
  ('Individual', 'Globo número (dorado/plata/rose gold)',        290, 8),
  ('Paquete',    'Paquete Burbuja 18"',                          620, 20),
  ('Paquete',    'Paquete Burbuja 24"',                          760, 21),
  ('Paquete',    'Paquete Burbuja 36"',                          980, 22)
) as v(categoria, nombre, precio, orden)
where not exists (select 1 from public.order_catalog);

-- ─── RLS + permisos ────────────────────────────────────────────────────────
alter table public.order_catalog        enable row level security;
alter table public.balloon_orders       enable row level security;
alter table public.balloon_order_items  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['order_catalog','balloon_orders','balloon_order_items'] loop
    execute format('drop policy if exists sel_auth on public.%I', t);
    execute format('create policy sel_auth on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

grant select on public.order_catalog, public.balloon_orders, public.balloon_order_items to authenticated;
grant execute on function
  public.order_save(jsonb),
  public.order_set_estado(bigint, text),
  public.order_delete(bigint)
  to authenticated;

do $$
begin alter publication supabase_realtime add table public.balloon_orders;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
