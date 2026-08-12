import { describe, expect, it } from 'vitest'
import { ConnectionStringError, SUPABASE_ROOT_CA_2021, toClientConfig } from './connection.js'

const POOLER =
  'postgres://postgres.abcdefghijklmnop:pa%3Ass%2Fword@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true'

describe('toClientConfig', () => {
  it('descompone la cadena del pooler de Supabase', () => {
    const config = toClientConfig(POOLER)
    expect(config.host).toBe('aws-0-eu-central-1.pooler.supabase.com')
    expect(config.port).toBe(6543)
    expect(config.user).toBe('postgres.abcdefghijklmnop')
    expect(config.database).toBe('postgres')
  })

  it('decodifica la contraseña con caracteres escapados', () => {
    // Las contraseñas generadas traen ':' y '/' con frecuencia. Pasarlas sin
    // decodificar da un fallo de autenticación que parece una credencial mala.
    expect(toClientConfig(POOLER).password).toBe('pa:ss/word')
  })

  it('verifica TLS contra la autoridad de Supabase', () => {
    const { ssl } = toClientConfig(POOLER)
    expect(ssl).not.toBe(false)
    if (ssl === false) throw new Error('inalcanzable')
    expect(ssl.rejectUnauthorized).toBe(true)
    expect(ssl.ca).toBe(SUPABASE_ROOT_CA_2021)
    expect(ssl.servername).toBe('aws-0-eu-central-1.pooler.supabase.com')
  })

  it('verifica TLS también en la conexión directa', () => {
    const config = toClientConfig('postgres://postgres:x@db.abc.supabase.co:5432/postgres')
    expect(config.ssl).not.toBe(false)
  })

  it('no exige TLS contra la base local de desarrollo', () => {
    // En Docker no hay certificados. Exigirlos acá sólo impide desarrollar.
    const config = toClientConfig('postgres://moneypilot:moneypilot@localhost:5433/moneypilot')
    expect(config.ssl).toBe(false)
    expect(config.port).toBe(5433)
  })

  it('descarta los parámetros de query en vez de reenviarlos', () => {
    // El modo de TLS lo decide este módulo. Si `sslmode` sobreviviera hasta
    // `pg`, pisaría la configuración explícita — que es el fallo que motivó
    // todo esto.
    const config = toClientConfig(POOLER)
    expect(JSON.stringify(config)).not.toContain('sslmode')
    expect(JSON.stringify(config)).not.toContain('pgbouncer')
  })

  it('usa 5432 cuando la cadena no trae puerto', () => {
    expect(toClientConfig('postgres://u:p@example.com/db').port).toBe(5432)
  })

  it('acepta el esquema postgresql:// además de postgres://', () => {
    expect(toClientConfig('postgresql://u:p@localhost/db').database).toBe('db')
  })

  it('rechaza una cadena que no es una URL', () => {
    expect(() => toClientConfig('host=localhost user=postgres')).toThrow(ConnectionStringError)
  })

  it('rechaza un esquema que no es de Postgres', () => {
    // Pegar la URL de la API de Supabase en lugar de la de la base es un error
    // frecuente, y conviene que lo diga en vez de intentar conectarse.
    expect(() => toClientConfig('https://abc.supabase.co')).toThrow(/postgres:\/\//)
  })

  it('el certificado incrustado es un PEM completo', () => {
    // Si un formateador se comiera el bloque, la verificación fallaría en
    // producción y sólo ahí. Mejor que salte acá.
    expect(SUPABASE_ROOT_CA_2021.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true)
    expect(SUPABASE_ROOT_CA_2021.trimEnd().endsWith('-----END CERTIFICATE-----')).toBe(true)
  })
})
