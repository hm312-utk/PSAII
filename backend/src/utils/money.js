/**
 * El dinero nunca se maneja como float: siempre como string decimal ("45.50") de cara
 * afuera, y como entero en unidades menores (centavos) para sumar/multiplicar sin el
 * error de redondeo de la coma flotante.
 */

/** "150.5" → 15050 */
export function toMinorUnits(decimalString) {
  const [whole, fraction = ''] = String(decimalString).split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

/** 15050 → "150.50" */
export function formatMinorUnits(minorUnits) {
  return (minorUnits / 100).toFixed(2);
}
