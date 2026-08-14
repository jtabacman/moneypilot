# Dónde corre el servidor, y por qué está escrito

`vercel.json` tiene tres líneas y una de ellas decide más sobre la velocidad
percibida del producto que cualquier optimización de código que hayamos hecho.
Este documento existe para que nadie la quite pensando que sobra.

## Lo que pasaba

Medido el 14 de agosto de 2026 contra producción, con el endpoint de salud:

```
idaYVueltaMs: 97      un `select 1` sobre una conexión ya abierta
conectarMs:  593      abrir la conexión: TCP + TLS
host:        aws-0-eu-central-1.pooler.supabase.com:6543
region:      iad1
```

La base está en **Fráncfort** y la función corría en **Virginia**. Cada consulta
cruzaba el Atlántico y volvía.

Eso no se nota en una aplicación que hace una consulta por página. Ésta hace
entre siete y quince **en serie**, y las hace en serie por una razón que no se
puede quitar: comparten un solo `TenantClient`, y el alcance del hogar
—`app.tenant_id`, el rol degradado— vive en esa transacción. Repartir las
lecturas entre clientes distintos sería repartirlas entre transacciones
distintas, o sea entre ámbitos de RLS distintos. Ver la cabecera de
`packages/db/src/client.ts`.

Así que el suelo de una pantalla era:

| pantalla | viajes | sólo de red |
|---|---|---|
| `/hoy` | 7 | 679 ms |
| `/movimientos` | 11 | 1.067 ms |
| `/cierre` | 15 | 1.455 ms |

Más unos 830 ms de coste fijo —la llamada HTTP a Supabase Auth, el arranque de
la función, el render—. Medido de punta a punta: entre 2,4 y 4,2 segundos por
pantalla, en caliente.

## Lo que se intentó primero, y por qué no alcanzaba

Dos arreglos de código, los dos correctos y los dos insuficientes:

1. **La sesión se resolvía dos y tres veces por página**, y cada vez abría un
   pool de Postgres nuevo —conexión y handshake TLS— más una petición a Supabase
   Auth. Envuelta en el `cache` de React y usando el pool que ya existe: entre un
   15% y un 33% menos.
2. **El preámbulo de cada transacción eran cuatro viajes** —`begin`, `set local
   role`, los `set_config`—. Juntados en uno: unos 390 ms menos por pantalla.

Después de los dos, la aritmética seguía diciendo que no: con 97 ms por viaje,
**aunque quedara una sola consulta por pantalla**, 830 ms de coste fijo más un
viaje son 927 ms. Con dos, ya nos pasábamos del segundo.

El problema no era el número de viajes. Era la longitud de cada uno.

## Lo que se hizo

```json
{ "regions": ["fra1"] }
```

`fra1` es Fráncfort, la misma ciudad que `eu-central-1`. La ida y vuelta pasa de
97 ms a un puñado de milisegundos.

## Lo que hay que saber antes de tocarlo

- **Si la base se mueve de región, esto se mueve con ella.** Son un par: el
  número que importa no es dónde está cada una, es la distancia entre las dos.
  `/api/salud` devuelve `host` y `region` justamente para poder comprobarlo sin
  adivinar.
- **Fijar una región no es gratis para todo el mundo.** Alguien que abra la
  aplicación desde América paga ahora la travesía en la latencia del primer
  byte. Es el intercambio correcto mientras el corredor declarado del producto
  sea España y Estados Unidos con los datos en Europa: una pantalla hace quince
  viajes contra la base y uno solo contra el navegador. Multiplicar por quince el
  lado equivocado es peor.
- **El día que haya clientes en los dos continentes de verdad**, esto deja de
  tener una respuesta única y la conversación pasa a ser réplicas de lectura, no
  una línea de configuración.
