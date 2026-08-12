# Fixtures

Ficheros de extracto con formato real, usados como suite de regresión de los
parsers. **Ninguno contiene datos de un cliente**: todos vienen de suites de
test de proyectos open source, ya anonimizados por sus autores.

Esa es una decisión, no una limitación: un fichero de test público es mejor
fixture que un extracto real, porque se puede versionar, compartir y publicar
sin exponer a nadie.

## Origen y licencia

| Directorio | Origen | Licencia |
|---|---|---|
| `ofx/` | [jseutter/ofxparse](https://github.com/jseutter/ofxparse), `tests/fixtures/` | MIT |
| `n43/` | [sergief/norma43parser](https://github.com/sergief/norma43parser), `norma43parser/test/fixtures/` | MIT |

Ambos proyectos están bajo licencia MIT, que permite redistribuir estos
ficheros conservando el aviso de copyright. Se descartó
[csingley/ofxtools](https://github.com/csingley/ofxtools) —que tiene la mejor
cobertura del ecosistema— porque su licencia no está identificada.

## Qué cubre cada uno

### `ofx/`

| Fichero | Por qué está |
|---|---|
| `checking.ofx` | OFX 1.02 SGML de una cuenta corriente, con indentación por tabuladores y campos `INTU.*` de Quicken |
| `bank_medium.ofx` | Varias transacciones, forma canónica |
| `bank_small.ofx` | Mínimo absoluto: sirve para verificar que no asumimos campos opcionales |
| `fidelity-savings.ofx` | Institución real de EE.UU., crítica para el ICP |
| `anzcc.ofx` | Tarjeta de crédito (`CCSTMTRS`) de un banco australiano |
| `multiple_accounts.ofx` | Varias cuentas en un mismo fichero |
| `ofx-v102-empty-tags.ofx` | **El caso borde importante**: todo en una sola línea y con tags vacíos (`<CURDEF></CURDEF>`, `<FITID></FITID>`, `<BALAMT></BALAMT>`). Un parser que asuma que un tag presente trae valor se rompe acá |

### `n43/`

| Fichero | Por qué está |
|---|---|
| `movements.n43` | Norma 43 español. **Sus líneas miden 70, 77, 79 y 81 caracteres, no los 80 fijos que exige la especificación**: los bancos recortan los espacios finales. Un parser fiel al spec rechazaría el fichero entero |

## Añadir fixtures propios

Un extracto de un cliente **no puede** entrar acá mientras el repositorio sea
público, ni siquiera anonimizado a mano: los importes y las fechas combinados
identifican a una persona con más facilidad de la que parece.

Si hace falta usar ficheros reales, van en `fixtures/private/`, que está en
`.gitignore`.
