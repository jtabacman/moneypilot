-- ═══════════════════════════════════════════════════════════════════════════
-- Quien pertenece a un hogar puede ver quién más pertenece a ese hogar.
--
-- Hasta ahora `membership` sólo tenía la policy `membership_own`, que filtra
-- por `app.user_id`. Es correcta y necesaria —es la tabla que decide el
-- aislamiento, así que no puede depender de `app.tenant_id` sin resolverse en
-- círculo— pero deja la pantalla de accesos sin poder hacer su trabajo: el
-- titular ve una sola fila, la suya, y no puede saber a quién le dio acceso.
--
-- El problema de escribir la policy que falta es la recursión. La expresión
-- natural sería «puedo ver una membresía si existe otra membresía mía en ese
-- hogar», y ese `exists` sobre la propia tabla vuelve a evaluar la policy, que
-- vuelve a consultar la tabla: Postgres corta con «infinite recursion detected
-- in policy for relation membership».
--
-- La salida es una función SECURITY DEFINER que resuelve la lista de hogares
-- de la persona **por encima de RLS**. Al no pasar por la policy, no hay
-- recursión. Es la técnica estándar para este caso, y el riesgo de una función
-- así —que devuelva de más— se acota dejándola sin parámetros: no recibe nada
-- del llamante, lee `app.user_id`, y no hay forma de pedirle los hogares de
-- otro.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app_my_tenants() returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(m.tenant_id), '{}'::uuid[])
    from membership m
   where m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
     and m.revoked_at is null
     and (m.expires_at is null or m.expires_at > now())
$$;

-- `stable` y no `volatile`: se llama una vez por consulta en vez de una vez
-- por fila. Sin esto, listar veinte membresías serían veinte ejecuciones de la
-- función, y las policies dejarían de poder usar índices.

revoke all on function app_my_tenants() from public;
grant execute on function app_my_tenants() to moneypilot_app;

-- Las policies permisivas se combinan con OR, así que esto AMPLÍA lo que
-- `membership_own` ya deja ver: tu propia fila la seguís viendo aunque tu
-- acceso haya caducado — y eso importa, porque es lo que permite decirte
-- «tu acceso caducó» en vez de tratarte como a un desconocido.
-- La condición del hogar en contexto NO sobra, aunque lo parezca.
--
-- Las policies permisivas se combinan con OR, así que la más amplia manda: una
-- policy que sólo dijera «los hogares a los que pertenezco» dejaría ver una
-- membresía del hogar B estando dentro del alcance del hogar A, y volvería a
-- abrir justo lo que `membership_own` cierra. Un test lo destapó.
--
-- Regla general que conviene recordar: en una tabla con alcance de hogar, toda
-- policy tiene que respetar el hogar en contexto. No alcanza con que lo haga
-- alguna.
create policy membership_roster on membership
  for select
  using (
    tenant_id = any (app_my_tenants())
    and (app_current_tenant() is null or tenant_id = app_current_tenant())
  );

-- Sólo lectura. Pertenecer a un hogar no autoriza a invitar ni a revocar: eso
-- lo decide la aplicación por rol, y más adelante una policy propia.

-- ── Y de paso, un cabo suelto de `membership_own` ──────────────────────────
--
-- Filtraba sólo por persona, sin mirar el hogar. Con eso, una consulta hecha
-- **dentro** del alcance del hogar A devolvía también la membresía propia en
-- el hogar B. No expone datos de nadie más —es tu propia fila— pero es un
-- cabo suelto de los que terminan en un contador equivocado: quien escribe
-- `select count(*) from membership` estando en un hogar espera el de ese
-- hogar. Un test lo destapó.
--
-- No se puede simplemente añadir el filtro por hogar, porque hay un momento
-- legítimo en que todavía no hay hogar fijado: el de averiguar a cuál entrar,
-- justo después de autenticarse. De ahí la condición doble — sin hogar en
-- contexto, se ven todas las propias; con hogar, sólo la de ese hogar.
drop policy membership_own on membership;

create policy membership_own on membership
  using (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    and (app_current_tenant() is null or tenant_id = app_current_tenant())
  );
