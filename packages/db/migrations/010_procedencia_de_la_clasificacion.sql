-- ═══════════════════════════════════════════════════════════════════════════
-- De dónde salió una clasificación automática, y por qué.
--
-- La 006 dejó `classification_change` contestando quién, cuándo y con qué
-- regla. Con una sola capa automática —las reglas— eso alcanzaba: `rule_id`
-- distinto de null era «lo hizo una regla» y null era «lo hizo una persona».
--
-- Ahora hay cinco capas (regla, memoria, señal, proveedor, diccionario) y sólo
-- una de ellas tiene una fila en `rule` a la que apuntar. Sin estas dos
-- columnas, cuatro de las cinco quedarían registradas exactamente igual que una
-- decisión humana, y las dos preguntas que sostienen todo el módulo dejarían de
-- tener respuesta:
--
--  · «¿por qué esta categoría?» — el usuario mira un gasto en «Supermercado»
--    que él no puso y no hay nada en la base que diga de dónde salió;
--  · «deshacé lo que puso el diccionario» — no habría forma de seleccionar esa
--    capa sin arrastrar también lo que decidió una persona.
--
-- Y hay una tercera, que es la que de verdad obliga: `memoria.ts` aprende de lo
-- que el hogar decidió a mano y **excluye** lo automático. Hoy lo distingue por
-- el prefijo `sistema:` en `changed_by`, que es texto libre. Un automatismo que
-- se olvide de firmar así se cuela en la memoria y el motor empieza a aprender
-- de sí mismo. Una columna tipada no se olvida.
--
-- ── Por qué también se guarda el motivo, ya escrito ─────────────────────────
--
-- Podría reconstruirse: mirar la procedencia, buscar la regla, recontar la
-- memoria. Pero se reconstruiría **con los datos de hoy**, y la pregunta es por
-- qué se clasificó así *entonces*. La regla se puede haber borrado, el hogar
-- puede haber cambiado de opinión tres veces desde entonces, y el diccionario
-- se actualiza con cada despliegue. Una explicación que cambia sola no es una
-- auditoría, es una conjetura recalculada.
--
-- Es el mismo criterio que ya rige en `import_batch.report`: se guarda el
-- informe tal como se le mostró al cliente, no los ingredientes para volver a
-- fabricarlo.
-- ═══════════════════════════════════════════════════════════════════════════

-- Las cinco capas del motor, en el orden en que mandan. 'persona' NO está en la
-- lista a propósito: se representa con null, que es lo que ya hay en las filas
-- escritas antes de esta migración. Un valor 'persona' obligaría a rellenar el
-- pasado con una afirmación que no se puede comprobar — de esas filas sabemos
-- que no las escribió una regla, no que las escribiera una persona.
create type classification_source as enum (
  'regla',       -- lo que el usuario escribió
  'memoria',     -- lo que el usuario hizo antes
  'senal',       -- lo que dice la estructura del movimiento
  'proveedor',   -- la taxonomía del agregador, traducida
  'diccionario'  -- el diccionario de comercios del producto
);

alter table classification_change
  add column procedencia classification_source,
  -- La frase que se le enseña al usuario, congelada en el momento del cambio.
  -- Sin límite de longitud porque `text` en Postgres no cuesta más que
  -- `varchar(n)` y un tope arbitrario sólo produce el día en que un motivo
  -- legítimo se corta a la mitad.
  add column motivo text;

-- Deshacer una capa entera y contar el reparto por capa son las dos consultas
-- que esta migración existe para permitir, y las dos filtran por procedencia
-- dentro de un hogar. El índice es parcial porque lo humano —que es null— no se
-- consulta nunca por esta columna y es la mayor parte de la tabla en un hogar
-- que lleva tiempo clasificando a mano.
create index classification_change_by_procedencia
  on classification_change (tenant_id, procedencia, changed_at desc)
  where procedencia is not null;
