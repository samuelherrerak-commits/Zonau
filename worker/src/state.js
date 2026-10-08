// Estado de conversación por número de teléfono, guardado en Cloudflare KV.
// (La memoria de un Worker no persiste entre peticiones.)

const STATE_TTL = 48 * 60 * 60;
const SEEN_TTL = 24 * 60 * 60;

export function newState(nombre = '') {
  return { step: 'IDLE', nombre };
}

export function createStore(kv) {
  return {
    async get(phone) {
      return (await kv.get(`conv:${phone}`, 'json')) || null;
    },
    async set(phone, state) {
      state.updatedAt = Date.now();
      await kv.put(`conv:${phone}`, JSON.stringify(state), { expirationTtl: STATE_TTL });
    },
    // Idempotencia: Meta reenvía webhooks si no recibe 200 a tiempo.
    async alreadySeen(messageId) {
      const key = `msg:${messageId}`;
      if (await kv.get(key)) return true;
      await kv.put(key, '1', { expirationTtl: SEEN_TTL });
      return false;
    },
  };
}
