# Proveedores de datos bancarios y enriquecimiento — documento de decisión

**Fecha:** 13 de agosto de 2026
**Pregunta que contesta:** ¿existe hoy un proveedor al que pagarle una suscripción razonable para conectar cuentas bancarias españolas sin firmar mínimos de miles de dólares al mes? ¿Y existe un proveedor de enriquecimiento de transacciones barato para un MVP?
**Método:** cuatro líneas de investigación + una pasada de verificación adversarial que abrió y leyó las páginas una por una. Todas las URLs consultadas el 13-08-2026. Este documento actualiza y corrige la sección A5 de `investigacion-personal-cfo.md`.

**Convención de confianza** (la misma del documento madre):
`[V]` verificado en fuente primaria · `[P]` probable, fuente secundaria consistente · `[I]` inferencia propia · `[?]` no verificado, tratar como hipótesis.

**Regla aplicada sin excepción:** el precio lo dice la página del proveedor. Si sólo hay fuente secundaria, está marcado. Si no está publicado, dice "no está publicado" y el siguiente paso es el correo del final.

---

## 0. Veredicto

**Sí existen dos proveedores contratables hoy para bancos españoles por debajo de los mínimos de miles de dólares. Ninguno de los dos es autoservicio limpio, y la decisión correcta hoy sigue siendo no comprar todavía.**

- **Wealth Reader — Launch, €212/mes de lista, sin permanencia, IVA aparte** `[V]` (https://www.wealthreader.com/es/precios/). Se puede contratar sin hablar con nadie: abrí el checkout de Stripe y dice literalmente *"60 días gratis. Luego EUR 200.00 por mes"* `[V]`. **¿Autoservicio? Sí.** Pero su web declara **tres unidades de facturación incompatibles en tres páginas distintas** (producto leído / credencial / banco) y buena parte de su catálogo no es PSD2: lee inversiones, seguros y préstamos por canal de banca online, es decir **con las credenciales del usuario** `[V]`.
- **finAPI — €320/mes** con licencia PSD2 incluida, usuarios con cuentas y conexiones ilimitadas, hasta 200 usuarios `[V]` (https://www.finapi.io/en/prices/ y /en/order-now/). **¿Autoservicio? No:** formulario de pedido, KYC, número de empresa obligatorio, prohibición explícita de correos personales, y **24 meses de permanencia = €7.680 comprometidos** `[V]`. Cubre España; **no cubre Suiza, Portugal, Irlanda, Polonia, Escandinavia ni nada de LatAm** `[V]`.
- **Enable Banking sigue sin precio público** — no existe página de precios (`/pricing` da 404) `[V]`; el FAQ de docs admite que hay **facturación mínima mensual** sin decir cuánto `[V]`. Su *Restricted Production* es gratis, indefinida y real, pero está limitada a *"individual non-commercial use"* `[V]`: sirve para medir, no para servir clientes.

**La frase de A5 —"el piso de mínimos suma USD 2.500–6.000/mes antes del primer usuario"— hay que reescribirla, no borrarla.** Es falsa para España vía finAPI o Wealth Reader. Sigue siendo la mejor descripción de Plaid en Europa, donde **sólo se ofrece plan Custom** `[V]`, y de todo lo que se vende por comercial sin publicar precio.

**¿Enriquecimiento barato para el MVP? Para medir sí; para producción no hay evidencia de que ninguno sirva en España.** Tapix devuelve un CSV enriquecido gratis y sin contrato `[V]`; Triqai cuesta €17/mes `[V]`; finAPI publica €30/mes hasta 15.000 transacciones `[V]`. **Ninguno publica una sola evidencia de cobertura de comercios españoles**, y el único con clientes españoles conocidos (Coinscrap) no publica precio. Yodlee excluye España por escrito `[V]`.

**Decisión: seguimos con extractos.** No es resignación, y la razón está en la sección 6: **la agregación no ahorra horas nuestras, las cambia de sitio.** Lo que elimina son los 60–120 minutos al mes que hoy pone el cliente `[I]`, que es un problema de activación y retención, no de coste. Hasta que haya hogares españoles de pago pidiéndolo, pagar €212 o €320 al mes compra una demo, no un producto. Lo que sí hay que hacer esta semana cuesta €0: abrir Restricted Production de Enable Banking para medir cobertura y fricción real, y mandarle el corpus propio a Tapix.

---

## 1. Qué cambia respecto de A5

| Afirmación de A5 | Estado | Corrección |
|---|---|---|
| "Ningún agregador grande publica precios" | **Se mantiene** | Ninguno de los grandes. Los que sí publican son de segunda línea: finAPI, Wealth Reader, open-banking.io, y en enriquecimiento Triqai, Quiltt, BankSync, FinCleanse `[V]` |
| GoCardless BAD dejó de aceptar clientes nuevos | **Confirmado, con la URL que faltaba** | https://bankaccountdata.gocardless.com/new-signups-disabled → *"New signups for Bank Account Data are currently disabled."* `[V]`. Ojo: `gocardless.com/bank-account-data/` no dice nada de esto y su CTA lleva a Instant Bank Pay `[V]` |
| El banner "24 August 2026" señala el desmantelamiento de BAD | **Descartar** | Es un aviso de migración de todo `developer.gocardless.com`: aparece igual sobre pagos, mandatos y Direct Debit `[V]`. Es ruido, fuera del argumento |
| Enable Banking es el reemplazo, precio no público | **Se mantiene y se agrava** | No existe página de precios: `/pricing` y `/pricing/` dan **404** `[V]`. El único dato es el FAQ: *"There is a minimum invoicing per month"* `[V]` |
| Plaid: mínimos de USD 1.000–3.000/mes `[P]` | **Corregir con cuidado** | Plaid publica *"Pay-as-you-go – **No minimum spend or commitment**"* `[V]`… y tres párrafos más abajo, en la misma página: *"**For customers based in the EU or UK, or who will be serving end users based in the EU or UK, only Custom plans are offered.**"* `[V]`. **Las dos frases van juntas o no va ninguna.** Para moneypilot, Plaid PAYG no existe |
| "USD 2.500–6.000/mes antes del primer usuario" | **Reescribir** | Falso para España: hay camino a €212 y a €320. Cierto para Plaid en Europa y para todo lo que se vende sin tarifario |
| — | **Nuevo** | finAPI publica precio de enriquecimiento: **External Data Labeling, €30/mes hasta 15.000 transacciones**, luego €0,0016/txn `[V]`. Es el único enriquecimiento con precio público en euros que apareció en toda la investigación |
| — | **Nuevo** | **Redsys impone una sola sesión de autenticación activa por usuario y por TPP** en CaixaBank, BBVA, Santander, Sabadell, Bankinter, Kutxabank y Unicaja: una nueva autenticación invalida el token anterior `[V]`. Es una restricción de arquitectura, no un detalle |

---

## 2. Agregación bancaria para España

### 2.1 La tabla

| Proveedor | Precio publicado | Unidad | ¿Puedo registrarme, poner tarjeta y empezar? | Compromiso | España | Fuente (13-08-2026) |
|---|---|---|---|---|---|---|
| **Wealth Reader** | **€212 / 695 / 1.200 / 3.500 al mes** (mensual); 180 / 590 / 1.020 / 2.975 en anual. IVA aparte `[V]` | **"Producto leído"/mes** — pero ver 2.3 | **Sí.** Checkout de Stripe abierto y leído: *"60 días gratis. Luego EUR 200.00 por mes"* `[V]` | *"Sin permanencia"* `[V]` | Sí, es su mercado | wealthreader.com/es/precios/ |
| **finAPI** | **€320/mes** = B2X €100 + Add-on International €20 + Licencia AIS €200, hasta 200 usuarios `[V]` | **Usuario** (cuentas y conexiones **ilimitadas**) `[V]` | **No.** Formulario de pedido, número de empresa, *"Private email addresses, such as @gmail.com, are not allowed!"* `[V]` | **24 meses**: *"The initial contract period is 24 months."* `[V]` → **€7.680** | Sí, pero sólo España (ver 2.2) | finapi.io/en/prices/ y /en/order-now/ |
| **Enable Banking** | **No publicado.** No hay página de precios (404) `[V]` | Cuenta/mes `[P]` | **No se puede saber.** Restricted Production es gratis pero *"individual non-commercial use"* `[V]` | Existe mínimo mensual, importe no publicado `[V]` | Sí, 2.700+ bancos y 30 países `[P, de A5]` | enablebanking.com/docs/faq/ |
| **open-banking.io** (revendedor de Enable Banking) | **€3/mes** con 1 cuenta, **+€1/mes** por cuenta adicional; *"Unlimited bank connections"*; *"No credit card required"* `[V]` | Cuenta/mes | **Sí** — pero ver 2.4 | Ninguno declarado | 2.664 bancos; BBVA, Santander, CaixaBank, Sabadell, Bankinter, ING, Openbank, Kutxabank, Unicaja y Revolut presentes `[V]` | open-banking.io |
| **Plaid** | PAYG *"No minimum spend or commitment"* `[V]` **pero** *"only Custom plans"* para UE/UK `[V]`. Existe además *"Trial – Free access. Limited to 10 Items"* `[V]`. La página UE tiene dos columnas: Free con *"200 live API calls per product"* y Custom → Contact sales `[V]` | Item/mes | **No**, para nosotros | Custom = lo que negocien | Sí, pero irrelevante mientras sea Custom | plaid.com/docs/account/billing/ y plaid.com/en-eu/pricing/ |
| **GoCardless Bank Account Data** | Era la opción barata en Europa | — | **No.** *"New signups… are currently disabled."* `[V]` | — | — | bankaccountdata.gocardless.com/new-signups-disabled |

### 2.2 finAPI: el número real es €320, no €340

Dos correcciones sobre el análisis previo, las dos con texto literal del formulario de pedido:

**(a) El add-on Batch no hace falta.** Literal: *"Add-on Batch for up to four automatic batch updates per day / **One automatic batch update per day (included free of charge)**"* `[V]`. Un refresco diario desatendido es gratis; el add-on compra el segundo, tercero y cuarto del día. Para un Personal CFO con cierre mensual, **el Batch cuesta €0**.

**(b) El add-on International es por país, no por paquete.** Literal: *"The usage agreement for finAPI Access includes one country. We charge the listed prices per additional country."* `[V]`. Los "13 países" son el menú, no lo incluido.

**Y aquí está el hallazgo que descalifica a finAPI para el ICP declarado.** La lista completa de países seleccionables es: **Alemania, Austria, Bélgica, Chequia, Francia, Hungría, Italia, Países Bajos, Rumanía, Eslovaquia, Eslovenia, España, Reino Unido** `[V]`. **No hay Suiza. No hay Portugal, Irlanda, Polonia ni Escandinavia. No hay nada de LatAm.** El ICP de moneypilot es multi-país con Suiza y Argentina sobre la mesa: **finAPI resuelve la pata española y nada más.**

| Concepto | Hasta 200 usuarios | Hasta 1.000 usuarios | Usuario adicional |
|---|---|---|---|
| finAPI Access **B2C** | €60/mes `[V]` | €300/mes `[V]` | €0,30 → €0,15 `[V]` |
| finAPI Access **B2X** (cuentas y conexiones ilimitadas) | €100/mes `[V]` | €500/mes `[V]` | €0,50 → €0,25 `[V]` |
| Licencia AIS (la licencia PSD2 de ellos) | €200/mes `[V]` | €1.000/mes `[V]` | — |
| Add-on International, por país adicional | €20/mes `[V]` | €100/mes `[I, derivado del total corregido]` | — |
| Add-on Batch (2.º a 4.º refresco diario) | €20/mes `[V]` — **innecesario** | €100/mes `[I]` | — |
| **Suelo operativo B2X + AIS + 1 país** | **€320/mes** `[V]` | **€1.600/mes** `[I]` | — |

Detalles que cambian la conversación comercial: se paga por **domiciliación SEPA o por factura** `[V]`, no sólo SEPA; el número de empresa es obligatorio y los correos personales están prohibidos `[V]`, lo que **excluye a personas físicas** y confirma que no hay autoservicio.

**Pregunta abierta que vale €20/mes y hay que hacer por correo:** ¿España puede ser el país base incluido en el acuerdo, o siempre es un país adicional de pago? No está escrito `[?]`.

### 2.3 Wealth Reader: el precio es real, la unidad no está fijada

Todos los importes verificados: 212/180, 695/590, 1.200/1.020, 3.500/2.975; unidad "producto leído"; *"sin permanencia"*; IVA aparte; premium €3/producto activo; **€0,25 por producto en gran volumen**; más de 120 refrescos al mes `[V]`.

El "sí" a la pregunta operativa es genuino: el checkout de Stripe está abierto y dice *"Prueba Wealthreader individual premium para volúmenes pequeños, **hasta 10 bancos**. **60 días gratis**. Luego **EUR 200.00 por mes** a partir del 12 de octubre de 2026."* `[V]`.

**Pero el mismo vendedor usa tres unidades incompatibles en tres páginas:**

| Página | Unidad declarada | Precio visible |
|---|---|---|
| wealthreader.com/es/precios/ | **"producto leído"** | 212 / 695 / 1.200 / 3.500 `[V]` |
| Checkout de Stripe (plan individual premium) | **"banco"** — *"hasta 10 bancos"* | EUR 200,00/mes `[V]` |
| wealthreader.com/en/pricing/ | **"credencial"** — *"Up to 10 credentials (1 credential = 1 secure bank connection)"* | **Ninguno.** Planes Individual / Professional / Enterprise, sin precio `[V]` |

Un hogar del ICP tiene ~15 conexiones y ~20–25 productos. Con "producto" se paga el triple que con "banco". **Fijar la unidad por escrito antes de construir no es prudencia: es requisito.**

Y el punto que no es de precio: **Wealth Reader no vende lo mismo que finAPI.** finAPI es PSD2 puro, cuentas de pago. Wealth Reader añade inversiones, seguros y préstamos **leyendo el canal de banca online con las credenciales del usuario** `[V]`. Para el ICP de moneypilot eso no es una línea de la comparativa, es la conversación de confianza entera (sección 5).

### 2.4 La comparación que decide

Normalizado a "familia con estructura" (~20–25 productos, ~15 conexiones):

| | Unidad facturable | 1 familia | 20 familias | 200 familias |
|---|---|---|---|---|
| **finAPI B2X** | usuario, cuentas y conexiones ilimitadas `[V]` | €320/mes (el suelo entero) | €320/mes → €16/familia `[I]` | €320/mes → **€1,60/familia** `[I]` |
| **Wealth Reader** | producto leído/mes `[V]` | €212/mes (Launch) | escalón intermedio, volumen por plan **no publicado** `[?]` | ~€0,25/producto en gran volumen → **~€5–6/familia** `[I]` |

**El cruce está en torno a 15–25 familias** `[I]`. Por debajo, Wealth Reader es más barato y además cancelable; por encima, finAPI es entre tres y cuatro veces más barato por familia. No son órdenes de magnitud de diferencia: es un factor de 3–4 a escala, y a favor de Wealth Reader en el arranque.

Lo que falta para cerrar el cálculo: **cuántos "productos" incluye cada plan de Wealth Reader por encima de Launch**. No está publicado `[?]`. Va en el correo.

### 2.5 open-banking.io: qué prueba y qué no

€3/mes con una cuenta, €1/mes por cuenta adicional, *"Unlimited bank connections"*, *"No credit card required"* `[V]`. Términos leídos: Tatic ApS (CVR 42532940), *"You may only connect bank accounts you are authorised to access"*, prohibición de *"resell or white-label the service without a written agreement with us"*, y conectividad provista por **Enable Banking Oy** `[V]`.

**Como proveedor de infraestructura está descartado por sus propios términos** (prohibición de reventa y white-label). Sirve para dos cosas: como **cota superior del precio mayorista de Enable Banking** —si un revendedor da conexiones ilimitadas y cobra €1/cuenta/mes, el mayorista por cuenta está muy por debajo de €1 `[I]`— y como sonda personal para ver cómo se comportan los bancos españoles de verdad.

Con la salvedad que hay que decir: **una ApS danesa sin entidad publicada, sin mínimos y a €3/mes puede estar vendiendo por debajo de coste.** Es un indicio de precio, no una referencia de mercado.

---

## 3. Enriquecimiento de transacciones

| Proveedor | Precio publicado | Autoservicio | Compromiso | ¿España? | Fuente (13-08-2026) |
|---|---|---|---|---|---|
| **Tapix** | **Gratis para probar:** *"send us a csv file with several hundred sample transactions which we will send back to you with the enriched data"* `[V]` | Por correo, sin contrato | Ninguno | No publicado `[?]` | tapix.io |
| **Triqai** | **€0 / 17 / 82 / 274 al mes**, overage €5,50 / €4,50 / €3,50 por 1.000; *"No credit card required"* en el free `[V]` | **Sí** | Los importes mostrados son **facturación anual** ("Yearly", "2 months free"): el mensual real es mayor `[V]` | No publicado `[?]` | triqai.com |
| **finAPI External Data Labeling** | **€30/mes hasta 15.000 txn**, luego €0,0016/txn `[V]` | No (mismo canal que finAPI) | `[?]` si arrastra los 24 meses | Implícita por su cobertura ES `[I]` | finapi.io/en/prices/ |
| **Quiltt** | Builder **$100/mes**, 50 MAU, $2/usuario extra, *"Month-to-month – cancel anytime"*, 1 enricher incluido, sin setup fee. Startup mín. $500, Scale mín. $1.000 `[V]` | Sí en Builder | Mensual en Builder | No publicado `[?]` | quiltt.io |
| **FinCleanse** | **$1.000/mes** con 1M txn, $0,002 de exceso, hasta 17% a 12 meses `[V]` | No | *"Monthly subscription fees are non-refundable once the billing month begins. Annual or multi-month commitments are non-cancelable."* `[V]` | No publicado `[?]` | fincleanse.com |
| **BankSync** | $4 / 6 / 16 / 49; 14 días de prueba **con tarjeta al alta** `[V]` | Sí | — | **España no listada** `[V]` | banksync |
| **Basiq** | AUD 0,50 + 0,25 por usuario/mes + platform fee `[V]` | No | *"Plans on the Basiq platform have a minimum duration of 12 months"* `[V]` | **Sólo AU/NZ** `[V]` | basiq.io |
| **Spade** | Los tres planes muestran **"$00.00"** `[V]` | — | — | Norteamérica | spade.com |
| **Yodlee TDE** | No publicado | No | — | **Excluida:** *"TDE is currently available for bank and card accounts and the United States, United Kingdom, Australia, and South Africa"* `[V]` | developer.yodlee.com |
| **Ntropy** | **No publicado.** Los docs sólo dicen que precio y billing están dentro del dashboard `[V]` | Requiere crear cuenta | — | `[?]` | docs.ntropy.com |
| **Coinscrap** | No publica nada | No | — | Sí, con clientes españoles `[P]` | — |

**Nota de método sobre Yodlee.** Una búsqueda web devolvió lo contrario ("US, Canadá, UK, India, Australia, Sudáfrica y otros"); la documentación primaria dice cuatro países y España no está `[V]`. Es el mejor ejemplo del dossier de por qué la regla de fuente primaria no es un formalismo.

**Corrección sobre Ntropy:** la afirmación de que da 10.000 créditos de trial al crear cuenta **baja de `[V]` a `[?]`**. No es reproducible desde la documentación pública; se resuelve creando una cuenta, no leyendo.

---

## 4. Lo que descalifica a cada uno

Esta lista suele ser más útil que la de features.

| Proveedor | Qué lo descalifica |
|---|---|
| **finAPI** | **24 meses de permanencia = €7.680 comprometidos** antes del primer cliente `[V]`. Correos personales prohibidos y número de empresa obligatorio → **no vende a personas físicas** `[V]`. **Sólo 13 países y sin Suiza, Portugal, Irlanda ni LatAm** `[V]`: no resuelve el ICP multi-país, sólo la pata española. Un país incluido; los demás, €20/mes cada uno `[V]` |
| **Wealth Reader** | **Tres unidades de facturación incompatibles en tres páginas del mismo vendedor** `[V]`, y la unidad es exactamente lo que determina si un hogar cuesta €212 o €700. Parte del catálogo se lee **con credenciales del usuario**, no por PSD2 `[V]` → fuera del perímetro de la licencia y dentro del riesgo que A8 dice evitar. **Su inscripción en el registro del Banco de España no está verificada en fuente oficial: sólo prensa** `[P]`. Los volúmenes de los planes por encima de Launch no están publicados `[?]` |
| **Enable Banking** | **Sin precio público y con mínimo mensual admitido pero no cuantificado** `[V]`: imposible modelar. Restricted Production es *"individual non-commercial use"* y no sale de ahí *"until an agreement has been signed"* `[V]` → no se puede servir a un cliente de pago sin pasar por comercial |
| **open-banking.io / Tatic ApS** | Sus propios términos prohíben *"resell or white-label the service"* sin acuerdo escrito `[V]`. Como infraestructura de moneypilot está descartado de origen |
| **Plaid** | Para clientes o usuarios finales en UE/UK **sólo hay plan Custom** `[V]`. El PAYG sin mínimos existe y no nos aplica. En la página UE lo único gratis son *"200 live API calls per product"* `[V]` |
| **GoCardless BAD** | No acepta clientes nuevos `[V]` |
| **Yodlee TDE** | España fuera por escrito `[V]` |
| **Basiq** | Sólo AU/NZ `[V]` y **mínimo de 12 meses** `[V]` |
| **BankSync** | España no listada `[V]`; pide tarjeta para la prueba de 14 días `[V]` |
| **FinCleanse** | $1.000/mes de entrada `[V]` y **no reembolsable ni cancelable** una vez empezado el mes `[V]` |
| **Quiltt** | El tier útil de verdad empieza en **$500/mes de mínimo** `[V]`; Builder a $100 trae **un** enricher y 50 MAU |
| **Spade** | Precios en "$00.00" `[V]`: no hay tarifario, hay maqueta. Y su cobertura declarada es norteamericana |
| **Ntropy** | Precio sólo dentro del dashboard `[V]`: no se puede comparar sin registrarse |
| **Todos, sin excepción** | **Ninguno publica evidencia de cobertura de comercios españoles.** Es la pregunta que hay que hacer por correo, y la respuesta que hay que exigir en forma de CSV enriquecido sobre nuestro corpus, no de porcentaje de marketing |

---

## 5. La licencia AISP: quién la resuelve por vos

**Qué hace falta para leer cuentas de pago españolas:** autorización PSD2 como AISP, inscrita en el registro de entidades del Banco de España. Los tres caminos, con lo que ya sabíamos de A8:

1. **Licencia propia.** Meses, no semanas. Referencia de coste del lado UK: **£1.130 de fee de aplicación como RAISP** (categoría 3, verificado en la página de fees de la FCA) `[V, A8]` y seguro de responsabilidad profesional con **piso de €50.000** según EBA/GL/2017/08 `[V, A8]`. Descartado en esta fase.
2. **Agente de un AISP autorizado.** ~4–6 semanas frente a 4–6 meses del registro propio `[P, A8]`.
3. **Comprar el dato a quien ya tiene la licencia.** Es lo que hacen los tres candidatos, y es lo que convierte al proveedor en algo más que un proveedor de datos.

| Proveedor | Cómo resuelve la licencia | Confianza |
|---|---|---|
| **finAPI** | La vende como línea explícita de la factura: **"Licence AIS", €200/mes hasta 200 usuarios, €1.000 hasta 1.000** `[V]`. Que esa línea exista al precio dicho está verificado; **que cubra un servicio dirigido a residentes españoles, y bajo qué pasaporte, no está escrito** `[?]` — es la primera pregunta del correo |
| **Wealth Reader** | Opera como la parte regulada y moneypilot sería cliente. **Su inscripción no está verificada en fuente oficial** `[P]`. Y pesa más de lo normal, porque **parte de su catálogo no es PSD2** y por tanto **no está cubierto por esa licencia aunque exista**: inversiones, seguros y préstamos se leen por canal de banca online `[V]` |
| **Enable Banking** | La conectividad la presta Enable Banking Oy `[V, vía los términos de open-banking.io]`. Salir de Restricted Production exige acuerdo firmado `[V]`, así que la licencia viene atada al contrato comercial |
| **Plaid** | Sólo Custom en UE/UK `[V]`: la conversación de licencia empieza después de la conversación de precio |

**Y la línea roja que no se cruza, que ya estaba en A8 y que esta investigación vuelve a poner en el centro:** **nunca pedir credenciales bancarias en nuestra propia UI.** El settlement de Plaid de **USD 58 millones** (aprobado el 20-07-2022) fue literalmente por una UI que imitaba la pantalla de login del banco `[V, A8]`. Con Wealth Reader las credenciales van a su widget y no a nuestro código, lo cual es materialmente distinto —pero el cliente no ve esa diferencia, y el DPA y la explicación en la llamada de venta las firmamos nosotros.

**Consecuencia operativa:** el proveedor no es sólo quien da el dato, es quien presta la licencia. **Eso hace que el coste real de cambiar de proveedor sea muy superior al precio mensual**, y es un argumento fuerte a favor de empezar por el que no tiene permanencia.

---

## 6. El coste de no comprar

Seguir con extractos tiene un coste, y hay que ponerle número para que la decisión sea una decisión y no una inercia.

### 6.1 Lo que cuesta el camino de fichero, en horas

**Deuda de ingeniería, una vez.** El camino español de verdad es la Norma 43, y ahí hay trabajo pendiente y localizado:

- **Las tablas de códigos propios son por banco.** El PDF de CaixaBank tiene **exactamente 45 códigos propios** y **19 conceptos comunes** (01–17, 98, 99) `[V]`. Y la colisión que lo justifica todo está reproducida sobre fichero: **Sabadell `04/007` es transferencia y `99/051` es Bizum; en CaixaBank `007` es gas y `051` seguros** `[V]`. El propio PDF explica por qué no hay estándar posible: *"El código propio del C43 se genera a partir de un código de operación interno (CLOP) que se completa hasta tres posiciones añadiendo ceros a la izquierda."* `[V]`. Estimación: **6–8 h el primer banco, 2–3 h cada banco adicional** `[I]`. Con 7–10 entidades españolas relevantes, **20–30 h una vez** `[I]`.
- **El registro 23 hay que arreglarlo, y no como se propuso.** En `/Users/juliantabacman/moneypilot/packages/importers/src/n43/parse.ts:233`:
  ```ts
  const text = (line.slice(4, 42) + line.slice(42, 80)).trim()
  ```
  El `Código Dato` (posiciones 3–4) se descarta, y eso sí es un bug. Pero **partir los dos tramos de 38 en campos separados rompería un caso que hoy funciona**: en un extracto real de Sabadell, `dato=01` trae un nombre en 5–42 y un NIF en 43–80 (dos campos independientes), mientras que el fixture del repo trae un texto continuo de 76 que al partirlo queda como `"SHOP TO B" + "UY..."`. **La forma correcta es guardar los tres: los dos tramos crudos, el `Código Dato`, y la concatenación como derivado**, y decidir la interpretación por `(entidad, código dato)`. Lo que **ya está hecho** y no hay que rehacer: `concepto_comun` y `concepto_propio` se guardan en `raw` (líneas 209–210).
  **Salvedad honesta sobre la estimación:** el único fichero N43 del repo es `/Users/juliantabacman/moneypilot/fixtures/n43/movements.n43`, que viene de la suite de tests de `sergief/norma43parser` `[V, fixtures/README.md]`, está **en inglés** ("TARG", "RESTARUANT") y usa códigos propios 408/204/227/030 que no existen en la tabla de CaixaBank. **Es sintético.** Cualquier estimación de horas asume ficheros reales que hoy no están en el repositorio.
- **Deriva de formatos CSV:** ~1–2 h por cambio de formato de banco, 4–8 cambios al año repartidos entre 10 entidades → **10–15 h/año** `[I]`.

**Total del camino de fichero:** **25–35 h una vez** (≈ €1.250–1.750 a €50/h de coste interno `[I]`) y **10–15 h/año recurrentes** (≈ €500–750/año `[I]`), más **0,1–0,2 h por hogar y mes** de incidencias de importación `[I]`.

### 6.2 Lo que cuesta el cliente, que es el número que importa

Un hogar del ICP tiene ≥12 cuentas y tarjetas y ≥2 países `[V, B2]`. Descargar el extracto de 10–15 entidades, mes a mes, son **4–8 minutos por entidad = 60–120 minutos al mes** `[I]`.

**Ese es el coste real de no comprar, y no lo pagamos nosotros: lo paga la persona que nos está pagando precisamente por no hacer eso.** El detonante de compra número uno del ICP es la rotura de conectividad, y el modo de fallo número uno de este producto es el abandono en el primer mes `[V, A5/B9]`.

### 6.3 Lo que la agregación **no** ahorra

Aquí está la parte que suele contarse mal:

- La agregación **no elimina horas de operador: las cambia de sitio.** El modelo conectado ya presupone **0,3–0,6 h por cliente y mes dominadas por reconexiones** `[I, B9]`.
- El consentimiento PSD2 caduca: *"For the majority of ASPSPs, this value corresponds to 180 days"* `[V]` → **2 re-consentimientos al año por conexión como mínimo**; con 15 conexiones, **30 eventos al año por hogar** antes de contar roturas `[I]`.
- **Redsys sólo admite una sesión de autenticación activa por usuario y por TPP**, y *"a new authentication performed by the end user automatically invalidates any authentication token"*, en CaixaBank, BBVA, Santander, Sabadell, Bankinter, Kutxabank y Unicaja `[V]`. Es una restricción de diseño que hay que absorber, no un incidente ocasional.
- La cobertura de **tarjetas de crédito españolas no la contesta públicamente ninguno de los proveedores** `[V, por ausencia]`, y por el lado del fichero la Norma 43 es un formato de cuenta, no de tarjeta `[I]`. **El agujero es el mismo por los dos caminos.**

**Conclusión de la sección: comprar agregación no es un ahorro de coste, es una compra de activación y retención.** Por eso el disparador correcto no puede ser "cuando salga más barato que el fichero" —no va a pasar a esta escala— sino "cuando haya evidencia de que el trabajo mensual del cliente está matando el uso". Eso se mide, y hoy no está medido.

### 6.4 Enriquecimiento propio: lo mismo, con números más pequeños

El motor de reglas ya existe en el repositorio (`rule` + `classification_change` en `packages/db/migrations/006_clasificacion.sql`, con la lógica en `packages/db/src/repo/classify.ts`), y lo que falta es aplicarlo automáticamente en cada importación (tarea #24, pendiente).

Con **3–8% del volumen a revisar en régimen** `[V, A7]` y ~500 transacciones/mes por hogar, eso son **15–40 transacciones por hogar y mes**; a 10–20 segundos cada una, **4–13 minutos por hogar y mes** `[I]`. A 20 hogares: **1,5–4,5 h/mes ≈ €45–200/mes** a €30/h `[I]`.

Triqai a €17/mes y finAPI a €30/mes están **por debajo de ese número desde ~10–20 hogares** `[I]`. Es decir: el enriquecimiento comprado se paga solo bastante antes que la agregación. **La razón para no comprarlo hoy no es el precio, es que no hay una sola evidencia pública de que funcione con descriptores españoles.**

---

## 7. Recomendación y disparadores

**Hoy: seguimos con extractos. No firmamos nada.** Y hacemos las tres cosas que cuestan €0 y producen el dato que falta.

### Ahora (coste €0)

1. **Abrir Restricted Production de Enable Banking** y conectar cuentas propias en los bancos españoles del ICP. Objetivo: medir cobertura real, profundidad de histórico, comportamiento de tarjetas y fricción de Redsys. **Límite explícito: es *"individual non-commercial use"* `[V]` — es una sonda, no se puede servir a un cliente con ella.**
2. **Mandarle a Tapix un CSV de varios cientos de transacciones españolas** y comparar su salida contra la clasificación propia. Es gratis y sin contrato `[V]`. En paralelo, el free tier de Triqai, que no pide tarjeta `[V]`.
3. **Mandar los cinco correos de la sección 8.** Son el 80% de lo que falta para decidir, y no cuestan más que el tiempo de escribirlos.

### Disparadores (condición → acción)

| Disparador | Acción | Por qué ese umbral |
|---|---|---|
| **≥3 hogares españoles de pago piden conexión explícitamente**, y está por escrito qué es la unidad de facturación y el número de registro del BdE | **Contratar Wealth Reader Launch**, €212/mes | Sin permanencia: la exposición máxima es **un mes y €212** `[V]`. A esa escala es además el más barato por familia. Sin las dos respuestas por escrito, no |
| **≥10 hogares Core de pago en España con contrato anual firmado** | **Contratar finAPI B2X + AIS**, €320/mes | La regla es no firmar un mínimo hasta que sea <20–25% del ARR que habilita. €320/mes = **€3.840/año** → hace falta un ARR español de **€15.400–19.200**, que con el ACV de Core (USD 1.788) son **9–12 hogares** `[I]`. Y hay que poder comerse los **€7.680** de los 24 meses si se van todos `[V]` |
| **>25 hogares conectados** | Volver a comparar: a partir de ahí finAPI es 3–4× más barato por familia `[I]` | El cruce está en 15–25 familias `[I]` |
| **Aparece un hogar con peso en Suiza, Portugal, Irlanda o LatAm** | **finAPI queda fuera de la conversación**; ese hogar es tier Archivo (manual) y se le dice de frente | Los 13 países son los que son `[V]`. A5 y B2 ya dicen que Suiza y Argentina se venden sólo en el tier manual |
| **La cola de revisión manual supera ~2 h/mes** (≈10–20 hogares) **y** Tapix o Triqai han demostrado sobre nuestro corpus una tasa de acierto útil | **Comprar enriquecimiento**, empezando por el más barato que haya pasado la prueba | El criterio es el del brief: se compra cuando las horas del operador superan su coste. €17–30/mes lo superan enseguida `[I]`. **El orden importa: primero se mide, después se paga** |
| **finAPI confirma que External Data Labeling se vende suelto y sin los 24 meses** | Evaluarlo contra Triqai con el mismo corpus | €30/mes hasta 15.000 txn es el único precio público en euros del mercado `[V]`; si arrastra la permanencia, deja de ser barato `[?]` |
| **Ninguno** | **No tocar Plaid** | En UE/UK sólo hay Custom `[V]`. Volver a mirarlo sólo si aparece volumen para esa conversación |

### Lo que haría fracasar esta decisión, y hay que vigilar

- Que la fricción del extracto mensual aparezca como causa de abandono en las primeras cancelaciones. **Si eso pasa, el disparador de Wealth Reader se adelanta y punto.** Medirlo desde el primer cliente.
- Que Wealth Reader suba de precio o cambie la unidad. Sin permanencia también significa sin protección de precio `[I]`.

---

## 8. Los correos

Borradores listos para copiar y pegar. **Sin enviar.** Si el precio no es público, esto es lo accionable.

### 8.1 finAPI — en inglés (correos personales prohibidos: usar el dominio de la empresa)

> Subject: finAPI Access pricing — Spain-only scope, AIS licence and data labeling
>
> Hello,
>
> We are building a personal finance product for households resident in Spain and are evaluating finAPI Access. Five questions before we go further:
>
> 1. **Base country.** The order form says the usage agreement includes one country and additional countries are charged per country. **Can Spain be the included base country**, or is Spain always a paid "Add-on International" country?
> 2. **Floor.** Can you confirm that finAPI Access B2X (€100/month, up to 200 users) + Licence AIS (€200/month) + one country is €320/month all-in, and that one automatic batch update per day is included at no extra cost?
> 3. **Licence scope.** Does the "Licence AIS" line cover a service whose end users are Spanish residents? Under which authorisation and which passporting arrangement?
> 4. **Spanish coverage.** Which Spanish ASPSPs do you support, and **do you return credit card accounts** for CaixaBank, BBVA, Santander, Sabadell and Bankinter? How many days of transaction history?
> 5. **External Data Labeling.** Can it be purchased standalone (€30/month up to 15,000 transactions), without finAPI Access and **without the 24-month term**? What is its coverage of Spanish merchant descriptors — can you run a sample CSV of ours?
>
> Also: is the 24-month initial term negotiable down to 12, and is there a pilot or exit clause? And where is the data processed, with which sub-processors?
>
> Thank you.

### 8.2 Wealth Reader — en español

> Asunto: Precios y unidad de facturación — producto de finanzas personales
>
> Hola,
>
> Estamos evaluando Wealth Reader para un producto de gestión financiera de hogares con estructura (varias entidades, ~15 conexiones y ~25 productos por hogar). Antes de contratar necesitamos cerrar seis cosas por escrito:
>
> 1. **La unidad de facturación.** Vuestra página de precios en español dice "producto leído", el checkout de Stripe dice "hasta 10 bancos" y la página en inglés dice "credential (1 credential = 1 secure bank connection)". **¿Cuál es la unidad contractual?** Para un hogar con 15 conexiones y 25 productos la diferencia es de tres veces el precio.
> 2. **Volumen por plan.** ¿Cuántos productos (o credenciales, o bancos) incluye cada plan: Launch €212, y los de €695, €1.200 y €3.500? No está publicado.
> 3. **El plan del checkout.** ¿El "individual premium… hasta 10 bancos" de 200 €/mes de Stripe es el mismo producto que Launch de 212 €? Si no, ¿en qué se diferencian?
> 4. **Licencia.** ¿Cuál es vuestro número de inscripción en el registro de entidades del Banco de España y bajo qué tipo de autorización operáis?
> 5. **PSD2 vs. credenciales.** ¿Qué parte del catálogo se lee vía API PSD2 del banco y qué parte vía canal de banca online con credenciales del usuario? Nos hace falta la lista por entidad. Y en el segundo caso: dónde se guardan las credenciales, con qué cifrado, y qué ocurre cuando el usuario revoca.
> 6. **Tarjetas de crédito españolas:** ¿qué entidades, con qué histórico y con qué frecuencia de actualización? ¿Qué pasa al superar los 120 refrescos al mes?
>
> Además, ¿nos podéis enviar el DPA, la lista de subencargados y la ubicación de procesamiento de los datos?
>
> Gracias.

### 8.3 Enable Banking — en inglés

> Subject: Pricing for a Spain-focused personal finance product
>
> Hello,
>
> Your FAQ states that pricing is volume based and that there is a minimum monthly invoice, but no figures are published and enablebanking.com/pricing returns a 404. Six questions:
>
> 1. **What is the minimum monthly invoice**, what does it include (how many accounts, how many payments), and what is the per-account price above it?
> 2. Is there a **contractual term**, and do you have a startup or pilot tier?
> 3. **Licensing:** can we serve Spanish end users under your authorisation as your agent or distributor, or do we need our own AISP registration?
> 4. **Spanish coverage:** which ASPSPs return credit card accounts, and which return more than 90 days of transaction history?
> 5. **Redsys:** your docs state that banks on the Redsys PSD2 platform allow a maximum of one active authentication session per user per TPP. How does this behave when several members of one household hold accounts at the same bank, and what is the recommended pattern to avoid invalidating tokens?
> 6. What is required to move from **Restricted Production to Production**, and how long does it typically take?
>
> Thank you.

### 8.4 Tapix — en inglés

> Subject: Sample enrichment on Spanish transaction descriptors
>
> Hello,
>
> Your site offers to enrich a sample CSV of a few hundred transactions. We would like to take you up on it, with one specific requirement: **our corpus is Spanish** — descriptors from CaixaBank, BBVA, Santander, Sabadell and Bankinter, including Bizum transfers and Norma 43 free-text concepts.
>
> 1. What column format do you want the CSV in, and what is the maximum number of rows?
> 2. What is your **merchant coverage for Spain specifically**, and how is it measured?
> 3. What does it cost in production, per transaction or per month? Is there a monthly plan with no minimum term?
>
> Thank you.

### 8.5 Triqai — en inglés

> Subject: Pricing clarification and Spanish coverage
>
> Hello,
>
> Two quick questions before we test:
>
> 1. Your pricing page shows €0 / €17 / €82 / €274 with "Yearly" selected and "2 months free". **What is the month-to-month price** for each tier, and is there any minimum term?
> 2. **Spanish coverage:** do you have evidence of merchant resolution quality on Spanish bank descriptors? We can send a sample CSV of several hundred anonymised Spanish transactions and would like to compare your output against our own classification.
>
> Thank you.

---

## 9. Qué quedó sin verificar

Se dice para que nadie lo lea como verificado dentro de tres meses.

| Punto abierto | Estado | Cómo se cierra |
|---|---|---|
| Mínimo mensual exacto de Enable Banking | No publicado `[V, por ausencia]` | Correo 8.3 |
| Si España puede ser el país base de finAPI | No escrito `[?]` | Correo 8.1, pregunta 1 |
| Si External Data Labeling de finAPI se vende suelto | `[?]` | Correo 8.1, pregunta 5 |
| Número de registro de Wealth Reader en el BdE | `[P]`, sólo prensa; **se intentó y no se cerró** | Correo 8.2, pregunta 4 |
| Volúmenes de los planes de Wealth Reader por encima de Launch | No publicado `[?]` | Correo 8.2, pregunta 2 |
| Reparto PSD2 vs. credenciales del catálogo de Wealth Reader | `[V]` que existen ambos, `[?]` el reparto por entidad | Correo 8.2, pregunta 5 |
| **Cobertura de tarjetas de crédito españolas de todos ellos** | Sin una sola respuesta pública `[V, por ausencia]` | Está en los tres correos de agregación |
| Cobertura de comercios españoles de cualquier enriquecedor | Sin evidencia publicada `[?]` | Se mide con CSV propio, no se pregunta |
| Trial de Ntropy (¿10.000 créditos?) | **Degradado a `[?]`** | Creando una cuenta |
| Add-ons de finAPI en el escalón de 1.000 usuarios (€100 c/u) | `[I]`, derivado del total | Confirmar en el formulario de pedido |
| Coinscrap, Salt Edge Partner Program, Snowdrop, Powens, Neonomics, Klarna Kosma, Mastercard/Aiia, Flanks, Unnax | **No reverificados en esta pasada** | Quedan sin segunda opinión; tratar como `[?]` |
| Redsys (como entidad), registro del BdE, eIDAS, la cifra del 66% de NSI | **No reverificados en esta pasada** | Ídem |

**Nota de reproducibilidad, para quien repita esto:** el PDF de códigos de CaixaBank **devuelve 403 sin User-Agent de navegador**; con UA de Chrome descarga sin problema `[V]`. Y una advertencia de método que costó una corrección: un fichero guardado como "evidencia" que resulta ser el bundle de JavaScript de Stripe **no prueba nada**, aunque la cita que lo acompaña sea correcta. La evidencia es el texto renderizado, con su URL y su fecha.

---

## 11. Prueba de campo contra el sandbox de finAPI (13-08-2026)

Con credenciales de sandbox propias se corrió el flujo entero: token de cliente → alta de usuario → Web Form → autenticación fuerte → importación. **Funcionó**: 4 cuentas y **1.612 movimientos** de 24 meses de histórico `[V]`. Lo que sigue está observado, no leído.

### 11.1 La forma del dato encaja mejor que un fichero

Un movimiento real, campo por campo `[V]`:

| Campo de finAPI | Qué es | Dónde encaja en nuestro esquema |
|---|---|---|
| `id` | Identificador estable del movimiento | `entry.external_id`, y **la clave de dedup para `data_source='api'`** (tarea #25) |
| `bankBookingDate` / `valueDate` | Fecha contable y fecha valor, distintas | `entry.booked_on` y `entry.valued_on` — la distinción ya está modelada |
| `finapiBookingDate` | Fecha propia del agregador | No se usa: es su reloj, no el del banco |
| `amount` + `currency` | Importe y moneda | `posting.amount` — **con la salvedad de 11.3** |
| `counterpartName`, `counterpartIban`, `counterpartBic`, `counterpartBankName` | **Contraparte estructurada** | Es la mejora grande: la Norma 43 da una cadena de concepto, esto da campos |
| `purpose` y `cleanedPurpose` | Concepto crudo y normalizado por ellos | El descriptor ya viene limpio |
| `type`, `typeCodeZka` | Tipo de operación con código | Señal para el matcher de transferencias |
| `category` | **Su categorización, con jerarquía** | Ver 11.4 |
| `isPotentialDuplicate` | Su propia detección de duplicados | Hay que reconciliarla con la nuestra, no ignorarla |
| `isNew` | Marca de sincronización incremental | Permite traer sólo lo nuevo |

**La contraparte con IBAN es mejor clave de comercio que cualquier descriptor.** Un IBAN es estable; "IBERDROLA CLIENTE 887" no.

### 11.2 Todo lo que se vio es alemán

Banco de pruebas alemán, IBAN alemanes (`DE77...`), códigos de tipo ZKA, categorías en alemán y autenticación por chipTAN `[V]`. Concuerda con lo del catálogo: **`location=ES` devuelve 32 bancos y ninguno es un banco minorista español** — no aparecen BBVA, Santander España, CaixaBank, Sabadell, Bankinter, ING España ni Openbank España `[V]`. Lo único con marca española es `tarjetayou.es`, una tarjeta luxemburguesa (Advanzia). Hay banco de pruebas checo; español no hay `[V]`.

Y por si el filtro de país fuera malo, se comprobó **buscando por nombre**, que es más duro `[V]`:

| Búsqueda | Qué aparece | ¿Conectable? |
|---|---|---|
| BBVA | `BANCO BILBAO VIZCAYA ARGENTARIA, Niederlassung Deutschland` | **No: sin interfaces** |
| CaixaBank | `CAIXABANK Zweigniederlassung Deutschland` | **No: sin interfaces** |
| Sabadell, Bankinter, Kutxabank, Unicaja | — | **No están en el catálogo** |
| Openbank | `Openbank Deutschland` | Sí (XS2A, salud 100) — pero es la filial alemana |
| Banco Santander | `Banco Santander Filiale Frankfurt` | Sí — ídem, sucursal de Fráncfort |

Es decir: lo que existe con nombre español son las **filiales alemanas** de bancos españoles, y las dos que funcionan sirven a clientes alemanes. Los bancos que usa una familia española no están.

Detalle que además importa por otro motivo: varias entidades exponen `WEB_SCRAPER` como interfaz `[V]`. Eso es lectura del canal de banca online con las credenciales del usuario, no PSD2 — la misma categoría de problema que se le señaló a Wealth Reader en 2.3. finAPI también lo hace.

El sandbox es un sandbox y el catálogo de producción puede diferir. Pero **3.933 de 5.169 bancos son alemanes** `[V]`, y eso sí describe dónde vive su cobertura.

### 11.3 El importe llega como número decimal de JSON

En el cuerpo crudo: `"amount":-135.89` `[V]`. Un `JSON.parse` lo convierte en coma flotante **antes de que lo veamos**, que es exactamente lo que el núcleo existe para evitar.

**La integración tiene que leer el texto de la respuesta y pasar la cadena decimal por `fromDecimalString`**, sin `JSON.parse` de por medio para los importes. Son veinte líneas, pero van en la frontera HTTP: hecho después ya es tarde.

### 11.4 La categorización viene incluida, y resuelve la mitad que no nos importa

De 500 movimientos, **478 llegaron categorizados** con jerarquía propia `[V]`. Eso reabre la pregunta de Tapix: para los países donde finAPI funciona, **el enriquecimiento no hay que comprarlo aparte**.

Pero la taxonomía es suya y es alemana —`Mobilität`, `KFZ-Versicherung`, `Tanken`, `Lebensmittel & Getränke`— `[V]`. Resuelve descriptor→comercio; **no resuelve comercio→tu estructura**, que es dónde está el producto: ningún proveedor sabe que esa factura de luz es de Casa Madrid, pagada por la sociedad y repartida 60/40.

### 11.5 El sandbox no lleva licencia

Pasar un `redirectUrl` devuelve `INVALID_REDIRECT_URL: mandator's license is UNLICENSED` `[V]`. Es la línea de **Licencia AIS, €200/mes**, del tarifario: sin ella no se puede probar el flujo de redirección real. El sandbox sirve para ver la forma del dato, no para medir la experiencia que tendría un cliente.

### 11.6 Qué cambia y qué no

**No cambia la decisión**: seguimos con extractos. La prueba confirmó la fontanería y **desmintió la cobertura**, que era la duda que importaba.

**Sí cambia la pregunta del correo.** Ya no es "¿cuánto cuesta España?" sino: *vuestro tarifario vende España como país adicional a €20/mes, y vuestro catálogo de sandbox no tiene ni un banco minorista español. ¿Qué entidades españolas son alcanzables en producción, por qué interfaz, y con qué cobertura de tarjetas de crédito?* Con esa respuesta se decide; sin ella, no.
