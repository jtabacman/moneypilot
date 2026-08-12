# moneypilot

Motor de un **Personal CFO**: sistema de registro del dinero que entra, sale y se debe
en una vida financiera con estructura (varias entidades, propiedades, países, monedas,
personas con acceso).

El análisis de mercado y producto que fundamenta estas decisiones está en
[investigacion-personal-cfo.md](investigacion-personal-cfo.md).

## Estado

Ola 1 en construcción — **el motor, sin agregación bancaria**.

| Pieza | Estado |
|---|---|
| Scaffold del monorepo | listo |
| Dinero, fechas y partida doble | listo |
| Identidad canónica y dedup en dos pasadas | listo |
| Matching de transferencias | listo |
| Reconciliación e informe de importación | listo |
| Parsers OFX / QFX / QIF / CSV / Norma 43 | pendiente |
| Esquema Postgres con RLS | pendiente |
| CLI (import, reconcile, undo) | pendiente |

84 tests, todos sobre el dominio puro: el motor contable se testea sin base de datos.

## Empezar

```bash
pnpm install
pnpm test
```

Para levantar Postgres (todavía no lo usa nada):

```bash
pnpm db:up
```

Comandos: `pnpm test` · `pnpm check` (controles + lint + typecheck) · `pnpm fix` · `pnpm build`.

## Las decisiones que no se pueden revertir barato

Cada una está comentada en el fuente con su porqué. En resumen:

**1. Grano `posting` con partida doble, e invariante fuerte: toda entry balancea a cero
dentro de cada moneda.** Esa formulación —y no "todo suma cero"— hace que un solo
mecanismo resuelva splits, transferencias, gastos compartidos con peso y conversión de
moneda. Las conversiones cierran contra cuentas de trading (método Selinger, el de
GnuCash), lo que deja la diferencia de cambio como una línea explícita en vez de un
redondeo perdido. Es lo que permite que el waterfall patrimonial tenga una barra
"efecto cambiario" que se pueda clickear hasta la transacción.
→ `packages/core/src/entry.ts`

**2. Dinero como `bigint` en unidades mínimas. Ningún importe pasa nunca por un `number`.**
Los flotantes no representan 0,10. Este producto le muestra reconciliaciones a un
contador: un céntimo de deriva es un delta distinto de cero, y un delta distinto de cero
es una cuenta perdida. El reparto proporcional usa el método del resto mayor, así que un
60/40 sobre un importe indivisible sigue sumando exactamente el total.
→ `packages/core/src/money.ts`

**3. Fechas de calendario sin hora ni zona horaria.** Un movimiento ocurre en un día, no
en un instante. Con `Date`, alguien en Madrid y alguien en Buenos Aires ven meses
distintos para la misma transacción. Aritmética entera sobre `YYYY-MM-DD`.
→ `packages/core/src/plain-date.ts`

**4. El identificador del banco es un atributo, nunca la clave.** El FITID de OFX sólo es
único dentro del alcance de la cuenta, y los bancos lo reemiten distinto tras un
rebooking. El sistema calcula su propia huella canónica y guarda el FITID al lado, como
una señal más. La huella lleva la versión del algoritmo adentro: si cambia el
normalizador, dos versiones no pueden colisionar.
→ `packages/core/src/identity.ts`

**5. Dedup en dos pasadas, y la difusa nunca descarta.** La determinista (huella o FITID
con importe y fecha coincidentes) descarta; la difusa manda a revisión humana. Una
importación que borra una transacción legítima en silencio es peor que una que duplica:
el duplicado se ve, la ausencia no.
Además, **la pasada difusa sólo mira lo ya persistido, nunca el propio lote**. Un extracto
no trae el mismo movimiento dos veces con descriptores distintos, y si la difusa mirara
el lote, dos cafés de 3,50 del mismo día irían a revisión — inundando la cola que el
modelo de negocio presupuesta en 3-8%.
→ `packages/core/src/dedup.ts`

**6. El informe de reconciliación es el producto, no una utilidad de diagnóstico.** Filas
leídas, importadas, duplicadas descartadas, transferencias emparejadas, rechazadas con
motivo, y delta de saldo por cuenta. Un delta distinto de cero es un fallo visible. Si el
motor no puede explicar su propia importación, nadie va a creerle un reporte de patrimonio.
→ `packages/core/src/reconcile.ts`

**7. El dominio no toca I/O.** Los parsers son funciones puras `bytes → ParsedStatement`;
el motor contable se testea sin base de datos. Eso es lo que hace que los 84 tests corran
en medio segundo y que las reglas se puedan verificar de verdad.

**8. Caracteres de control sólo como escape.** Usamos U+001F como separador dentro del
string canónico que se hashea. Escrito como carácter literal es invisible y cualquier
formateador puede comérselo — y si eso pasa, el hash cambia en silencio y la próxima
importación duplica la base entera. Hay un check que lo impide.
→ `scripts/check-control-chars.mjs`

## Estructura

```
packages/core/          dominio puro, cero I/O
  money.ts              bigint, allocate con resto mayor, convert con tasa exacta
  plain-date.ts         fecha de calendario, aritmética entera
  currency.ts           exponentes ISO 4217
  entry.ts              partida doble, invariante por moneda, cuentas de trading
  identity.ts           huella canónica versionada
  normalize.ts          normalización estable (hash) y tokens (difusa)
  dedup.ts              dos pasadas
  transfers.ts          emparejamiento determinista de traspasos
  reconcile.ts          reconciliación e informe de importación
  statement.ts          contrato entre parsers y motor
scripts/                checks del repo
```

## Lo que este producto NO hace

No recomienda activos, no rebalancea, no proyecta retornos, no da asesoramiento
financiero ni fiscal, no mueve dinero y no custodia nada. El límite es deliberado: deja
el producto fuera del test de tres elementos del Advisers Act y de la definición de
*personal recommendation* de MiFID II, y elimina el conflicto de interés. Ver la sección
A8 del documento de investigación.
