-- ═══════════════════════════════════════════════════════════════════════════
-- Índices que faltaban para las claves foráneas.
--
-- Postgres crea un índice para una PRIMARY KEY y para un UNIQUE, pero **no
-- para una FOREIGN KEY**. Cada vez que se borra una fila referenciada, el
-- disparador de integridad tiene que comprobar que nadie la apunta, y sin
-- índice esa comprobación es un recorrido secuencial de la tabla hija — una
-- vez por fila borrada.
--
-- No es teórico: borrar el hogar de ejemplo (unas 800 filas) se pasaba del
-- statement_timeout de 15 segundos. Medido con EXPLAIN (ANALYZE), el
-- disparador de `posting.account_id` recorría `posting` entera por cada cuenta
-- eliminada.
--
-- Ojo con `posting_by_account`: existe, pero es (tenant_id, account_id,
-- entry_id). La columna que la FK necesita buscar es la segunda, y un índice
-- compuesto sólo sirve para búsquedas que empiezan por su primera columna. Un
-- índice que existe pero no se puede usar es peor que ninguno, porque induce a
-- pensar que el caso está cubierto.
-- ═══════════════════════════════════════════════════════════════════════════

-- El caro. account_id es la segunda columna de posting_by_account, así que la
-- comprobación de la FK no podía usarlo.
create index if not exists posting_by_account_only on posting (account_id);

-- Jerarquía de cuentas: parent_id es on delete restrict, y comprobarlo exige
-- buscar hijos.
create index if not exists account_by_parent on account (parent_id)
  where parent_id is not null;

-- Anulación de asientos: mismo caso.
create index if not exists entry_by_reversed on entry (reversed_by)
  where reversed_by is not null;

-- Estos dos son baratos hoy porque las tablas son chicas, pero crecen con cada
-- importación y el coste aparece justo cuando ya hay datos de un cliente.
create index if not exists review_by_batch on review_item (import_batch_id)
  where import_batch_id is not null;
create index if not exists declared_balance_by_batch on declared_balance (import_batch_id)
  where import_batch_id is not null;

-- posting_dimension: la clave primaria es (posting_id, dimension_id,
-- dimension_value_id), así que sólo cubre búsquedas por posting_id. Las otras
-- dos FK quedaban sin índice — y `posting_dimension_by_value` no vale, porque
-- empieza por tenant_id, el mismo problema que arriba.
create index if not exists posting_dimension_by_dimension
  on posting_dimension (dimension_id);
create index if not exists posting_dimension_by_value_only
  on posting_dimension (dimension_value_id);
