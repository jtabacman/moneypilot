/**
 * De cadena de conexión a configuración de cliente, con TLS verificado.
 *
 * Existe por un motivo concreto. `pg` 8.16 endureció el significado de
 * `sslmode=require`: antes cifraba sin comprobar quién había al otro lado,
 * ahora equivale a `verify-full`. El pooler de Supabase presenta un
 * certificado firmado por su propia autoridad, que no está en el almacén del
 * sistema, así que la conexión pasó a fallar con "self-signed certificate in
 * certificate chain".
 *
 * Hay dos salidas. La fácil es `rejectUnauthorized: false`: cifra pero no
 * comprueba nada, y cualquiera que se meta en medio puede leer y modificar el
 * tráfico presentando su propio certificado. En un producto que transporta el
 * detalle financiero de una familia no es una opción razonable.
 *
 * La otra es fijar la autoridad de Supabase y verificar contra ella, que es lo
 * que hace este módulo. El certificado va incrustado como texto y no como
 * fichero a propósito: leerlo del disco obliga a resolver una ruta que los
 * bundlers no saben seguir, y ya nos costó un build.
 *
 * Por qué no basta con pasarle `ssl` a `pg` junto al `connectionString`:
 * cuando recibe los dos, `pg` parsea la cadena y **pisa** con ella lo que le
 * hayas puesto a mano. Por eso descomponemos la URL en campos sueltos.
 */

/**
 * Autoridad raíz de Supabase, válida hasta el 26 de abril de 2031.
 *
 * Huella SHA-256:
 * 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
 *
 * Se obtuvo del propio servidor (`openssl s_client -starttls postgres`). Que
 * el build de producción, que corre en otra red y en otro continente, valide
 * contra ella es la comprobación de que no la interceptó nadie: para colar una
 * falsa habría que estar en medio de las dos rutas a la vez.
 */
export const SUPABASE_ROOT_CA_2021 = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`

export interface TlsOptions {
  readonly ca: string
  readonly rejectUnauthorized: true
  readonly servername: string
}

export interface ClientConfig {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly password: string
  readonly database: string
  readonly ssl: TlsOptions | false
}

export class ConnectionStringError extends Error {}

/** Hosts de Supabase: el pooler y la conexión directa. */
function isSupabase(host: string): boolean {
  return host.endsWith('.supabase.com') || host.endsWith('.supabase.co')
}

/**
 * Descompone la cadena de conexión en campos explícitos.
 *
 * Los parámetros de query (`sslmode`, `pgbouncer`, …) se descartan: el modo de
 * TLS lo decidimos acá, no la cadena. Si algún día hiciera falta pasar
 * `options=-c ...`, hay que añadirlo a mano — descartarlo en silencio sería
 * peor que no soportarlo.
 */
export function toClientConfig(connectionString: string): ClientConfig {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new ConnectionStringError('La cadena de conexión no es una URL válida.')
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new ConnectionStringError(
      `La cadena de conexión debería empezar por postgres:// y empieza por ${url.protocol}//.`,
    )
  }
  if (url.hostname === '') {
    throw new ConnectionStringError('La cadena de conexión no tiene host.')
  }

  const host = url.hostname
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))

  return {
    host,
    port: url.port === '' ? 5432 : Number.parseInt(url.port, 10),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: database === '' ? 'postgres' : database,
    // Sin TLS fuera de Supabase: en local la base corre en Docker sin
    // certificados, y exigirlo ahí sólo consigue que nadie pueda desarrollar.
    ssl: isSupabase(host)
      ? { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true, servername: host }
      : false,
  }
}
