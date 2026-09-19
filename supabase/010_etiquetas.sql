-- ============================================================================
-- 010_etiquetas.sql — listas de etiquetas enviadas desde el portal al POS
--
-- Flujo: en el portal (Recibir mercancía) se revisa el Excel y, ANTES de
-- confirmar, se puede "Enviar a etiquetas del POS". Eso crea una lista
-- pendiente (código, nombre, precio, cantidad). En el POS, página Etiquetas,
-- aparece un aviso con la lista: se elige el tamaño y se imprime todo, o se
-- carga a la lista de etiquetas para ajustarla.
--
-- La lista guarda una FOTO (código/nombre/precio/cantidad), no ids de producto:
-- así funciona igual aunque el producto aún no exista (se da de alta al confirmar).
-- Idempotente. Pegar completo en el SQL Editor de Supabase.
-- ============================================================================

create table if not exists public.label_lists (
  id         bigint generated always as identity primary key,
  source     text,                                   -- nombre del archivo de origen
  status     text not null default 'pendiente'
             check (status in ('pendiente','impresa','cargada','descartada')),
  created_by text not null,
  created_at timestamptz not null default now(),
  closed_by  text,
  closed_at  timestamptz
);
create index if not exists label_lists_status_idx on public.label_lists (status, id);

create table if not exists public.label_list_items (
  id      bigint generated always as identity primary key,
  list_id bigint not null references public.label_lists(id) on delete cascade,
  code    text not null,
  name    text not null,
  price   numeric(12,2) not null default 0,
  qty     integer not null check (qty > 0)
);
create index if not exists label_list_items_list_idx on public.label_list_items (list_id);

-- Crea una lista pendiente. p_items = [{code, name, price, qty}, ...]
create or replace function public.label_list_create(p_source text, p_items jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public._require_admin();
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La lista de etiquetas está vacía';
  end if;

  insert into public.label_lists (source, created_by)
  values (nullif(trim(p_source), ''), public._actor())
  returning id into v_id;

  insert into public.label_list_items (list_id, code, name, price, qty)
  select v_id,
         trim(e->>'code'),
         coalesce(nullif(trim(e->>'name'), ''), trim(e->>'code')),
         coalesce((e->>'price')::numeric, 0),
         greatest(1, ceil(coalesce((e->>'qty')::numeric, 1)))::int
  from jsonb_array_elements(p_items) e
  where nullif(trim(e->>'code'), '') is not null;

  if not exists (select 1 from public.label_list_items where list_id = v_id) then
    raise exception 'La lista de etiquetas está vacía';   -- deshace todo
  end if;

  return v_id;
end $$;

-- Cierra una lista pendiente: 'impresa' | 'cargada' (se pasó a la lista del POS) | 'descartada'.
create or replace function public.label_list_set_status(p_id bigint, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_status not in ('impresa','cargada','descartada') then
    raise exception 'Estado inválido: %', p_status;
  end if;
  update public.label_lists
    set status = p_status, closed_by = public._actor(), closed_at = now()
    where id = p_id and status = 'pendiente';
end $$;

-- ─── RLS + permisos (solo lectura directa; escritura por RPC) ───────────────
alter table public.label_lists      enable row level security;
alter table public.label_list_items enable row level security;

drop policy if exists sel_auth on public.label_lists;
create policy sel_auth on public.label_lists for select to authenticated using (true);
drop policy if exists sel_auth on public.label_list_items;
create policy sel_auth on public.label_list_items for select to authenticated using (true);

grant select on public.label_lists, public.label_list_items to authenticated;
grant execute on function
  public.label_list_create(text, jsonb),
  public.label_list_set_status(bigint, text)
  to authenticated;

notify pgrst, 'reload schema';
