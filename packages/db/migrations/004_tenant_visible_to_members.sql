-- ═══════════════════════════════════════════════════════════════════════════
-- Un hogar es visible para quien pertenece a él.
--
-- Hasta ahora `tenant` sólo se podía leer con `app.tenant_id` fijado. Eso deja
-- fuera el momento anterior a todo: alguien acaba de autenticarse y hay que
-- averiguar a qué hogar entra. Sin esta policy, la consulta de pertenencia
-- devuelve cero filas para un usuario que sí tiene hogar, y el código de
-- arriba lo interpreta como "hay que crear uno". `provision_household` es
-- idempotente, así que no duplica nada — pero devuelve el nombre por defecto
-- en vez del real. Un fallo que no rompe nada y miente en la pantalla.
--
-- La policy también es el cimiento del cambio de hogar: un contador pertenece
-- a varios y tiene que poder listarlos antes de elegir uno. Lo mismo una
-- pareja con un hogar personal y una sociedad patrimonial.
--
-- Las policies permisivas se combinan con OR, así que esto AMPLÍA la
-- visibilidad, no la sustituye: `tenant_isolation` sigue mandando cuando hay
-- un hogar fijado.
-- ═══════════════════════════════════════════════════════════════════════════

create policy tenant_by_membership on tenant
  for select
  using (
    exists (
      select 1
        from membership m
       where m.tenant_id = tenant.id
         and m.user_id   = nullif(current_setting('app.user_id', true), '')::uuid
         and m.revoked_at is null
         and (m.expires_at is null or m.expires_at > now())
    )
  );

-- Sólo `for select`. Pertenecer a un hogar no autoriza a renombrarlo ni a
-- borrarlo: eso sigue exigiendo el alcance completo, y más adelante, el rol.
