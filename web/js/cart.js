// Carrito en localStorage y armado del mensaje para WhatsApp.
import { usd } from './util.js';

const KEY = 'zonau:cart';
export const MAX_QTY = 50;

/** @type {Record<string, {qty: number, nota: string}>} */
let items = load();
const listeners = new Set();

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* modo privado */ }
  listeners.forEach((fn) => fn());
}

export const onChange = (fn) => listeners.add(fn);
export const getItem = (id) => items[id] || { qty: 0, nota: '' };

export function setQty(id, qty) {
  const q = Math.max(0, Math.min(MAX_QTY, Math.floor(qty)));
  if (q === 0) delete items[id];
  else items[id] = { qty: q, nota: items[id]?.nota || '' };
  persist();
}

export function setNota(id, nota) {
  if (!items[id]) return;
  items[id].nota = String(nota).slice(0, 200);
  persist();
}

export function clear() {
  items = {};
  persist();
}

// Quita productos que ya no están en el catálogo.
export function prune(products) {
  const ids = new Set(products.map((p) => p.id));
  let changed = false;
  for (const id of Object.keys(items)) {
    if (!ids.has(id)) {
      delete items[id];
      changed = true;
    }
  }
  if (changed) persist();
}

/** Líneas del carrito en el orden del catálogo. */
export function lines(products) {
  return products
    .filter((p) => items[p.id]?.qty > 0)
    .map((p) => ({ ...p, qty: items[p.id].qty, nota: items[p.id].nota.trim(), subtotal: Math.round(p.precio * 100 * items[p.id].qty) / 100 }));
}

export function totals(products) {
  const ls = lines(products);
  return {
    count: ls.reduce((s, l) => s + l.qty, 0),
    total: Math.round(ls.reduce((s, l) => s + l.subtotal * 100, 0)) / 100,
  };
}

// Las notas van en una sola línea y sin "#" para no confundir al bot.
const cleanNota = (s) => s.replace(/[\r\n]+/g, ' ').replace(/#/g, '').trim();

/**
 * Mensaje legible + línea de código "#PEDIDO ID*cant|ID*cant" que lee el bot.
 * Los precios son informativos: el bot los recalcula desde el catálogo.
 */
export function buildMessage(products, storeName = 'Zonau') {
  const ls = lines(products);
  const body = ls.map((l) => {
    const nota = cleanNota(l.nota);
    return `• ${l.qty}x ${l.nombre} — ${usd(l.subtotal)}` + (nota ? `\n  Nota: ${nota}` : '');
  });
  const { total } = totals(products);
  const code = ls.map((l) => `${l.id}*${l.qty}`).join('|');
  return `Hola ${storeName}! 🖤 Quiero hacer este pedido:\n\n${body.join('\n')}\n\nTotal estimado: ${usd(total)}\n\n#PEDIDO ${code}`;
}

export function waLink(number, text) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
