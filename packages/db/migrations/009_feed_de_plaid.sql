-- ═══════════════════════════════════════════════════════════════════════════
-- Segundo proveedor de feed: Plaid.
--
-- La 008 dejó escrito por qué las tablas del feed llevan `provider` y no se
-- llaman `finapi_*`: el catálogo de finAPI no tiene un solo banco español, así
-- que el segundo proveedor no era una hipótesis. Es éste. Plaid cubre los dos
-- lados del corredor —10.097 instituciones en EE. UU. y 78 en España, con las
-- diez entidades que importan expuestas con producto `transactions`— y entra
-- por la misma costura: mismas tres tablas, mismo `persistImport`, mismos
-- lotes reversibles. Acá sólo se añade lo que Plaid necesita y finAPI no.
--
-- Nada de esto crea tablas, así que las policies de la 008 siguen cubriendo
-- todo lo de abajo: una columna nueva de una tabla con RLS activo hereda el
-- aislamiento de la tabla. Los `grant` tampoco hacen falta por el mismo motivo
-- —son por tabla, no por columna—, y por eso esta migración no los repite.
--
-- ── El modelo de Plaid, en tres frases ──────────────────────────────────────
--
-- Plaid no tiene usuarios como finAPI: tiene **items**. Un item es una
-- conexión con una entidad —un login— y trae consigo un `access_token` que no
-- caduca. Un hogar puede tener varios (BBVA y Chase son dos items), así que
-- todo lo de Plaid cuelga de la conexión y no del hogar: por eso las tres
-- columnas nuevas van en `feed_connection` y ninguna en `feed_user`.
-- ═══════════════════════════════════════════════════════════════════════════

-- `add value` dentro de una transacción está permitido desde Postgres 12, con
-- una condición que esta migración respeta: el valor nuevo **no se puede usar**
-- hasta que la transacción confirme. Por eso más abajo no hay ni un `'plaid'`
-- en un where, un check o un insert. El corredor de migraciones envuelve cada
-- fichero en su propia transacción (ver migrate.ts).
alter type feed_provider add value if not exists 'plaid';

-- ── El formulario web es un concepto de finAPI ──────────────────────────────
--
-- `web_form_id` nació `not null` porque con finAPI una conexión ES un
-- formulario: la persona teclea las credenciales en el sitio del agregador y
-- ese formulario es lo único que después se puede sondear. Plaid no tiene
-- nada equivalente. Su widget (Link) no deja un identificador que sobreviva a
-- cerrar la pestaña, y en sandbox se lo salta entero con
-- `/sandbox/public_token/create`, que devuelve una conexión ya autenticada sin
-- que haya existido ningún formulario.
--
-- Se afloja la columna y se conserva la regla donde sí es cierta, con un
-- check por proveedor. Dejarla `not null` habría obligado a inventar un valor
-- para las filas de Plaid, y un identificador inventado en una columna que
-- alguien va a usar para sondear es peor que una columna vacía.
alter table feed_connection alter column web_form_id drop not null;

alter table feed_connection add constraint feed_connection_webform_de_finapi
  check (provider <> 'finapi' or web_form_id is not null);

-- ── Lo que Plaid necesita y finAPI no ──────────────────────────────────────

-- El identificador del item en Plaid.
--
-- No se reutiliza `bank_connection_id`, y no es por purismo: esa columna se
-- usa para **cruzar** las cuentas que devuelve finAPI (cada cuenta suya viene
-- con su `bankConnectionId` dentro) contra la conexión que las trajo. Las
-- cuentas de Plaid no llevan el item dentro: el item es implícito en el
-- `access_token` con el que se preguntó. Son dos claves con la misma pinta y
-- distinto trabajo, y meterlas en la misma columna haría que el cruce de
-- finAPI encontrara filas de Plaid que no significan lo mismo.
--
-- Además es el identificador con el que Plaid nombra sus webhooks: cuando
-- llegue `SYNC_UPDATES_AVAILABLE`, lo único que trae el aviso para saber a
-- quién despertar es este item.
alter table feed_connection add column item_id text;

-- El cursor de `/transactions/sync`, que es lo que hace incremental el feed.
--
-- Es por conexión y no por cuenta a propósito: Plaid lo define por item, y una
-- llamada devuelve los movimientos de todas las cuentas del item mezclados.
-- Guardarlo por cuenta obligaría a avanzarlo cinco veces sobre la misma
-- lectura, y cada avance de más se lleva por delante movimientos de las otras
-- cuatro cuentas sin que nada falle.
--
-- Nullable porque una conexión recién creada todavía no tiene ninguno, y eso
-- se lee como "traé todo el histórico". Perderlo no duplica nada: sin cursor
-- Plaid vuelve a mandar todo desde el principio y el dedup de origen 'api' lo
-- absorbe. Adelantarlo de más, en cambio, pierde movimientos para siempre —
-- por eso sólo se escribe en la misma transacción que asienta lo que trajo.
alter table feed_connection add column sync_cursor text;

-- La credencial de larga duración de ESTA conexión.
--
-- El `access_token` de Plaid no caduca y es la llave de todos los datos
-- bancarios del item. Va acá y no en `feed_user.access_secret` porque en Plaid
-- no hay un secreto por hogar: hay uno por conexión, y un hogar con dos bancos
-- tiene dos.
--
-- Vale palabra por palabra el aviso de la 008: **esto se guarda en claro**.
-- Hoy lo protegen RLS —sólo el hogar dueño lee su fila—, el rol de aplicación
-- sin privilegios y el hecho de que del otro lado hay un sandbox con datos
-- sintéticos. Antes de que esta columna vea un banco real hace falta cifrado
-- con clave fuera de la base. La diferencia con finAPI es que acá el secreto
-- no se puede rotar pidiéndolo de nuevo: si se pierde, la única salida es que
-- la familia vuelva a pasar por Link.
--
-- Nunca sale en un `select` de listado: se lee con una función propia. Ver
-- `readConnectionSecret` en repo/feed.ts y el motivo — la fila de una conexión
-- viaja hasta la pantalla, y una credencial que viaja en el mismo objeto que
-- el nombre del banco acaba en el navegador el día que alguien añada un campo.
alter table feed_connection add column access_secret text;

-- Registrar dos veces el mismo item deja dos conexiones que comparten cuentas:
-- la segunda no puede crear las cuentas del libro (ya están enlazadas por
-- `feed_account_once`) y se queda como una fila muerta que igual aparece en la
-- pantalla con su botón. El índice es parcial porque las filas de finAPI no
-- tienen item.
create unique index feed_connection_item_unique
  on feed_connection (tenant_id, provider, item_id)
  where item_id is not null;

-- ── Los índices que la 008 se dejó ─────────────────────────────────────────
--
-- La lección de la 005, aplicada a las tablas del feed: Postgres crea índice
-- para una PRIMARY KEY y para un UNIQUE, pero **no para una FOREIGN KEY**, y
-- un índice compuesto sólo sirve si la búsqueda empieza por su primera
-- columna.
--
--  · `feed_account.account_id` es FK a `account(id)` con on delete cascade. La
--    unique que existe es (tenant_id, account_id): empieza por tenant_id, así
--    que borrar una cuenta recorre `feed_account` entera. Es exactamente el
--    caso que en la 005 se pasaba del statement_timeout.
--  · `feed_account.connection_id` es FK a `feed_connection(id)`, y no hay
--    ningún índice que empiece por ella.
--
-- Hoy las dos tablas son chicas. El coste aparece justo cuando ya hay datos de
-- un cliente, que es cuando nadie quiere estar creando índices.
create index if not exists feed_account_by_account on feed_account (account_id);
create index if not exists feed_account_by_connection on feed_account (connection_id)
  where connection_id is not null;
