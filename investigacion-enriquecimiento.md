# Enriquecimiento: descriptor bancario → comercio canónico — documento de decisión

**Fecha:** 13 de agosto de 2026
**Pregunta que contesta:** Tapix está bloqueado (sandbox por navegador, token de portal inútil para API). ¿Existe hoy un reemplazo que haga **descriptor → comercio canónico + categoría genérica**, probable **por API sin hablar con un comercial**, gratis o por debajo de 100 USD/mes, y que sirva para España (segundo mercado, Alemania)?
**Método:** tres líneas de búsqueda + una medición contra nuestro corpus real. Lo medido es reproducible con los scripts del scratchpad (`medir.py`, `motor_propio.py`, `motor_nsi.py`, `union.py`). Todas las URLs y todas las llamadas HTTP, del 13-08-2026. Este documento continúa las secciones 3, 4, 11 y 12 de `investigacion-proveedores-datos.md` y no las contradice: las mide.

**Convención de confianza** (la del documento madre):
`[V]` verificado en fuente primaria · `[P]` probable, fuente secundaria consistente · `[I]` inferencia propia · `[?]` no verificado, tratar como hipótesis.

**Regla aplicada sin excepción:** el precio y el alta los dice la página del proveedor o el README del repositorio. Y la pregunta operativa es siempre la misma: *¿puedo obtener una clave y hacer una llamada en los próximos diez minutos?*

---

## 0. Veredicto

**No. Hoy no se pudo probar nada que haga la mitad que falta — y el motivo no es el precio ni un comercial: es un formulario de alta que no me corresponde rellenar a mí.**

- **Los dos candidatos que sí hacen el trabajo de Tapix están a un registro de distancia, los dos son autoservicio real y los dos entran holgadamente en el presupuesto:** **Triqai** (Free 100 créditos/mes, sin tarjeta; Starter €17/mes con 4.000 créditos) `[V]` y **Context.dev** (Free 500 créditos de una vez con correo corporativo —250 con Gmail—, sin tarjeta; Developer 25 USD/mes con 10.000 créditos = 1.000 consultas) `[V]`. Sus endpoints existen y responden hoy: probados sin clave, devuelven **401** con el mensaje de "falta API key", no 404 `[V]`. El script de medición está escrito y sólo espera `TRIQAI_API_KEY` / `CONTEXT_DEV_API_KEY`. **Crear cuentas está fuera de lo que puedo hacer yo; son cinco minutos tuyos y descongelan la decisión entera.**
- **Lo que sí se pudo probar hoy, sin alta ninguna, fue tres cosas, y ninguna hace descriptor → comercio canónico con calidad de producto:**
  - **finAPI Access** (credenciales ya en el repo): **47 de 49 contrapartes alemanas categorizadas (95,9%)** y **0 comercios canónicos (0,0%)** `[V]`. Hace la otra mitad. No reemplaza a Tapix.
  - **name-suggestion-index** de OpenStreetMap (`npm i`, BSD-3-Clause, sin clave y sin red): **16/58 descriptores alemanes (28%)** y **21/68 españoles (31%)** `[V]`. Pero su **aporte marginal sobre nuestro motor es +2 descriptores en alemán y ruido en español**: de los 12 "comercios" españoles que agrega, los 12 son bancos en traspasos, pagos de tarjeta e hipotecas —donde poner un comercio es exactamente el error— y 3 de ellos son falsos positivos con aplomo (`Millennium` → hotel) `[V]`.
  - **Wikidata SPARQL** (sin clave): resuelve Mercadona (Q377705), Alcampo, El Corte Inglés y hasta Casa Lucio (Q5754310, "restaurante de Madrid"); y con `Hornbach` devuelve una página de desambiguación, una localidad de Renania-Palatinado y un apellido `[V]`. Es una fuente de datos, no un enriquecedor: la desambiguación la tenés que poner vos.
- **El corpus no da para decidir una compra.** 1.612 movimientos alemanes son **58 descriptores distintos** (49 contrapartes) y 720 españoles son **68** `[V]`. Un nombre acertado mueve 2 puntos porcentuales. Y el corpus alemán **es la demo de finAPI**: medir su categorizador contra sus propios datos de demostración es casi una tautología.
- **La vía barata del MCC no existe para nuestro dato.** El OpenAPI de finAPI (257 KB) tiene **cero ocurrencias de `mcc` y cero de `merchant`** `[V]`, y sus 23 campos de transacción no lo incluyen `[V]`. El MCC viaja por la red de tarjetas, no por el extracto. Sección 4.

**Decisión: seguimos con el motor propio, y no como consuelo.** El argumento no es "no hay nada bueno", es que **el hueco que dejamos abierto no es de comercios**. De los 17 descriptores españoles que el motor no resuelve, **sólo 3 o 4 son "comercio desconocido"** (B&H Photo, Casa Lucio, Joe's Stone Crab, quizá Citizens Property Insurance). Los otros 13 son impuestos (IBI, IMI, Miami-Dade), movimientos entre cuentas propias, distribuciones de fondos, saldos de apertura y certificaciones de obra `[V]`. **Ningún enriquecedor de comercios resuelve eso**; lo resuelven la memoria del hogar y la estructura, que es lo que estamos construyendo.

**Lo único que hay que hacer para cerrar esto cuesta €0 y diez minutos: dos altas gratuitas (Triqai y Context.dev) y `python3 medir.py triqai && python3 medir.py context`.** Con esos dos números —acierto sobre los 68 descriptores españoles, revisado a ojo— la compra se decide o se descarta con evidencia. Sin ellos, seguimos opinando.

---

## 1. La pregunta operativa: ¿clave y llamada en diez minutos?

| Candidato | ¿Hoy? | Qué lo bloquea exactamente |
|---|---|---|
| **finAPI Access** | **SÍ** `[V]` | Nada. Credenciales de sandbox en el repo. Token de usuario OK, 1.612 movimientos en 4,9 s |
| **name-suggestion-index** (OSM) | **SÍ** `[V]` | Nada. `npm i name-suggestion-index`, 22 MB, BSD-3-Clause, sin clave y sin red en caliente |
| **Wikidata SPARQL** | **SÍ** `[V]` | Nada. Sin clave, sin alta. Consultado hoy con `curl` contra `query.wikidata.org/sparql` |
| **MCC (tabla de códigos)** | **SÍ** `[V]` | Nada: 982 líneas de CSV de dominio público. Pero no tenemos MCC en el dato. Sección 4 |
| **Triqai** | **casi** `[V]` | Sólo falta que **vos** creés la cuenta. Free: 100 créditos/mes, 60 RPM / 1 RPS, sin tarjeta. El *playground* que anuncian "sin registro" es UI, no API: `POST https://api.triqai.com/v1/transactions/enrich` sin clave → `401 authentication_error: "API key is required"` `[V]` |
| **Context.dev** | **casi** `[V]` | Ídem: alta sin tarjeta. `POST https://api.context.dev/v1/brand/retrieve` sin clave → `401 Unauthorized: No API key provided` `[V]` |
| **Ntropy** | **NO** `[V]` | Su OpenAPI v2 existe y es real (24 rutas, `/v2/transactions/sync` y `/async`) `[V]`, pero el precio sólo está dentro del dashboard `[V]` y el alta es por cuenta. Mismo bloqueo, sin tarifario que compense el riesgo |
| **Trove (Headline)** | **NO** `[V]` | Su propia documentación: la API está *diseñada específicamente para optimizar el emparejamiento de transacciones financieras estadounidenses en inglés*, y advierte peor acierto en otros idiomas o regiones (trove.headline.com/docs) `[V]` |
| **Tapix, Quiltt, FinCleanse, Yodlee, Plaid, Basiq, BankSync, Spade** | **NO** | Ya documentado en las secciones 3 y 4 de `investigacion-proveedores-datos.md`. Nada cambió hoy |

**Los dos que hacen lo que necesitamos están a un formulario de distancia.** Es la frase entera del documento.

---

## 2. Tabla comparativa

| Candidato | Qué hace exactamente | Precio | ¿Alta autoservicio? | Cobertura española | Licencia / naturaleza |
|---|---|---|---|---|---|
| **Triqai** | Descriptor → comercio + categoría + logo + ubicación + confianza con motivos `[V, docs]` | **€0** (100 créditos/mes) · **€17/mes** (4.000) · €82 (25.000) · €274 (100.000). 1 crédito por transacción enriquecida; **los créditos no se acumulan** `[V]` | **Sí**, sin tarjeta en el free `[V]` | **No publicada.** Dicen "150+ países" para ubicaciones; de comercios españoles, nada `[?]` | SaaS. SDK oficial de Node/TS (`npm i triqai`) `[V]` |
| **Context.dev** | Descriptor → marca: dominio, título, logos, colores, industria, dirección `[V, docs]` | **$0** (500 créditos una vez con correo corporativo; **250 con Gmail**) · **$25/mes** Developer (10.000 créditos) · $149 Pro · $499 Scale. **10 créditos por llamada de marca**; overage $15 por 10.000 créditos `[V]` | **Sí**, sin tarjeta `[V]` | **No publicada.** Acepta `country_gl` con cualquier ISO-3166 alfa-2 `[V]`; que funcione para `es` es hipótesis `[?]` | SaaS. SDKs en varios lenguajes `[V]` |
| **finAPI Access** | Transacción **suya** → **su** categoría (jerarquía alemana). **No da comercio** `[V, medido]` | Incluido en Access (€320/mes de suelo, 24 meses) `[V, doc madre]`. *External Data Labeling*: €30/mes hasta 15.000 txn, luego €0,0016/txn `[V]` | **No.** Formulario, KYC, correos personales prohibidos `[V]` | Cero bancos españoles en el catálogo del sandbox `[V, §11.2 doc madre]` | SaaS regulado |
| **name-suggestion-index** | Marca canónica + etiquetas OSM (`shop=supermarket`…) + QID de Wikidata para colgar logo. **No limpia el descriptor** | **€0** | **No hace falta**: es un paquete npm | **Medible, y es el único que lo es: 546 marcas con `es` en su `locationSet`** (1.112 con `de`) de 18.973 bajo `brands/` `[V]` | **BSD-3-Clause**, versión `8.0.20260729` (publicada hace dos semanas: está vivo) `[V]` |
| **Wikidata** | Entidad canónica + QID + descripción; con SPARQL se puede sacar sector, sede, logo | **€0** | **No hace falta** | Amplia para marcas grandes y sorprendente en la cola larga (Casa Lucio existe) `[V]`; **ambigua sin desambiguación propia** `[V]` | CC0. Servicio público de la Wikimedia Foundation |
| **Tabla MCC** | Código de 4 dígitos → descripción de rubro | **€0** (981 códigos + cabecera, 982 líneas) | — | Universal (ISO 18245) | **Unlicense** (dominio público), `github.com/greggles/mcc-codes` `[V]` |
| **Trove (Headline)** | Descriptor → comercio con ficha de empresa | Se anuncia como *"Free Transaction Enrichment API"* `[V]` | Sí `[P]` | **Descartado por su propia doc: optimizado para EE.UU. en inglés** `[V]` | SaaS |
| **Ntropy** | Enriquecimiento completo | **No publicado** (sólo dentro del dashboard) `[V]` | Requiere cuenta | `[?]` | SaaS |

Los dos precios que importan, normalizados a **coste por descriptor distinto resuelto** (que es la unidad real, porque el resultado se cachea y un descriptor se consulta una vez en la vida):

| | Coste marginal por descriptor | Qué compra el plan de entrada |
|---|---|---|
| finAPI *External Data Labeling* | **€0,0016** `[V]` | 15.000 txn/mes por €30 — pero atado a su canal `[?]`, ver sección 5 |
| Triqai Starter | **€0,0055** de exceso `[V, doc madre]`; €17/mes = 4.000 créditos | ~58 altas de hogar al mes a 68 descriptores nuevos cada una `[I]` |
| Context.dev Developer | **$0,015** por llamada `[V]` | 1.000 llamadas/mes ≈ 14 altas de hogar `[I]` |

**El precio no es el problema.** A nuestro volumen, cualquiera de los tres cuesta menos que el café de una reunión. El problema es que **ninguno publica una sola evidencia de cobertura española**, y eso sólo se resuelve midiendo.

---

## 3. Lo que se midió hoy

### 3.1 El hallazgo que condiciona todo: el corpus no sirve de banco de pruebas

| | movimientos | **descriptores DISTINTOS** |
|---|---|---|
| Alemán (sandbox de finAPI, real) | 1.612 | **58** (49 contrapartes) |
| Español + resto (inventado) | 720 | **68** (46 de cuentas ES, 15 US, 9 PT) |

Las 1.612 alemanas son 58 cadenas repetidas ~28 veces cada una `[V]`. Cualquier "cobertura del 95,7% sobre 1.612" es en realidad **47 aciertos sobre 49 nombres**. Los números que ya circulaban (478/500, 95,7%) no son falsos: **miden otra cosa**, están inflados por repetición.

Y hay circularidad: **el corpus alemán es la demo de finAPI**. Que su categorizador acierte 47/49 sobre sus propios datos de demostración no dice nada sobre un descriptor real de Sparkasse, y menos aún sobre uno de BBVA.

Nota de método: no existe `entry.raw` en el esquema. Los descriptores viven en `entry.description` como `"contraparte · concepto"`, construido por el mapeador; el payload crudo de finAPI **no se persiste**. Se volvió a bajar del sandbox con las credenciales de `apps/web/.env.local`. La base no se tocó: sigue en 2.332 filas `[V]`.

### 3.2 finAPI Access: resuelve la mitad equivocada, y la resuelve bien

```
movimientos            : 1612
con categoría          : 1542 (95.7%)   ← el número inflado
contrapartes distintas :   49
contrapartes con cat.  :   47 (95.9%)   ← el número honesto
fallan                 : ['TueV Bayern', 'Winzergenossenschaft Nordheim']
con COMERCIO canónico  :    0 (0.0%)
```

**Devuelve:** categoría con jerarquía propia en alemán (23 categorías usadas de un catálogo de 79), `labels` (vacío), `cleanedPurpose` (**idéntico a `purpose` en el 100% de los casos** `[V]`).
**No devuelve:** comercio canónico, logo, ubicación, recurrencia, MCC, dominio. `counterpartName` es lo que dijo el banco, no un comercio normalizado.

**Acierto revisado a ojo sobre 15 descriptores alemanes de la muestra: 13 bien, 1 mal, 1 sin resolver** `[V]`. El error es instructivo: `VB Musterstadt · HERZLICHEN GLÜCKWUNSCH ZU IHREM GEWINN LOS 0815` (un premio del sorteo de ahorro) lo clasifica como **Freizeitaktivitäten**, ocio — cuando es un ingreso. El sin resolver es `TueV Bayern`, la ITV alemana. Nuestro motor, sobre ese mismo par, acierta `TÜV → coche_mantenimiento` y también falla el premio.

**Esto es lo decisivo: finAPI no reemplaza a Tapix.** Tapix vende `descriptor → comercio canónico`. finAPI vende `transacción suya → categoría suya`. Son productos distintos y nosotros necesitamos el primero.

### 3.3 name-suggestion-index: la biblioteca gratis que promete la mitad exacta y no la entrega

Índice construido para ES + DE + marcas mundiales: **2.336 marcas** `[V]`.

| | descriptores distintos | comercio canónico | categoría genérica |
|---|---|---|---|
| Alemán (real) | 58 | **16 (28%)** | 14 (24%) |
| Español (inventado) | 68 | **21 (31%)** | 19 (28%) |

Los 16 alemanes son casi todos correctos (Aldi, Edeka, Lidl, Rewe, Allianz, Hornbach, Ibis, Deutsche Bahn, Amazon). **Pero la precisión de la categoría no acompaña:** `Aral` (gasolinera) sale como **supermercado**, y en español `Millennium` —el banco portugués— sale tres veces como **viaje_alojamiento**, porque hay una cadena hotelera con ese nombre. **4 de 37 aciertos traen la categoría mal: un 11% de falsos positivos seguros de sí mismos** `[V]`. Un hueco va a la cola de revisión; un falso positivo va al informe del cliente.

Dos trampas que costaron tiempo y quedan documentadas en `motor_nsi.py`:

1. **`operators/` no es `brands/`.** Lidl, Mercadona y Rewe explotan puntos de recarga eléctrica, así que aparecen bajo `operators/amenity/charging_station`. Recorrer ese árbol primero clasifica cuatro supermercados como "carburante" con total aplomo `[V]`.
2. **Palabras que son marca en OSM y ruido en un descriptor bancario.** Sin una lista de paradas, `Max Mustermann · Sparen` resuelve a la cadena de ropa "Max" y `Casa Lucio` a la marca "CASA" `[V]`.

### 3.4 El número que mata la idea: el aporte marginal

La pregunta correcta no es "¿cuánto cubre NSI?" sino "**¿cuánto agrega NSI sobre lo que ya tenemos?**".

| | comercio: motor propio | NSI solo | **unión** | Aporte real de NSI |
|---|---|---|---|---|
| Alemán, 58 descriptores | 38 (66%) | 16 (28%) | **40 (69%)** | **+2**: `Agip` y `SB-Tank Hohenlohe`, dos gasolineras `[V]` |
| Español, 68 descriptores | 21 (31%) | 21 (31%) | **33 (49%)** | **+12, y los 12 son un error de concepto** `[V]` |

Los 12 "nuevos" españoles: `Hipoteca Casa Madrid — BBVA`, `Pago tarjeta CaixaBank Mastercard`, `Retirada de efectivo cajero BBVA`, `Transfer to Chase Savings`, `Traspaso a CaixaBank para gastos de casa`, `Intereses Millennium Poupança`… **son todos bancos en movimientos donde el comercio no existe.** Un traspaso a tu propia cuenta de CaixaBank no es una compra en "Caixabank": es un traspaso interno, y nuestro motor ya lo clasifica así por señal estructural. Poner ahí un comercio no mejora el informe, lo ensucia.

**En categoría, el aporte de NSI es +2 en alemán y +1 en español** `[V]`. Por eso NSI no entra hoy como capa: entra, si acaso, como **fuente de siembra del diccionario** —tomar sus 546 marcas españolas y volcarlas al diccionario propio, revisadas— que es una tarea de datos, no una dependencia en caliente.

### 3.5 Wikidata: fuente, no servicio

Consultado hoy contra `https://query.wikidata.org/sparql`, sin clave `[V]`:

| Consulta (etiqueta exacta en español) | Resultado |
|---|---|
| Mercadona | **Q377705** ✔ |
| Alcampo | **Q2832081**, "hipermercado español de origen aragonés" ✔ |
| El Corte Inglés | **Q623133**, "empresa de distribución de España" (+ dos centros concretos) ✔ |
| Casa Lucio | **Q5754310**, "restaurante de Madrid" ✔ — la cola larga existe |
| Hornbach | Página de desambiguación · localidad de Renania-Palatinado · apellido ✖ |
| Winzergenossenschaft Nordheim | sin resultados ✖ |

Es gratis, es CC0, no caduca y no depende de nadie que nos venda nada. Pero **la desambiguación y la limpieza del descriptor las tenés que poner vos**, que es justamente el trabajo. Sirve para enriquecer una marca que ya identificaste (logo, sector, sede), no para identificarla.

### 3.6 El motor propio, medido en el mismo banco

| | movimientos con categoría | descriptores distintos con categoría | descriptores con comercio |
|---|---|---|---|
| Alemán (1.612 mov. / 58 desc.) | 1.372 (**85,1%**) | 48/58 (**82,8%**) | 38/58 (66%) |
| Español (720 mov. / 68 desc.) | 669 (**92,9%**) | 51/68 (**75,0%**) | 21/68 (31%) |

Cara a cara sobre las **mismas 49 contrapartes alemanas** `[V]`:

| | categoría | comercio canónico |
|---|---|---|
| finAPI Access | **47/49 (96%)** | **0/49 (0%)** |
| Motor propio v0 | 41/49 (84%) | **33/49 (67%)** |

Doce puntos por debajo en categoría, sobre el corpus de demostración del propio finAPI, con ~150 líneas de tablas, sin red, sin IA y sin contrato. Y **ganando 33 a 0 en la única columna que compramos si compramos**.

---

## 4. El MCC: la respuesta más barata de todas, y no la tenemos

La hipótesis era buena: si nuestra fuente trae el *merchant category code*, categorizar una compra con tarjeta es un `JOIN` contra una tabla de 981 filas y no hay nada que comprar.

**Qué se verificó hoy:**

- **finAPI no lo expone.** Su especificación OpenAPI descargada del sandbox (257 KB) tiene **cero ocurrencias de `mcc`, `MCC`, `merchantCategory` y `merchant`** `[V]`. Y los 23 campos de una transacción son exactamente éstos `[V]`:
  `accountId · amount · bankBookingDate · category · cleanedPurpose · counterpartAccountNumber · counterpartBankName · counterpartBic · counterpartBlz · counterpartIban · counterpartName · currency · finapiBookingDate · id · importDate · isAdjustingEntry · isNew · isPotentialDuplicate · labels · purpose · type · typeCodeZka · valueDate`
- **No es un olvido suyo.** El MCC viaja por la red de tarjetas (ISO 18245): lo tiene el emisor de la tarjeta. Quien lee cuentas por PSD2 o FinTS ve el apunte del banco, no el mensaje de la red. `[I, consistente con todo lo observado]`
- **Norma 43 tampoco lo trae, y trae otra cosa que sí sirve.** Nuestro parser ya extrae `concepto_comun` (2 dígitos, posiciones 22–24) y `concepto_propio` (3 dígitos, 24–27) `[V, packages/importers/src/n43/parse.ts:210]`. Eso no es una categoría de comercio: es **el tipo de operación** (recibo domiciliado, transferencia, cheque, efectivo…). Es decir, alimenta la **capa estructural** del motor, que es la que ya funciona bien —y explica por qué el motor propio saca 92,9% de categoría en español con sólo 31% de comercios.
- **Si alguna vez llega, la tabla es gratis:** `github.com/greggles/mcc-codes`, **Unlicense** (dominio público), 981 códigos con descripción `[V]`. Descargada y guardada.
- **Señal de la industria:** Context.dev acepta `mcc` como **parámetro de entrada** para desambiguar, y su tabla de errores recomienda, cuando no hay marca, *"caer a un descriptor limpio + un icono de categoría basado en MCC"* `[V, docs]`. Es decir: hasta quien vende resolución de marca trata el MCC como la pista barata.

**Conclusión de la sección:** la vía "MCC + tabla de búsqueda" **no existe para nuestro tipo de dato hoy**, y sólo se abriría si (a) alguna fuente de tarjeta nos lo entregara, o (b) emitiéramos tarjeta, que no está en el producto.

**Lo que sí hay que hacer, y cuesta una tarde:** el estándar OFX define un elemento `<SIC>` (código de rubro) dentro de `STMTTRN` `[P]`, y **nuestro parser de OFX no lo lee** `[V]`. Aunque casi ningún banco lo rellene, ignorarlo es tirar un dato gratis. Acción concreta: **leer `<SIC>` y `<PAYEEID>` si vienen, guardarlos, y contar en cuántos ficheros reales aparecen.** Si aparece en un 20% de los OFX de tarjetas, es la vía barata resucitada; si aparece en el 0%, se cierra la pregunta con datos y no con teoría.

---

## 5. Lo que ya pagamos (o pagaríamos): la categorización incluida en finAPI

**Medida, no leída:** 1.542/1.612 movimientos, 47/49 contrapartes, 23 categorías de un catálogo de 79 con 12 raíces (Mobilität, Einnahmen, Bank & Kredit, Gesundheit & Wellness, Freizeit, Kinder, Shopping, Lebenshaltung, Reisen, Versicherung, Wohnen, Sparen & Anlegen) `[V]`.

**¿Sirve para movimientos que no vengan de sus conexiones? No.** `[V]`

```
POST /api/v2/bankConnections          → 405 Method Not Allowed
POST /api/v2/accounts                 → 405 Method Not Allowed
POST /api/v2/transactions/triggerCategorization → 200, pero sólo sobre los
                                        movimientos que ya tiene ese usuario
GET  /api/v2/api-docs                 → 404
(con token de cliente, todos los endpoints de datos → 403)
```

No hay endpoint de texto libre. **No se le puede pasar un descriptor español para medirlo**, ni un movimiento de un fichero Norma 43, ni uno de un OFX. Su motor sólo ve lo que entra por sus propias conexiones — y su catálogo no tiene un solo banco minorista español `[V, §11.2 del doc madre]`.

Queda una puerta sin abrir: **finAPI *External Data Labeling*, €30/mes hasta 15.000 transacciones** `[V]`, que por nombre sí sugiere "datos externos". **No está verificado que acepte transacciones ajenas por API, ni con qué formato, ni si arrastra los 24 meses de permanencia de Access** `[?]`. Es la primera pregunta del correo de la sección 8: si la respuesta fuera "sí, acepta un CSV o un POST con descriptores", cambiaría el cálculo —€0,0016 por descriptor es el precio más bajo de todo el dossier— aunque seguiría entregando **su** categoría alemana y **no** un comercio canónico.

| Camino de entrada | ¿lo categoriza finAPI? |
|---|---|
| Conexión de finAPI (Alemania, Austria y sus 13 países) | **Sí, 95,7%, en alemán** `[V]` |
| Fichero OFX/QFX/QIF/CSV/Norma 43 | **No.** No acepta el dato `[V]` |
| Cualquier cosa española | **No.** No hay bancos españoles en su catálogo `[V]` |

---

## 6. Comprar contra construir, con los números de hoy

Lo que compraríamos, exactamente: **descriptor → comercio canónico + categoría genérica + logo + ubicación**. Nada más. La categoría *nuestra* (Casa Madrid, sociedad, reparto 60/40) no la vende nadie y no la venderá nunca.

| | **Comprar** (Triqai o Context.dev) | **Construir** (lo que hay hoy) |
|---|---|---|
| Cobertura alemana medida | `[?]` — no se pudo medir | 82,8% categoría · 66% comercio `[V]` |
| Cobertura española medida | `[?]` — no se pudo medir | 75,0% categoría · 31% comercio `[V]` |
| Coste | €17/mes o $25/mes; ~€0,0055 / $0,015 por descriptor nuevo `[V]` | €0 de licencia; el tiempo de mantener el diccionario `[I]` |
| Latencia | red, con caché por descriptor `[I]` | nanosegundos, en proceso |
| Riesgo de dependencia | proveedor joven, sin cobertura ES publicada, créditos que caducan `[V]` | ninguno |
| Qué mejora con el uso | nada nuestro | **la memoria del hogar**: cada corrección del cliente vale para siempre |
| Qué resuelve del residuo | 3–4 de 17 huecos españoles `[V, ver abajo]` | el resto |

**El argumento que decide, y no es de precio.** Los 17 descriptores españoles sin resolver, clasificados por qué son de verdad `[V]`:

| Qué es | Cuántos | ¿Lo arregla un enriquecedor de comercios? |
|---|---|---|
| Impuestos y tasas (`IBI Casa Madrid`, `IMI Piso Lisboa`, `Miami-Dade property tax`) | 3 | **No.** No hay comercio |
| Movimientos entre cuentas propias (`Cargo TRF 5022 sin concepto`, `Transferencia enviada a cuenta propia`, `Transferência recebida de conta própria`, `Transferencia BBVA a Chase`) | 4 | **No.** Son estructura, y ya los coge la capa estructural cuando el concepto no viene vacío |
| Flujos financieros (`Distribución fondo Arcano IX`, `Schwab cash sweep interest`) | 2 | **No.** Y es donde el ICP tiene el dinero |
| Saldos de apertura del histórico (EUR y USD) | 2 | **No.** Son artefactos de importación |
| Obra y proveedores del hogar (`Reforma cocina Madrid — certificación de obra`) | 1 | **No** |
| Negocios locales y comercio con nombre propio (`Casa Lucio`, `Joe's Stone Crab`, `B&H Photo New York`, `Citizens Property Insurance — Miami`) | 4 | **Quizá.** Son el 24% del residuo `[V]` |

**Comprar enriquecimiento de comercios compra, como mucho, una cuarta parte del hueco español que tenemos abierto** — y lo compra en la parte del gasto (restaurantes, retail) que menos pesa en el informe de un hogar con estructura. Para una app de presupuesto de consumo, Tapix es el producto entero. **Para un Personal CFO de patrimonio complejo, es un accesorio.**

Y hay una asimetría que no se ve en la tabla: **el error de un proveedor no se puede arreglar**. Cuando Triqai diga que `Traspaso a CaixaBank` es una compra en CaixaBank, hay que escribir una regla que lo desmienta — es decir, hay que construir el motor igual, además de pagarlo.

**Lo honesto en la otra dirección:** el motor propio tiene un techo bajo y conocido. 31% de comercios canónicos en español es poco, el diccionario lo mantenemos nosotros, y cada marca nueva es trabajo manual. Si el producto llega a mil hogares españoles, ese trabajo no escala y **entonces sí** hay que comprar. Lo que dice la medición no es "nunca", es "**todavía no, y no por las razones que creíamos**".

---

## 7. Recomendación y disparadores

**Recomendación: no comprar. Seguir con el motor propio como suelo permanente del producto, no como puente.** Y cerrar la pregunta con dos altas gratuitas, que es lo único que falta para tener evidencia en vez de opinión.

**Ahora, coste €0:**

1. **Dar de alta Triqai y Context.dev** (cinco minutos, sin tarjeta) y correr `python3 medir.py triqai` y `python3 medir.py context`. Ojo con Context.dev: **con Gmail son 250 créditos = 25 consultas**, no 500; conviene el correo del dominio de la empresa `[V]`.
2. **Revisar los resultados a ojo, no por porcentaje.** La pregunta es cuántos de los 68 descriptores españoles devuelven el comercio *correcto*, no cuántos devuelven algo.
3. **Sembrar el diccionario propio con las 546 marcas españolas de NSI**, revisadas a mano, sin meter NSI como dependencia en caliente. Es la única parte de NSI que sobrevivió a la medición.
4. **Leer `<SIC>` y `<PAYEEID>` en el parser de OFX** y contar en cuántos ficheros reales aparecen (sección 4).
5. **Conseguir un corpus español de verdad.** Es el trabajo más valioso de esta lista y el más aburrido: 300–500 descriptores reales de BBVA, CaixaBank, Santander y Sabadell, de extractos propios o de un cliente piloto. Con 68 descriptores inventados no se compra nada.

**Disparadores (condición → acción), sin fechas:**

| Cuando pase esto | Hacer esto |
|---|---|
| Triqai o Context.dev acierten **≥70% de comercios correctos, revisados a ojo, sobre 300+ descriptores españoles reales** | Contratar el plan de €17/$25 y meterlo como capa 4, por detrás de la memoria del hogar, nunca por delante |
| Ninguno pase del 40% en español | Cerrar la pregunta por seis meses y volcar ese tiempo en la memoria del hogar y en las reglas |
| El diccionario propio pase de **~300 marcas** o la cola de revisión manual pase de **30 minutos al mes por hogar** | Comprar, aunque el acierto sea mediocre: a esa altura el coste es de nuestro tiempo, no del proveedor |
| Aparezca un cliente español de pago que traiga tarjetas con MCC en el extracto | Reabrir la sección 4: la tabla ya está descargada |
| finAPI confirme que *External Data Labeling* acepta transacciones externas por API sin arrastrar los 24 meses | Medirlo: €0,0016 por descriptor es el precio más bajo del dossier |
| Tapix conteste y mande el CSV enriquecido sobre nuestro corpus | Usarlo como **patrón de oro** para medir a los demás, aunque no se le compre nada |

**Lo que haría fracasar esta decisión, y hay que vigilar:** que el motor propio se quede en 31% de comercios españoles *y* nadie mida a los candidatos, con lo cual dentro de seis meses volvemos a tener esta misma conversación sin un dato nuevo. El antídoto son las dos altas de arriba.

---

## 8. Las preguntas que quedan, y a quién se le hacen

### 8.1 Triqai — en inglés

> Subject: Merchant coverage for Spain — evaluation before subscribing
>
> We're evaluating Triqai for a personal-finance product serving households in Spain (second market: Germany). Before subscribing to Starter, three questions:
>
> 1. **Spanish coverage.** Do you have any figure for merchant resolution on Spanish card and direct-debit descriptors (BBVA, CaixaBank, Santander, Sabadell)? A hit rate, a sample, or a merchant count for Spain — anything measured.
> 2. **We'll send you a corpus.** Can we send ~300 real Spanish descriptors and get back your enriched output, as Tapix offers? We'd rather measure than read.
> 3. **Credits.** The free tier is 100 credits/month and unused credits don't carry over. For an evaluation, is there a one-off larger allowance? And does a `partial` result consume a credit?

### 8.2 Context.dev — en inglés

> 1. `country_gl` accepts any ISO-3166 alpha-2 code. **Is `es` actually backed by Spanish merchant data**, or does the resolver fall back to global brands for non-US countries?
> 2. Your docs say a brand call costs 10 credits and a miss returns 400. **Does a 400 consume credits?**
> 3. Do you have any measured hit rate for European bank descriptors as opposed to US card descriptors?

### 8.3 finAPI — en inglés, al dominio de la empresa (los correos personales están prohibidos)

> 1. **External Data Labeling, €30/month up to 15,000 transactions: can it label transactions that did *not* come from a finAPI bank connection** — e.g. transactions we upload from a CSV or a Spanish CSB43 file? If yes, which endpoint, and is it available without the 24-month Access commitment?
> 2. Does the categorisation ever return a **normalised merchant name** (not `counterpartName` as the bank sent it), or a merchant identifier we could join on?
> 3. Is the category taxonomy available **in Spanish**, or is German the only language?

### 8.4 Tapix — en inglés (reiterando lo del doc madre)

> Your sandbox requires a browser login and the portal token doesn't authenticate API calls. **Is there a way to get an API key for a technical evaluation without a sales call?** If not, we'll take you up on the CSV offer: we'll send ~300 real Spanish descriptors.

### 8.5 Lo que no se le pregunta a nadie

Cuántos comercios españoles cubren "en total". Ese número no significa nada. **La única respuesta que sirve es el CSV enriquecido sobre nuestro corpus.**

---

## 9. Qué quedó sin verificar

| Afirmación | Estado | Cómo se cierra |
|---|---|---|
| Acierto real de Triqai y Context.dev en España | `[?]` **La pregunta central del documento, sin respuesta** | Dos altas gratuitas + `medir.py`. Diez minutos |
| Que el free tier de Triqai/Context.dev funcione tal como lo documentan | `[P]` — el precio y los límites están verificados en su web; el comportamiento del alta, no | Ídem |
| `External Data Labeling` de finAPI acepta datos externos | `[?]` | Correo 8.3 |
| OFX define `<SIC>` en `STMTTRN` | `[P]` | Abrir la especificación OFX 2.x y contarlo en ficheros reales |
| Cobertura de NSI para comercios españoles reales | `[P]` — 546 marcas con `es` está verificado; que sean *las* que aparecen en un extracto, no | Medir contra corpus español real |
| Que el corpus alemán represente descriptores bancarios reales | **`[?]` y con sospecha fundada** | Es la demo de finAPI. Sólo se cierra con extractos reales |
| Ntropy: precio y cobertura | `[?]` | Sólo visible tras crear cuenta |

---

## 10. Resumen para quien lea sólo esto

1. **Nada probable hoy por API hace descriptor → comercio canónico.** Los dos que lo harían (Triqai €0–17/mes, Context.dev $0–25/mes) son autoservicio, sin tarjeta, y están a un formulario de alta que tenés que rellenar vos.
2. **finAPI no es el reemplazo de Tapix:** 96% de categorías alemanas, **0% de comercios**.
3. **La biblioteca gratis (NSI) no rinde:** +2 descriptores alemanes y ruido en español. Sirve como semilla del diccionario, no como capa.
4. **El MCC no está en nuestro dato** y no lo va a estar mientras no emitamos tarjeta. La tabla, por si acaso, ya está descargada y es de dominio público.
5. **El residuo que no resolvemos no son comercios**: son impuestos, traspasos propios, flujos financieros y obra. Comprar enriquecimiento compra, como mucho, una cuarta parte del hueco.
6. **Seguimos con el motor propio** — y con un corpus español real como la tarea más valiosa de la semana, porque sin él ninguna de estas decisiones se puede volver a tomar mejor.

---

## 11. Plaid mide el enriquecimiento sobre descriptores españoles

**Fecha:** 13 de agosto de 2026 (pasada posterior a las secciones 1–10 del mismo día)
**Pregunta que contesta:** las secciones anteriores se quedaron sin el número que decide, porque los dos candidatos que hacían el trabajo estaban detrás de un formulario de alta. Plaid no: las credenciales del sandbox ya están, y Plaid **trae su propio enriquecimiento incluido** (`merchant_name`, `counterparties`, `personal_finance_category`). Así que la pregunta es directa: **con Plaid como agregador, ¿hace falta comprar enriquecimiento aparte, o el motor propio alcanza?**
**Método:** medición contra el sandbox de Plaid, reproducible con los scripts del scratchpad (`medir-enriquecimiento.mjs`, `revision-a-ojo.mjs`, `descriptores-es.mjs`). Todas las llamadas HTTP, del 13-08-2026.

### 11.0 Veredicto

**No hace falta comprar enriquecimiento de comercios. Y no porque Plaid lo resuelva —resuelve 11 de 25— sino porque hace bien lo único que un comprador externo hacía mal: no inventa.**

- **La vía se abrió.** `/transactions/enrich` sigue rechazando descripciones libres en sandbox, pero el **usuario de sandbox a medida** deja meter nuestras propias transacciones y leerlas ya pasadas por el motor de Plaid. Medido de verdad, no leído `[V]`.
- **Categoría: 40/40 en español y 58/58 en alemán.** Plaid siempre pone una `personal_finance_category` `[V]`. Cobertura del 100%, que es justo lo que finAPI daba (96%) y lo que el motor propio no necesita comprar.
- **Comercio: 11/40 en español (27,5%)** `[V]`. Sobre los 25 descriptores que **sí** deberían llevar comercio, acierta **11 (44%)**.
- **El número que importa, revisado a ojo: de una muestra de 25, 19 están BIEN**, 1 casi y 5 mal `[V]`. Sobre los 40 completos: **31 bien, 2 casi, 7 mal (77,5%)**.
- **Y el hallazgo que cambia la conversación: de los 15 movimientos que NO debían llevar comercio —impuestos, traspasos propios, hipoteca, Bizum, cajero, comunidad— Plaid inventó CERO** `[V]`. En alemán, cero sobre 13. **Veintiocho oportunidades de equivocarse y ninguna aprovechada.** Es exactamente el contrario del resultado de name-suggestion-index en §3.4, que inventaba doce comercios justo en esas filas. `PAGO TARJETA CREDITO BBVA` lo resuelve poniendo BBVA como `financial_institution`, **no** como comercio: la distinción que nos importaba, hecha por ellos.
- **El español no sale peor que el alemán. Sale mejor:** 77,5% bien contra 70,7% del corpus alemán de control `[V]`. La hipótesis de "Plaid es un producto estadounidense y en España se cae" **no se sostiene con este dato**.

**Decisión que sugiere la medición: seguir con el motor propio y usar la `personal_finance_category` de Plaid como señal de entrada, no como veredicto.** No se compra nada. El detalle está en §11.6.

### 11.1 Cómo se midió (la vía que sí funciona)

`/transactions/enrich` no sirve en sandbox. Comprobado hoy con un descriptor español `[V]`:

```
POST /transactions/enrich   {"description":"RECIBO IBERDROLA CLIENTES SAU", ...}
400  INVALID_SANDBOX_TRANSACTION — "description must match a preset transaction"
```

La vía que sí funciona es el **usuario de sandbox a medida**: `/sandbox/public_token/create` con `options.override_username = "user_custom"` y `options.override_password` = el JSON de configuración. Se le dan a Plaid nuestras propias cuentas y movimientos, se canjea el token y se leen por `/transactions/sync` **ya enriquecidos por su motor** `[V]`.

Lo decisivo del método: **la configuración sólo admite `date_transacted`, `date_posted`, `amount`, `description` y `currency`.** No hay forma de pasarle el comercio ni la categoría. Todo lo que devuelve en `merchant_name`, `counterparties` y `personal_finance_category` **lo pone Plaid** `[V]`. La medición no puede ser circular por construcción.

Se usó **`ins_76` (CaixaBank)** como entidad, no un banco estadounidense: si el motor mira la institución o el país para desambiguar, que lo haga a nuestro favor `[V]`.

Tres cautelas de método, y las tres importan:

1. **La primera pasada midió mal y se detectó a tiempo.** `/transactions/sync` devolvió `HISTORICAL_UPDATE_COMPLETE` con `has_more: false` cuando todavía faltaban movimientos: **7 de 40**, justo los siete días más recientes. Un porcentaje calculado ahí habría estado inflado sobre un denominador roto. Se arregló sondeando hasta que varias vueltas seguidas no traen nada, y **contrastando con `/transactions/get` sobre todo el rango**. Los dos endpoints coinciden en 40, 58 y 58 `[V]`. *Si alguien reusa este script, el bug está en el estado de sync, no en el cursor.*
2. **Es determinista.** El corpus español se midió dos veces completas y las 40 filas coinciden en comercio y categoría `[V]`. Los números no son una tirada de dados.
3. **Los 40 descriptores españoles los construí yo**, con la forma de un extracto español pero sin ser uno. `[I]` Es la misma limitación que ya tiene el corpus `seed` de la base (§3.1) y **no se cierra hasta que haya extractos españoles reales**. El corpus alemán, en cambio, es el que ya está en la base (hogar `aaaa1111…`, formato `finapi`, 58 descriptores distintos) — pero es la demo de finAPI, con la misma sospecha de §3.1.

### 11.2 Cobertura, en crudo

| | español (40, construidos) | alemán (58, los de la base) |
|---|---|---|
| `personal_finance_category` asignada | **40/40 (100%)** | **58/58 (100%)** |
| …con hoja poco informativa (`*_OTHER_*`) | 4 (10%) | 8 (13,8%) |
| `merchant_name` asignado | **11/40 (27,5%)** | **11/58 (19,0%)** |
| …sobre los que **sí** debían llevar comercio | **11/25 (44%)** | 11/45 (24,4%) |
| …**comercios inventados** donde no debía haberlos | **0 de 15** | **0 de 13** |
| `merchant_entity_id` / `website` / `logo_url` | 4/40 (10%) | 8/58 (13,8%) |
| `merchant_category_code` (MCC) | **0/40** | **0/58** |
| ramas primarias distintas usadas | 9 | 12 |

Tres lecturas que no se ven en la tabla:

- **El MCC sigue sin existir, ahora confirmado en un segundo proveedor.** Cero en 156 movimientos `[V]`. La §4 daba esto por cerrado con finAPI; Plaid lo cierra otra vez. El MCC viaja por la red de tarjetas y no llega al extracto, y punto.
- **`merchant_name` sin marca:** de los 11 comercios españoles resueltos, **sólo 4 traen logo y web** (Carrefour, Lidl, Vodafone, Amazon). Los otros siete —Mercadona, Alcampo, Orange, Renfe, Cabify, CEPSA, El Corte Inglés— son **nombre y nada más** `[V]`. Si el diseño contaba con el logo del comercio en la ficha del movimiento, el dato llega en el 10% de los casos, no en el 27,5%.
- **La categoría heredada (`category`, la de dos niveles) es basura y no hay que tocarla.** `RECIBO IBI AYUNTAMIENTO DE MADRID` sale como `["Shops","Clothing and Accessories"]`, y `ADEUDO TASA RESIDUOS URBANOS` como `["Food and Drink","Restaurants"]`, mientras la `personal_finance_category` de la misma fila acierta `[V]`. Está deprecada y se nota. **Usar sólo `personal_finance_category`.**

### 11.3 La confianza: el campo que pedía el encargo y que el sandbox no da

Se pidió medir la categoría **"y con qué confianza"**. La respuesta honesta:

**`personal_finance_category.confidence_level` vale `UNKNOWN` en los 156 movimientos de las tres corridas** `[V]`. No hay un solo `HIGH`, `MEDIUM` ni `LOW`. **En sandbox ese campo no se puede medir**, y cualquier número que se publicara sobre él estaría inventado. `[?]` Sólo se cierra en producción o preguntándoles.

El otro campo de confianza, el de `counterparties[].confidence_level`, **sí viene relleno — y es inútil como filtro**: vale `VERY_HIGH` en las 12 contrapartes españolas y en las 11 alemanas, **el 100%** `[V]`. No hay gradación: cuando Plaid encuentra un comercio, siempre dice estar segurísimo. Eso significa que **no se puede usar la confianza para decidir qué mandar a revisión manual**. Lo bueno es que, en este corpus, esa seguridad estaba justificada: cero falsos positivos.

### 11.4 Los 25 revisados a ojo

Criterio, el mismo para los dos corpus: **BIEN** = sirve tal cual en el informe de un cliente (categoría correcta, y comercio bien puesto **o bien ausente**); **CASI** = rama principal correcta, hoja imprecisa; **MAL** = es otra cosa, o se queda sin resolver.

| | BIEN | CASI | MAL |
|---|---|---|---|
| **Muestra de 25 españoles** (es01–es25) | **19** | 1 | 5 |
| Los 40 españoles completos | **31 (77,5%)** | 2 | 7 |
| Los 58 alemanes de control | **41 (70,7%)** | 4 | 13 |

Los veredictos están escritos uno a uno en `revision-a-ojo.mjs`, con el motivo de cada fallo, para que se puedan discutir de a uno y no en bloque.

**Dónde se equivoca en español, con el descriptor y lo que puso** `[V]`:

| Descriptor | Puso | Por qué está mal |
|---|---|---|
| `COMPRA TARJ. 1234 DIA RETAIL ESPANA SAU` | `GENERAL_MERCHANDISE_OTHER`, sin comercio | DIA es una cadena de supermercados presente en toda España |
| `RECIBO IBERDROLA CLIENTES SAU` | `GENERAL_SERVICES_OTHER`, sin comercio | **La mayor eléctrica española.** Y sí acierta Endesa y Naturgy en las filas de al lado |
| `ADEUDO AMPA CEIP CERVANTES CUOTA ANUAL` | `GENERAL_SERVICES_INSURANCE` | La cuota del AMPA de un colegio no es un seguro |
| `TRANSFERENCIA UNIVERSIDAD COMPLUTENSE MATRICULA` | `TRANSFER_OUT_ACCOUNT_TRANSFER` | Leyó "TRANSFERENCIA" y paró. Una matrícula es educación |
| `REPSOL E.S. 12345 MADRID COMPRA TARJ` | `GENERAL_MERCHANDISE_OTHER`, sin comercio | **La mayor red de gasolineras de España.** Acierta CEPSA y Galp al lado |
| `BIZUM DE MARIA GARCIA LOPEZ` | `OTHER_OTHER` | Bizum recibido: se queda sin resolver |
| `BIZUM A JUAN PEREZ CENA DEL SABADO` | `FOOD_AND_DRINK_RESTAURANT` | **El error peligroso:** es un envío a una persona, y el motor se quedó con la palabra "CENA" del concepto |
| `RECIBO IBI AYUNTAMIENTO DE MADRID` *(casi)* | `GOVERNMENT_DEPARTMENTS_AND_AGENCIES` | Rama correcta; la hoja debería ser `TAX_PAYMENT` |
| `TRANSFERENCIA COMUNIDAD PROPIETARIOS` *(casi)* | `TRANSFER_OUT_ACCOUNT_TRANSFER` | Mecánicamente es una transferencia; económicamente es gasto de vivienda |

**El patrón de los fallos es más útil que la lista:** Iberdrola, Repsol y DIA no fallan por ser españoles —Vodafone, Orange, Renfe, Cabify, CEPSA, Mercadona, Alcampo y El Corte Inglés salen bien—, fallan por ser **las marcas grandes que un diccionario propio de veinte líneas resuelve el primer día**. Es el hueco más barato de tapar que existe.

**Y los correctamente "sin comercio", que se cuentan aparte de los fallos** `[V]` — 15 de 15, ni uno inventado:

| Descriptor | Categoría, sin comercio |
|---|---|
| `ADEUDO AEAT IRPF MOD 130 TRIMESTRAL` | `GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT` |
| `IMPUESTO VEHICULOS TRACCION MECANICA AYTO` | `GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT` |
| `RECIBO IBI AYUNTAMIENTO DE MADRID` | `GOVERNMENT_DEPARTMENTS_AND_AGENCIES` |
| `ADEUDO SEGURIDAD SOCIAL RETA AUTONOMOS` | `GOVERNMENT_DEPARTMENTS_AND_AGENCIES` |
| `ADEUDO TASA RESIDUOS URBANOS AYUNTAMIENTO` | `RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT` |
| `TRASPASO A CUENTA PROPIA ES91 2100 0418 45` | `TRANSFER_OUT_ACCOUNT_TRANSFER` |
| `TRANSFERENCIA A MI CUENTA AHORRO OPENBANK` | `TRANSFER_OUT_ACCOUNT_TRANSFER` — **no inventó "Openbank"** |
| `PAGO TARJETA CREDITO BBVA LIQUIDACION MENSUAL` | `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT` — **BBVA como `financial_institution`, no como comercio** |
| `REINTEGRO CAJERO 4B OFICINA 1234` | `TRANSFER_OUT_WITHDRAWAL` |
| `AMORTIZACION PRESTAMO HIPOTECARIO 0182 4567` | `LOAN_PAYMENTS_MORTGAGE_PAYMENT` |
| `BIZUM ENVIADO A ANA MARTINEZ REGALO` | `TRANSFER_OUT_ACCOUNT_TRANSFER` |
| `TRANSFERENCIA COMUNIDAD PROPIETARIOS` | `TRANSFER_OUT_ACCOUNT_TRANSFER` |
| `ADEUDO AMPA CEIP CERVANTES` | (categoría mal, pero sin comercio: correcto) |
| `BIZUM DE MARIA GARCIA LOPEZ` | (sin resolver, pero sin comercio: correcto) |
| `BIZUM A JUAN PEREZ CENA DEL SABADO` | (categoría mal, pero sin comercio: correcto) |

### 11.5 El grupo de control alemán, y dos cosas que salieron de él

Sobre los 58 descriptores reales de la base: **41 bien, 4 casi, 13 mal (70,7%)** `[V]`. Los fallos son del mismo tipo que en español y algunos son llamativos: `Hornbach` (bricolaje) → **supermercado**; `Aral` y `SB-Tank` (gasolineras) → **restaurante** y **ferretería**; `Tengelmann` (supermercado) → **bricolaje**; y las tres nóminas y el dividendo clasificados como traspasos o servicios en vez de **ingresos**, que para un CFO personal es el error caro.

Contra finAPI sobre este mismo corpus: finAPI categorizaba 47/49 contrapartes (§3.2) y **0 comercios**; Plaid categoriza 58/58 y **11 comercios**. La comparación de *acierto* no es cara a cara —la revisión a ojo de finAPI fue sobre 15 descriptores y ésta sobre 58— así que se deja como indicativa `[I]`. Lo que sí es directo: **Plaid da comercios donde finAPI daba cero, y da la categoría igual de siempre.** Y resuelve `Winzergenossenschaft Nordheim` (cooperativa vinícola → `BEER_WINE_AND_LIQUOR`), que era uno de los dos que finAPI no resolvía.

Dos hallazgos que no se buscaban y afectan a código nuestro:

- **El separador `·` de nuestro mapeador degrada el enriquecimiento de terceros.** Se midió el corpus alemán dos veces, con `·` y sustituyéndolo por un espacio: **6 de 58 filas cambian de resultado, y en 5 el cambio es a mejor** (la sexta pasa de un error a otro) `[V]`. Los tres `Max Mustermann · Sparen` (traspasos a ahorro) pasan de **`CLOTHING_AND_ACCESSORIES`** y **`HAIR_AND_BEAUTY`** a `TRANSFER_OUT_ACCOUNT_TRANSFER`, y `Tengelmann` pasa de bricolaje a **supermercado**, que es lo correcto. El `·` lo pone `packages/importers/src/finapi/map.ts` para unir contraparte y concepto y **no sale de ningún banco**. *Acción concreta: cuando se mande un descriptor a un enriquecedor externo, mandar el texto sin el separador.*
- **Plaid rompe los acentos en su propia base de comercios.** Para `PAGO EN EL CORTE INGLES SA MADRID` devuelve `merchant_name` = **`"El Corte Ingl?s"`** — un signo de interrogación ASCII literal, U+003F, verificado por punto de código `[V]`. No es nuestra codificación: nosotros mandamos el descriptor sin tildes y el `?` viene en su respuesta. Para un producto español esto no es cosmético: **si se muestra `merchant_name` tal cual, el cliente ve el nombre roto**. Hay que normalizar a la salida. (En la misma línea, el `Aldi` alemán viene con `website: aldi.us` — la resolución de entidades tira a Estados Unidos.)

### 11.6 Qué significa esto para la decisión

**Sobre comprar enriquecimiento de comercios: la respuesta se mantiene en NO, y ahora con el número que faltaba.**

El argumento de §0 —"el hueco que dejamos abierto no es de comercios"— **queda confirmado desde el otro lado**. De los 40 descriptores españoles, **15 no deben llevar comercio**: impuestos, traspasos propios, hipoteca, tarjeta, cajero, comunidad y Bizum. Eso es el **37,5% del corpus** donde un enriquecedor de comercios, por definición, no tiene nada que vender. Comprar resolución de marca para ese 37,5% no es caro: es **contraproducente**, y §3.4 ya mostró a NSI haciendo exactamente ese daño.

Lo que Plaid aporta gratis, incluido en la agregación que de todos modos vamos a contratar:

1. **Categoría en el 100% de los movimientos**, con un 77,5% de acierto a ojo en español. Como **señal de entrada** del motor propio —una columna más, junto al `concepto_comun` de la Norma 43 y las reglas del hogar— es un punto de partida mucho mejor que el vacío.
2. **Comercio en el 44% de los que lo tienen**, sin un solo falso positivo en 28 oportunidades. Es la propiedad que ningún candidato de §2 pudo demostrar.
3. **La distinción comercio / entidad financiera hecha por ellos** (`counterparties[].type`), que es justo la que hacía falta para no ensuciar traspasos y pagos de tarjeta.

**Lo que NO hay que hacer con esto** `[I]`:

- **No usar `personal_finance_category` como veredicto.** Un 22,5% de error, con un `confidence_level` que no se puede leer y una confianza de contraparte que siempre dice `VERY_HIGH`, no se publica en el informe de un cliente sin pasar por el motor propio y por las reglas del hogar.
- **No mostrar `merchant_name` sin normalizar**, por lo de los acentos.
- **No tirar el motor propio para la capa estructural.** Los tres errores más caros del corpus —matrícula universitaria como traspaso, Bizum a una persona como restaurante, nóminas alemanas como servicios— son de **estructura**, y la estructura es exactamente lo que el motor propio resuelve bien (92,9% de categoría en español, §3.6) con señal de Norma 43 y memoria del hogar.

**El trabajo barato que sale de acá, por orden de rendimiento** `[I]`:

1. **Veinte marcas españolas al diccionario propio.** Iberdrola, Repsol y DIA son tres de los cinco fallos de la muestra, y son las tres marcas más obvias del país. Una tarde de datos vale más que cualquier suscripción de §2.
2. **Regla de Bizum por estructura, no por texto.** `BIZUM` en el descriptor ⇒ P2P, e ignorar el concepto libre. Mata el falso `RESTAURANT` y el `OTHER_OTHER` de un golpe.
3. **Quitar el `·` antes de mandar texto a cualquier enriquecedor externo.**
4. **Normalizar `merchant_name` a la entrada** (el `Ingl?s`).

### 11.7 Qué quedó sin verificar en esta sección

| Afirmación | Estado | Cómo se cierra |
|---|---|---|
| Que estos 40 descriptores se parezcan a un extracto español real | `[I]` **los construí yo** | Sigue siendo la tarea más valiosa: un extracto español de verdad |
| `personal_finance_category.confidence_level` en producción | `[?]` — `UNKNOWN` en 156/156 en sandbox | Medir en producción, o preguntarles |
| Que el enriquecimiento de sandbox sea el mismo motor que el de producción | `[?]` **no verificado, y condiciona todos los números de arriba** | Preguntar a Plaid, o comparar contra un Item real |
| Que el corpus alemán represente descriptores bancarios reales | `[?]` — heredado de §3.1 | Es la demo de finAPI; sólo se cierra con extractos reales |
| Acierto de Plaid contra Triqai / Context.dev sobre el mismo corpus | `[?]` | Los 40 descriptores ya están en `descriptores-es.mjs`: el día que haya clave, se corre igual |

**La pregunta abierta más incómoda es la tercera**, y conviene decirla fuerte: **no está verificado que el motor de enriquecimiento del sandbox sea el de producción.** Si en producción fuera mejor, estos números son un suelo; si fuera peor, son un techo. No se puede saber desde acá `[?]`. Todo lo de arriba se lee con esa condición encima.
