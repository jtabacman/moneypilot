# Personal CFO digital — Investigación de mercado, producto y modelo de negocio

**Fecha:** 12 de agosto de 2026
**Método:** 13 agentes de investigación en paralelo (competencia consumer, competencia de alto patrimonio y sustitutos humanos, segmentos y demanda, cohorte legacy, infraestructura de agregación bancaria, arquitectura de reporting, arquitectura de IA, regulación y confianza) + 4 agentes de análisis + 1 pasada de verificación adversarial que corrigió errores aritméticos y contradicciones entre entregables. 554 búsquedas y fetches web.

**Convención de confianza usada en todo el documento:**
`[V]` verificado en fuente primaria · `[P]` probable, fuente secundaria consistente · `[I]` inferencia propia · `[?]` no verificado, tratar como hipótesis.

---

## 0. Veredicto en una página

**El hueco de mercado existe, está documentado y está vacío. Existe porque servir bien a ese cliente cuesta lo que cuesta un humano, y ese cliente compra humanos.**

Los tres hallazgos que cambian el planteo del brief:

1. **El precio de referencia no son USD 30–100/mes. Es USD 12.000–48.000/año.** Plumb Bill Pay cobra USD 2.000–4.000/mes, con mínimo de USD 1.000/mes, para familias de USD 10–150M de patrimonio `[V]`. Un CPA con paquete personal cobra USD 300–5.000/mes `[P]`. El pricing planteado está 10–40× por debajo del sustituto que hoy hace el trabajo — lo cual no es una ventaja: a USD 100/mes el producto le señala al comprador de patrimonio alto que es una app de consumo.

2. **El techo del software puro está clavado y no se mueve.** Monarch Core USD 99,99/año, Copilot USD 95/año, Tiller USD 99/año, YNAB USD 109/año `[V]`. Las dos únicas excepciones verificadas son Monarch Plus a **USD 299/año** (lanzado el 21-abr-2026) y **Kubera Black a USD 2.500/año** `[V]`. Kubera es el caso que importa, porque justifica su precio con exactamente lo que plantea el brief: entidades anidadas, control de acceso granular por contacto, onboarding concierge y soporte 1:1 — es decir, **con servicio, no con features**.

3. **Nadie combina las tres cosas a la vez: agregación EE.UU.+Europa real, reporting con filtros combinables y drill-down, y roles de acceso para contador/pareja/asistente.** Ese cruce vacío es la tesis. Pero está vacío porque cada una de las tres es cara: los mínimos de contrato de agregación suman USD 2.500–6.000/mes **antes del primer usuario** `[V/P]`, la delegación multiplica soporte y superficie de riesgo, y el reporting profundo solo tiene valor si el dato de abajo está impecable.

**Conclusión operativa:** no se está construyendo una aplicación premium de finanzas personales. Se está construyendo **un servicio financiero personal habilitado por software, cuya escalabilidad depende de convertir el trabajo humano en producto — no al revés**. El componente de IA es un multiplicador de productividad del equipo de servicio antes que una feature de cara al usuario.

Y una advertencia de tamaño que conviene decir antes de levantar dinero: el SOM honesto es **USD 4–18M de ARR a 5 años** (5.000–20.000 hogares). Es un negocio excelente, eficiente en capital, de 12–25 personas. No sostiene una tesis de venture de USD 100M+ de ARR, y financiarlo contra esa cifra obliga a bajar el precio para perseguir volumen — y a USD 30/mes este producto es matemáticamente inviable.

---

# PARTE A — Lo que dice el mercado

## A1. Panorama competitivo

### A1.1 El mercado se parte en cinco bloques que casi no se tocan

| Bloque | Ejemplos | Precio/año | Qué resuelve |
|---|---|---|---|
| Budgeting mainstream premium | Monarch, Copilot, YNAB, Origin, Simplifi | USD 48–110 | Categorizar y presupuestar, EE.UU. |
| Power user / planilla | Tiller, Lunch Money, Fina, Actual, Firefly III | USD 0–120 | Control del dato, flexibilidad |
| Desktop legacy profundo | Quicken Classic, Banktivity, Moneydance, MoneyWiz | USD 60–132 | Reportes serios, multi-moneda, offline |
| Planning / proyección | PocketSmith, Monarch Plus | USD 120–320 | Cash flow futuro, escenarios |
| Balance sheet HNW | Kubera, Vyzer | USD 250–9.540 | Patrimonio, entidades, herencia |

El producto planteado (USD 30–100/mes = USD 360–1.200/año) cae en tierra de nadie entre PocketSmith Fortune y Kubera Black. Eso es simultáneamente la oportunidad y el riesgo.

### A1.2 Precios verificados (agosto 2026)

| Producto | Precio | Multi-moneda real | Multi-país | Acceso de terceros | Reporting |
|---|---|---|---|---|---|
| Monarch Core | USD 99,99/año o 14,99/mes `[P]` | No | EE.UU./Canadá | **Rol Professional view-only, expira a 1 año, revocable** `[P]` | 3 pestañas, 4 gráficos, filtros, **drill-down al click**, reportes guardados con rangos relativos, Sankey. **La sección de reportes es solo web** `[V]` |
| Monarch Plus | **USD 299/año, solo anual** (21-abr-2026) `[V]` | No | EE.UU./Canadá | Ídem | + forecasting, negocio, inversiones, estate planning |
| Copilot Money | USD 95/año `[V]` | Mínima | EE.UU. | No | Débil. **Las reglas de categorización no se pueden ver ni editar desde la UI** `[P]` |
| Lunch Money | Mínimo USD 60/año (subió de 50 el 15-mar-2026) `[V]` | **Sí, 160+ monedas con FX histórico por transacción** `[P]` | Sí | No | Query Tool con datasets y gráficos guardables `[P]` |
| Tiller | USD 99/año `[V]` | Vía planilla | Vía planilla | La planilla se comparte | Delega en Sheets/Excel |
| PocketSmith Fortune | **USD 26,66/mes anual · 39,95/mes mensual** `[V]` | **Sí, guarda tipos diarios** `[V]` | **Sí (Foundation limitado a 6 bancos de 1 país)** `[V]` | **Colaboradores con permisos totales — no existe read-only** `[V]` | Medio |
| Kubera | **Essentials USD 250/año · Black USD 2.500/año** `[V]` | Sí, sin atribución FX `[P]` | Sí (múltiples agregadores + extensión "Web Sync" + carga manual) `[V]` | **Control granular por contacto + "dead man's switch"** `[V]` | Balance sheet, no gastos |
| Vyzer | USD 145 / 375 / 795 por mes (anual) `[V]` | Base USD | Sí | **Roles y permisos recién desde USD 375/mes** `[V]` | Cash flow con escenarios |
| Quicken Classic | Deluxe USD 6,99/mes · Premier 7,99 · B&P 10,99, anual, promo hasta 11-sep-2026; renovación "at then-current rates" **no publicada** `[V]` | Parcial; **no** multi-moneda dentro de una cuenta; online banking solo USD `[P]` | Solo EE.UU./Canadá `[P]` | No | **El mejor motor de reportes del mercado.** Guarda la definición completa: cuentas, filtros, orden, columnas, rango `[P]` |
| Sequence | Starter 15,99 · Pro 29,98 · **Premium 59,98/mes** con "unlimited viewer accounts" `[V]` | — | — | Sí | No reporta: mueve plata |
| Banktivity | Bronze 6,99 · Silver 8,99 · **Gold 10,99/mes** (multi-moneda solo en Gold) `[V]` | Solo Gold | Parcial | No | Reportes personalizables desde Silver |
| Origin | USD 99/año o 12,99/mes `[P]` | No | EE.UU. | Pareja incluida | **Cruzó a asesoramiento: opera bajo una RIA registrada en SEC** `[P]` |

**El mercado europeo de gama alta está desierto.** Money Dashboard cerró el 31-oct-2023 declarando que no encontró modelo sostenible `[V]`. Fintonic es gratis y monetiza lead-gen de préstamos `[P]`. El techo europeo verificado es Bankin' Pro €99,99/año y Emma Ultimate £124,99/año `[P/V]`. Nadie en Europa sirve al patrimonio complejo con software: ese usuario está en software de family office con precios institucionales.

### A1.3 Cinco huecos concretos que no encontré cubiertos en ningún producto

1. **Permisos por dimensión.** Dar al contador acceso solo a la sociedad, a la pareja solo a lo familiar, al asistente solo a viajes y suscripciones. Kubera se acerca con Nested Portfolios pero es balance sheet, no gastos.
2. **Reportes programados por email configurados por el usuario.** Lo único verificado es "Hello, Money" de Tiller (email diario de balances) y los weekly recaps de Monarch — ninguno es un reporte configurable.
3. **Enlaces compartidos de reporte con expiración.**
4. **Conversión FX con tipo de cambio de la fecha de la transacción como comportamiento por defecto en todos los reportes.** Lunch Money lo hace a nivel transacción; PocketSmith guarda tipos diarios pero su documentación dice que al mostrar en moneda base usa el **tipo actual** `[V]`. Es un error conceptual que un producto multi-país serio no puede tener.
5. **Atribución del efecto FX en la variación patrimonial.** Kubera consolida a moneda base pero no desglosa cuánto de la variación fue movimiento real y cuánto tipo de cambio `[P]`. Es el hueco más limpio del mercado y el más barato de llenar.

> **Corrección importante respecto de la investigación inicial:** la afirmación "nadie tiene grupos de condiciones AND/OR anidados en filtros de reporte" **no está verificada** — es una inferencia por ausencia de evidencia, y hay indicios contrarios (Firefly III tiene reportes *Custom* con combinaciones múltiples de tags, Actual Budget usa condiciones all/any en su motor de reglas, Quicken guarda definiciones completas de filtro). **No usar como diferencial en un deck hasta probarlo con las manos** en trials de PocketSmith Fortune, Fina Premium, Lunch Money y Monarch Plus.

### A1.4 La amenaza real

**Monarch.** USD 75M de Serie B (mayo 2025) a USD 850M post-money; ~500.000 suscriptores pagos y ~1M de miembros según su propio blog `[P — sin confirmación independiente]`; 217 empleados. Ya lanzó Plus a USD 299/año con forecasting, negocio, inversiones y estate planning. **Le falta multi-país, multi-moneda real y permisos granulares — tres cosas que puede construir o comprar en 18 meses si detecta el nicho.**

El "cruce vacío del diagrama de Venn" no es una barrera: es una lista de tareas para tres competidores que ya tienen usuarios. El moat no puede ser "mejores reportes".

---

## A2. El sustituto humano: el verdadero competidor y el verdadero ancla de precio

El roundup 2025 de software de family office de Forbes clasifica ~120 productos en 13 categorías y **no existe una categoría de gastos, bill pay ni presupuesto doméstico** `[V]`. Addepar se autodescribe como *"a reporting and analysis platform rather than a general ledger or planning suite"* `[V]`.

| Sustituto | Costo verificado | Qué entrega | Qué NO cubre |
|---|---|---|---|
| **Plumb Bill Pay** | **USD 2.000–4.000/mes típico, mínimo USD 1.000/mes** (clientes de USD 10–150M) `[V]` | Estados consolidados mensuales, cash flow, conciliación, pago de facturas, payroll doméstico, contabilidad de trusts. Corre sobre **Sage Intacct** `[V]` | No prepara declaraciones ni da asesoramiento fiscal |
| **CPA / bookkeeper personal** | USD 300–2.000/mes estándar; casos complejos ~USD 5.000/mes `[P]` | Cierre mensual, categorización | Latencia de 2–6 semanas; sin drill-down |
| **Daily Money Manager (AADMM)** | USD 75–150/hora, ~4 h/mes = USD 300–600/mes `[P]` | Organización, pagos, reportes básicos | "No reemplaza a profesionales de contabilidad o inversión" `[V]` |
| **Asset Vantage** | **USD 30.000/año por 10 entidades → 55.200 por 30** `[V]` | GL integrado, bill pay, proyecciones | Requiere operador contable |
| **FundCount** | Desde **USD 35.899/año** (SFO) `[V]` | Contabilidad de family office | Idem |
| **Asora** | **USD 15.600/año + USD 3.900 de onboarding** (tramo 50–100M) `[V]` | Consolidación de activos | **Su página de pricing no menciona gastos, presupuesto ni bill pay** |
| **Addepar** | ~USD 50.000–70.000/año de entrada `[P — fuentes de competidores]` | Reporting de inversiones | Explícitamente, no gastos ni cash flow |
| **Eton AtlasFive** | ~USD 150.000/año, clientes >USD 1.500M `[P]` | ERP completo con bill pay | Fuera de alcance |
| **Internalizarlo** | Controller USD 140–220k base; CFO de family office USD 420k base `[P]` | Todo | — |

**Hay un vacío de precio brutal entre USD 1.000 y USD 15.000 al año.** Abajo están las herramientas de consumo; arriba, Asora. En el medio, nada que una persona pueda manejar sola. Ese vacío es la oportunidad y, al mismo tiempo, la advertencia: está vacío porque servir bien a ese cliente es caro y hay pocos clientes.

**La diferenciación defendible frente al humano no es cobertura funcional ni precio: es latencia y self-service.** El bookkeeper entrega un PDF mensual con 2–6 semanas de rezago; una pregunta nueva le cuesta un email y días. Un cliente que puede preguntar *"compará el costo de las tres propiedades trimestre contra trimestre y decime qué categoría explica la diferencia"* y tenerlo en tres segundos con drill-down hasta la transacción tiene algo que hoy no existe a ningún precio. **Ese es el pitch, y el reporte por propiedad es la demo.**

Y un corolario de modelo de datos: Addepar, Masttro, Landytech y Asora modelan entidad legal, cuenta, custodio y clase de activo. **Ninguno modela *propiedad*, *persona del hogar*, *viaje*, *vehículo* ni *empleado doméstico*.** El hack de campo es Classes/Locations de QuickBooks, mantenido a mano. Esa es la única ventaja estructural verdadera del planteo, y es sorprendentemente barata de construir.

---

## A3. Segmentos: ranking honesto

Regla que la evidencia confirma: **más patrimonio no es más disposición a pagar. Más entidades, propiedades y personas con acceso, sí.**

| # | Segmento | Complejidad | Frecuencia de revisión | Techo de WTP | Alcanzabilidad | Veredicto |
|---|---|---|---|---|---|---|
| 6+8+9 | **Familias con múltiples propiedades/entidades/empleados, que ya le pagan a alguien y necesitan dar acceso controlado** | Muy alta | Mensual, forzada por ciclos | **USD 1.200–6.000/año** | Baja (sin canal obvio) | **Beachhead.** Es la intersección, no tres segmentos |
| 1 | Patrimonio alto sin family office (USD 3–30M) | Variable | Trimestral | Media | Baja | **Rankea último.** Patrimonio alto ≠ ganas de operar software |
| 2 | Profesionales/empresarios con muchas cuentas personales | Alta (mezcla personal/profesional) | Mensual | Alta | Media | **Segundo mejor.** Quicken ya cobra el doble por el tier Business & Personal |
| 3+4 | Cuentas EE.UU.+Europa / expatriados | Alta | Mensual | Media-alta | **Buena** (comunidades reales) | Excelente canal de entrevistas, monetización mediocre |
| 5 | Parejas con patrimonio compartido | Media | Mensual | USD 100–200/año | Alta | **No es un segmento, es una feature.** Monarch lo resuelve a USD 99/año con 4,89/5 y 104k reseñas `[V]` |
| 7 | Usuarios de Quicken / MS Money / Excel | Media-alta | **Semanal** | **USD 100–250/año** | **Muy alta** | **La trampa clásica.** Máxima frecuencia y vocalidad, techo de precio más bajo del mercado. Excelentes beta testers, pésimos clientes a precio alto |

**El comprador y el usuario probablemente son personas distintas.** En el segmento de mayor WTP, el principal quiere reportes y el contador o asistente hace el trabajo. La lectura recomendada: **el principal paga, el operador opera** — y el producto tiene que ser excelente para el operador aunque el operador no firme el cheque. Ese diseño es también lo que produce la frecuencia semanal que sostiene la retención; el principal entra una vez por mes.

### Sizing honesto

- 25,3M de HNWI globales, USD 98,3 billones de riqueza; EE.UU. 8,7M de HNWI (+9,2% en 2025) `[V, Capgemini WWR 2026]`.
- 713.626 UHNWI (USD 30M+) globales; EE.UU. concentra el 35% `[P, Knight Frank 2026]`.
- **TAM:** ~2,4–2,8M de hogares en Norteamérica + Europa en la banda USD 3–30M. A USD 900/año de ACV ≈ **USD 2,2B teóricos**.
- **SAM:** 15–25% de esos hogares (tech-adopters, self-directed, con complejidad operativa real) = **360.000–700.000 hogares** → USD 320–630M.
- **SOM escéptico a 5 años: 5.000–20.000 hogares = USD 4,5–18M de ARR.** Escenario excelente: 40.000 hogares → USD 36M.

Contexto: Monarch necesitó ~5 años, USD 90M de capital y el cierre de Mint (base ×20 en un año) para llegar a 500k suscriptores **a un precio 10× menor**. El evento de distribución más grande de la década ya ocurrió; no hay otro.

### Retención: el riesgo #1 no es la adquisición

`[V, RevenueCat State of Subscription Apps 2025]`:
- Planes **anuales**: 44,1% de retención a 12 meses. Planes **mensuales**: 17,0%.
- **Planes mensuales de precio alto: 12,2% de retención a 12 meses** (los de precio bajo, 22,5%).
- **~30% de las suscripciones anuales se cancelan en el primer mes.**
- Los trials de 17–32 días tienen la mejor conversión mediana: 45,7%.

*(Salvedad honesta: RevenueCat no publica una categoría "Finance"; son benchmarks cross-category de apps móviles. Un producto multi-usuario con facturación anual puede comportarse más como SaaS prosumer, 1–2% de churn mensual. Es una de las incertidumbres más importantes del análisis.)*

**Consecuencias directas de pricing:** facturación anual por default, sin opción mensual barata; trial de 21–30 días; y **onboarding pago como mecanismo de activación, no como línea de ingreso** — costo hundido más datos completos en la ventana crítica del primer mes.

**El multi-usuario es la única palanca de retención estructural disponible.** Cada persona adicional con datos adentro multiplica el costo de cambio.

---

## A4. El cohorte legacy: la ventana está abierta ahora

El dolor de 2025–2026 no es el precio de Quicken: es que se está cayendo la conectividad.

- **Bank of America discontinuó todos los servicios OFX el 30-09-2025** (Direct Connect y Web Connect; importar un QFX da error CC-885) `[V]`.
- **Charles Schwab Bank discontinuó Web Connect el 22-01-2026** `[V]`.
- **PNC Direct Connect roto desde el 12-02-2026** `[P]`.
- BofA, US Bank y Discover eliminaron QFX/OFX/QBO. La industria está matando el archivo descargable `[P]`.
- Microsoft Money no murió: se fosilizó. Money Plus Sunset sigue corriendo en Windows 11, pero **Microsoft retiró el instalador de su Download Center** y las respuestas oficiales remiten al Internet Archive `[V]`. Hay preguntas nuevas en Microsoft Q&A fechadas el 27-02-2026 pidiendo cómo convertir `.MNY` `[V]`.

Es un **evento de migración forzada, con fecha**. No es una preferencia.

### La promesa "importamos 24 meses sin que pierdas nada": defendible, pero hay que reformularla

Como promesa técnica automática **no es defendible**. Como promesa operada con servicio, es una de las cuñas comerciales más fuertes disponibles. Motivos:

- El export de Microsoft Money es **una cuenta por fichero QIF**, no exporta cuentas cerradas ni préstamos ni securities ni presupuestos, tiene un límite reportado de ~500 transacciones por importación, **no es partida doble** (los saldos no cierran solos) y **escribe cada transferencia dos veces**, una en el QIF de cada cuenta `[V]`.
- QIF no tiene identificador único de transacción, ni moneda, ni tipo de cambio, y su formato de fecha es ambiguo `[V]`.
- OFX es mejor pero el **FITID es único dentro de la cuenta, no globalmente, y no es permanente** — los bancos reemiten FITIDs distintos tras un rebooking `[V]`.
- **Plaid tope 730 días** (`days_requested` 1–730, default 90) y **no se puede ampliar después de inicializar el Item sin borrar y re-linkear** `[V]`.

**Reformulación recomendada — tres promesas separables y verificables:**
1. *"Cargamos toda tu historia exportable, sin límite de años, y te mostramos exactamente qué entró y qué no antes de que confirmes."*
2. *"24 meses de tus cuentas conectadas desde el día uno."*
3. *"Si tu banco solo da PDF, nosotros lo pasamos a datos."*

Y el mecanismo que hace creíble todo lo anterior: **el informe de reconciliación de importación**. Cuenta por cuenta: saldo esperado vs. obtenido, filas leídas, importadas, duplicados descartados, transferencias emparejadas, rechazadas con motivo. Es el producto de confianza — y es la primera demostración del motor de reportes. *Si el motor no puede explicar su propia importación, no va a poder explicar el patrimonio de nadie.*

### Los 14 problemas técnicos que hay que resolver sí o sí

1. **Identidad de transacción propia:** hash canónico `(cuenta_id, fecha_normalizada, importe_en_moneda_de_cuenta, descripción_normalizada, ordinal)`. El FITID se guarda como atributo, nunca como clave primaria.
2. **FITID con alcance de cuenta y tolerancia a inestabilidad:** único por `(institución, cuenta, FITID)`.
3. **Dedup en dos pasadas:** determinista + difusa (±5 días, importe exacto, similitud de descripción) con **cola de revisión humana**. Nunca autodescartar en silencio.
4. **Idempotencia total:** reimportar el mismo fichero produce cero altas. Todo lote es reversible.
5. **Matching de transferencias:** pares `(-X en A, +X en B)` dentro de ±5 días, colapsados en una entidad `transferencia` de dos patas que **no cuenta como gasto ni ingreso**. Cubrir fechas distintas por pata, importes distintos por FX o comisión, y transferencias a tres patas.
6. **Detección del formato de fecha** escaneando el fichero completo antes de parsear. Nunca asumir locale.
7. **Convención de signos por origen**, con detección de columnas débito/crédito y de valor absoluto + indicador C/D (MT940, Norma 43, camt.053).
8. **Multi-moneda de primera clase:** importe en moneda original, en moneda de la cuenta y en moneda de reporte, con el tipo de cambio **usado en el momento**.
9. **Gasto de tarjeta en moneda extranjera = tres números:** importe del comercio, importe liquidado, comisión de cambio separada.
10. **Saldo de apertura y reconciliación por cuenta.** Un delta ≠ 0 es un fallo visible, no un detalle.
11. **Fechas de booking vs. valor** (camt.053 da las dos): elegir una canónica y conservar la otra.
12. **Splits, categorías fantasma y jerarquías:** preservar memos por split, ofrecer descartar categorías internas tipo "XXXX", pantalla de mapeo explícita.
13. **Parsers por formato con suite de regresión con ficheros reales:** QIF (loose y strict), OFX 1.x SGML y 2.x XML, QFX, QBO, CSV con detección de esquema, MT940, camt.053 y **Norma 43** (estándar de todos los bancos grandes de España, conviviendo con camt.053 hasta 2028) `[P]`. Más OCR de PDF: es la única vía para Argentina y para historia de más de 24 meses en casi todos los bancos.
14. **Pedir 730 días en el primer link de Plaid, siempre.** Debe ser un test de integración, no un recordatorio.

**Regla transversal:** nunca importar en silencio, y todo lote es reversible.

---

## A5. Infraestructura de datos: el número que rompe el pricing

### Agregación bancaria

**Ningún agregador grande publica precios.** Los dos únicos precios públicos verificables en EE.UU. son:
- **Teller: USD 0,30 por enrollment/mes** para Transactions (7.000+ instituciones US, dev tier gratis con 100 conexiones) `[V]`.
- **SimpleFIN Bridge: USD 15/año pagado por el usuario final**, hasta 25 instituciones `[V]`.

Plaid cobra Transactions como **suscripción mensual por Item** mientras exista un `access_token` válido `[V]`. Sin tarifario público. Mínimos reportados por terceros: **USD 1.000–3.000/mes** en bajo volumen, contrato mediano ~USD 10.000/año `[P, Vendr sobre 51 deals]`.

En Europa, **GoCardless Bank Account Data (ex-Nordigen) dejó de aceptar clientes nuevos desde julio de 2025** `[V]` — era la opción barata. El reemplazo práctico es **Enable Banking** (2.700+ bancos, 30 países, cobra por cuenta conectada por mes, **precio no público**) `[V]`. Su changelog documenta que **UniCredit, Banca Mediolanum y Crédit Agricole no exponen cuentas de tarjeta de crédito vía PSD2** `[V]`.

En LatAm el problema es el costo, no la cobertura: **Pluggy desde R$ 2.500/mes, Belvo desde USD 1.000/mes** `[V]`. **Argentina no tiene open banking operativo**: el Decreto 353/2025 creó el Sistema de Finanzas Abiertas con el BCRA como autoridad, pero en 2026 no hay estándares técnicos publicados `[P]`. **Suiza no tiene PSD2**: el camino es bLink de SIX, con multibanking retail lanzado la semana del 25-11-2025 con 8 bancos `[V]`, onboarding uno a uno.

**El número que importa: el piso de mínimos de contrato suma USD 2.500–6.000/mes antes del primer usuario.** Con 100 usuarios, eso son USD 25–60 por usuario y mes **solo en datos**. A USD 25–30/mes de precio, el margen bruto es negativo.

**El costo también puede subir sin aviso.** JPMorgan empezó a cobrar a los agregadores en 2025; Forbes reportó una estimación de **~USD 300M/año para Plaid, más del 75% de su revenue 2024** `[V]`. JPM declara procesar ~1.890 millones de requests de acceso a cuentas en un mes, de los cuales **solo el 6% está ligado a una acción activa del usuario** `[P]` — lo que hace que el refresh programado agresivo sea un costo directo creciente. Arquitectura obligada: refresh bajo demanda, webhooks y caché agresivo; nunca cron.

Estado regulatorio en EE.UU.: la regla 1033 del CFPB se finalizó en octubre de 2024 con primera fecha de cumplimiento el 1-04-2026; el CFPB emitió un ANPRM el 22-08-2025 reabriendo cuatro áreas (incluida **si los bancos pueden cobrar**) y envió el NPRM *"Personal Financial Data Rights Reconsideration"* a OIRA el **6 de agosto de 2026** `[V]`. Circula además que la regla está *enjoined* por el tribunal del E.D. Kentucky desde el 29-10-2025 — **esa caracterización viene de un blog de vendor y hay que verificarla en el docket antes de ponerla en un memo** `[?]`. La conclusión de negocio no cambia: **hoy no hay un derecho de acceso exigible y la cuestión de los fees está formalmente abierta.**

En Europa: **PSD3/PSR con acuerdo político el 27-11-2025 y textos finales el 23-04-2026, publicación esperada verano 2026, aplicabilidad real ~Q2/Q3 2028** `[P]`. **FIDA sigue en trílogo, aplicabilidad realista 2029–2030** `[P]`. Nada de esto ayuda antes de 2028.

### Fiabilidad: es un costo operativo, no un detalle

**Monarch usa tres proveedores en paralelo (Plaid + Mastercard Data Connect + MX) y publica un dashboard público de estado de conexión por institución** `[V]`. Eso es una confesión: la rotura es crónica y visible para el usuario final.

Causas documentadas de rotura: expiración de sesión y re-autenticación periódica (~90 días), cambio de contraseña, cambios de seguridad del banco, **MFA con OTP en cada login — que Plaid documenta como directamente incompatible con la sincronización automática** `[V]`, y revocación desde el banco.

Con 15 instituciones y SCA cada ~90 días, un usuario genera del orden de **60 eventos de reconexión al año en el mejor caso** `[I]`. Un usuario que pagó por no revisar no perdona un feed caído.

### FX: resuelto y gratis

**Frankfurter**: API open source, 201 monedas, histórico desde 1948, datos de 84 bancos centrales, sin cuotas ni API key, self-hosteable `[V]`. Alternativas de pago: OpenExchangeRates USD 12/47/97 al mes, Fixer USD 14,99/59,99/99,99 `[V]`. **No dedicar presupuesto a esto.** Lo que requiere diseño es la política contable, no la fuente de datos.

---

## A6. Arquitectura del motor de reportes (el núcleo del producto)

### Decisiones que hay que tomar el día 1 (irreversibles)

**1. Partida doble, pero invisible.** Guardar `entry` (evento) + N `postings` que suman cero. Es lo que hacen Firefly III (1 journal = 2+ transactions) `[V]`, GnuCash y Beancount. Splits, transferencias, multi-moneda y gastos compartidos con peso se resuelven todos con el mismo mecanismo; con "transacción de monto único" hay que parchear los cuatro por separado para siempre. Casos que lo justifican solo: gasto 60/40 entre persona y sociedad; transferencia EUR→USD; reembolso parcial; sueldo del personal doméstico pagado desde una cuenta e imputado a una propiedad.

**2. Multi-moneda: guardar tres números, no uno.** `(amount_native, currency_native)` + `fx_rate` usado + `amount_base` congelado a la fecha. **Nunca reconvertir históricos en silencio.**

**3. Flujos y stocks usan tasas distintas.** Gastos e ingresos se consolidan a la tasa de la fecha de la transacción; el patrimonio en cuentas de otra moneda se revalúa a la tasa de cierre del período. **La diferencia es ganancia/pérdida de cambio y debe ser una línea explícita, no un residuo.** GnuCash lo resuelve con *Trading Accounts* (método Selinger) `[V]`; hledger con `--infer-equity`; Beancount con precios que no tocan el inventario `[V]`. Modelar la revaluación como postings explícitos contra `Equity:FX-Revaluation:<CCY>` da gratis el waterfall con barra "efecto cambiario" **y su drill-down**.

**4. Dimensiones extensibles: híbrido.** FK-columnas para las ~6 dimensiones core (fecha, cuenta, moneda, categoría, comercio, entidad) + tabla puente `posting_dimension_value` con registro de dimensiones tipadas para el resto (persona, proyecto, propiedad, viaje, tag). EAV puro no; JSONB solo para atributos no filtrables `[P]`.

**5. El IR de consulta es la decisión más importante del producto.** Un DSL estructurado en JSON (medida + dimensiones + árbol de filtros AND/OR + grano temporal + comparación) que es **simultáneamente**: el reporte guardado, la URL, el payload del drill-down, el parámetro del PDF programado, el contenido del enlace compartido y la herramienta que invoca el asistente. **Un solo compilador IR→SQL.** Si hay cinco caminos de cálculo, hay cinco definiciones de "gasto" y el primer número que no cuadra mata la cuenta. La referencia más cercana y simple es ActualQL (`$and/$or/$gte/$oneof/$like`) `[V]`.

**6. Nunca exponer SQL.** Metabase documenta que el drill-through **no funciona sobre preguntas SQL nativas** porque *"corre tu query pero no la parsea"* `[V]`. Si el usuario o el LLM escriben SQL, se pierde el drill-down universal.

### Decisiones que se pueden diferir

- **Motor:** Postgres puro alcanza y sobra para 50k–500k transacciones por usuario. DuckDB/ClickHouse es sobreingeniería el día 1; la puerta de salida es `pg_duckdb` sobre una réplica de lectura `[V]`. *(La latencia p95 <300 ms es inferencia, no medición: hacer un spike de 2 días con 500k postings sintéticos y 8 dimensiones antes de comprometerla.)*
- **Multi-tenancy:** RLS de Postgres + `tenant_id` en cada tabla, no schema-per-tenant. RLS aísla filas pero **no CPU ni caché**: sumar `statement_timeout` y rate limiting por tenant `[V]`.
- **Capa semántica externa (Cube, dbt MetricFlow, Malloy):** no comprarla, robar el concepto. Definir medidas y dimensiones en un archivo declarativo propio. Cube Cloud arranca en USD 40/desarrollador/mes `[V]`.
- **PDF:** Typst en vez de headless Chrome (50–200 ms vs 800–2.000 ms con pool caliente) `[P, fuente con sesgo de vendor: hacer benchmark propio con la plantilla real]`. **Excel:** ExcelJS (Node, streaming real) o XlsxWriter (Python) `[P]`.
- **Gráficos:** Apache ECharts v6, Apache-2.0, ~100 kB gzip tree-shaken `[P]`. Para PDF, renderizar a SVG del lado servidor — nunca capturar screenshots.

### Drill-down universal

Mismo IR, sin agregación, con los filtros exactos del punto clickeado. Es el modelo `drillMembers` + `ResultSet#drillDown()` de Cube `[V]`. Los cinco enemigos de la consistencia, que hay que resolver explícitamente: **distinct counts, ratios, top-N con "Otros", redondeo FX y exclusión de transferencias**. Reglas: la conversión FX se hace **por posting y luego se suma** (nunca al revés, o el detalle no cuadra con el agregado por centavos); **"Otros" siempre es clickeable y devuelve el complemento exacto**; y hay un test en CI de `SUM(detalle) == agregado` al centavo, en las tres lentes de moneda.

### Detección de recurrentes

Normalizar descriptor → binning de importes con epsilon relativo → mediana de deltas de días con tolerancia a jitter → **madurez con ≥3 ocurrencias** (estándar de Plaid), early detection con 2, **180 días de historia mínimos**, y excluir explícitamente categorías de hábito (nafta, supermercado, café) — que es exactamente lo que hace Plaid `[V]`. No existen cifras públicas de precisión/recall de detección de recurrentes en ningún producto: hay que medirlo con datos reales y diseñar la corrección del usuario como parte del producto.

---

## A7. El asistente: arquitectura sobre datos estructurados

### La decisión está tomada por la evidencia, no por preferencia

**No hacer text-to-SQL directo.** Los mejores sistemas del mundo llegan a **81,95% de execution accuracy en BIRD** (baseline humano: 92,96%) y **76,23% en Spider 2.0-Lite**; en esquemas empresariales reales GPT-4o cayó de 86,6% (Spider 1.0) a **10,1%** (Spider 2.0) `[V]`.

Con capa semántica los números mejoran, pero **el argumento decisivo no es la precisión: es el modo de fallo.** Text-to-SQL falla en silencio (número plausible y falso); la capa semántica falla explícitamente ("no puedo responder eso") `[V]`. Para un CFO personal, un error explícito del 20% es tolerable; uno silencioso del 5% mata el producto.

Dos mediciones, con su salvedad:
- Benchmark abierto de dbt (7-abr-2026): Claude Sonnet 4.6 pasa de 90,0% a **98,2%** con capa semántica; GPT-5.3-Codex de 84,1% a **100%** `[V]` — **pero es sobre 11 preguntas** × 20 corridas.
- Paper de Cube (arXiv, abr-2026, 100 preguntas, 3 modelos frontera): **67,7–68,7% con capa semántica vs. 45,5–50,5% sin ella** (+17 a +23 puntos, p<0,01) `[V]`.

**Leer los dos juntos: la capa semántica ayuda mucho y aun así un tercio de las preguntas reales falla.** Las preguntas de este segmento son justamente multi-salto ("el costo total de la casa incluyendo la parte proporcional del sueldo de la asistenta"). De ahí el umbral de lanzamiento propuesto más abajo.

### Arquitectura de referencia

1. **LLM con tool-calling sobre una API de consulta tipada** (medidas, dimensiones, filtros, granularidad, orden) que compila a SQL. El LLM elige *qué* preguntar; nunca escribe el *cómo*. Escape hatch de SQL read-only sandboxeado, visible y confirmado por el usuario.
2. **Trazabilidad enforced por el renderer, no prometida por el prompt.** Cada número lleva un `query_id`; el renderer lo convierte en un chip expandible con filtro literal + métrica + nº de filas + link al drill-down. **Si un número no tiene referencia, se bloquea.**
3. **Acciones con estado = propuestas, no ejecuciones.** El gate vive fuera del modelo, en el harness. Precedente: Copilot Money lo declara explícitamente — *"It checks for your approval before any edits. Nothing happens without your say-so."* `[V]`.
4. **Memoria por usuario = ontología, no notas en texto.** Tabla de entidades (propiedades, personas, sociedades, cuentas, proyectos) con alias, predicado de filtro asociado, procedencia (dicho / inferido / confirmado) y validez temporal. El asistente llama `resolve_entity("la casa de España")` y recibe el filtro; nunca lo inventa.
5. **Permisos evaluados en la capa semántica.** El `scope_predicate` de cada grant se AND-ea a toda consulta antes de compilar. Consecuencia: **el asistente no puede consultar lo que el principal no puede ver, sin que haga falta confiar en el prompt** `[V, patrón MCP + capa semántica]`.

### Categorización: separar dos problemas

- **Resolución de comercio** (resoluble y comprable): Spade declara 99,9% de cobertura US/CA con >99% de precisión `[V]`; Snowdrop hasta 98% de match rate `[P]`; MX "up to 95%" `[P]`. **Todos son claims de marketing sin metodología, y todos son de Norteamérica.**
- **Asignación a la taxonomía del usuario** (personal / profesional / casa X): **es intención, no dato**, y no está en la transacción. Ahí vive el error.

Precisión realista de la segunda: **60–75% zero-shot** (GPT-4o midió 60,4% en transacciones reales de PyMEs; un FinBERT fine-tuned 73,5%), 88–92% en el subconjunto de alta confianza (~50% del volumen), y 90–96% tras 4–8 semanas de reglas y correcciones `[V]`. **Planificar 10–25% de revisión humana el primer mes y 3–8% en régimen** — y asumir que para un ICP multi-país con comercios europeos y latinoamericanos será peor.

El diseño ganador es el de Copilot: modelo por usuario, umbral de confianza, y **abstenerse en vez de adivinar**. Convertir el residual en feature ("12 transacciones necesitan tu criterio, 2 minutos") en vez de en defecto oculto. Y **las reglas tienen que ser visibles y editables desde la UI**: que no lo sean es la queja recurrente contra Copilot `[P]`.

### Alertas: optimizar precisión, no recall

En este segmento, tres falsos positivos seguidos y el usuario apaga las notificaciones para siempre. Lanzar solo con: subida de precio en recurrente de **importe fijo** con ≥3 ocurrencias, cargo recurrente ausente, y duplicado con céntimos no redondos. Comparar en **moneda de facturación original**, exigir Δ>5% **y** un piso absoluto, y poner un techo de 3 alertas por semana.

### Costo y privacidad

Con prompt caching y ruteo de modelos, el costo modelado es **USD 8–25/usuario/mes** en el peor caso razonable — 5–25% de una suscripción de USD 149 `[P, modelo con supuestos declarados: 2.000 txn/mes, 40 preguntas/mes, alto hit rate de caché]`. **El costo dominante del producto es la agregación bancaria y el servicio humano, no los tokens.**

Privacidad: "no entrenamos con tus datos" ya es baseline. Lo vendible son dos cosas concretas: **minimización arquitectónica** (el LLM ve esquema + ontología + agregados, no filas crudas — es verificable y explicable) y **permisos por dimensión implementados en la capa semántica**. Sobre residencia: **Anthropic no ofrece residencia UE de primera parte** — se consigue vía Bedrock o Vertex en regiones europeas `[P, fuente secundaria: confirmar comercialmente antes de firmar un contrato]`. Despliegue recomendado: híbrido — enriquecimiento con modelo open-weight en VPC propia (gpt-oss-120b o Qwen3, Apache 2.0), asistente en API frontera con ZDR contractual y camino a región UE listo.

---

## A8. Regulación, privacidad y confianza

**La regulación no mata este producto. Lo encarece y le dicta el vocabulario.**

### Dónde está la línea del asesoramiento regulado

El test de "investment adviser" en EE.UU. (§202(a)(11) del Advisers Act) tiene **tres elementos acumulativos**: (1) por compensación, (2) engaged in the business, (3) advice, recommendations, reports o analyses **sobre securities** `[V]`. Un producto que muestra gastos, cash flow y patrimonio como número **no toca el elemento 3**.

- El *publisher's exclusion* **no sirve**: exige contenido "general and impersonal", y un Personal CFO es personalizado por definición `[V]`. La defensa correcta es *"no hablamos de securities"*, no *"somos un publisher"*.
- En la UE, MiFID II define "investment advice" como **personal recommendation sobre instrumentos financieros presentada como adecuada para esa persona** `[V]`. El reporting agregado sin recomendación queda fuera.
- **"Proyectá tu liquidez" es seguro. "Deberías mover X a Y" no lo es.**
- En **España**, *asesoramiento financiero* es actividad reservada de la CNMV; una EAF requiere **capital mínimo de €75.000** `[V]`. En EE.UU., varios estados registran como investment adviser a quien hace **solo financial planning** `[P]`.
- **"Personal CFO" como nombre: riesgo bajo-medio.** "CFO" no es título reservado. Los términos peligrosos son *asesoramiento / advice / asesor / financial planning*.

**Consecuencia operativa:** un glosario prohibido aplicado a copy, emails, onboarding **y al output del asistente**, más un **clasificador de refusal en la capa de output del LLM** con logs de refusals como evidencia de programa. Un guardrail de system prompt no es defensa jurídica.

### El riesgo con precedentes reales no es la SEC

No encontré **ninguna** acción regulatoria contra una app de finanzas personales por asesoramiento de inversión no registrado. Los precedentes con dientes son de consumo:
- **FTC v. Cleo AI**, 27-03-2025: **USD 17 millones**, Section 5 + ROSCA, por claims exagerados y **cancelación difícil** `[V]`.
- **CFPB vs. Block/Cash App**, 15-01-2025: **hasta USD 175 millones** `[V]`.

Para un SaaS de precio alto con onboarding pago, **el vector de riesgo número uno es click-to-cancel y los claims de marketing**, no el Advisers Act. La política de reembolso tiene que ser explícita y generosa.

### El killer fiscal está en Alemania

**§5 StBerG** prohíbe la asistencia comercial en materia tributaria a no-Steuerberater, y **§6 Nr. 3 solo permite "mechanische Arbeitsgänge", excluyendo expresamente la codificación de documentos (*Kontierung*) y la emisión de instrucciones de contabilización** `[V]`. Una IA que auto-categoriza transacciones con efecto fiscal y arma un "cierre para el contador" es exactamente lo prohibido — y **el servicio humano es más riesgoso que el software**, no menos.

En EE.UU. el bookkeeping es libre; la línea es preparar o firmar declaraciones (PTIN, Circular 230). **Francia e Italia no están verificados**, pero por analogía con el monopolio del *expert-comptable* y de los *commercialisti* hay que presumir riesgo análogo y pedir dictamen local `[?]`.

**Decisión de roadmap:** no vender el módulo de cierre fiscal en DE/FR/IT hasta tener dictamen. El fallback es "propuesta que el cliente confirma", con el humano fuera del loop de codificación.

### Agregación: licencias

En UE/UK **no hace falta licencia propia si se opera como agente de un AISP autorizado** (~4–6 semanas, frente a 4–6 meses de registro propio) `[P]`. El registro propio como RAISP en UK cuesta **£1.130 de fee de aplicación** (categoría 3, verificado en la página de fees de la FCA) `[V]` y exige seguro de responsabilidad profesional con **piso de €50.000** según EBA/GL/2017/08 `[V]`.

**Y nunca pedir credenciales bancarias en la propia UI:** el settlement de Plaid de **USD 58 millones** (aprobado el 20-07-2022) fue literalmente por una UI que imitaba la pantalla de login del banco `[V]`. OAuth del banco o nada.

### Protección de datos y seguridad

- **Sos "financial institution" bajo la FTC Safeguards Rule** (16 CFR 314) casi con seguridad. **Pero §314.6 exime a quien mantiene información de menos de 5.000 consumidores** del risk assessment escrito, el pentest anual + escaneo semestral, el plan de respuesta a incidentes escrito y el reporte anual al board `[V]`. **Lo que NO se exime: cifrado en tránsito y en reposo, y MFA para cualquier persona que acceda a cualquier sistema** `[V]`. **Diseñar para ese umbral**: no gastar en pentest anual en fase 1, sí gastar en cifrado y MFA desde el día 1.
- **Notificación de brechas obligatoria desde mayo de 2024:** ≥500 consumidores → FTC en ≤30 días, y va a una base pública `[V]`. En este segmento eso es terminal. **El cifrado en reposo es literalmente la condición que apaga la obligación de notificar.**
- **CCPA/CPRA no exime a nivel entidad:** la exención GLBA es a nivel de dato (solo NPI). Analytics, marketing y datos B2B quedan dentro `[V]`.
- **Transferencias UE→EE.UU.:** el DPF sigue válido (el Tribunal General desestimó Latombe el 3-09-2025) pero hay apelación viva ante el TJUE (C-703/25 P) `[V]`. Con clientes europeos, la respuesta comercialmente ganadora no es "DPF": es **residencia de datos en la UE**, y es una decisión de arquitectura de fase 1 porque no se retrofitea barato.
- **Costos de certificación 2026** `[P, fuentes de vendors y lead-gen — pedir tres cotizaciones antes de meterlo en un modelo]`: SOC 2 Type II con firma especialista USD 15–50k de honorarios; pentest USD 8–30k; plataformas GRC con precio de lista público en AWS Marketplace (Sprinto desde USD 9.500, Secureframe USD 15.000, Drata USD 32.500). Ciberseguro para startup fintech: USD 5.000–15.000/año, con hasta ~30% de descuento por MFA obligatorio.

### El paquete de confianza es una ventaja desproporcionada

**68% de los family offices no tiene protocolo de "Know Your Vendor" y 58% de las nuevas relaciones con proveedores no tiene due diligence documentado** `[P]`. La lectura optimista: el que llega con el paquete de confianza armado gana por default. La lectura pesimista, igual de válida: **no evalúan porque compran por relación personal** — y un desconocido pidiendo acceso a 15 cuentas parte de confianza negativa.

Entregable mínimo de confianza: nombres y caras del equipo, jurisdicción de constitución de la sociedad, mapa de dónde viven los datos, lista pública de sub-encargados, quién internamente puede ver qué **con log visible para el cliente**, borrado total verificable, y **modo "solo importación manual" sin conectar bancos**.

**Ese modo manual no es una concesión: es un pilar estratégico.** Resuelve cuatro problemas a la vez — la objeción de privacidad (que en este segmento es mayoritaria `[I, sin medir]`), la licencia AISP en Europa, el costo variable creciente de la agregación, y el riesgo de brecha por credenciales.

---

# PARTE B — Los catorce entregables

## B1. Definición concreta de "Personal CFO"

**Un Personal CFO es el sistema de registro del dinero que entra, sale y se debe en una unidad familiar con estructura** — varias entidades legales, varias propiedades, varios países, varias personas con acceso — **y el motor de reportes que convierte ese registro en respuestas inmediatas y en entregables para terceros.**

Tres funciones, en este orden de importancia:

1. **Registrar bien.** Ingesta multi-fuente (API, archivo, PDF, manual), normalización a partida doble con grano *posting*, multi-moneda con FX congelado a la fecha, y dimensiones definidas por el usuario (propiedad, persona, sociedad, viaje, proyecto) que ningún software del sector modela hoy.
2. **Responder.** Reportes con filtros combinables, comparación de períodos y drill-down hasta la transacción, más un asistente que emite consultas tipadas sobre esos mismos datos.
3. **Delegar sin exponer.** Accesos con alcance, caducidad y log — para la pareja, el contador, el asistente y el asesor.

### Lo que explícitamente NO hace (lista cerrada, va publicada en el sitio)

| No hace | Por qué |
|---|---|
| Recomendar activos, rebalancear, proyectar retornos | Es el elemento 3 del test §202(a)(11) del Advisers Act |
| Asesoramiento financiero o "planificación financiera" | En España es actividad reservada de la CNMV; en EE.UU. varios estados registran a quien hace solo financial planning |
| Mover dinero: transferencias, pagos, bill pay | Sale del perímetro de datos y entra en servicios de pago |
| Preparar o firmar declaraciones fiscales | PTIN/Circular 230 en EE.UU.; §5 StBerG en Alemania |
| Custodiar activos | — |
| Vender leads de crédito, seguros o gestión patrimonial | Es el modelo de Fintonic y de Empower, y es exactamente lo que este cliente desconfía |

### Por qué el límite es una ventaja vendible, no una carencia

- **No monetizamos tu plata.** Suscripción pura, sin AUM, sin comisión, sin producto propio. Es la única estructura sin conflicto de interés — contraste directo con Empower (dashboard gratis como lead-gen de gestión patrimonial) y con Origin, que cruzó a asesoramiento y hoy opera bajo una RIA registrada en SEC.
- **El hueco está literalmente ahí.** ~120 productos de family office en 13 categorías y ninguna de gastos. Addepar se define como plataforma de reporting "rather than a general ledger or planning suite". Es una invitación a sentarse **al lado**, no enfrente.
- **Compliance barato.** Sin securities no hay Advisers Act ni MiFID II; el trabajo regulatorio se reduce a vocabulario y guardrails.
- **Foco.** El día que el roadmap admite "análisis de portfolio", el motor de reportes deja de ser el diferencial y el producto se convierte en un Kubera peor.

### Posicionamiento

**Principal:** *"El sistema de registro de tu vida financiera: todas tus cuentas, países y monedas en un solo lugar, con los reportes que hoy le pedís a tu contador y esperás tres semanas."*

Alternativas:
- *"Un CFO no elige tus inversiones. Ordena el dinero, dice cuánto cuesta cada cosa y arma el cierre. Eso hacemos."*
- *"Dejá de mandarle extractos por mail a tu contador."*
- *"Tu patrimonio ya tiene quien lo mire. Tus gastos, no."*

---

## B2. Perfil del cliente ideal (ICP)

**La variable de segmentación no es el patrimonio: es la complejidad operativa.**

| Dimensión | Umbral de calificación | Cómo se verifica en la llamada |
|---|---|---|
| Cuentas y tarjetas | ≥12 | "Contame cuántas cuentas y tarjetas tenés que mirar" |
| Países | ≥2 (uno de ellos EE.UU. o UE) | — |
| Monedas | ≥2 | "¿En qué moneda pensás tu patrimonio?" |
| Estructura | ≥1 sociedad patrimonial **o** ≥2 propiedades **o** personal doméstico en blanco | Es el disparador de las dimensiones |
| Personas con acceso | ≥1 además del titular | Pareja, contador, asistente |
| **Gasto actual en el problema** | **≥USD 3.000/año** en contador, bookkeeper, DMM o asistente | **El calificador más predictivo** |
| Herramienta hoy | Excel/Sheets + portal del asesor + una app de consumo, o Quicken/Money con 10+ años | Si dice "no uso nada", no está listo |
| Tolerancia a operar software | Abre un dashboard al menos 1×/mes | Si delega el 100%, el comprador es el operador, no la persona |

**Detonantes de compra, por orden de potencia:**
1. **Rotura de conectividad legacy** (BofA 30-09-2025, Schwab 22-01-2026, PNC 12-02-2026). Migración forzada, ahora mismo.
2. **Cambio de contador**, que expone que nadie sabe dónde están los datos.
3. **Compra o venta de una propiedad**, o alta de una sociedad.
4. **Divorcio, herencia o entrada de un hijo adulto** a la estructura: aparece la necesidad de permisos.
5. **Susto fiscal**: un requerimiento que obliga a reconstruir 24 meses.

**A quién NO vender:**

| Perfil | Por qué descalifica |
|---|---|
| Refugiado de Quicken/Money sin entidades ni multi-país | Techo de WTP USD 100–250/año. Excelente beta tester, pésimo cliente a precio alto |
| Pareja que quiere presupuestar junta | Monarch lo resuelve a USD 99/año con 4,89/5 y 104k reseñas. Es una feature obligatoria, no un segmento |
| Patrimonio alto que delega el 100% y no abre software | Compra resultado. Solo vendible con capa de servicio operativa; si no la hay, no vender |
| Family office con >5 entidades y contabilidad formal | Necesita GL y auditoría: es Asset Vantage (USD 30.000/año) o Eton. Se pierde por abajo |
| >60% del patrimonio operativo en Argentina o Suiza | Sin open banking operativo. Vendible **solo** en el tier manual, y diciéndolo |
| Quien quiere que le digan qué hacer con su plata | Fuera del producto por diseño |

---

## B3. Los cinco reportes por los que pagaría

### R1 — Cierre Mensual para el Contador
**Pregunta:** *"¿Está cerrado el mes y puedo mandárselo sin que me lo devuelvan?"*
**Consume:** contador (primario), titular (aprueba).
**Por qué duele hoy:** es literalmente el entregable por el que se pagan USD 300–5.000/mes, con 2–6 semanas de rezago y en PDF muerto.
**Filtros/dimensiones:** entidad legal, cuenta, categoría, período (mes cerrado), moneda de reporte, exclusión de transferencias internas, exclusión de categorías marcadas sensibles.
**Formato:** PDF + XLSX con fórmulas y tablas reales + CSV crudo + ZIP de adjuntos. Programado el día 5.

**Layout — cinco bloques verticales:**
1. **Cabecera de estado:** entidad, período, moneda, política FX aplicada, semáforo de completitud (cuentas conciliadas / con delta / sin sincronizar).
2. **Reconciliación por cuenta:** `cuenta | saldo inicial | movimientos | saldo final calculado | saldo real | delta`. Delta ≠ 0 en rojo. **Este bloque es el producto de confianza.**
3. **Estado de resultados por categoría** con comparación mes anterior y acumulado del año.
4. **Excepciones:** sin categorizar, splits pendientes, transferencias sin par, duplicados descartados, y **"N transacciones ocultas por política de privacidad, importe total X"** — el hueco se declara, nunca se esconde.
5. **Anexo:** adjuntos vinculados y log de cambios posteriores al cierre anterior.

### R2 — Costo Total por Propiedad / Entidad
**Pregunta:** *"¿Cuánto me cuesta realmente la casa de Madrid, todo incluido, y cómo se compara con el año pasado?"*
**Por qué duele:** ninguna plataforma del sector modela la dimensión "propiedad". El hack de campo es Classes/Locations de QuickBooks, mantenido a mano.
**Dimensiones:** propiedad (jerárquica: propiedad → área: obra, servicios, personal, impuestos, seguros), persona, proveedor, entidad pagadora, moneda.
**Layout:** selector de propiedad arriba (chips multi-select) · fila de KPIs (costo total, promedio mensual, Δ% vs. comparación, % del gasto total del hogar) · barras apiladas por área y mes · tabla `área | importe | Δ | % del total | nº transacciones`, cada fila clickeable · panel lateral con top 10 proveedores y Pareto acumulado.
**Este es el reporte de la demo comercial.**

### R3 — Cash Flow y Proyección de Liquidez (13 semanas / 12 meses)
**Pregunta:** *"¿Me alcanza? ¿En qué cuenta y en qué moneda va a faltar, y cuándo?"*
**Por qué duele:** ingresos irregulares (distribuciones, honorarios, alquileres) contra obligaciones fijas grandes. Hoy es un Excel manual.
**Layout:** toggle 13 semanas / 12 meses · **un carril por moneda, sin consolidar** (el problema de liquidez es por moneda, no por patrimonio) · línea de saldo proyectado con banda de incertidumbre · barra de eventos grandes bajo el eje · tabla `fecha | concepto | cuenta | importe | confianza (confirmado/probable)` **editable en línea**, porque el usuario sabe cosas que los datos no. Alimentado por el motor de recurrentes (≥3 ocurrencias = confirmado, 2 = probable).

### R4 — Patrimonio con Atribución de Variación (incluido FX)
**Pregunta:** *"Mi patrimonio subió 4%. ¿Cuánto fue aporte, cuánto gasto, cuánto mercado y cuánto tipo de cambio?"*
**Por qué duele:** **Kubera consolida a moneda base pero no desglosa el impacto FX.** Es un hueco verificado en el producto más caro del mercado consumer.
**Layout:** waterfall de 6 barras (saldo inicial → aportes → gastos → revaluación de activos → efecto FX → saldo final), cada una clickeable · tabla de composición por entidad y propietario con columna "cuánto explica de la variación" · nota metodológica visible al pie: *flujos a tasa de la fecha, stocks a tasa de cierre, diferencia = efecto FX*.
**Requisito técnico derivado:** la barra de FX debe ser clickeable, lo que obliga a modelar la revaluación como postings explícitos contra `Equity:FX-Revaluation:<CCY>` y no como un cálculo al vuelo.
**Nota de límite:** clase de activo solo a nivel agregado. Sin análisis de performance, sin comparación con índices, sin proyección de retornos.

### R5 — Obligaciones Recurrentes y Fugas
**Pregunta:** *"¿Qué me están cobrando todos los meses, qué subió, y qué no se cobró?"*
**Por qué duele:** con 25 cuentas y 6 tarjetas nadie tiene el inventario. Es el hallazgo de mayor ROI percibido en la primera semana.
**Layout:** tabla `proveedor | importe actual | importe mediano | Δ% | frecuencia | próxima fecha esperada | cuenta | estado` con sparkline por serie. Estados: activo, subió, no cobró, huérfano.
**Regla dura:** la detección de subida corre **solo sobre series de importe fijo**, compara en **moneda de facturación original** y exige Δ>5% **y** un piso absoluto. Si no, la luz y el FX generan ruido y el usuario apaga las notificaciones para siempre.

---

## B4. Diseño conceptual del report builder

### La decisión: ni mini-BI ni filtros fijos

**Mini-BI es un error** porque expone joins y etapas (la crítica documentada del notebook de Metabase, issue #14467 abierto desde 2021) y porque si el usuario o el LLM escriben SQL **se pierde el drill-down universal**.
**Filtros fijos también es un error**: es lo que ofrece Simplifi, y es la razón por la que Quicken Classic, con 20 años encima, sigue siendo el mejor motor de reportes del mercado.

**Tres niveles:**

| Nivel | Qué es | % de uso estimado `[I — instrumentar y corregir]` |
|---|---|---|
| 1. Plantillas | 18 reportes precocinados, incluidos los 5 anteriores | 70% |
| 2. Builder guiado | medida → dimensiones → filtros → comparación → visualización → guardar | 25% |
| 3. Modo avanzado | árbol AND/OR anidado, detrás de un click | 5% |

El nivel 2 usa **AND entre dimensiones y OR implícito dentro de cada una** (elegir tres categorías = OR). Eso cubre el 90% de las preguntas sin que nadie vea un operador booleano. El nivel 3 existe porque es barato — **no porque esté demostrado que nadie más lo tenga** (ver corrección en A1.3).

### Catálogo del día 1

- **Medidas (12):** gasto neto, gasto bruto, ingreso, flujo neto, saldo, saldo proyectado, patrimonio neto, variación de patrimonio, efecto FX, obligación recurrente mensualizada, nº de transacciones, ticket promedio.
- **Dimensiones (14):** fecha (día/semana/mes/trimestre/año), cuenta, institución, entidad legal, propiedad, persona, proyecto, viaje, categoría (jerárquica), comercio/proveedor, moneda original, país, método de pago, tag libre.
- **Tipos de filtro (9):** igual/distinto · uno de/ninguno de · contiene/no contiene · rango numérico · rango de fecha absoluto y relativo ("últimos 12 meses", "trimestre anterior") · es nulo/no nulo · umbral de importe en moneda de reporte · tiene adjunto · origen del dato (API/archivo/manual).
- **Comparaciones (4):** período anterior · mismo período del año anterior · promedio de N períodos · presupuesto/objetivo.
- **Reglas transversales definidas una sola vez en la capa semántica:** las transferencias internas nunca cuentan como gasto; la conversión FX se hace por posting y luego se suma; los splits con peso agregan `importe × peso` y el detalle muestra la porción.

### Cómo se evita que sea inusable

- Resultado en vivo en cada cambio, sin botón "ejecutar".
- Una fila por paso, siempre visible y en el mismo orden: el usuario lee su pregunta como una oración.
- Tabla de desglose debajo del gráfico, sincronizada, con top-N automático y **"Otros" siempre clickeable**.
- Cada número lleva un chip de trazabilidad expandible: medida, filtros literales, rango, moneda, nº de transacciones, link al detalle.
- Metadatos de cobertura obligatorios en la cabecera: % sin categorizar, cuentas desactualizadas, si hubo conversión FX.
- Test de reconciliación en CI: `SUM(detalle) == agregado` al centavo, en las tres lentes de moneda.

### El objeto "reporte" (IR)

Este objeto **es** el reporte guardado, la URL, el payload del drill-down, el parámetro del PDF programado, el contenido del enlace compartido y la herramienta que invoca el asistente.

```json
{
  "id": "rpt_9f2c", "version": 3, "tenant_id": "hh_014",
  "name": "Costo casa Madrid vs 2025",
  "measures": ["gasto_neto"],
  "dimensions": [
    {"field": "propiedad", "level": "area"},
    {"field": "fecha", "grain": "month"}
  ],
  "filter": {
    "op": "and",
    "children": [
      {"op": "or", "children": [
        {"field": "propiedad", "operator": "one_of", "value": ["prop_madrid"]},
        {"field": "tag", "operator": "one_of", "value": ["obra_madrid"]}
      ]},
      {"field": "categoria", "operator": "not_one_of", "value": ["cat_transferencia"]},
      {"field": "fecha", "operator": "relative_range", "value": "last_12_months"}
    ]
  },
  "compare": {"type": "same_period_last_year"},
  "currency": {"report": "EUR", "flow_policy": "txn_date", "stock_policy": "period_close"},
  "exclusions": ["internal_transfers"],
  "sensitivity_policy": "declare_hidden",
  "sort": [{"field": "gasto_neto", "dir": "desc"}],
  "limit": {"top_n": 10, "others": true},
  "viz": {"type": "stacked_bar", "secondary": "table", "drill": true},
  "sharing": {"mode": "private"},
  "schedule": null,
  "created_by": "usr_1", "updated_at": "2026-08-12T10:00:00Z"
}
```

**Compartir:** JWT firmado con `exp`, alcance = este IR exacto y nada más, revocable server-side, con log de accesos visible para el dueño. **No usar "public links" tipo Metabase**: su propia documentación advierte que quitando los parámetros de la URL se ve la pregunta original sin filtros.
**Programar:** cron + destinatarios (que pueden no ser usuarios) + formatos. Se guarda el IR, no el resultado; se renderiza a la hora.

### Los gráficos: qué construir y qué es vanidad

| Gráfico | ¿Día 1? | Por qué |
|---|---|---|
| **Tabla con drill-down** | Sí | La visualización más usada y la menos citada. Todo gráfico necesita su tabla debajo |
| **Serie temporal con comparación** | Sí | El default correcto para tendencia |
| **Barras apiladas por categoría/mes** | Sí | Lectura de mix en el tiempo. Es R2 |
| **Bullet / presupuesto vs. real** | Sí | Lo primero que mira quien administra |
| **Waterfall de variación patrimonial** | Sí | Donde vive la atribución FX que Kubera no da. Alto valor, poco ofrecido |
| **Proyección de liquidez con banda** | Sí | Core del segmento. Es R3 |
| **Pareto de proveedores** | Sí | Barato y accionable ("el 20% de tus proveedores es el 63% del gasto") |
| **Sankey ingreso→categorías** | **Marketing** | Monarch lo llama "fan-favorite" y lo usa para adquisición. Alta primera impresión, baja frecuencia. Una semana de trabajo, **fuera del roadmap del motor** |
| Treemap | No | Comparar áreas es cognitivamente caro; la tabla gana |
| Heatmap calendario | No | Bonito, poco accionable con gasto lumpy |
| Torta | No | Salvo 2–3 segmentos |
| Gauge | No | Ocupa mucho, dice poco |

**Regla de diseño transversal: cualquier elemento gráfico que no sea clickeable hasta la transacción no entra al producto. Si un número no se puede explicar, no se muestra.**

---

## B5. Dashboards iniciales

| Dashboard | Para quién | Widgets |
|---|---|---|
| **Hoy** | Titular | Liquidez por moneda (KPI × N) · Proyección 13 semanas · Alertas abiertas (máx. 3) · Bandeja de revisión ("12 transacciones necesitan tu criterio") · Estado de conexiones |
| **Este Mes** | Titular + pareja | Gasto del mes vs. mes anterior vs. promedio 12m · Barras apiladas por categoría · Bullet presupuesto vs. real · Top 10 comercios con Pareto · Gasto por propiedad |
| **Estructura** | Titular + asesor (lectura) | Patrimonio neto (serie) · Waterfall de variación con barra FX · Composición por entidad y propietario · Distribución por moneda · Obligaciones recurrentes mensualizadas |
| **Cierre** | Contador + titular | Semáforo de completitud por cuenta · Deltas de reconciliación · Sin categorizar · Transferencias sin par · Botón "generar cierre" · Historial de cierres emitidos |

**Personalización del día 1, deliberadamente limitada:** reordenar widgets, ocultarlos, cambiar el período global y **fijar hasta 3 reportes guardados en slots libres**. Nada de drag-and-drop libre ni dashboards nuevos desde cero.

**Razón:** un canvas vacío es la forma más rápida de que alguien descubra que no sabe qué preguntar. El canvas libre llega después, y solo si la telemetría muestra que la gente agota los slots.

---

## B6. Roles y permisos

Acciones: **V**er · **F**iltrar · **E**xportar · **C**omentar · **Ed**itar · **A**probar · **I**nvitar.

| Rol | Alcance por defecto | V | F | E | C | Ed | A | I |
|---|---|---|---|---|---|---|---|---|
| **Titular** | Todo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Pareja / co-titular** | Todo menos entidades marcadas "privadas" | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| **Contador** | Entidades asignadas; categorías sensibles excluidas; adjuntos fiscales sí | ✓ | ✓ | ✓ | ✓ | Δ | — | — |
| **Asistente** | Dimensiones asignadas (viajes, suscripciones, proveedores); importes visibles, saldos ocultos | ✓ | ✓ | — | ✓ | Δ | — | — |
| **Asesor** | Solo patrimonio agregado y R4; sin transacciones | ✓ | ✓ | ✓ | ✓ | — | — | — |
| **Invitado por link** | Un IR exacto, congelado | ✓ | — | Δ | — | — | — | — |

Δ = configurable, apagado por defecto. **Editar, para contador y asistente, significa proponer**: la propuesta genera un diff que el titular aprueba. Nunca escritura directa.

**Ámbitos:** cuenta (individual o por institución) · entidad legal · categoría (individual o por rama, con flag `sensible`) · **propiedad / persona / proyecto (este es el diferencial)** · reporte / dashboard · adjuntos por tipo (fiscal, contractual, personal).

**Modelo técnico.** Un grant es `(principal, scope_predicate, actions[], expires_at, granted_by)`. **El `scope_predicate` es un filtro del mismo lenguaje que el IR** y se AND-ea a toda consulta en la capa semántica antes de compilar a SQL. Consecuencias: el asistente no puede consultar lo que el principal no puede ver; un bug que omite el filtro en la app no filtra datos porque el filtro no vive en la app; y los permisos por dimensión son gratis, porque son predicados. Debajo, RLS de Postgres con `tenant_id` en todas las tablas + `statement_timeout` y concurrencia limitada por tenant.

**Casos borde — son los que definen si el producto es serio:**

| Caso | Regla |
|---|---|
| **Ex-pareja co-titular** | Un co-titular **no** se revoca unilateralmente. Se ejecuta una *separación de household*: corte a fecha, export completo a ambos, histórico compartido congelado en solo-lectura para ambos. Revocar en caliente los datos de alguien que los co-creó es una demanda esperando pasar |
| **Revocación de contador** | Kill switch: invalida sesión, revoca todos los JWT de reportes emitidos por esa persona, cancela envíos programados y **notifica al titular qué se llevó** (log de exports de los últimos 90 días) |
| **Datos que el contador nunca ve** | Categorías con flag `sensible` (salud, donaciones, legal, terapia) excluidas por defecto — **pero el reporte declara el hueco**: "47 transacciones ocultas por política, EUR 12.340". Ocultar en silencio rompe la reconciliación y destruye la confianza cuando se descubre |
| **Caducidad obligatoria** | Contador 90 días renovables, asesor 30, invitado por link 7 (máx. 30). Monarch expira su rol Professional al año; acá somos más estrictos y se vende como feature |
| **Fallecimiento / inactividad** | Entrega a beneficiarios designados tras N días de inactividad, con doble confirmación. Kubera lo tiene ("dead man's switch") y en este segmento se pregunta en la primera llamada |
| **Log visible** | El titular ve "quién vio qué y cuándo", filtrable. **No es un control de seguridad: es una feature de gobernanza familiar**, porque el miedo real de este cliente es tanto el ex-cónyuge y el asistente como el hacker |

**Riesgo a mitigar:** los permisos por dimensión son el diferencial y también el mejor camino a una pantalla de configuración que nadie completa. Mitigación: **tres presets de un click (Contador / Asistente / Asesor)**, configuración avanzada escondida, e **invitación como paso del onboarding, hecha por el equipo**.

---

## B7. Flujo de onboarding premium

Cliente arquetipo del piloto: 18 cuentas, 3 países, 2 monedas, 1 sociedad patrimonial, 3 propiedades, 1 contador externo, 1 pareja, 1 asistente.

| # | Paso | Duración | Se le pide al cliente | Entrega el equipo | Horas equipo v1 → v3 |
|---|---|---|---|---|---|
| 0 | Calificación | 30 min | Nº de entidades, propiedades, países, personas con acceso, a quién le paga hoy | Go/no-go + presupuesto cerrado | 0,5 → 0,3 |
| 1 | **Kickoff "diseño de tu estructura"** | 90 min video | Nombrar sus propiedades, sociedades, personas y proyectos **como los nombra en la vida real** | **Mapa de dimensiones** (no plan de cuentas), con alias | 2 → 1 |
| 2 | Recolección | 3–5 días, 1–2 h del cliente | Exports por institución (OFX/QFX/CSV/Norma 43/camt.053), PDFs donde no haya otra cosa, saldos actuales | Checklist personalizado con instrucciones banco por banco | 1,5 → 0,5 |
| 3 | **Ingesta + reconciliación de 12–24 meses** | 2–3 días | Nada | **Informe de reconciliación** por cuenta: leídas / importadas / duplicadas descartadas / transferencias emparejadas / rechazadas con motivo / **delta de saldo** | 8 → 2,5 |
| 4 | Categorización asistida | 1 día + sesión de 45 min | Confirmar 15–30 decisiones de criterio ("¿esta compra es casa, oficina o hijos?") | Reglas propuestas con diff e impacto ("esta regla afecta 342 transacciones") | 6 → 2 |
| 5 | **Tres dashboards** | 1 día | Nada | Cash flow multi-moneda **con el efecto FX como línea separada** · Costo por propiedad/entidad con drill-down · Recurrentes + obligaciones + proyección de liquidez | 4 → 1 |
| 6 | Accesos delegados | 30 min | A quién invita y qué debe ver cada persona | Invitaciones con scope por dimensión, caducidad y log visible | 1 → 0,5 |
| 7 | **Primer cierre mensual** | 2 h + 45 min | Nada | Paquete PDF + XLSX apto para el contador, + tres hallazgos concretos ("el seguro subió 22%", "estos 4 recurrentes nunca los revisaste") | 4 → 1,5 |
| 8 | Handoff a self-service | 30 min | — | Grabación de 8 min: "cómo hacerte vos la pregunta que hoy me hacés a mí" | 1 → 0,5 |
| | **Total** | **~3 semanas calendario** | **~3 h de tiempo del cliente** | | **28 h → 9,8 h** |

> **Corrección importante:** la estimación consistente es **28 horas en la versión 1**, no 8–14. A un costo cargado de USD 24–30/hora eso son **USD 670–840 de costo por onboarding**. Un onboarding de USD 750 tiene margen cero o negativo. **De ahí que el precio mínimo del onboarding sea USD 1.500** (ver B8), y que bajar de 28 h a ~10 h sea un objetivo de producto, no una optimización.

**Los cuatro momentos "wow", por orden de potencia:**
1. **Paso 3** — *"24 meses cargados, 18 cuentas, delta de saldo 0,00 en 17 de 18, y la que falta es esta y este es el motivo."* Nadie del mercado entrega esto. Es la prueba de credibilidad de todo lo demás.
2. **Paso 5** — *"cuánto me cuesta la casa de Madrid"* respondido en 3 segundos con drill-down. El sustituto humano tarda un email y días.
3. **Paso 6** — *"dejá de mandarle extractos completos por mail a tu contador; dale una vista acotada, auditable y con caducidad."* Es reducción de exposición, no aumento: hay que venderlo así.
4. **Paso 7** — la diferencia de cambio separada del movimiento real.

**Cómo bajar de 28 h a ~10 h, en orden de ROI:**
- **Parsers con suite de regresión por banco real en el repo** (−5,5 h). El 80% del trabajo manual es el mismo banco otra vez.
- **Biblioteca de plantillas de dimensiones por arquetipo** (−4 h). "Familia con propiedades + sociedad" no se diseña de cero cada vez.
- **Reglas de comercio compartidas a nivel plataforma** (−4 h), sin compartir datos: el mapeo descriptor→comercio canónico es cross-tenant; la asignación a la taxonomía del cliente no.
- **Auto-generación de los tres dashboards desde el mapa de dimensiones** (−3 h).
- **El informe de reconciliación como producto y no como Excel del operador** (−2,5 h).

**Regla dura de arquitectura para el paso 2:** si en algún momento se usa Plaid, hay que pedir `days_requested: 730` en el primer link. No se puede ampliar después sin borrar y re-linkear el Item.

---

## B8. Propuesta de precios (esquema único)

> Los cuatro análisis produjeron cuatro esquemas de precio incompatibles. Este es el esquema unificado, reconciliado con la economía unitaria de B9 y con las 28 h de onboarding de B7.

| Plan | Precio anual (equiv./mes) | Entidades | Colaboradores | Instituciones | Onboarding |
|---|---|---|---|---|---|
| **Archivo** | **USD 588/año (49/mes)** | 1 | 2 | **Ninguna conexión** — importación de archivos, PDF y manual | Self-serve guiado, gratis |
| **Core** | **USD 1.788/año (149/mes)** | 3 | 5 con permisos por dimensión | 20 incluidas | **USD 1.500, obligatorio** |
| **Complex** | **USD 4.188/año (349/mes)** | 10 | 10 + enlaces de reporte con expiración | 60 incluidas | **USD 2.500, obligatorio** |
| **Cierre Mensual** (add-on de servicio sobre Core o Complex) | **+USD 5.400/año (450/mes)** | — | — | — | Incluido |
| Institución adicional | +USD 5/mes | | | | |
| Entidad adicional | +USD 25/mes | | | | |

**Reglas de packaging:**
- **Facturación anual, sin opción mensual.** No es preferencia: es la diferencia entre 44,1% y 12,2% de retención a 12 meses. Trial de 21–30 días.
- **Plan familiar incluido** en Core y Complex: cada miembro del hogar tiene login y vista propia sin cargo. Cobrar un asiento familiar de USD 20 cuesta la venta de USD 1.788.
- **El rol "Contador" es gratis y no consume asiento.** Es la decisión estratégica más importante del pricing: **el contador es canal de distribución, no cliente. Cobrarle un asiento lo convierte en bloqueador.**
- **Se cobra por entidades + colaboradores, no por instituciones.** Las instituciones son el driver del *costo* (cada Item de Plaid es una suscripción mensual); las entidades y las personas con acceso son el driver del *valor* y de la retención. Precedente directo: Asset Vantage cobra literalmente por entidad legal. Pero las instituciones **no pueden ser ilimitadas** — cupo por tier + overage de USD 5/mes.

### Evaluación explícita de las bandas planteadas en el brief

| Banda | Veredicto | Razón |
|---|---|---|
| **USD 20–30/mes** | **Descartar** | El piso de mínimos de agregación (USD 2.500–6.000/mes antes del primer usuario) hace el margen negativo hasta ~1.000 usuarios. Y a USD 25/mes se compite de frente con Monarch Plus, que tiene 500k suscriptores y USD 75M de Serie B. La única versión viable de esta banda es "un país, sin agregación" — y eso es el tier Archivo a USD 49 |
| **USD 50/mes** | **Tierra de nadie. Evitar** | Demasiado caro para el refugiado de Quicken (techo USD 100–250/año), demasiado barato para señalizarle seriedad a quien compra señalización. Paga los costos de un producto premium con el precio de uno medio |
| **USD 100/mes** | **Correcto como piso, no como techo** | Es el punto donde la economía cierra con agregación. Se fija en USD 149 para dejar margen a un aumento de 2–3× en el costo de datos en EE.UU., que es plausible y no negociable por nosotros |
| **Onboarding USD 250** | **Insuficiente y contraproducente** | No cubre ni una fracción de las 28 h reales. Y un onboarding barato señala un onboarding liviano, cuando lo que este cliente compra es precisamente el "no lo hago yo" |
| **Onboarding USD 750–1.000** | **Insuficiente** | A 28 h × USD 24–30/h el costo es USD 670–840: margen cero |
| **Onboarding USD 1.500–2.500** | **Correcto, y barato para el estándar del sector** | Asora cobra USD 3.900 de onboarding; Asset Vantage, FundCount y Eton cobran implementación aparte |
| **Servicio recurrente de Personal CFO** | **USD 450/mes** | Es 1/4 del mínimo de Plumb (USD 1.000/mes) y 1/9 de su ticket típico |

### Qué valor hay que entregar para justificar cada nivel

- **USD 49/mes:** importación impecable con informe de reconciliación, motor de reportes completo, multi-moneda correcta. Sin conexiones. *Ancla: el tiempo propio en Excel.*
- **USD 149/mes:** lo anterior + 20 conexiones mantenidas + accesos delegados con permisos por dimensión + cierre mensual autoservicio. *Ancla: los USD 300–2.000/mes de un bookkeeper.*
- **USD 349/mes:** lo anterior + multi-entidad + enlaces compartidos + soporte prioritario. *Ancla: Asora a USD 15.600/año, que ni siquiera cubre gastos.*
- **+USD 450/mes:** un humano revisa las clasificaciones, produce el cierre, reconecta lo que se rompe y contesta preguntas ad-hoc con SLA de 24 h. *Ancla: Plumb a USD 12.000–48.000/año.*

---

## B9. Software vs. servicio: los tres modelos con números

| Dimensión | (a) Solo software | (b) Software + onboarding pago | (c) Software + servicio recurrente |
|---|---|---|---|
| **Qué se entrega** | Producto self-serve, soporte por chat | + setup completo: conectar 20–40 instituciones, importar 24 meses + histórico por archivo, mapear entidades/propiedades/personas, definir taxonomía y reglas, configurar roles | + revisión mensual de categorización, cierre mensual, paquete de reportes, reconexión proactiva, preguntas ad-hoc, interlocución con el contador |
| **Horas humanas/cliente/mes** | 0,3–0,6 h (dominadas por reconexiones) | 28 h **one-time** (meta: 10 h) + 0,3–0,6 h/mes | 2,5–3,5 h/mes `[?]` |
| **Costo humano** | USD 9–18/mes | USD 670–840 one-time en v1; USD 240–300 en v3 | USD 75–105/mes a USD 24–30/h blended `[?]` |
| **Margen bruto** | ~55–62% a 2.000 usuarios; **40–50% a 500**; negativo bajo 250 con mínimos firmados | Igual que (a) en recurrente; **~45% en el one-time a USD 1.500 en v1, ~80% en v3** | **60–77%**, según el costo horario real |
| **Capacidad por persona** | ~800–1.200 clientes por agente L1 | ~14–18 onboardings/mes por specialist | **30–40 clientes por operador** |
| **Cómo escala** | Casi lineal en revenue, sublineal en costo. El mejor multiplicador | No escala, pero **compra activación**: ataca el ~30% de anuales que cancela el primer mes | Lineal en headcount. Escala solo si la IA reduce horas/cliente año tras año |
| **Qué rompe primero** | **El churn** y los mínimos de agregación | La calidad del onboarding al pasar de 15 a 60/mes; y que el 40% del trabajo no depende de nosotros (bancos que no exponen tarjetas, Suiza sin PSD2, Argentina sin estándares) | **El reclutamiento y el compliance.** §5/§6 StBerG hace de la categorización con efecto fiscal una actividad reservada en Alemania. Y el seguro E&O no cubre errores de clasificación |
| **Clientes para USD 1M de ARR** | **~560** (a ACV 1.788) | ~470 + 340 onboardings/año | **~322** (ACV blended 3.108) |

### La afirmación que hay que tratar como hipótesis, no como hallazgo

Circula una conclusión tentadora: *"en este negocio el servicio humano tiene mejor margen que el software"* (77–83% en el add-on de USD 450/mes). **Eso descansa en dos parámetros libres que nadie verificó:** (a) un costo blended de **USD 24–30/hora** — que asume operadores offshore a USD 12–25/h, **no verificado**; y (b) **2,5–3,5 h/mes por hogar** — que contradice el propio benchmark, porque los Daily Money Managers facturan ~4 h/mes a clientes *más simples* y Plumb cobra USD 2.000–4.000/mes por un alcance comparable.

**A 6 h/mes y USD 45/h el margen cae a ~40% y el modelo (c) pierde su ventaja sobre (a).** Es el punto de mayor apalancamiento de todo el modelo y **hay que medirlo en el piloto, no asumirlo**.

### Economía unitaria (régimen, ~1.000 clientes)

| Componente | Archivo | Core | Complex |
|---|---|---|---|
| Agregación marginal | 0 | 12,00 (20 inst. × 0,60) | 36,00 (60 × 0,60) |
| Amortización de mínimos | 0 | 3,50 | 3,50 |
| Enriquecimiento `[?]` | 1,20 | 4,50 | 12,00 |
| LLM (asistente + categorización) | 2,00 | 6,00 | 14,00 |
| Infra (Postgres, storage, FX) | 1,00 | 2,00 | 3,50 |
| Soporte (0,2 / 0,4 / 1,0 h a USD 28) | 5,60 | 11,20 | 28,00 |
| **COGS total/mes** | **9,80** | **39,20** | **97,00** |
| **Precio/mes** | 49,00 | 149,00 | 349,00 |
| **Margen bruto** | **80%** | **74%** | **72%** |

*Bases: piso verificado de Teller USD 0,30/enrollment/mes, asumido USD 0,60 blended US+EU `[?]` — Plaid y Enable Banking no publican precio y podría ser 2–3×. Enriquecimiento a USD 0,003/txn `[?]`. FX = 0 (Frankfurter gratis).*

**Cliente Core + Cierre Mensual (el cliente objetivo):** ingreso USD 599/mes · COGS USD 39,20 + 90 = **USD 129** · **margen bruto 78%** · contribución USD 470/mes.

### CAC, payback y LTV

| Métrica | Archivo | Core | Core + Servicio | Complex |
|---|---|---|---|---|
| CAC estimado `[?]` | 150 | **800** | 900 | **3.000** |
| Contribución mensual | 39 | 110 | 470 | 252 |
| Onboarding cobrado (margen v1) | 0 | 660 | 660 | 1.660 |
| **Payback** | 3,8 meses | **1,3 meses** | **0,5 meses** | **5,3 meses** |
| Churn anual bruto asumido `[?]` | 45% | **30%** | 20% | 22% |
| **LTV (contribución + onboarding)** | 1.040 | **4.060** | **28.860** | 15.400 |
| **LTV/CAC** | 6,9 | **5,1** | **32** | **5,1** |

**El supuesto más cuestionable de esta tabla es el churn de 30% anual en Core.** La mediana verificada de RevenueCat para planes anuales es 44,1% de retención a 12 meses, o sea **56% de churn**. Se justifica el 30% con tres mecanismos concretos, no con optimismo: (i) el onboarding pago y hecho por el equipo elimina el "nunca terminé de configurarlo" que explica el ~30% de cancelaciones del primer mes; (ii) hay 3–8 personas con datos adentro, no una; (iii) el contador tiene acceso y el cierre mensual sale por ahí. **Si a los 12 meses el churn real supera 40%, el modelo de precio alto está muerto y hay que replegarse.**

### Modelo financiero a 24 meses (escenario recomendado, modelo c)

Mix de altas: 20% Archivo / 60% Core / 20% Complex; 25% de Core+Complex toma el add-on de servicio. **ARPU blended USD 259/mes; ACV USD 3.108.** Onboarding blended por alta: USD 1.400, con 85% de aceptación. Churn 30% anual (2,94% mensual) aplicado a la base. Sin mínimos de agregación hasta T5 (Teller + SimpleFIN + archivos); Plaid y Enable Banking entran en T5 (+USD 3.500/mes).

| Trim | Altas brutas | Bajas | Clientes fin | MRR fin | ARR fin | Onboarding cobrado (trim) |
|---|---|---|---|---|---|---|
| T1 | 8 | 0 | 8 | 2.072 | 24.864 | 9.520 |
| T2 | 15 | 1 | 22 | 5.698 | 68.376 | 17.850 |
| T3 | 25 | 3 | 44 | 11.396 | 136.752 | 29.750 |
| T4 | 38 | 5 | 77 | 19.943 | 239.316 | 45.220 |
| T5 | 52 | 9 | 120 | 31.080 | 372.960 | 61.880 |
| T6 | 68 | 13 | 175 | 45.325 | 543.900 | 80.920 |
| T7 | 85 | 19 | 241 | 62.419 | 749.028 | 101.150 |
| T8 | 100 | 25 | **316** | **81.844** | **982.128** | 119.000 |

**Totales a 24 meses:** 391 altas brutas, ~75 bajas, **316 clientes netos**, **~USD 982k de ARR de salida**.
Revenue devengado: **~USD 685k de suscripción + ~USD 465k de onboarding = ~USD 1,15M**.
COGS: ~USD 205k recurrente + ~USD 42k de mínimos + ~USD 183k de ejecución de onboardings = **~USD 430k** → **margen bruto acumulado ~63%**.
Gasto comercial: 391 altas × USD 800 de CAC = **~USD 313k** (no existe en un funnel de performance marketing; es tiempo de venta, comisiones de referido y contenido).
Equipo y estructura: ~6 FTE promedio + compliance (USD 70k) + herramientas y legal → **~USD 1,2M**.

**Necesidad de capital: USD 1,5–2,2M para llegar a ~USD 1M de ARR en 24 meses. Break-even operativo alrededor de USD 2,6–3M de ARR.**

*(Este modelo corrige el planteo inicial, que no aplicaba churn a la base, no tenía línea comercial y sumaba ARR de salida en lugar de facturación devengada, sobreestimando el revenue acumulado en ~2×.)*

---

## B10. Cuánto componente humano incorporar

**Recomendación: modelo (c) — software con servicio recurrente — con (b) como puerta de entrada obligatoria. Pero con el humano diseñado como algo que se retira, no como algo que se acumula.**

Cuatro razones:

1. **Cambia el denominador.** 322 clientes para USD 1M de ARR en vez de 560. En un segmento sin canal de performance marketing y con alcanzabilidad baja, reducir a la mitad los clientes necesarios es la única palanca que hace el negocio construible.
2. **Es lo que el segmento compra.** Todo el sector funciona así: Plumb son staff accountants sobre Sage Intacct; Eton se vende con managed services; Kubera empaqueta onboarding concierge en su tier de USD 2.500. **El software solo no se vende arriba de USD 300/año.**
3. **Sin el humano, el cliente nunca llega al valor.** El trabajo sucio —conectar 40 cuentas, categorizar 24 meses, mapear propiedades y entidades— es exactamente lo que el cliente compra para no hacer. Si el onboarding es autoservicio, este cliente no activa.
4. **La IA rinde más ahí que de cara al usuario.** El mejor caso de uso de la IA no es el chat: es multiplicar la productividad del operador (categorización con abstención, propuestas de reglas con diff e impacto, generación de dashboards desde el mapa de dimensiones).

**Las cuatro reglas que impiden que esto se convierta en una consultora:**

1. **El humano se cobra aparte y visible** (USD 450/mes), nunca empaquetado en el precio del software. Empaquetarlo destruye la comparación mental que interesa provocar ("USD 450/mes contra USD 2.000/mes de Plumb").
2. **Cada hora humana tiene que morir.** Todo trabajo que un operador haga dos veces se convierte en una tarea de producto con dueño. El objetivo declarado es 28 h → 10 h de onboarding y 3,5 h → 1,5 h de servicio mensual. **Si la curva no aparece en los primeros cinco clientes, no hay negocio escalable.**
3. **El servicio nunca escribe directo.** Propone; el titular aprueba. Eso lo mantiene fuera del terreno de la actividad reservada y deja la responsabilidad donde corresponde.
4. **La geografía del equipo se decide temprano y es cara de revertir.** Dónde vive físicamente determina transferencias internacionales de datos, background checks, licencias contables locales y seguro E&O. Y **no vender el módulo de cierre fiscal en Alemania** (ni en Francia o Italia hasta tener dictamen).

---

## B11. Diez perfiles a entrevistar y dónde encontrarlos

> **Nota expresa: no se nombra a ninguna persona real.** El brief pide no inventar personas, y targetear individuos identificados por sus reseñas o comentarios públicos es la versión operativa del mismo problema (además de chocar con los ToS de App Store y Reddit y, en la UE, con la base legal de marketing directo). **Las reseñas y los hilos se usan como fuente de insight — para leer, no para contactar.** Lo que sigue son perfiles y canales.
>
> **Verificación:** `[V]` = URL comprobada durante la investigación · `[NV]` = canal conocido pero **no comprobado**; hay que abrirlo con un navegador real antes de escribir el primer mensaje. Varios sitios devolvieron 403 al crawler (Reddit, Bogleheads, Trustpilot) — eso no significa que estén muertos, significa que no se pudieron verificar así.

| # | Perfil | Complejidad | Herramienta hoy | Por qué importa |
|---|---|---|---|---|
| **P1** | Dueño de PyME o estudio profesional con sociedad patrimonial, 2–3 propiedades, ES/US, USD 3–8M | Mezcla personal/profesional, 12–20 cuentas | Quicken Classic Business & Personal, o QuickBooks forzado a uso personal | Máxima WTP incremental verificada: Quicken cobra el doble por el tier B&P |
| **P2** | Ciudadano estadounidense residente en Europa, USD 2–5M | US+EU, FBAR/8938, 2–3 monedas | Dos apps separadas + Excel de consolidación | Monarch y Empower no funcionan fuera de EE.UU./Canadá. Dolor estructural sin solución |
| **P3** | Familia con 3+ propiedades y personal doméstico en 2 jurisdicciones, USD 10–50M | Payroll doméstico, proveedores, 25–40 cuentas | Firma de bill-pay a USD 2–4k/mes o un DMM | Es el cliente de Plumb. Compra resultados |
| **P4** | Socio de firma profesional (legal, PE, consultoría) con ingresos irregulares | Distribuciones, K-1s, reservas fiscales | Excel + contador trimestral | Ciclo obligatorio → frecuencia y retención |
| **P5** | Fundador post-exit sin family office, USD 3–30M, self-directed | Multi-cuenta, cripto, activos ilíquidos | Kubera + planilla aparte para gastos | Ya paga USD 250–2.500/año; el lado gastos está vacío |
| **P6** | Emigrado de LatAm (AR/MX) con patrimonio en US/ES | Bancos que solo dan PDF, multi-moneda extremo | PDFs + Excel | Nadie los sirve. La ruta manual/PDF es producto, no parche |
| **P7** | Usuario de Quicken / MS Money con 15–25 años de historia | Conectividad rota ahora mismo | Quicken Classic / Money Sunset | Evento forzado con fecha |
| **P8** | Contador, bookkeeper o Daily Money Manager con 5–20 clientes personales complejos | Opera QuickBooks o Excel por cliente | QuickBooks + Classes | **No es cliente: es canal.** Trae 5–20 hogares |
| **P9** | Family office de 1–2 personas, por debajo del piso de Asora | Multi-entidad, multi-generación | Excel + el Addepar del asesor | El 40% de los family offices opera con <USD 1M/año de costo |
| **P10** | Pareja con patrimonio compartido + asistente ejecutivo que opera | Separación personal/empresa, 3 usuarios | Monarch o nada | Multi-usuario = retención estructural |

### Canales por perfil

| Perfil | Canales concretos | Verif. |
|---|---|---|
| P1 | Colegios profesionales locales (abogados, médicos), cámaras de comercio sectoriales, grupos de LinkedIn de dueños de estudio | `[NV]` |
| P2 | American Citizens Abroad (americansabroad.org), AARO (aaro.org), InterNations, Expat.com, AngloInfo, r/ExpatFIRE, r/USExpatTaxes | `[NV]` — aaro.org y fvap.gov dieron error durante la investigación |
| P3 | **Directorio público de la AADMM** (secure.aadmm.com) · firmas de bill-pay como derivadores · agencias de household staffing | `[V]` AADMM |
| P4 | Grupos de alumni de escuelas de negocio, asociaciones de partners, r/fatFIRE, r/HENRYfinance | `[NV]` |
| P5 | Comunidad de Kubera · Hacker News (hay hilos históricos de dolor con Quicken) · Indie Hackers | `[V]` HN |
| P6 | TabNews y comunidades dev/finanzas de LatAm · grupos de argentinos y mexicanos en el exterior · contadores especializados en expatriación | `[V]` TabNews |
| P7 | **community.quicken.com** (hilos de discontinuación de BofA, Schwab y PNC) · **microsoftmoneyoffline.wordpress.com** (activo en 2026, 234 suscriptores) · grupo de Google `microsoft-money` · foros de Bogleheads | `[V]` los tres primeros |
| P8 | **AADMM** · AICPA PFP Section · NAPFA · colegios de contadores locales · comunidad de Tiller (proxy de contadores que ya trabajan con planillas compartidas) | `[V]` AADMM; resto `[NV]` |
| P9 | **Simple (andsimple.co)**, reportes y comunidad de family offices · el roundup de software de family office de Forbes como mapa de proveedores y eventos · Family Office Exchange, Campden Wealth | `[V]` Simple y Forbes; resto `[NV]` |
| P10 | r/MonarchMoney · Discord de Lunch Money · comunidades de parejas que administran juntas | `[NV]` |

### Mensajes de contacto en frío

Objetivo: una conversación de 40 minutos, no una venta. Sin pitch de producto.

- **P1 · ES:** "Vi que manejás la operación de tu estudio y tu patrimonio personal en el mismo lugar. Estoy entrevistando a 20 personas con esa mezcla para entender cómo cierran el mes de verdad. 40 minutos, sin venderte nada, te paso el resumen de los 20." · **EN:** "You run both a practice and personal holdings. I'm interviewing 20 people who live with that mix to learn how they actually close a month. 40 minutes, nothing to sell, I'll share what the other 19 said."
- **P2 · ES:** "Tenés cuentas en Estados Unidos y en Europa a la vez. Estoy documentando cómo consolida la gente esa foto hoy — spoiler: casi todos con un Excel a mano. ¿Me regalás 40 minutos?" · **EN:** "You hold accounts in both the US and Europe. I'm documenting how people actually consolidate that today — most answers so far are 'a spreadsheet I update by hand'. 40 minutes?"
- **P3 · ES:** "Trabajo en cómo las familias con varias propiedades y personal doméstico entienden lo que gastan cada mes. No vendo un servicio de bill pay. Busco 40 minutos para entender cómo funciona hoy en tu caso." · **EN:** "I study how families with multiple properties and household staff understand their monthly spend. Not selling bill-pay. Looking for 40 minutes to hear how it works for you today."
- **P4 · ES:** "Ingresos irregulares por distribuciones más reservas fiscales: estoy entrevistando a socios de firmas sobre cómo administran ese calendario. 40 minutos, sin pitch." · **EN:** "Lumpy distribution income plus tax reserves — I'm interviewing firm partners about how they manage that calendar. 40 minutes, no pitch."
- **P5 · ES:** "Estoy investigando qué usa la gente que ya trackea su patrimonio pero no encuentra nada decente para el lado de los gastos. ¿Tenés 40 minutos?" · **EN:** "I'm researching what people who already track net worth use for the *spending* side, where tooling seems to end. 40 minutes?"
- **P6 · ES:** "Si tu banco solo te da PDF y tu plata está en tres países, me interesa mucho tu caso. Estoy entrevistando a 20 personas en esa situación. 40 minutos." · **EN:** "If your bank only gives you PDFs and your money sits in three countries, I want to hear it. Interviewing 20 people in that situation. 40 minutes."
- **P7 · ES:** "Estoy hablando con gente que tiene 15 años o más de historia financiera adentro de Quicken o Money y no quiere perderla ahora que se están cayendo las conexiones. ¿Charlamos 40 minutos?" · **EN:** "I'm talking to people with 15+ years of history inside Quicken or Money who don't want to lose it now that the bank connections are dying. 40 minutes?"
- **P8 · ES:** "Trabajás con clientes personales complejos. Quiero entender qué parte de tu mes se te va en *armar* el reporte en lugar de pensarlo. 40 minutos, y te comparto lo que aprendí de los demás." · **EN:** "You work with complex personal clients. I want to understand how much of your month goes into *assembling* the report vs. thinking about it. 40 minutes, and I'll share what others told me."
- **P9 · ES:** "Los family offices de una o dos personas quedan afuera del software del sector: empieza en USD 15.000 al año. Estoy entrevistando a quienes quedan en ese hueco. 40 minutos." · **EN:** "One- and two-person family offices fall below the software floor — it starts around USD 15k/year. I'm interviewing people stuck in that gap. 40 minutes."
- **P10 · ES:** "Estoy investigando qué pasa cuando una pareja administra el patrimonio junta y además hay un asistente o un contador mirando. 40 minutos." · **EN:** "I'm researching what happens when a couple manages money together and an assistant or accountant is also in the picture. 40 minutes."

---

## B12. Guion de entrevista para personas de patrimonio alto

**Duración: 40–50 minutos. Estilo *The Mom Test*. Regla madre: nunca preguntar si usaría el producto. Preguntar qué hizo el mes pasado y cuánto le costó.**

**Bloque 0 — Apertura (0:00–3:00).**
Literal: *"Gracias. Te aclaro tres cosas: no te voy a vender nada hoy, no tengo producto para mostrarte, y si en algún momento te aburre lo cortamos. Lo que necesito es entender cómo hacés algo que ya hacés. ¿Te grabo, solo para no tomar notas?"*

**Bloque 1 — Mapa (3:00–8:00).**
*"Sin números: contame cuántos bancos, tarjetas, países y monedas hay en tu vida."* → *"¿Hay sociedades? ¿Propiedades? ¿Alguien en nómina personal?"* → *"¿Quién más, además de vos, ve esta información?"* → *"¿Cómo se la mandás hoy?"*
**La respuesta "por mail les paso los extractos" es oro.**

**Bloque 2 — Reconstrucción del último mes real (8:00–18:00). El bloque más importante.**
*"Vamos a julio concretamente. ¿En algún momento del mes te sentaste a mirar tus números? Contame ese momento: qué día, dónde estabas, qué abriste primero."* → *"¿Cuánto tardaste?"* → *"¿Qué archivo abriste?"* → **"¿Me lo podés compartir en pantalla?"** (pedirlo; si accede, el dolor es real) → *"¿Qué pregunta querías responder?"* → *"¿La respondiste?"* → *"¿Qué hiciste con la respuesta?"*

**Bloque 3 — Momento de mayor dolor (18:00–25:00).**
*"¿Cuándo fue la última vez que un número financiero te sorprendió mal?"* → *"¿Cuánto tardaste en darte cuenta?"* → *"¿Qué hiciste después?"* → *"¿Cambiaste algo para que no vuelva a pasar?"*
**Si no cambió nada, el dolor no es suficiente.**

**Bloque 4 — El contador y el asistente (25:00–32:00).**
*"¿Qué le pediste por última vez a tu contador que no fuera impuestos?"* → *"¿Cuánto tardó?"* → *"¿En qué formato te lo mandó?"* → *"¿Le pudiste repreguntar sobre eso?"* → *"¿Cuánto le pagás y cómo está calculado?"* → *"Si mañana desapareciera, ¿qué es lo primero que se rompe?"*

**Bloque 5 — El Excel (32:00–38:00).**
*"¿Tenés una planilla? ¿Me la mostrás?"* → *"¿Quién la mantiene?"* → *"¿Cuándo fue la última vez que la actualizaste?"* → **"¿Qué columna agregaste vos que no venía de ningún lado?"** (esa columna es una dimensión que el modelo de datos tiene que soportar) → *"¿Qué pasa si te vas dos meses de viaje?"*

**Bloque 6 — Prueba de compartir acceso (38:00–43:00).**
*"Si existiera un lugar donde tu contador ve solo la sociedad y tu pareja ve solo lo familiar, ¿a quién invitarías primero?"* → *"¿Qué NO querrías que vea esa persona?"* → *"¿Te importaría que quedara registrado quién miró qué?"* → **la pregunta dura:** *"¿Conectarías las cuentas de tu banco privado a un software de una empresa de cinco personas? Si no, ¿qué haría falta?"*
**Esperar un "no" mayoritario. Ese "no" es lo que valida el modo de importación manual como feature de venta y no como degradación.**

**Bloque 7 — Precio (43:00–50:00). Nunca preguntar cuánto pagaría.**
- *"Sumá todo lo que hoy le pagás a alguien por entender tus finanzas: contador, gestoría, asistente, apps. ¿Cuánto da al año?"*
- *"De eso, ¿qué parte te parece que estás pagando de más?"*
- *"¿Cuándo fue la última vez que aumentaste ese gasto y por qué lo aprobaste?"* → da el disparador de compra real.
- *"Si te ofrecieran hacer el setup completo por USD 1.500 pagados hoy, ¿cuál sería tu primera objeción?"* → **la objeción es información; el "sí" es cortesía.**
- Cierre duro: *"¿Te puedo llamar cuando tenga los primeros tres clientes trabajando, para que lo veas?"* → si pide que le mandes un mail, no hay interés.

**Preguntas trampa a evitar:** "¿usarías algo así?", "¿cuánto pagarías?", "¿te parece útil un reporte por propiedad?", "¿te gustaría que tuviera IA?", y cualquier pregunta que empiece con "si existiera". **No describir el producto antes del minuto 43.**

**Señales de compra reales:** (1) comparte la pantalla con su Excel sin que se lo insistan; (2) nombra una cifra concreta de lo que paga hoy, sin dudar; (3) pregunta *"¿y esto cuándo está?"*; (4) menciona espontáneamente a alguien —su contador, su asistente— como persona a involucrar; (5) ofrece presentar a otra persona.
**Señales falsas:** "está buenísimo", "avisame cuando lo tengas", "yo lo probaría".

---

## B13. El experimento: cinco clientes que paguen antes de construir las integraciones

**Oferta única, sin tiers: "Cierre financiero personal — 3 meses".**
**USD 1.500 de setup + USD 500/mes**, o **USD 2.800 pagados por adelantado por el trimestre completo** (7% de descuento; el prepago es lo que sostiene la retención).
5 clientes = **USD 14.000–15.000 de caja en 8 semanas.**

**Qué se entrega, todo manual:** los pasos 1 a 7 de B7, más un canal de WhatsApp o email con **SLA de 24 h para preguntas ad-hoc** ("compará las tres propiedades trimestre contra trimestre"). **Ese SLA es el experimento central:** mide si la latencia es realmente el diferencial frente al humano.

**Stack detrás (costo de datos ≈ USD 0):**

| Función | Herramienta | Costo |
|---|---|---|
| Ingesta | Parsers propios OFX/QFX/CSV/Norma 43/camt.053 + parsing de PDF | Tiempo |
| Almacenamiento y consulta | Postgres con grano = posting (partida doble), RLS por tenant | ~USD 50/mes |
| Reportes | Compilador IR→SQL propio, mínimo viable | 0 |
| FX | Frankfurter | 0 |
| PDF / Excel | Typst + ExcelJS | 0 |
| Cobro | Stripe, con cancelación en un click y política de reembolso explícita | 2,9% |
| **Agregación bancaria** | **Ninguna.** Si alguien insiste: SimpleFIN (USD 15/año que paga la persona) o Teller (USD 0,30/enrollment/mes) | ~0 |

**No integrar Plaid en el MVP.** Los mínimos reportados son USD 1.000–3.000/mes antes del primer usuario. Con importación de archivos y PDF el costo de datos es ~USD 0 y se puede cobrar igual.

**Costo de trabajo:** mes 1 ≈ 28 h/cliente; meses 2 y 3 ≈ 6 h cada uno → **40 h por cliente por trimestre**. 5 clientes = 200 h de entrega + ~60 h de venta (35 conversaciones más preparación) = **~260 h en 8 semanas ≈ 0,8 FTE promedio**, con un pico de ~1,2 FTE en las semanas 4–6. Es caro a propósito: el objetivo es aprender qué automatizar, no el margen.

**Guion de venta (llamada de 20 minutos, después de la entrevista):**
*"Basado en lo que me contaste, esto es lo que haría: cargo tus últimos 24 meses de las 18 cuentas, te armo el mapa por propiedad y por sociedad, y en tres semanas tenés un cierre mensual que tu contador acepta sin retrabajo, más la posibilidad de preguntarme cualquier cosa y tenerla en 24 horas. Son USD 1.500 de arranque y USD 500 por mes durante tres meses. Si al final del primer mes el informe de reconciliación no cuadra, te devuelvo todo. ¿Arrancamos el lunes?"*

**Cronograma:**

| Semana | Qué se hace | Qué se aprende |
|---|---|---|
| 1 | 15 entrevistas (guion B12). Cero desarrollo | Cuáles de los 10 perfiles responden y cuáles ignoran |
| 2 | 15 entrevistas más + primeras 6 ofertas | Primera lectura de la tasa oferta→cierre |
| 3 | 8–12 ofertas más; cierre de las primeras ventas y cobro. Onboarding del cliente 1 (pasos 1–3) | Si la gente paga antes de ver producto. Cuántas instituciones tienen ruta de datos viable |
| 4 | Clientes 1–2 completos (pasos 4–7). Parsers para sus bancos | **Horas reales de ingesta.** Si el delta de reconciliación cierra |
| 5 | Clientes 3–5. Primer cierre mensual del cliente 1 | Qué preguntan cuando ya tienen los datos. **Se registra literalmente cada pregunta ad-hoc** |
| 6 | Todos con dashboards y accesos delegados | **¿Invitan al contador o a la pareja?** Si nadie invita a nadie, el pilar de retención es falso |
| 7 | Segundo ciclo de cierre. Se automatiza lo más repetido de las semanas 4–6 | Curva de horas: el cliente 5 debería costar 25–40% menos que el cliente 1 |
| 8 | Conversación de renovación con los 5 + retrospectiva | Cuántos renuevan y a qué precio. Cuántas preguntas ad-hoc son expresables como IR |

*Nota sobre el embudo: para cerrar 5 ventas hacen falta del orden de 20–30 ofertas formales sobre 30–35 conversaciones calificadas. Un cronograma que asuma 5 cierres sobre 8 ofertas implica un 62% de conversión, que no es creíble.*

**Criterios de éxito — los cinco, no cuatro de cinco:**
- ≥5 cobros efectivos sobre ≤35 conversaciones calificadas (tasa de cierre ≥14%).
- ≥3 de 5 renuevan al mes 4 **sin renegociar el precio a la baja**.
- ≥3 de 5 hacen ≥1 pregunta ad-hoc por semana en las semanas 5–8.
- ≥2 de 5 invitan **y activan** a un tercero.
- Delta de reconciliación = 0 en ≥90% de las cuentas cargadas.

**Zona intermedia (2–4 cobros): continuar 4 semanas más con una sola variable cambiada.** Si el bloqueo fue el precio, se prueba USD 1.000 + USD 500/mes con los mismos entregables. Si fue la confianza, se prueba con derivación de un contador (canal P8). Si fue el alcance, se recorta a un solo reporte (el cierre mensual). **Una variable por vez, y una sola prórroga.**

**Criterios de aborto — cualquiera basta:**
- **<2 cobros después de 40 conversaciones calificadas** → el dolor no se paga.
- **Horas/cliente >45 en el mes 1 sin que el cliente 5 baje al menos 25% respecto del cliente 1** → no hay curva de aprendizaje, no hay negocio escalable.
- **>30% de las instituciones de los clientes sin ninguna ruta de datos viable** (ni archivo ni PDF parseable) → el problema es de infraestructura y hay que resolverlo antes que el GTM.
- **Cero preguntas ad-hoc espontáneas en las semanas 6–8** → la latencia no era el diferencial y la tesis central se cae.

**Presupuesto de adquisición: USD 0–1.500.** Todo es tiempo. Si hace falta gastar dinero para conseguir los primeros cinco clientes, el problema no es el canal.

**Excluir Alemania del piloto** (§5 y §6 Nr. 3 StBerG), y Francia e Italia hasta tener dictamen local.

---

## B14. Métricas para validar uso real de los reportes

**El momento de activación:** *en ≤14 días desde el kickoff, **el cliente** (no el equipo) ejecuta ≥3 reportes distintos, hace ≥1 drill-down hasta la transacción y guarda ≥1 vista.* Los tres eventos, del mismo usuario, en la misma ventana. Cualquier definición más blanda mide onboarding del equipo, no adopción.

**La señal de retención de la semana 6:** *≥1 vista guardada **reutilizada** (cargada en dos semanas calendario distintas) + ≥2 sesiones con reporte ejecutado por el propio cliente durante la semana 6.* **La creación es entusiasmo; la reutilización es hábito.**

| Familia | Métrica | Definición exacta | Umbral de valor real | Se contrasta con (vanidad) |
|---|---|---|---|---|
| Activación | Reportes ejecutados por el cliente | Ejecuciones de IR iniciadas por un usuario con rol titular/miembro, excluyendo las del equipo y las cargas automáticas de dashboard | ≥3 distintos en 14 días | Ejecuciones totales |
| Activación | Time-to-first-drilldown | Minutos desde el primer login hasta el primer click que abre la lista de transacciones detrás de un número | <10 min en la primera sesión | "Vio el dashboard" |
| Hábito | Reportes por usuario y semana | Ejecuciones distintas por semana, deduplicadas por hash del IR | ≥4 en semanas 3–8 | Sesiones o DAU |
| Hábito | Drill-downs por sesión | Drill-downs ÷ sesiones con ≥1 reporte | ≥1,5 | Tiempo en pantalla (puede ser confusión) |
| Hábito | Vistas guardadas reutilizadas | Vistas cargadas en ≥2 semanas distintas ÷ vistas creadas | ≥40% | Vistas creadas |
| Valor | Reportes programados abiertos | Aperturas del PDF o enlace ÷ envíos, ventana de 7 días | ≥60% a las 4 semanas | Tasa de apertura del email |
| Valor | **Exportaciones compartidas con terceros** | Exports o enlaces cuyo destinatario es un email distinto al del titular | ≥1/mes por cliente | Exports totales |
| Valor | Colaboradores activos | Invitados que ejecutan ≥1 reporte en la semana ÷ invitados | ≥50%, y ≥1 colaborador activo por hogar | **Invitaciones enviadas** (vanidad grave) |
| Valor | Transacciones revisadas | Transacciones cuya categoría o dimensión fue confirmada o cambiada por un humano | Cae de >20% del volumen el mes 1 a <8% el mes 3 | Transacciones categorizadas automáticamente |
| Valor | Reglas vivas | Reglas aceptadas que siguen aplicando a ≥5 transacciones/mes a los 60 días | ≥5 por cliente | Reglas creadas |
| Valor | **Preguntas al asistente que terminan en acción** | Conversaciones seguidas, en ≤10 min, de: guardar vista, crear regla, recategorizar en lote, programar envío o exportar | ≥25% de las conversaciones | **Nº de mensajes al asistente** (la vanidad más peligrosa del producto) |
| Confianza | **Error silencioso** | Respuestas numéricas sin `query_id` referenciable, o numéricamente incorrectas, medidas sobre un eval dorado de 200–300 preguntas | **<2% para lanzar** | Tasa de acierto agregada |
| Confianza | Delta de reconciliación | % de cuentas con delta ≠ 0 tras la importación | <10%, y cada una con motivo explicado | "Importación completada" |
| Negocio | Renovación a 90 días | Clientes que pagan el 4.º mes al mismo precio | ≥60% en el piloto | NPS (declarativo) |

**Vanidad vs. verdad, en una línea: cualquier métrica que un operador propio pueda mover trabajando más es vanidad. Solo cuentan los eventos originados por el cliente o por un tercero que el cliente invitó.**

*Todos los umbrales de esta tabla son elegidos, no derivados de benchmarks: **no existe telemetría pública de ninguna herramienta de finanzas personales sobre uso de reportes**. Su valor hoy es forzar la instrumentación desde el día 1; hay que recalibrarlos con los datos de los primeros cinco clientes.*

---

# PARTE C — MVP, riesgos y conclusión

## C1. Crítica del MVP propuesto

| # | Elemento del MVP planteado | Veredicto |
|---|---|---|
| 1 | Importación de CSV, OFX, QFX y QIF | **Núcleo.** Y hay que sumar camt.053 y Norma 43: sin ellos no hay Europa |
| 2 | Modelo normalizado de transacciones | **Núcleo, pero mal formulado.** El grano correcto es el *posting* con partida doble, no la transacción. Es la decisión irreversible del día 1 |
| 3 | Categorías, subcategorías y tags ilimitados | **Núcleo, pero insuficiente.** Lo que falta es el **registro de dimensiones definidas por el usuario con pesos** (propiedad, persona, entidad, viaje, proyecto). Sin eso el cohorte Excel no migra: la única razón por la que no sueltan la planilla es que pueden inventar una dimensión sin pedir permiso |
| 4 | Reglas avanzadas | **Núcleo — y visibles y editables desde la UI.** La queja más repetida contra Copilot es exactamente que no lo son |
| 5 | Splits | **Núcleo día 1.** Es el mecanismo, no una feature |
| 6 | Reconciliación | **Núcleo, y es el producto de confianza.** Con informe de importación y **undo de lote completo** |
| 7 | Búsqueda y filtros combinables | **Núcleo. Es el producto** |
| 8 | Vistas guardadas | **Núcleo.** Son el mismo objeto IR |
| 9 | Cinco o seis gráficos realmente buenos | **Núcleo**, con la lista de B4 (siete, y el Sankey aparte como pieza de marketing) |
| 10 | Dashboards configurables | **Núcleo en versión limitada:** cuatro de fábrica, reordenables, con 3 slots libres. **Nada de canvas libre** |
| 11 | Comparación entre períodos | **Núcleo.** Es un campo del IR |
| 12 | Exportación profesional a PDF y Excel | **Núcleo.** Con XLSX de fórmulas y tablas reales, no un volcado |
| 13 | Asistente para consultar datos y crear reportes | **Diferir a la tercera ola**, y solo en modo lectura con citas obligatorias. Es lo que más riesgo de credibilidad aporta y lo que menos vende en la demo |
| 14 | Revisión humana de clasificaciones dudosas | **Núcleo — y es el producto**, no una muleta. Es el add-on de servicio |
| 15 | Una integración bancaria para validar sincronización | **Sí, pero la más barata y sin mínimos: Teller (USD 0,30/enrollment/mes) o SimpleFIN (USD 15/año pagado por el usuario). Nunca Plaid en el MVP** |

**Lo que falta y no está en la lista:**
- **Informe de reconciliación de importación** con undo de lote. Es el producto de confianza y la primera demo del motor.
- **El "cierre mensual" como objeto versionado**, no como export: con estado, aprobación y diff contra el cierre anterior.
- **Parser de PDF de extractos.** Sin esto no hay historia de más de 24 meses, ni Argentina, ni banca privada.
- **Log de accesos visible para el cliente.**
- **Modo "sin conectar bancos" como configuración de primera clase**, no como degradación.

### Tres olas

**Ola 1 — El motor (0–4 meses). Sin agregación bancaria.**
Modelo de datos (posting, partida doble, append-only, multi-moneda) · importación de archivos + PDF + manual · reconciliación con informe y undo · dimensiones con pesos · IR + compilador · builder niveles 1 y 2 · reportes R1, R2 y R4 simple · dashboards "Este Mes" y "Cierre" · usuario único.
**Criterio de salida:** 20 hogares pagos; 15 cierres mensuales aceptados por un contador real sin retrabajo; p95 de consulta <300 ms con 500k postings; test de reconciliación en verde.
*Si el producto no se vende sin feeds, tampoco se va a vender con ellos — solo va a quemar los mínimos de agregación antes de tener con quién amortizarlos.*

**Ola 2 — La conexión y la delegación (4–9 meses).**
Agregación en EE.UU. con proveedor de precio público y sin mínimo · Europa como agente de un AISP · roles y permisos completos · motor de recurrentes · reportes R3 y R5 · builder nivel 3 · reportes programados y enlaces firmados · onboarding pago operado.
**Criterio de salida:** 100 hogares pagos con ACV ≥USD 1.500; ≥60% con al menos un tercero activo; churn mensual <2%; ≤1,5 tickets de reconexión por usuario y mes.

**Ola 3 — El asistente y la escala (9–15 meses).**
Asistente sobre el IR, solo lectura, con citas obligatorias enforced por el renderer · harness de eval con 200–300 preguntas doradas midiendo *acierto* y *error silencioso* por separado · acciones con propuesta y diff · alertas calibradas a precisión >90% · segundo agregador con ruteo por institución · dashboards personalizables.
**Criterio de salida:** error silencioso <2% en el eval; 40% de usuarios activos mensuales usan el asistente; 300 hogares pagos.

---

## C2. La tesis bajista: por qué esto fracasa

Escrita como la escribiría un inversor escéptico. Cada punto incluye **qué tendría que ser verdad** para que no ocurra.

| # | Tesis | Evidencia más dura | Severidad |
|---|---|---|---|
| 1 | El rico delega; no quiere una herramienta | Plumb USD 12.000–48.000/año para patrimonios de USD 10–150M. El segmento "patrimonio alto sin family office" rankea **último** | Fatal |
| 2 | Dolor real pero infrecuente → no sostiene suscripción | Mensual de precio alto retiene 12,2% a 12 meses; 30% de los anuales cancela el primer mes | Fatal |
| 3 | Mercado chico y sin canal | SOM 5.000–20.000 hogares = USD 4,5–18M de ARR a 5 años | Alta |
| 4 | Las conexiones rotas se comen confianza y margen | Piso de USD 2.500–6.000/mes; ~60 reconexiones/año por usuario; Monarch publica un dashboard de estado como confesión | Fatal |
| 5 | Barrera de confianza para un desconocido | Plaid pagó USD 58M por una UI que imitaba el login del banco; Evolve arrastró a ocho fintechs en una brecha ajena | Alta |
| 6 | La categorización valiosa solo la puede hacer el usuario | GPT-4o zero-shot 60,4%; 10–25% de revisión humana el primer mes | Alta |
| 7 | El humano no escala: esto es una consultora | Plumb = staff accountants sobre Sage Intacct; onboarding real de 28 h/hogar | Alta |
| 8 | Los incumbentes cierran el hueco primero | Monarch Plus a USD 299/año, USD 75M de Serie B, 217 empleados, ya con rol Professional | Alta |
| 9 | La IA se equivoca y quema la credibilidad de golpe | Cube: 67,7–68,7% con capa semántica sobre 100 preguntas. Un tercio falla | Media-alta |
| 10 | "Multi-país" son N productos distintos | Argentina solo PDF; Suiza sin PSD2; Alemania con StBerG; México 8 años sin reglas; bancos UE que no exponen tarjetas | Alta |

**Desarrollo de las tres más peligrosas:**

**#1 — El rico delega.** Cuando se le muestra una app, la respuesta no es "qué bueno", es "eso lo hace mi contador". El producto le devuelve una tarea que ya había externalizado. Capgemini: 88% de los HNWI trabajan con múltiples firmas — la fragmentación existe, pero **lo que compran es más firmas, no más software**.
*Qué tendría que ser verdad:* que exista un sub-segmento con complejidad de UHNW y presupuesto de HNW — quien *quiere* delegar pero no puede pagar USD 12.000/año. Es real, pero es un segmento **definido por no poder pagar**, lo cual es un mal punto de partida.

**#2 — El dolor es intenso pero infrecuente.** "¿Cuánto me costó la casa de Madrid?" se pregunta en marzo (impuestos) y en diciembre (revisión anual). Una suscripción se cancela cuando la frecuencia de uso cae por debajo del umbral de culpa.
*Qué tendría que ser verdad:* que la frecuencia la aporte otra persona — un operador que entra semanalmente, o una obligación de ciclo (payroll doméstico, cierre mensual). **Es decir: la única cura para el churn está en el segmento sin canal de venta.**

**#4 — Las conexiones rotas destruyen el producto por los dos lados.** El churn técnico y el costo de soporte crecen juntos. Y el costo del dato en EE.UU. no lo controlamos.
*Qué tendría que ser verdad:* que el producto sea excelente **sin** agregación y que el usuario acepte eso a precio premium. Es posible —y es la mejor idea de toda la investigación— pero **contradice frontalmente el pitch de "conectá todo"**.

### El cementerio

| Caso | Desenlace | Lectura |
|---|---|---|
| **Money Dashboard (UK)** | Cerró Neon y Classic el 31-10-2023; adquirida por ClearScore en 2022; declaró no haber encontrado modelo sostenible | El agregador multi-banco de consumo mejor posicionado de UK no encontró cómo cobrar |
| **Mint** | Cierre; su base migró y multiplicó ×20 la de Monarch | El evento de distribución más grande de la década **ya ocurrió** |
| **Empower Personal Dashboard** | Gratis, estancado, empuja a agendar con un asesor | El destino natural del PFM premium: lead-gen de gestión patrimonial |
| **Fintonic (ES)** | Gratis, sin tier de pago, monetiza originación de préstamos y seguros | En Europa el PFM no se paga; se monetiza vendiendo productos financieros |
| **Linxo (FR) / Snoop (UK)** | Absorbidas por Crédit Agricole y Vanquis | Salida por adquisición estratégica, no por unit economics |
| **PocketSmith** | El incumbente global multi-moneda: app iOS 3,10/5 con **52 reseñas** frente a las 104.146 de Monarch | Servir bien al multi-país correlaciona con ser irrelevantemente pequeño |
| **Lunch Money** | Indie, pay-what-you-want, subió el mínimo de USD 50 a 60 en mar-2026 | El público multi-moneda existe y paga USD 60/año, no USD 1.800 |
| **Quicken** | Intuit → H.I.G. → Aquiline; de USD 51,99 a 101,88 en 4 años según testimonio de foro | El motor de reportes que se quiere construir ya existe, y su dueño lo ordeña en vez de modernizarlo |

*Contraejemplos honestos: **Monarch** (USD 850M de valuación) ganó con precio bajo y un evento de migración masiva; **Kubera Black** cobra USD 2.500/año pero **no hay ninguna cifra pública de cuántos clientes tiene ese tier**. Ese dato es el más valioso que falta en toda la investigación.*

### Contradicciones internas del planteo original

1. **Reportes profundos configurables vs. simplicidad premium.** Quien quiere grupos AND/OR anidados es el refugiado de Quicken, cuyo techo de WTP es USD 100–250/año. Quien paga USD 1.800/año no quiere un query builder: quiere que el número aparezca. **Se está construyendo la feature del segmento pobre para vendérsela al rico.** *(Resolución adoptada: los tres niveles de B4, con el 70% del uso en plantillas.)*
2. **Servicio white-glove vs. márgenes de software vs. precio de USD 30–100.** No se pueden tener las tres cosas. *(Resolución: el precio sube a USD 149–349 y el servicio se cobra aparte.)*
3. **Privacidad extrema vs. asistente de IA en la nube.** El modo "sin conectar bancos" —correctamente identificado como el destrabador— **desactiva el asistente proactivo y degrada el reporting**, porque los datos llegan tarde e incompletos. *(Resolución: minimización arquitectónica — el LLM ve esquema, ontología y agregados, nunca filas crudas — y camino a región UE.)*
4. **"No damos asesoramiento" vs. un LLM con herramientas reales.** *(Resolución: clasificador de output, no system prompt.)*
5. **MVP amplio vs. plazo corto.** Solo el importador tiene 14 problemas obligatorios: eso ya es un trimestre. *(Resolución: las tres olas de C1, y un piloto concierge que vende antes de construir.)*
6. **Onboarding pago como filtro de leads vs. como cobertura de costo.** A 28 h no puede ser ambas cosas por USD 250–1.000. *(Resolución: USD 1.500–2.500.)*
7. **Multi-usuario como retención vs. privacidad como pitch.** Cada asiento extra multiplica soporte y superficie de brecha sin ingreso incremental si se regala. *(Resolución: se regala igual — el contador es canal, no cliente — y se cobra por entidades.)*

### Criterios de muerte a 90 días

Si se cumple cualquiera de los tres primeros, **se abandona o se pivota**.

| # | Test | Métrica | Umbral de muerte |
|---|---|---|---|
| **1** | Fake door con tarjeta real: USD 149/mes anual + onboarding USD 1.500 | Conversión de visita calificada a intento de pago | **<4%** |
| **2** | 20 hogares pagos onboardeados | Activos a día 60 (login ≥1/semana de algún miembro) | **<70%** (menos de 14) |
| **3** | Test de conectividad sobre las ~300 instituciones de los primeros 20 hogares | % con alguna ruta de datos viable (API, archivo o PDF parseable) | **<70%**, o **>30%** de hogares con una cuenta crítica inalcanzable |
| 4 | 30 entrevistas al ICP | Nº que dice que **operaría la herramienta en persona** (no su contador) | **<8 de 30** → el comprador no es el usuario |
| 5 | 10 onboardings cronometrados | Horas medias por hogar | **>20 h** en el cliente 10, o sin bajada de 25% respecto del cliente 1 |
| 6 | Eval de 200 preguntas doradas | Tasa de error silencioso | **>2%** |
| 7 | Bandeja de categorización tras 4 semanas | % de transacciones que requieren criterio **y** % que el usuario deja sin tocar 2 semanas | **>8%** pendientes **y** **>50%** ignoradas |
| 8 | Sensibilidad al precio | De quienes aceptan USD 149, % que acepta USD 349 | **<40%** → no hay tier que pague el servicio humano |
| 9 | CAC de los primeros 20 pagos | Costo total ÷ clientes | **>USD 2.000** |
| 10 | Rol del contador | Entrevistas donde el contador aparece como bloqueador | **≥10 de 30** → invertir el GTM |

*Los umbrales 1, 8 y 9 son juicio calibrado contra el ACV, no benchmarks. Los umbrales 2 y 6 se derivan de la evidencia (retención de RevenueCat, modo de fallo de text-to-SQL).*

### La versión mínima defendible, y el pivote

**Si solo se pudiera construir una cosa: el cierre mensual por dimensiones, entregado — no construido.**

Un servicio que produce cada mes un paquete conciliado con costo total por propiedad, por entidad legal, por persona y por proyecto; comparación contra el mes y el año anterior; el detalle transaccional que lo sustenta; el delta de saldo por cuenta; y el archivo que el contador acepta sin retrabajo. PDF + XLSX con fórmulas reales. **Seis reportes fijos. Cero query builder. Cero chat. Cero multi-país.** Precio: **USD 350–500/mes**.

Por qué esto y no el producto grande: es literalmente el entregable por el que hoy se pagan USD 12.000–48.000/año; funciona **sin agregación**, lo que elimina el piso de mínimos, la licencia AISP, las 60 reconexiones anuales y la objeción de privacidad; la dimensión "propiedad / persona / viaje / empleado doméstico" no existe en Addepar, Masttro, Landytech ni Asora; y convierte al contador de bloqueador en beneficiario.

Lo que **no** se difiere en ninguna versión: el grano de posting con partida doble, los tres números de FX por transacción, el registro de dimensiones con pesos, el informe de reconciliación de importación y el `SUM(detalle) == agregado` en CI.

**El pivote más probable si la tesis principal no se sostiene: vender al operador, no al principal.** Herramienta para bookkeepers, daily money managers, contadores y family offices chicos que ya atienden 20–80 hogares complejos. Precio por hogar atendido: **USD 30–60/mes facturado a la firma**. El principal recibe un portal de solo lectura con permisos por dimensión.

Esto arregla siete de las diez tesis bajistas de un golpe: **frecuencia** (el operador entra a diario, es su trabajo), **categorización** (es su oficio y ya cobra por hacerla), **CAC** (una firma equivale a 30–80 hogares, y hay listas y asociaciones), **confianza** (la marca la pone la firma), **servicio humano** (es de la firma; el margen vuelve a ser de software), **regulación** (en Alemania, Francia y España el profesional autorizado firma el trabajo y nosotros somos la herramienta mecánica) y **competencia** (Monarch, Copilot y Kubera son productos de consumo y no van a entrar ahí).

El precedente está a la vista: Plumb corre sobre Sage Intacct, un ERP de mediana empresa forzado a un caso de uso personal. **Nadie construyó el sistema nativo de gastos personales multi-dimensionales para el profesional que hace este trabajo.**

*Salvedad honesta sobre este pivote: es un mercado de ciclo largo, con precio por asiento comprimido y clientes que ya invirtieron en QuickBooks o Sage. No está validado; es una hipótesis, no un plan de reserva garantizado.*

---

## C3. Conclusión: qué estamos construyendo

El brief plantea cuatro opciones. **La respuesta no es una combinación difusa de las tres primeras: es una secuencia con un orden obligatorio.**

**Hoy y durante los próximos 12 meses: un servicio financiero personal habilitado por software.**
La evidencia es consistente en las tres direcciones. El precio de referencia lo fija un humano (USD 12.000–48.000/año). El único producto de consumo que sostiene un precio alto (Kubera Black, USD 2.500/año) lo justifica con onboarding concierge y soporte 1:1, no con features. Y todo el sector adyacente —Plumb, Eton, Asset Vantage, Nines— funciona como *tech-enabled service*. **El software solo no se vende por encima de USD 300/año.**

**A los 18–24 meses, si y solo si la curva de horas aparece: una aplicación premium de finanzas personales con capa de servicio opcional.**
La condición es medible: el onboarding tiene que bajar de 28 h a ~10 h y el servicio mensual de 3,5 h a ~1,5 h. Si eso no ocurre, el negocio es una consultora con software y hay que aceptarlo explícitamente — una consultora rentable de 20 personas es un buen negocio, pero no es el que se está financiando.

**El "Personal CFO asistido por IA" es la consecuencia, no el punto de partida.**
La IA de este producto tiene dos usos y solo uno de ellos se vende el día 1:
- **Interno, desde el principio:** multiplicar la productividad del equipo de servicio (categorización con abstención, propuestas de reglas con diff e impacto, generación de dashboards desde el mapa de dimensiones). **Ahí es donde la IA produce margen.**
- **De cara al usuario, en la tercera ola y con condiciones duras:** solo lectura, citas obligatorias enforced por el renderer, y error silencioso <2% en un eval propio de 200–300 preguntas. Un asistente que se equivoca en un número que el cliente reenvió a su contador no pierde una conversación: pierde la cuenta, y en un segmento chico y conectado, pierde también la referencia.

**Y una respuesta que el brief no pedía pero que la investigación impone: el comprador y el usuario probablemente no son la misma persona.** El principal paga; el contador o el asistente operan. Un producto diseñado solo para el principal va a tener la frecuencia de uso de un trámite anual. Ese es el hallazgo con más consecuencias de todo el trabajo, y es exactamente lo que las 30 entrevistas tienen que confirmar o desmentir antes de escribir la primera línea de código de producto.

**Lo que NO estamos construyendo, confirmado:** no un portfolio tracker, no un motor de recomendaciones, no una plataforma de inversiones. Ese límite es defendible, es barato en compliance y es un argumento de venta frente a un segmento que desconfía —con razón— de que su herramienta le termine vendiendo productos financieros.

---

## C4. Qué hacer en los próximos 90 días

**Semanas 1–3 — Cerrar los agujeros de evidencia (costo: tiempo).**
1. **30 entrevistas al ICP** con el guion de B12. La hipótesis a matar es: *"el contador es aliado, no bloqueador"*. La segunda: *"la persona operaría el software"*.
2. **Test de conectividad real:** listar las ~40 instituciones concretas de 20 hogares objetivo (incluida banca privada europea y suiza) y verificar ruta de datos —API, archivo o PDF— antes de prometer nada multi-país.
3. **Trials con las manos** de PocketSmith Fortune, Fina Premium, Lunch Money y Monarch Plus, probando específicamente: filtros combinables, grupos AND/OR, drill-down, vistas guardadas, exportación, reportes programados y conversión FX. **Es el único modo de saber contra qué se compite.**
4. **Cotizaciones formales** de Plaid y Enable Banking para 20–25 Items por usuario, y de dos proveedores de enriquecimiento. Son las dos variables que más mueven el margen.
5. **Dictamen legal** de un abogado de securities en EE.UU. y de uno de la UE sobre el perímetro del asistente, más consulta sobre §5/§6 StBerG en Alemania y el equivalente francés e italiano.

**Semanas 4–11 — El piloto concierge de B13.** Cinco clientes pagos, USD 14.000–15.000 de caja, cero agregación bancaria, todo manual detrás.

**En paralelo, la Ola 1 de producto**, en este orden: modelo de datos con grano posting → parsers con suite de regresión → **informe de reconciliación de importación** → registro de dimensiones con pesos → IR y compilador → builder niveles 1 y 2 → los reportes R1 y R2.

**Semana 12 — Decisión.** Con los diez criterios de muerte de C2 sobre la mesa, y una respuesta explícita a: ¿el comprador opera el software, o hay que vendérselo al operador?

**Dos spikes técnicos de dos días cada uno, cuando convenga:** (a) 500k postings sintéticos con 8 dimensiones y 3 tablas puente, medir p95 de las 20 consultas más probables — eso decide si Postgres puro alcanza; (b) benchmark de Typst contra headless Chrome con la plantilla real de PDF, con gráficos embebidos.

---

## C5. Fiabilidad de esta investigación

Lo que sigue es importante para no tratar el documento como más firme de lo que es.

**Verificado en fuente primaria y sólido:** los precios de Kubera (USD 250 / 2.500), Monarch Plus (USD 299, 21-abr-2026), PocketSmith, Quicken, Lunch Money, YNAB, Tiller, Banktivity, Vyzer, Sequence · Plumb Bill Pay (USD 2.000–4.000/mes, mínimo 1.000) · Asora, Asset Vantage y FundCount · Teller y SimpleFIN · los benchmarks de RevenueCat · las fechas de discontinuación de BofA y Schwab · los formatos QIF/OFX y sus defectos · los límites de Plaid (730 días) · la exención §314.6 de la FTC Safeguards Rule · §5 y §6 Nr. 3 StBerG · el fee RAISP de la FCA (£1.130) · FTC v. Cleo AI y CFPB vs. Block · los benchmarks de BIRD, Spider 2.0, dbt y Cube.

**Zonas débiles que hay que cerrar antes de decidir:**
- **Cero evidencia conductual de primera mano.** Reddit está bloqueado para crawlers, Bogleheads devuelve 403, Trustpilot 403, el foro de Quicken es JS-rendered y la comunidad de Tiller devuelve un placeholder. **No se pudo citar ni un solo hilo verbatim de r/fatFIRE, r/HENRYfinance ni r/ExpatFIRE.** Es el hueco más grande y el más barato de cerrar, con un navegador real y 30 entrevistas.
- **Ningún agregador grande publica precios.** Todas las cifras de Plaid, Enable Banking, MX, Yodlee, Salt Edge y Tink vienen de terceros. El costo de datos por usuario podría ser 2–3× el modelado.
- **Los costos horarios del equipo de servicio (USD 12–25/h offshore) no están verificados** y de ahí depende todo el margen del modelo (c).
- **Los precios del software de family office** (Addepar ~50–70k, Masttro 50–150k, Eton ~150k) vienen de páginas de competidores, que tienen incentivo a inflarlos.
- **El estado procesal exacto de la regla 1033 del CFPB** (la palabra *enjoined*) descansa en un blog de vendor y hay que verificarlo en el docket.
- **La afirmación "nadie tiene grupos AND/OR anidados"** es inferencia por ausencia de evidencia, con indicios contrarios. No usarla como diferencial sin probarla.
- **No hay telemetría pública de uso de reportes en ninguna herramienta de finanzas personales.** Todos los umbrales de B14 son elegidos.
- **No hay ninguna cifra de cuántos clientes tiene Kubera Black.** Toda la hipótesis de disposición a pagar premium es circunstancial: prueba que el tier existe, no que alguien lo compre en volumen.
- **Nada de esto cubre LatAm ni España del lado del sustituto.** Si el mercado objetivo real no es EE.UU. y Europa, el costo del contador cae 3–10× y **toda la tesis de precio se desploma**. Es probablemente la incertidumbre más importante que queda abierta.

---

*Documento generado el 12 de agosto de 2026. Las cifras de precio y estado regulatorio son las vigentes a esa fecha y rotan con frecuencia; reverificar antes de usarlas en un documento externo.*
