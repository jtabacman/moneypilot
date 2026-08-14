-- Lo que el motor propuso y una persona dijo que no.
--
-- ── Por qué esta tabla y no una de propuestas ───────────────────────────────
--
-- Las propuestas del clasificador NO se guardan, y es deliberado. Se recalculan
-- al abrir la pantalla porque una propuesta guardada caduca sola: el
-- diccionario cambia en cada despliegue, la memoria del hogar cambia cada vez
-- que alguien confirma algo, y una regla nueva pisa a las cuatro capas de
-- abajo. Una tabla de propuestas empieza a mentir el día dos y necesita una
-- invalidación que es más código que la pasada entera. Medido sobre la base
-- local: 566 movimientos sin categorizar se recalculan en 75-140 ms con cinco
-- consultas, y /reglas ya hace exactamente eso en cada carga.
--
-- Lo que sí hay que guardar es el rechazo, porque **no es derivable de nada**.
-- Si no se guarda, la misma propuesta que alguien descartó ayer vuelve a
-- aparecer hoy, y una cola que reaparece deja de mirarse en una semana.
--
-- ── La clave es (asiento, categoría), y eso es una decisión de producto ─────
--
-- Se rechaza «este movimiento no va a esta categoría», no «no me preguntes más
-- por este movimiento». Si el motor cambia de opinión —porque el diccionario
-- aprendió el comercio, o porque la memoria del hogar ya sabe otra cosa— y
-- propone una categoría distinta, se vuelve a ofrecer. Que es lo correcto: el
-- rechazo era sobre una respuesta concreta, no sobre la pregunta.
--
-- `procedencia` y `motivo` se guardan aunque nadie los consulte todavía. Son la
-- única forma de contestar más adelante «qué capa se equivoca más», que es la
-- medición que decide si el diccionario crece o si hay que quitarle una capa.

create table propuesta_rechazada (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  entry_id uuid not null references entry(id) on delete cascade,
  category_id uuid not null references account(id) on delete cascade,
  procedencia classification_source,
  motivo text,
  rechazado_por text not null,
  rechazado_at timestamptz not null default now(),
  constraint propuesta_rechazada_unica unique (entry_id, category_id)
);

-- El filtro de la pantalla es «las propuestas de este hogar que no estén
-- rechazadas», así que la consulta entra por tenant y sale por entry.
create index propuesta_rechazada_por_hogar on propuesta_rechazada (tenant_id, entry_id);

-- ── Aislamiento ────────────────────────────────────────────────────────────
--
-- El bucle de la 002 recorre una lista fija y no alcanza a las tablas que se
-- crean después. Se engancha a mano, igual que hizo la 008.

alter table propuesta_rechazada enable row level security;
alter table propuesta_rechazada force row level security;
create policy tenant_isolation on propuesta_rechazada
  using (tenant_id = app_current_tenant())
  with check (tenant_id = app_current_tenant());

grant select, insert, update, delete on propuesta_rechazada to moneypilot_app;

-- ── De paso, el índice que a `review_item` le faltaba ───────────────────────
--
-- Hay dos `exists` correlacionados contra `review_item.entry_id` —el listado de
-- movimientos y la vista previa de reglas— y esa columna no tenía índice. Hoy
-- no cuesta nada porque la tabla tiene cuatro filas; con una cola de verdad,
-- cada listado de movimientos haría un recorrido secuencial por fila mostrada.
create index review_item_por_asiento on review_item (entry_id)
  where state = 'pendiente';
