// Parseo del mensaje pre-armado, armado del carrito y cálculo de montos.
import { toCents, slug } from './format.js';

export const PEDIDO_RE = /#PEDIDO\s+([A-Z]{3}-\d{2}\*\d+(?:\|[A-Z]{3}-\d{2}\*\d+)*)/i;
export const MAX_QTY = 50;

/**
 * Lee la línea "#PEDIDO CAM-01*2|TAZ-01*1" y las notas "Nota: ..." del texto legible.
 * @returns {{items:{id:string, qty:number, nota:string}[], notaGeneral:string} | null}
 */
export function parsePedido(text) {
  const m = String(text || '').match(PEDIDO_RE);
  if (!m) return null;

  const merged = new Map();
  for (const part of m[1].split('|')) {
    const [rawId, rawQty] = part.split('*');
    const id = rawId.toUpperCase();
    const qty = Math.min(MAX_QTY, parseInt(rawQty, 10) || 0);
    if (qty <= 0) continue;
    merged.set(id, Math.min(MAX_QTY, (merged.get(id) || 0) + qty));
  }
  const items = [...merged].map(([id, qty]) => ({ id, qty, nota: '' }));

  // Las notas van debajo de cada viñeta, en el mismo orden que la línea #PEDIDO.
  const notas = [];
  let bullet = -1;
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (/^[•\-*]\s*\d+\s*x/i.test(t)) {
      bullet++;
      notas[bullet] = '';
    } else if (bullet >= 0 && /^nota\s*:/i.test(t)) {
      notas[bullet] = t.replace(/^nota\s*:\s*/i, '').slice(0, 300);
    }
  }
  let notaGeneral = '';
  if (notas.length === items.length) {
    items.forEach((it, i) => (it.nota = notas[i] || ''));
  } else if (notas.some(Boolean)) {
    notaGeneral = notas.filter(Boolean).join(' | ');
  }
  return { items, notaGeneral };
}

/**
 * Cruza el pedido con el catálogo. Los precios SIEMPRE salen del catálogo.
 * @returns {{items:object[], unavailable:string[], subtotal:number}}
 */
export function buildCart(parsed, catalog) {
  const byId = new Map(catalog.map((p) => [String(p.ID_Servicio).toUpperCase(), p]));
  const items = [];
  const unavailable = [];
  for (const it of parsed.items) {
    const p = byId.get(it.id);
    if (!p || !isActive(p.Activo)) {
      unavailable.push(it.id);
      continue;
    }
    items.push({
      id: it.id,
      nombre: String(p.Nombre),
      precio: Number(p.Precio_USD),
      qty: it.qty,
      nota: it.nota,
      tiempo: String(p.Tiempo_Entrega || ''),
    });
  }
  const subtotalC = items.reduce((s, i) => s + toCents(i.precio) * i.qty, 0);
  return { items, unavailable, subtotal: subtotalC / 100, notaGeneral: parsed.notaGeneral || '' };
}

export function isActive(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE' || String(v).trim().toUpperCase() === 'SI';
}

// "2x Camisa Oversize (negra) · 1x Taza Mágica"
export function describeItems(items) {
  return items.map((i) => `${i.qty}x ${i.nombre}${i.nota ? ` (${i.nota})` : ''}`).join(' · ');
}

// El tiempo de entrega más largo del pedido ("3 días hábiles").
export function longestDelivery(items) {
  let best = null;
  let bestN = -1;
  for (const i of items) {
    const n = parseInt(String(i.tiempo).match(/\d+/)?.[0] ?? '', 10);
    if (!Number.isNaN(n) && n > bestN) {
      bestN = n;
      best = i.tiempo;
    }
  }
  return best;
}

/**
 * Montos de la cotización. Trabaja en céntimos para evitar errores de coma flotante.
 * @param {{subtotal:number, envio:number, porcentaje:number, tipoPago:'FULL'|'ADEL', tasa:number|null}} q
 */
export function computeQuote({ subtotal, envio = 0, porcentaje, tipoPago, tasa }) {
  const totalC = toCents(subtotal) + toCents(envio);
  const pct = tipoPago === 'FULL' ? 100 : Number(porcentaje);
  const pagarC = Math.round((totalC * pct) / 100);
  const restC = totalC - pagarC;
  const r = tasa ? Number(tasa) : null;
  return {
    total: totalC / 100,
    pagar: pagarC / 100,
    restante: restC / 100,
    porcentaje: pct,
    totalVES: r ? Math.round(totalC * r) / 100 : null,
    pagarVES: r ? Math.round(pagarC * r) / 100 : null,
  };
}

// ---- Helpers de configuración ----

export function cfgNum(config, key, fallback) {
  const v = config?.[key];
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

export function cfgList(config, key, fallback = []) {
  const v = config?.[key];
  if (!v) return fallback;
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Busca "Datos_PagoMovil" para "Pago Móvil", sin importar acentos ni espacios.
export function paymentDetails(config, metodo) {
  const target = 'datos' + slug(metodo);
  for (const [k, v] of Object.entries(config || {})) {
    if (slug(k) === target) return String(v);
  }
  return '';
}

export function isVesMethod(config, metodo) {
  const list = cfgList(config, 'Metodos_En_Bolivares', ['Pago Móvil', 'Transferencia']);
  return list.some((m) => slug(m) === slug(metodo));
}

export function shippingCost(config, entrega) {
  if (entrega === 'DELIVERY') return cfgNum(config, 'Costo_Delivery_USD', 0);
  if (entrega === 'MRW') return cfgNum(config, 'Costo_Envio_MRW_USD', 0);
  return 0;
}

export const ENTREGA_LABEL = { RETIRO: 'Retiro', DELIVERY: 'Delivery', MRW: 'Envío MRW' };
