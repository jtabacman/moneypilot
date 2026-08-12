-- ═══════════════════════════════════════════════════════════════════════════
-- Esquema base: partida doble con grano posting, multi-moneda y dimensiones
-- definidas por el usuario.
--
-- Es SQL de Postgres estándar a propósito. No usa ninguna extensión ni función
-- propia de Supabase, así que la base se puede mover a otro proveedor sin
-- tocar una línea. Lo único que se apoya en el hosting es la región.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── Aislamiento entre hogares ───────────────────────────────────────────────
-- tenant_id va en TODAS las tablas, incluso donde parece redundante (por
-- ejemplo posting, que ya llega por entry). Esa redundancia es lo que permite
-- que la policy de RLS sea un filtro local y no un join: sin ella, aislar
-- posting exigiría resolver entry en cada consulta.

create table tenant (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  -- Moneda en la que se consolidan los reportes. Los flujos se convierten a
  -- la tasa de la fecha de la transacción; los saldos, a la de cierre.
  base_currency char(3)     not null,
  created_at    timestamptz not null default now()
);

-- ── Cuentas ────────────────────────────────────────────────────────────────

create type account_kind as enum (
  'asset',      -- corriente, ahorro, efectivo
  'liability',  -- tarjeta de crédito, préstamo
  'income',
  'expense',
  'equity',     -- apertura, patrimonio
  'trading'     -- contrapartida de conversión de moneda (método Selinger)
);

create table account (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  kind           account_kind not null,
  name           text not null,
  -- Una cuenta tiene UNA moneda. Los postings contra ella van en esa moneda,
  -- que es lo que hace que el balanceo por moneda sea comprobable.
  currency       char(3) not null,
  institution    text,
  -- Enmascarado en el parser. El número completo nunca entra al sistema.
  account_number text,
  country        char(2),
  parent_id      uuid references account(id) on delete restrict,
  closed_at      date,
  created_at     timestamptz not null default now(),

  constraint account_name_unique unique (tenant_id, name)
);

create index account_by_tenant on account (tenant_id, kind, name);

-- Sólo puede haber una cuenta de trading por moneda y hogar: si hubiera dos,
-- el residuo de cambio se repartiría entre ambas y dejaría de ser rastreable.
create unique index account_trading_unique
  on account (tenant_id, currency) where kind = 'trading';

-- ── Dimensiones definidas por el usuario ───────────────────────────────────
-- Propiedad, persona, proyecto, viaje, entidad legal. Ninguna plataforma del
-- sector modela esto; es el único diferencial verdaderamente estructural.

create table dimension (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant(id) on delete cascade,
  key        text not null,   -- 'propiedad', 'persona', 'proyecto'
  label      text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now(),

  constraint dimension_key_unique unique (tenant_id, key)
);

create table dimension_value (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  dimension_id uuid not null references dimension(id) on delete cascade,
  label        text not null,
  -- Jerarquía: "Casa Madrid" -> "Obra", "Servicios", "Personal".
  parent_id    uuid references dimension_value(id) on delete restrict,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),

  constraint dimension_value_unique unique (dimension_id, label)
);

create index dimension_value_by_tenant on dimension_value (tenant_id, dimension_id);

-- ── Lotes de importación ───────────────────────────────────────────────────
-- Todo dato importado pertenece a un lote, y todo lote es reversible por
-- completo. Es lo que permite prometer "cargamos tu historia" sin miedo.

create type import_status as enum ('running', 'completed', 'reverted', 'failed');

create table import_batch (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  account_id    uuid references account(id) on delete set null,
  file_name     text not null,
  format        text not null,
  -- Hash del contenido del fichero. Reimportar el mismo fichero entero se
  -- detecta acá, no en el dedup por transacción: el ordinal distingue a
  -- propósito dos cafés iguales del mismo día, así que no puede además
  -- protegernos de un fichero duplicado.
  content_sha256 char(64) not null,
  status        import_status not null default 'running',
  lines_read    integer not null default 0,
  imported      integer not null default 0,
  duplicates    integer not null default 0,
  needs_review  integer not null default 0,
  rejected      integer not null default 0,
  -- El informe completo, tal como se le mostró al cliente. Se conserva para
  -- poder responder por qué una importación quedó como quedó.
  report        jsonb,
  created_at    timestamptz not null default now(),
  reverted_at   timestamptz
);

create index import_batch_by_tenant on import_batch (tenant_id, created_at desc);
create unique index import_batch_content_unique
  on import_batch (tenant_id, content_sha256) where status = 'completed';

-- ── Asientos ───────────────────────────────────────────────────────────────

create type data_source as enum ('file', 'pdf', 'manual', 'api');

create table entry (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  -- Fecha contable. La canónica para cortes de período y para la identidad.
  booked_on       date not null,
  -- Fecha de valor cuando el origen la trae. Se conserva; no se mezcla.
  valued_on       date,
  description     text not null,
  source          data_source not null,
  import_batch_id uuid references import_batch(id) on delete restrict,
  -- Huella canónica versionada. Ver packages/core/src/identity.ts.
  fingerprint     char(64),
  -- FITID u otra referencia del banco. Atributo, nunca clave.
  external_id     text,
  created_at      timestamptz not null default now(),
  -- Append-only: corregir un asiento crea uno nuevo que anula al anterior.
  -- Nunca se borra historia que ya se le mostró a alguien.
  reversed_by     uuid references entry(id) on delete restrict
);

create index entry_by_date on entry (tenant_id, booked_on desc);
create index entry_by_batch on entry (import_batch_id);

-- La huella es única por hogar: es la garantía de idempotencia del importador.
create unique index entry_fingerprint_unique
  on entry (tenant_id, fingerprint) where fingerprint is not null;

-- ── Postings ───────────────────────────────────────────────────────────────
-- El grano real del sistema. Toda entry balancea a cero DENTRO DE CADA MONEDA;
-- las conversiones cierran contra cuentas de trading.

create table posting (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references tenant(id) on delete cascade,
  entry_id        uuid not null references entry(id) on delete cascade,
  account_id      uuid not null references account(id) on delete restrict,
  ordinal         smallint not null,

  -- Importe que balancea, en la moneda de la cuenta. Unidades mínimas.
  -- bigint y no numeric: el dominio ya trabaja en enteros y así no hay una
  -- segunda representación decimal que pueda diferir de la primera.
  amount          bigint not null,
  currency        char(3) not null,

  -- Los otros dos de los "tres números" de un gasto en el exterior.
  native_amount   bigint,
  native_currency char(3),

  -- Consolidado a la moneda de reporte, CONGELADO a la fecha. No se recalcula
  -- nunca: un reporte emitido en marzo tiene que dar lo mismo en diciembre.
  base_amount     bigint,
  base_currency   char(3),
  fx_numerator    bigint,
  fx_denominator  bigint,
  fx_as_of        date,
  fx_source       text,

  memo            text,
  -- Las patas de una transferencia interna nunca cuentan como gasto ni ingreso.
  is_transfer     boolean not null default false,

  constraint posting_entry_ordinal unique (entry_id, ordinal),
  constraint posting_fx_complete check (
    (fx_numerator is null and fx_denominator is null)
    or (fx_numerator is not null and fx_denominator is not null and fx_denominator <> 0)
  ),
  constraint posting_native_complete check (
    (native_amount is null) = (native_currency is null)
  )
);

create index posting_by_account on posting (tenant_id, account_id, entry_id);
create index posting_by_entry on posting (entry_id);

-- ── Atribución a dimensiones, con pesos ────────────────────────────────────
-- Tabla puente porque la relación es muchos a muchos: un gasto puede estar
-- 60% en Personal y 40% en la sociedad, y a la vez 100% en Casa Madrid.

create table posting_dimension (
  tenant_id          uuid not null references tenant(id) on delete cascade,
  posting_id         bigint not null references posting(id) on delete cascade,
  dimension_id       uuid not null references dimension(id) on delete cascade,
  dimension_value_id uuid not null references dimension_value(id) on delete cascade,
  -- Peso en partes por millón, entero. Un 60/40 son 600000 y 400000.
  -- Entero y no float: los importes derivados se calculan con el método del
  -- resto mayor, y un peso en coma flotante reintroduce el error que el
  -- núcleo elimina.
  weight_ppm         integer not null default 1000000,

  primary key (posting_id, dimension_id, dimension_value_id),
  constraint weight_range check (weight_ppm > 0 and weight_ppm <= 1000000)
);

create index posting_dimension_by_value on posting_dimension (tenant_id, dimension_value_id);

-- ── Cola de revisión ───────────────────────────────────────────────────────
-- La pasada difusa del dedup nunca descarta: manda acá. Una importación que
-- borra una transacción legítima en silencio es peor que una que duplica.

create type review_kind as enum ('posible_duplicado', 'transferencia_sugerida', 'sin_categorizar');
create type review_state as enum ('pendiente', 'aceptado', 'rechazado');

create table review_item (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  kind            review_kind not null,
  state           review_state not null default 'pendiente',
  entry_id        uuid references entry(id) on delete cascade,
  counterpart_id  uuid references entry(id) on delete cascade,
  -- Por qué el sistema lo marcó: similitud, días de diferencia, importes.
  evidence        jsonb not null default '{}'::jsonb,
  import_batch_id uuid references import_batch(id) on delete cascade,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     text
);

create index review_pending on review_item (tenant_id, state, created_at)
  where state = 'pendiente';

-- ── Tipos de cambio ────────────────────────────────────────────────────────
-- Se guardan como fracción exacta, nunca como float.

create table fx_rate (
  base        char(3) not null,
  quote       char(3) not null,
  as_of       date    not null,
  numerator   bigint  not null,
  denominator bigint  not null,
  source      text    not null,
  fetched_at  timestamptz not null default now(),

  primary key (base, quote, as_of),
  constraint fx_denominator_nonzero check (denominator <> 0)
);

-- ── Saldos declarados por el banco ─────────────────────────────────────────
-- Lo que el extracto dice que hay. Contra esto se calcula el delta: si el
-- sistema no puede explicar la diferencia, el informe la muestra.

create table declared_balance (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  account_id      uuid not null references account(id) on delete cascade,
  as_of           date not null,
  amount          bigint not null,
  currency        char(3) not null,
  import_batch_id uuid references import_batch(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint declared_balance_unique unique (account_id, as_of)
);
