'use server'

import { hasDemoData, removeDemoData, seedDemoHousehold } from '@moneypilot/db'
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
