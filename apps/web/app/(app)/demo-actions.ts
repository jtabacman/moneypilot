'use server'

import {
  hasDemoData,
  instalarPlanDeCuentas,
  removeDemoData,
  seedDemoHousehold,
} from '@moneypilot/db'
import { revalidatePath } from 'next/cache'
import { writeHousehold } from '@/lib/data'

/**
 * Cargar y quitar el hogar de ejemplo.
 *
 * Existe porque un producto de registro financiero tiene un problema de
 * primera impresión que no tienen otros: hasta que no hay dos años de
 * movimientos dentro, todas las pantallas están vacías y no hay nada que
 * juzgar. La alternativa habitual —rellenar la interfaz con números falsos—
 * es justo lo que este producto no puede hacer.
 *
 * La solución es sembrar datos **reales en la base**: mismos asientos, mismas
 * policies, mismo motor. Se ven porque están, no porque estén pintados. Y se
 * quitan de un click, porque cuelgan de un único lote de importación.
 */
export async function loadDemoData(): Promise<void> {
  await writeHousehold(async (client) => {
    if (await hasDemoData(client)) return
    await seedDemoHousehold(client)
  })
  revalidatePath('/', 'layout')
}

export async function unloadDemoData(): Promise<void> {
  await writeHousehold(async (client) => {
    await removeDemoData(client)
  })
  revalidatePath('/', 'layout')
}

/**
 * Instalar el plan de cuentas en un hogar que se quedó sin él.
 *
 * `instalarPlanDeCuentas` corre en el alta, así que todo hogar creado a partir
 * de hoy nace con sus categorías y sus cuatro ejes. Los creados **antes** no:
 * pasaron por un alta que no lo hacía, y no hay forma de que se enteren solos.
 *
 * Y un hogar sin plan de cuentas no es un hogar configurado de otra manera: es
 * un hogar donde el motor de clasificación no puede escribir. Propone,
 * `resolverRuta` no encuentra la cuenta, la propuesta muere en `rutasSinCuenta`
 * y todo queda en «Sin categorizar» sin un solo error. Por eso esto es un
 * arreglo y no una preferencia.
 *
 * Es idempotente y respeta lo que ya esté: si el hogar tiene una cuenta
 * llamada «Salud», ésa es la suya y no se toca. Correrlo dos veces no crea
 * nada.
 */
export async function instalarPlan(): Promise<void> {
  await writeHousehold(async (client) => {
    await instalarPlanDeCuentas(client)
  })
  revalidatePath('/', 'layout')
}
