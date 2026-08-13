-- ═══════════════════════════════════════════════════════════════════════════
-- Segunda fuente de entrada: el feed de un agregador bancario.
--
-- Hasta acá la única forma de que un movimiento entrara al libro era un
-- fichero. `data_source` contempla 'api' desde la 001, pero nadie lo usaba.
-- Esta migración es lo mínimo que hace falta para que exista: **el estado de
-- la conexión**. Ni un movimiento ni un saldo se guardan acá.
--
-- Esa frase es la regla entera. El feed es una fuente de entrada al libro, no
-- un sustituto del libro: lo que trae se normaliza y se persiste con
-- `persistImport`, con sus asientos balanceados, su lote reversible y su cola
-- de revisión, exactamente igual que un OFX. Si mañana alguien escribe un
-- reporte que lee de estas tablas para responder "cuánto tengo", el diseño se
-- rompió. Acá sólo vive el cableado: quién somos ante el agregador, qué
-- conexiones abrimos y qué cuenta suya corresponde a qué cuenta nuestra.
--
-- Las tres tablas llevan `provider` y no se llaman `finapi_*`. No es
-- generalidad especulativa: el catálogo de finAPI no tiene bancos españoles,
-- así que el segundo proveedor no es una hipótesis remota — y migrar el
-- nombre de una tabla con datos dentro cuesta bastante más que una columna.
-- ═══════════════════════════════════════════════════════════════════════════

create type feed_provider as enum ('finapi');

-- ── Quiénes somos ante el agregador ────────────────────────────────────────
--
-- finAPI no conoce hogares: conoce usuarios suyos. Cada hogar necesita uno, y
-- ese usuario es el dueño de todas sus conexiones bancarias allá. Por eso la
-- clave es (hogar, proveedor): dos hogares nunca comparten usuario, que es lo
-- que impide que una consulta mal escrita traiga los movimientos del vecino
-- desde el otro lado de la red, donde RLS ya no llega.

create table feed_user (
  tenant_id   uuid not null references tenant(id) on delete cascade,
  provider    feed_provider not null,
  -- El identificador del usuario en el proveedor. Es la llave de todos sus
  -- datos bancarios allá, así que no se deriva de nada nuestro: lo genera el
  -- proveedor y lo guardamos tal cual.
  external_id text not null,
  -- La contraseña de ESE usuario, la que el proveedor devuelve una sola vez al
  -- crearlo y sin la cual no se puede volver a pedir su token.
  --
  -- NO son las credenciales del banco. Ésas se teclean en el formulario del
  -- agregador y nunca pasan por nosotros; es la razón por la que el formulario
  -- web existe y por la que las llamadas directas de importación están
  -- prohibidas para este cliente.
  --
  -- Límite conocido, escrito acá para que nadie lo descubra tarde: esto se
  -- guarda en claro. Hoy protege RLS —sólo el hogar dueño lee su fila— y el
  -- rol de aplicación sin privilegios, y lo que hay del otro lado es un
  -- sandbox con datos sintéticos alemanes. Antes de que esta columna vea un
  -- banco real hace falta cifrado con clave fuera de la base (KMS o similar,
  -- sobre para cada hogar y rotación), porque un volcado de la base no puede
  -- ser suficiente para leer las cuentas de nadie. Mientras tanto la otra
  -- mitad del contrato es `borrarUsuario`: un hogar que desconecta el feed
  -- borra el usuario en el proveedor y esta fila con él.
  access_secret text not null,
  created_at  timestamptz not null default now(),

  primary key (tenant_id, provider)
);

-- ── Conexiones bancarias abiertas ──────────────────────────────────────────
--
-- Una conexión nace de un formulario web que la persona completa en el sitio
-- del agregador. Se guarda el formulario y no sólo el resultado porque en el
-- sandbox **no hay vuelta automática**: el cliente está UNLICENSED y cualquier
-- `redirectUrl` da INVALID_REDIRECT_URL, así que nadie nos avisa de que
-- terminó. El estado hay que sondearlo, y para sondearlo hay que saber qué
-- formulario mirar después de que la persona cerró la pestaña, cambió de
-- dispositivo o volvió al día siguiente.

create table feed_connection (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant(id) on delete cascade,
  provider           feed_provider not null,
  -- Texto y no entero: los ids de banco de finAPI son numéricos, los de otros
  -- proveedores no tienen por qué serlo.
  bank_id            text not null,
  bank_name          text not null,
  web_form_id        text not null,
  -- Lo rellena el sondeo cuando el formulario termina bien.
  bank_connection_id text,
  -- Texto y no enum a propósito: los estados los define el proveedor y puede
  -- añadir. Un enum obligaría a una migración para poder guardar un estado que
  -- ya está ocurriendo, y mientras tanto el sondeo fallaría al escribirlo.
  status             text not null,
  -- Lo último que dijo el proveedor cuando algo salió mal, para que la
  -- pantalla pueda explicarlo en vez de decir "no se pudo".
  error_detail       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint feed_connection_form_unique unique (tenant_id, provider, web_form_id)
);

create index feed_connection_by_tenant on feed_connection (tenant_id, created_at desc);

-- ── Qué cuenta suya es qué cuenta nuestra ──────────────────────────────────
--
-- Sin esta tabla, cada sincronización tendría que adivinar contra qué cuenta
-- del hogar asentar los movimientos de una cuenta del agregador. Adivinar por
-- IBAN funcionaría casi siempre, y "casi siempre" acá significa que un día los
-- movimientos de la cuenta de la sociedad entran en la personal.

create table feed_account (
  tenant_id           uuid not null references tenant(id) on delete cascade,
  provider            feed_provider not null,
  external_account_id text not null,
  account_id          uuid not null references account(id) on delete cascade,
  connection_id       uuid references feed_connection(id) on delete set null,
  -- Cuándo terminó bien la última sincronización de esta cuenta. Informativo:
  -- lo que manda para no duplicar es el dedup, no esta fecha.
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),

  primary key (tenant_id, provider, external_account_id),

  -- Una cuenta nuestra la alimenta como mucho un feed. Dos cuentas del
  -- agregador escribiendo en la misma cuenta del libro darían un saldo que no
  -- es el de ninguna de las dos, y el delta contra el saldo declarado —que es
  -- justamente lo que hace comprobable esta importación— dejaría de significar
  -- nada.
  constraint feed_account_once unique (tenant_id, account_id)
);

-- ── Un contador más en el lote ─────────────────────────────────────────────
--
-- `import_batch` cuenta leídas, importadas, duplicadas, a revisión y
-- rechazadas, y hasta ahora esas cinco sumaban lo leído. Con un feed aparece
-- una sexta clase: el movimiento que YA estaba y que el banco corrigió al
-- pasarlo de pendiente a asentado. No es nuevo (se contaría dos veces) ni
-- duplicado (lo guardado ya no dice lo que el banco dice hoy): se reescribe el
-- asiento en su sitio.
--
-- Sin esta columna, un lote de 1.612 filas con 12 correcciones enseñaría 1.600
-- repartidas y 12 evaporadas. Una fila que no aparece en ninguna columna es
-- exactamente la clase de agujero que hace que nadie se crea el informe.
--
-- `default 0` porque para un fichero siempre es 0 y los lotes ya existentes
-- son todos de fichero.
alter table import_batch add column updated integer not null default 0;

-- ── Aislamiento ────────────────────────────────────────────────────────────
--
-- El bucle de la 002 recorre una lista fija de tablas y no alcanza a las que
-- se crean después. Estas tres se enganchan a mano con la misma policy. Acá no
-- es un descuido caro: es la fila que contiene la credencial del agregador.

do $$
declare
  target text;
begin
  foreach target in array array['feed_user', 'feed_connection', 'feed_account']
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
  on feed_user, feed_connection, feed_account
  to moneypilot_app;
