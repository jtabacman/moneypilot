-- El saldo que el agregador leyó del banco, con su instante.
--
-- ── El hecho que se estaba tirando ──────────────────────────────────────────
--
-- Cuando entra un lote de Plaid, el motor de reconciliación compara el libro
-- contra el saldo que Plaid acaba de leer de la entidad y `asentarExtracto` se
-- niega a cerrar la transacción si no coinciden al céntimo. O sea: en el
-- momento del commit sabemos, con certeza comprobada, que el libro suma
-- exactamente lo que dice el banco.
--
-- Ese hecho no se guardaba en ningún sitio. Y como `accountBalances` y
-- `reconciliation` leen sólo `declared_balance` —que es de extractos—, las
-- pantallas decían «4 de 4 cuentas no se pudieron comprobar contra el
-- extracto» justo después de comprobarlas. Para un producto cuya promesa es
-- «tu libro cuadra con tu banco», ése era el número de portada, calculado y
-- escondido.
--
-- ── Por qué no vale `declared_balance` ──────────────────────────────────────
--
-- Su grano es el DÍA (`unique (account_id, as_of)`), y encima `persistImport`
-- lanza si ya hay otro importe para esa fecha. Un saldo de agregador no es el
-- cierre de un día: es lo que había **en un instante**. Dos sincronizaciones a
-- las 9:00 y a las 14:00 devuelven cifras distintas y las dos son ciertas;
-- metidas en esa tabla, la segunda abortaría la importación entera por
-- contradecir a la primera.
--
-- Por eso la clave de acá es `(account_id, provider, observed_at)`: dos
-- lecturas del mismo día son dos filas y ninguna discute con la otra. La tabla
-- es de sólo añadir, y lo que consultan las pantallas es la última.
--
-- ── Y por qué tampoco columnas en `feed_account` ────────────────────────────
--
-- La cabecera de la 008 lo prohíbe por escrito: «Ni un movimiento ni un saldo
-- se guardan acá… si mañana alguien escribe un reporte que lee de estas tablas
-- para responder "cuánto tengo", el diseño se rompió». Esas tablas son el
-- enlace con el proveedor, no una fuente de verdad contable. Ésta sí lo es, y
-- por eso lleva `tenant_id`, RLS y su propio nombre.
--
-- ── Deshacer un lote NO borra estas filas ───────────────────────────────────
--
-- `revertImport` sí borra los `declared_balance` que trajo el lote, porque un
-- saldo declarado por un extracto es parte de ese extracto. Un saldo del
-- proveedor no: es un hecho fechado —«a las 14:03 del 12 de agosto, Plaid dijo
-- 23.772,06»— y deshacer una importación no des-dice al banco. De ahí el
-- `on delete set null` en `import_batch_id`, que es informativo. Es la
-- asimetría que alguien va a querer «arreglar» dentro de un año; está acá dicha
-- a propósito.

create table provider_balance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  account_id uuid not null references account(id) on delete cascade,
  provider feed_provider not null,
  external_account_id text not null,
  -- El instante. Es toda la diferencia con `declared_balance`.
  observed_at timestamptz not null,
  amount bigint not null,
  currency char(3) not null,
  -- Plaid manda `available` aparte. Nullable porque casi ninguna entidad
  -- europea lo da, y un cero fingido se leería como «no te queda nada».
  available bigint,
  -- 'proveedor' = el instante lo dijo la entidad (`last_updated_datetime`).
  -- 'lectura'   = el instante es cuándo preguntamos nosotros.
  -- La diferencia importa: con el primero se puede decir «el banco lo dijo a
  -- las 14:03»; con el segundo, sólo «lo leímos a las 14:03», que es más flojo
  -- y hay que enseñarlo como lo que es.
  observed_source text not null check (observed_source in ('proveedor', 'lectura')),
  import_batch_id uuid references import_batch(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint provider_balance_unica unique (account_id, provider, observed_at)
);

-- La consulta de las pantallas es siempre «el último de esta cuenta».
create index provider_balance_ultimo on provider_balance (account_id, observed_at desc);

-- ── Aislamiento ────────────────────────────────────────────────────────────
--
-- El bucle de la 002 recorre una lista fija y no alcanza a lo que se crea
-- después. Se engancha a mano, igual que hicieron la 008 y la 011.

alter table provider_balance enable row level security;
alter table provider_balance force row level security;
create policy tenant_isolation on provider_balance
  using (tenant_id = app_current_tenant())
  with check (tenant_id = app_current_tenant());

grant select, insert, update, delete on provider_balance to moneypilot_app;
