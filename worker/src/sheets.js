// Cliente del Web App de Google Apps Script.
// Apps Script no permite leer headers, por eso el secreto viaja en el cuerpo.

const CACHE_TTL = 5 * 60;

export function createSheetsClient(env, kv) {
  async function call(action, payload = {}) {
    // TODO: APPS_SCRIPT_URL y APPS_SCRIPT_SECRET se configuran con `wrangler secret put`.
    const res = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      // text/plain evita problemas de CORS/preflight y Apps Script lo lee igual.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, secret: env.APPS_SCRIPT_SECRET, ...payload }),
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Apps Script ${action}: HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok && json.error !== 'DUPLICATE_ID') throw new Error(`Apps Script ${action}: ${json.error}`);
    return json;
  }

  async function cached(key, action) {
    const hit = kv && (await kv.get(key, 'json'));
    if (hit) return hit;
    const { data } = await call(action);
    if (kv) await kv.put(key, JSON.stringify(data), { expirationTtl: CACHE_TTL });
    return data;
  }

  return {
    getConfig: () => cached('cache:config', 'getConfig'),
    getCatalog: () => cached('cache:catalog', 'getCatalogPrivate'),
    async uploadReceipt(file) {
      const { data } = await call('uploadReceipt', file);
      return data.url;
    },
    // Devuelve { ok: true } o { ok: false, error: 'DUPLICATE_ID' }
    createOrder: (order) => call('createOrder', { order }),
  };
}
