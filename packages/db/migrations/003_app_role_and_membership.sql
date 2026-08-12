-- ═══════════════════════════════════════════════════════════════════════════
-- Dos cosas que hacen falta para que la aplicación real funcione con RLS:
-- el cambio de rol por transacción, y el vínculo entre usuarios y hogares.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Que la aplicación pueda degradarse a un rol sin privilegios ─────────
--
-- El problema: en Supabase la cadena de conexión entra como `postgres`, que es
-- dueño de las tablas y tiene BYPASSRLS. Conectando así, las policies de
-- aislamiento no se aplican **y no hay ningún error**: simplemente cada hogar
-- vería el dinero de los demás.
--
-- La solución sin una segunda credencial: `set local role` dentro de la
-- transacción. El rol efectivo pasa a ser moneypilot_app —que no es dueño ni
-- tiene BYPASSRLS— así que RLS sí aplica, y al terminar la transacción el rol
-- vuelve solo. Es el mismo mecanismo de alcance que ya usa app.tenant_id, y
-- por la misma razón: lo que dura más que la transacción se filtra al
-- reciclarse la conexión del pool.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'moneypilot_app') then
    create role moneypilot_app nologin noinherit;
  end if;
end
$$;

-- `set local role X` exige que el rol de conexión sea miembro de X.
do $$
begin
  execute format('grant moneypilot_app to %I', current_user);
exception
  when others then
    -- Ya es miembro, o el proveedor no lo permite. La comprobación en
    -- tiempo de ejecución lo detecta y se niega a servir.
    null;
end
$$;

-- En Supabase las tablas las crea `postgres`, no nosotros: hay que repetir
-- los grants para lo que se creó después de la migración 002.
grant usage on schema public to moneypilot_app;
grant select, insert, update, delete on all tables in schema public to moneypilot_app;
grant usage, select on all sequences in schema public to moneypilot_app;
revoke insert, update, delete on fx_rate from moneypilot_app;
grant select on fx_rate to moneypilot_app;

-- ── 2. Quién puede ver qué hogar ──────────────────────────────────────────
--
-- El identificador del usuario viene de Supabase Auth (auth.users.id). No se
-- declara una clave foránea contra ese esquema a propósito: acopla nuestras
-- migraciones al proveedor de identidad y hace imposible migrar a otro o
-- correr los tests sin él.

create type household_role as enum (
  'titular',     -- dueño de la cuenta; puede todo
  'pareja',      -- co-titular
  'contador',    -- entidades asignadas, categorías sensibles excluidas
  'asistente',   -- dimensiones asignadas, saldos ocultos
  'asesor'       -- sólo patrimonio agregado
);

create table membership (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  -- auth.users.id de Supabase.
  user_id      uuid not null,
  role         household_role not null,
  email        text,
  -- Todo acceso externo caduca. El contador a 90 días, el asesor a 30.
  -- Un acceso sin fecha de fin es un acceso que nadie revoca nunca.
  expires_at   timestamptz,
  invited_by   uuid,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,

  constraint membership_unique unique (tenant_id, user_id)
);

create index membership_by_user on membership (user_id) where revoked_at is null;

grant select, insert, update, delete on membership to moneypilot_app;

-- membership es la tabla que decide el aislamiento, así que su propia policy
-- no puede depender de app.tenant_id: se resolvería en círculo. Se filtra por
-- el usuario, que es un dato que la aplicación no elige.
alter table membership enable row level security;
alter table membership force row level security;

create policy membership_own on membership
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

-- ── 3. Alta de un hogar ───────────────────────────────────────────────────
--
-- Crear el tenant, la membresía del titular y las cuentas de sistema en una
-- sola operación atómica. Si esto quedara repartido en tres llamadas desde la
-- aplicación, un fallo intermedio dejaría un usuario sin hogar o un hogar sin
-- dueño, y el arreglo es manual.
--
-- SECURITY DEFINER porque crea el primer tenant, que por definición ocurre
-- antes de que exista un tenant al que pertenecer.

create or replace function provision_household(
  p_user_id       uuid,
  p_email         text,
  p_name          text,
  p_base_currency char(3)
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  if p_user_id is null then
    raise exception 'provision_household necesita un user_id';
  end if;

  -- Idempotente: si el usuario ya tiene hogar, se devuelve ese. Un doble
  -- click en "crear cuenta" no puede dejar a alguien con dos hogares vacíos.
  select m.tenant_id into v_tenant_id
    from membership m
   where m.user_id = p_user_id and m.revoked_at is null
   limit 1;
  if v_tenant_id is not null then
    return v_tenant_id;
  end if;

  insert into tenant (name, base_currency)
       values (coalesce(nullif(p_name, ''), 'Mi hogar'), coalesce(p_base_currency, 'EUR'))
    returning id into v_tenant_id;

  insert into membership (tenant_id, user_id, role, email)
       values (v_tenant_id, p_user_id, 'titular', p_email);

  -- Cuentas de sistema. La de apertura absorbe la diferencia cuando se
  -- importa un recorte de historia: sin ella, los saldos no cuadran nunca.
  insert into account (tenant_id, kind, name, currency)
       values (v_tenant_id, 'equity', 'Saldo de apertura', coalesce(p_base_currency, 'EUR'));

  return v_tenant_id;
end
$$;

revoke all on function provision_household(uuid, text, text, char) from public;
grant execute on function provision_household(uuid, text, text, char) to moneypilot_app;
