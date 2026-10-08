// Cloudflare Worker: webhook de WhatsApp Cloud API para Zonau.
//
// GET  /webhook  -> verificación de Meta (hub.challenge)
// POST /webhook  -> mensajes entrantes (firma X-Hub-Signature-256 obligatoria)
// GET  /         -> health check

import { createWhatsApp, verifySignature } from './whatsapp.js';
import { createSheetsClient } from './sheets.js';
import { createStore } from './state.js';
import { getRate } from './rates.js';
import { handleMessage, FALLBACK_MESSAGE } from './flow.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/webhook' && request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      // TODO: META_VERIFY_TOKEN es el texto que tú inventas y pegas también en Meta.
      if (mode === 'subscribe' && token && token === env.META_VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      const raw = await request.text();
      const ok = await verifySignature(raw, request.headers.get('X-Hub-Signature-256'), env.META_APP_SECRET);
      if (!ok) return new Response('Invalid signature', { status: 401 });

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return new Response('Bad JSON', { status: 400 });
      }
      // Respondemos 200 de inmediato; el procesamiento sigue en segundo plano.
      ctx.waitUntil(processPayload(payload, env));
      return new Response('OK', { status: 200 });
    }

    if (url.pathname === '/') return new Response('Zonau bot OK');
    return new Response('Not found', { status: 404 });
  },
};

export async function processPayload(payload, env) {
  const kv = env.ZONAU_KV;
  const wa = createWhatsApp(env);
  const store = createStore(kv);
  const deps = {
    wa,
    store,
    sheets: createSheetsClient(env, kv),
    rates: { getRate: (config) => getRate(config, { kv }) },
    now: () => new Date(),
  };

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      // Ignoramos "statuses" (enviado/leído) y cualquier otro evento sin mensajes.
      for (const msg of value.messages || []) {
        if (await store.alreadySeen(msg.id)) continue;
        const contact = (value.contacts || []).find((c) => c.wa_id === msg.from) || value.contacts?.[0];
        try {
          await wa.markRead(msg.id);
          await handleMessage(msg, contact, deps);
        } catch (err) {
          console.error('Error procesando mensaje', msg.id, err?.stack || err);
          await wa.sendText(msg.from, FALLBACK_MESSAGE).catch(() => {});
        }
      }
    }
  }
}
