import Link from 'next/link'
import { Importer } from '../importer'

export const metadata = {
  title: 'Probar con un extracto',
  description:
    'Subí un extracto bancario y mirá exactamente qué entró, qué se descartó y si los saldos cuadran, antes de importar nada. Sin cuenta y sin guardar nada.',
}

export default function Probar() {
  return (
    <main className="shell">
      <h1>Mirá qué entró antes de importar nada</h1>
      <p className="lede" style={{ marginTop: 'var(--s3)' }}>
        Subí un extracto y el motor te dice exactamente qué leyó, qué descartó por duplicado, qué
        necesita criterio humano y si los saldos cuadran al céntimo. Nada se guarda: esto sólo lee
        el fichero y te devuelve el informe.
      </p>

      <div style={{ marginTop: 'var(--s5)' }}>
        <Importer />
      </div>

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
        <br />
        <br />
        Si querés guardarlo y volver mañana, <Link href="/entrar">creá una cuenta</Link>. El
        importador de adentro es el mismo motor, sólo que además persiste el lote y te deja
        deshacerlo entero.
      </p>
    </main>
  )
}
