-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security desde la primera versión.
--
-- Por qué acá y no más adelante: retrofitear aislamiento multi-tenant sobre
-- datos que ya existen exige auditar cada consulta escrita hasta ese momento.
-- Y el modo de fallo es el peor posible — un usuario viendo el dinero de otro.
--
-- La diferencia con filtrar en la aplicación: acá, un bug que se olvide el
-- `where tenant_id = ...` NO filtra datos, porque Postgres agrega el filtro
-- por su cuenta. La aplicación deja de ser el único guardián.
--
-- Dos detalles que hacen que esto funcione de verdad:
--
--  1. `force row level security`. Sin eso, el DUEÑO de la tabla queda exento
--     de sus propias policies, y como las migraciones corren con ese rol, el
--     aislamiento sería una ilusión en cuanto la app se conectara con él.
--
--  2. Un rol de aplicación que NO es superusuario. Postgres ignora RLS para
--     superusuarios, sin avisar.
--
-- Límite conocido: RLS aísla filas, no CPU ni caché. Un tenant con una
-- consulta pesada puede degradar a los demás, así que hace falta además
-- statement_timeout y concurrencia acotada por tenant.
-- ═══════════════════════════════════════════════════════════════════════════

-- Rol de aplicación. NOLOGIN acá: la contraseña se asigna fuera de la
-- migración para no dejarla escrita en el repositorio.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'moneypilot_app') then
    create role moneypilot_app nologin noinherit;
  end if;
end
$$;

grant usage on schema public to moneypilot_app;
grant select, insert, update, delete on all tables in schema public to moneypilot_app;
grant usage, select on all sequences in schema public to moneypilot_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to moneypilot_app;
alter default privileges in schema public
  grant usage, select on sequences to moneypilot_app;

-- El hogar activo viaja en una variable de sesión que la aplicación fija al
-- tomar la conexión del pool. `true` en current_setting evita el error cuando
-- todavía no se fijó: en ese caso no se ve absolutamente nada, que es el
-- comportamiento seguro por defecto.
create or replace function app_current_tenant() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

do $$
declare
  target text;
begin
  foreach target in array array[
    'tenant', 'account', 'dimension', 'dimension_value', 'import_batch',
    'entry', 'posting', 'posting_dimension', 'review_item', 'declared_balance'
  ]
  loop
    execute format('alter table %I enable row level security', target);
    execute format('alter table %I force row level security', target);
  end loop;
end
$$;

-- tenant se filtra por su propia clave primaria; el resto, por tenant_id.
create policy tenant_isolation on tenant
  using (id = app_current_tenant())
  with check (id = app_current_tenant());

do $$
declare
  target text;
begin
  foreach target in array array[
    'account', 'dimension', 'dimension_value', 'import_batch',
    'entry', 'posting', 'posting_dimension', 'review_item', 'declared_balance'
  ]
  loop
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_current_tenant())
         with check (tenant_id = app_current_tenant())',
      target
    );
  end loop;
end
$$;

-- fx_rate es dato público de mercado, no de ningún hogar: sin RLS, y de sólo
-- lectura para la aplicación. Que un tenant no pueda escribir tipos de cambio
-- evita que una importación corrompa la conversión de todos los demás.
revoke insert, update, delete on fx_rate from moneypilot_app;
grant select on fx_rate to moneypilot_app;
