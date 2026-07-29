-- ============================================================================
-- Migración base de auth de plataforma (ADR-006) — Copuno app.copuno.com
-- Crea `perfiles` (espejo 1:1 de auth.users) y `accesos_modulo` (autorización
-- por módulo: sin fila = sin acceso). Idempotente: se puede re-ejecutar.
--
-- Aplicar en el proyecto "Partes de Obra" (org Grupo Copuno, eu-west-1,
-- ref cuwtneprjbvumfjycnmn) vía MCP `supabase-copuno` o SQL Editor.
-- OJO: existe otro MCP de Supabase apuntando a la cuenta personal de
-- NotionVan — no usarlo para Copuno.
-- ============================================================================

-- 1) Perfiles — una fila por usuario de auth.users, mantenida por trigger
create table if not exists public.perfiles (
	id        uuid primary key references auth.users (id) on delete cascade,
	email     text not null,
	nombre    text,
	creado_en timestamptz not null default now()
);

comment on table public.perfiles is
	'Espejo 1:1 de auth.users (ADR-006). Lo crean/actualizan los triggers de abajo — no insertar a mano.';

-- 2) Accesos por módulo — la clave `modulo` es la ruta de primer nivel (ADR-005)
create table if not exists public.accesos_modulo (
	usuario_id uuid not null references public.perfiles (id) on delete cascade,
	modulo     text not null
	           check (modulo in ('partes', 'vehiculos', 'almacen', 'empleado')),
	rol        text not null,
	creado_en  timestamptz not null default now(),
	primary key (usuario_id, modulo)
);

comment on table public.accesos_modulo is
	'Autorización por módulo (ADR-006): sin fila = sin acceso. Roles de partes: jefe_obra | oficina | admin; cada módulo nuevo define los suyos y se añade su clave al CHECK (un ALTER).';

-- 3) Trigger de alta: insert en auth.users → fila en perfiles
create or replace function public.handle_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into public.perfiles (id, email, nombre)
	values (new.id, new.email, new.raw_user_meta_data ->> 'nombre')
	on conflict (id) do nothing;
	return new;
end;
$$;

drop trigger if exists trg_nuevo_usuario on auth.users;
create trigger trg_nuevo_usuario
	after insert on auth.users
	for each row execute function public.handle_nuevo_usuario();

-- 4) Trigger de cambio de email: "Secure email change" está ON, el usuario puede
--    cambiarlo — y el cruce con Notion (Persona Autorizada) va por email, así que
--    el espejo no puede quedarse desactualizado.
create or replace function public.handle_email_actualizado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	update public.perfiles set email = new.email where id = new.id;
	return new;
end;
$$;

drop trigger if exists trg_email_actualizado on auth.users;
create trigger trg_email_actualizado
	after update of email on auth.users
	for each row execute function public.handle_email_actualizado();

-- 5) RLS: el usuario autenticado lee SOLO lo suyo (lo que el portal necesita
--    para pintar sus tarjetas). Nadie escribe desde el cliente: sin policies de
--    insert/update/delete, solo la service_role (que salta RLS) y el dashboard.
alter table public.perfiles enable row level security;
alter table public.accesos_modulo enable row level security;

drop policy if exists perfiles_select_propio on public.perfiles;
create policy perfiles_select_propio
	on public.perfiles for select
	to authenticated
	using ((select auth.uid()) = id);

drop policy if exists accesos_select_propios on public.accesos_modulo;
create policy accesos_select_propios
	on public.accesos_modulo for select
	to authenticated
	using ((select auth.uid()) = usuario_id);
