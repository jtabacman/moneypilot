import { Importer } from './importer'

export default function Page() {
  return (
    <main className="shell">
      <div className="brand">
        <b>moneypilot</b>
        <span>importar y conciliar</span>
      </div>

      <h1>Mirá qué entró antes de importar nada</h1>
      <p className="lede">
        Subí un extracto y el motor te dice exactamente qué leyó, qué descartó por duplicado, qué
        necesita criterio humano y si los saldos cuadran al céntimo. Nada se guarda: esto sólo lee
        el fichero y te devuelve el informe.
      </p>

      <Importer />

      <p className="foot">
        Formatos que entiende: <b>OFX 1.x y 2.x</b>, <b>QFX</b>, <b>QIF</b> (Quicken y Microsoft
        Money), <b>CSV</b> con detección de esquema y <b>Norma 43</b> española. El formato se
        detecta por contenido, no por extensión.
        <br />
        <br />
        Sobre los saldos: Norma 43 trae apertura y cierre, así que la aritmética se verifica con el
        fichero solo. <b>OFX y QIF no traen saldo de apertura y no lo inventamos</b> — derivarlo
        restando los movimientos daría delta cero siempre y convertiría la comprobación en una
        tautología. Cuando no se puede verificar, se dice.
      </p>
    </main>
  )
}
