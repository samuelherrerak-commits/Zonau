import { API_URL, USE_MOCK } from './config.js';

const CACHE_KEY = 'zonau:catalog';
const CACHE_MS = 5 * 60 * 1000;

async function getJSON(url, timeoutMs = 15000) {
  // Sin headers personalizados: así el navegador no hace preflight CORS contra Apps Script.
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** @returns {Promise<{productos: object[], config: object}>} */
export async function getCatalog() {
  try {
    const hit = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (hit && Date.now() - hit.t < CACHE_MS) return hit.data;
  } catch { /* sessionStorage no disponible */ }

  const json = USE_MOCK ? await getJSON('mock/catalog.json') : await getJSON(`${API_URL}?action=getCatalog`);
  if (!json.ok) throw new Error(json.error || 'Error del servidor');

  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data: json.data })); } catch { /* sin caché */ }
  return json.data;
}

/** @returns {Promise<{ok: boolean, data?: object, error?: string}>} */
export async function getTracking(id) {
  if (USE_MOCK) {
    const all = await getJSON('mock/tracking.json');
    const data = all[id];
    return data ? { ok: true, data } : { ok: false, error: 'NOT_FOUND' };
  }
  return getJSON(`${API_URL}?action=getTracking&id=${encodeURIComponent(id)}`);
}
