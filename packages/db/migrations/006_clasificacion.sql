-- ═══════════════════════════════════════════════════════════════════════════
-- Clasificación: reglas, las dimensiones que ponen, y la auditoría del cambio.
--
-- ── La frontera que sostiene todo este módulo ──────────────────────────────
--
-- El esquema base dice que los asientos son append-only: "corregir un asiento
-- crea uno nuevo que anula al anterior". **Reclasificar no es corregir.**
--
-- El hecho registrado no cambia cuando alguien decide que el recibo de la luz
-- va en "Casa > Servicios" y no en "Sin categorizar": la fecha es la misma, el
-- importe es el mismo, la cuenta bancaria es la misma y la huella también. Lo
-- que cambia es cómo lo clasificamos, que es una opinión sobre el hecho y no
-- el hecho.
--
-- De ahí la regla del módulo, que vale también para el código que lo usa:
--
--   · la pata de la CATEGORÍA se actualiza en su sitio;
--   · la pata BANCARIA es inmutable — importe, fecha, cuenta y huella no se
--     tocan nunca, ni acá ni en ningún sitio.
--
-- El asiento sigue balanceando a cero justamente porque el importe no se toca.
--
-- La alternativa (anular y reasentar en cada cambio de categoría) duplicaría
-- el libro en cada pasada: 2.000 movimientos clasificados serían 4.000
-- asientos, y el extracto tendría dos filas por cada compra. Eso no es un
-- libro más auditable, es un libro ilegible.
--
-- El precio de actualizar en su sitio es que el cambio sería invisible. Ese
-- precio lo paga `classification_change`: cada movimiento de categoría queda
-- registrado con quién, cuándo y por qué regla. B6 exige poder contestar quién
-- cambió qué —el contador y el asistente proponen, no escriben— y sin esa
-- tabla la pregunta no tiene respuesta.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Reglas ─────────────────────────────────────────────────────────────────

create type rule_match_kind as enum (
  'contiene',  -- ILIKE %valor%, con los comodines del usuario escapados
  'empieza',   -- ILIKE valor%
  'exacto',    -- ILIKE valor, sin comodines: igualdad sin distinguir mayúsculas
  'regex'      -- ~* en Postgres
);

create table rule (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  name        text not null,
  match_kind  rule_match_kind not null,
  match_value text not null,

  -- Limita la regla a UNA cuenta bancaria. Es ON DELETE CASCADE y no SET NULL
  -- a propósito: si la cuenta desaparece y el puntero se pusiera a null, una
  -- regla escrita para "la tarjeta de la sociedad" pasaría a aplicarse a todo
  -- el hogar sin que nadie la haya tocado. Una regla que se ensancha sola es
  -- peor que una regla que se va con su cuenta.
  account_id  uuid references account(id) on delete cascade,

  -- Rango de importe **con signo**, en unidades mínimas, comparado contra la
  -- pata bancaria tal como aparece en el extracto: un cargo de 45,20 es −4520.
  -- Traducir "gastos de entre 10 y 100 €" a este rango es trabajo de la
  -- pantalla, no de la regla; acá no se adivina el signo.
  min_amount  bigint,
  max_amount  bigint,

  -- A qué categoría manda. Es una cuenta de gasto o ingreso: acá no hay tabla
  -- de categorías. Null es válido y significa una regla que sólo pone
  -- dimensiones.
  --
  -- ON DELETE RESTRICT, al revés que account_id: la regla es configuración
  -- viva, y una regla cuyo destino se borró no se puede "arreglar sola" ni
  -- dejándola apuntando a null (se volvería una regla que no hace lo que dice
  -- su nombre). Que Postgres se plante al borrar la categoría obliga a decidir
  -- qué pasa con las reglas, que es exactamente la decisión que hay que tomar.
  category_id uuid references account(id) on delete restrict,

  -- Gana la de mayor prioridad. Empate: la más vieja, que es la que el usuario
  -- lleva más tiempo dando por buena.
  priority    integer not null default 0,
  enabled     boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text,

  constraint rule_name_no_vacio  check (btrim(name) <> ''),
  -- Un patrón vacío es una regla que coincide con TODO el libro. Con 'regex'
  -- ni siquiera hace falta que esté vacío del todo para eso, pero lo evidente
  -- se corta acá.
  constraint rule_match_no_vacio check (match_value <> ''),
  -- Un rango invertido no coincide con nada, y "cero movimientos" se lee como
  -- "no hay" en vez de como "preguntaste al revés".
  constraint rule_rango_ordenado check (
    min_amount is null or max_amount is null or min_amount <= max_amount
  )
);

create index rule_by_tenant on rule (tenant_id, priority desc, created_at);

-- Postgres NO crea índice para una clave foránea (lección de la migración
-- 005). Sin estos, borrar una cuenta recorre `rule` entera por cada fila.
create index rule_by_account  on rule (account_id)  where account_id  is not null;
create index rule_by_category on rule (category_id) where category_id is not null;

-- ── Dimensiones que pone una regla ─────────────────────────────────────────
-- Misma forma que posting_dimension, con la misma unidad de peso: un 60/40
-- son 600000 y 400000 ppm. La regla no reparte por su cuenta; escribe los
-- pesos que le dijeron.

create table rule_dimension (
  tenant_id          uuid not null references tenant(id) on delete cascade,
  rule_id            uuid not null references rule(id) on delete cascade,
  dimension_id       uuid not null references dimension(id) on delete cascade,
  dimension_value_id uuid not null references dimension_value(id) on delete cascade,
  weight_ppm         integer not null default 1000000,

  primary key (rule_id, dimension_id, dimension_value_id),
  constraint rule_weight_range check (weight_ppm > 0 and weight_ppm <= 1000000)
);

-- La primaria empieza por rule_id, así que cubre esa FK y nada más.
create index rule_dimension_by_tenant    on rule_dimension (tenant_id);
create index rule_dimension_by_dimension on rule_dimension (dimension_id);
create index rule_dimension_by_value     on rule_dimension (dimension_value_id);

-- ── Auditoría de la clasificación ──────────────────────────────────────────

create table classification_change (
  -- bigint identity y no uuid, como `posting`: esta tabla crece al ritmo de la
  -- clasificación (una pasada sobre 2.000 movimientos son 2.000 filas) y sólo
  -- se lee en orden temporal. Un entero monotónico da localidad de índice
  -- donde un uuid aleatorio la rompe.
  id              bigint generated always as identity primary key,
  tenant_id       uuid   not null references tenant(id) on delete cascade,

  -- La pata que cambió. Cascade: si el asiento se borra al revertir un lote,
  -- su historia de clasificación no tiene a qué referirse.
  posting_id      bigint not null references posting(id) on delete cascade,

  -- De dónde venía y a dónde fue. ON DELETE SET NULL y no RESTRICT: con
  -- RESTRICT, una categoría que alguna vez recibió un movimiento no se podría
  -- borrar nunca más, y fusionar dos categorías (mover todo a una y borrar la
  -- otra) sería imposible. Preferimos un registro con un hueco a un plan de
  -- cuentas que no se puede limpiar. El quién, el cuándo y el qué movimiento
  -- —que es lo que B6 pregunta— sobreviven igual.
  from_account_id uuid references account(id) on delete set null,
  to_account_id   uuid references account(id) on delete set null,

  -- Qué regla lo hizo. Null = lo hizo una persona a mano. Si la regla se
  -- borra, el registro se queda sin su porqué pero no se pierde.
  rule_id         uuid references rule(id) on delete set null,

  changed_by      text        not null,
  changed_at      timestamptz not null default now(),

  constraint classification_change_autor check (btrim(changed_by) <> '')
);

-- Cómo leer una fila con from_account_id = to_account_id: no cambió la
-- categoría, cambió la atribución por dimensiones de ese mismo movimiento.
-- Quien quiera sólo el historial de categorías filtra con
-- `from_account_id is distinct from to_account_id`.

create index classification_change_by_posting
  on classification_change (posting_id, changed_at desc);
create index classification_change_by_tenant
  on classification_change (tenant_id, changed_at desc);
create index classification_change_by_rule
  on classification_change (rule_id) where rule_id is not null;
create index classification_change_by_from
  on classification_change (from_account_id) where from_account_id is not null;
create index classification_change_by_to
  on classification_change (to_account_id) where to_account_id is not null;

-- ── Aislamiento entre hogares ──────────────────────────────────────────────
-- El bucle de la migración 002 recorre una lista fija de tablas, así que NO
-- alcanza a las que se crean después. Estas tres se enganchan a mano, con la
-- misma policy: sin esto, las reglas de un hogar serían visibles —y
-- aplicables— desde otro.

do $$
declare
  target text;
begin
  foreach target in array array['rule', 'rule_dimension', 'classification_change']
  loop
    execute format('alter table %I enable row level security', target);
    execute format('alter table %I force row level security', target);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_current_tenant())
         with check (tenant_id = app_current_tenant())',
      target
    );
  end loop;
end
$$;

-- En Supabase las tablas las crea `postgres`, no nosotros, así que los grants
-- por defecto de la 002 no siempre alcanzan a lo nuevo. Repetirlos es barato.
grant select, insert, update, delete
  on rule, rule_dimension, classification_change
  to moneypilot_app;
