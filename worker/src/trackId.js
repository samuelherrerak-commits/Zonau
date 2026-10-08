import { ddmmCaracas } from './format.js';

// Sin O, 0, I, 1 para evitar confusiones al leer o dictar el código.
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TRACK_ID_RE = /^[A-Z]{3}-\d{4}-[A-HJ-NP-Z2-9]{3}$/;

// Producto principal: el de mayor subtotal (precio x cantidad). En empate, el primero.
export function mainItem(items) {
  return items.reduce((a, b) => (b.precio * b.qty > a.precio * a.qty ? b : a));
}

export function randomSuffix(length = 3, randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  // 256 es múltiplo de 32, así que b % 32 no introduce sesgo.
  return [...randomBytes(length)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * Genera un Track_ID con formato PREFIJO-DDMM-XXX (ej. CAM-0810-K9R).
 * @param {{id:string, precio:number, qty:number}[]} items
 * @param {Date} now
 */
export function generateTrackId(items, now = new Date(), randomBytes) {
  if (!items || !items.length) throw new Error('El pedido no tiene productos');
  const prefix = mainItem(items).id.slice(0, 3).toUpperCase();
  const { day, month } = ddmmCaracas(now);
  return `${prefix}-${day}${month}-${randomSuffix(3, randomBytes)}`;
}

export function normalizeTrackId(raw) {
  return String(raw || '').toUpperCase().replace(/\s+/g, '');
}
