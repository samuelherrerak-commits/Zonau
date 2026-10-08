#!/usr/bin/env node
// Envía al Worker local (`npm run dev`) payloads firmados como los de Meta,
// para probar la conversación sin un teléfono real.
//
// Uso:
//   node scripts/simulate.js text "Hola"
//   node scripts/simulate.js text "$(cat test/fixtures/cart-message.txt)"
//   node scripts/simulate.js button ENT_MRW "Envío MRW"
//   node scripts/simulate.js image MEDIA_ID
//
// Variables: WORKER_URL (default http://localhost:8787/webhook), META_APP_SECRET (default "dev-secret"),
//            FROM (default 584141234567). Las respuestas del bot se ven en la consola de `wrangler dev`.

import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [, , kind = 'text', ...args] = process.argv;
const url = process.env.WORKER_URL || 'http://localhost:8787/webhook';
const secret = process.env.META_APP_SECRET || 'dev-secret';
const from = process.env.FROM || '584141234567';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../test/fixtures/${name}.json`, import.meta.url)));

let payload;
if (kind === 'text') {
  payload = fixture('text');
  payload.entry[0].changes[0].value.messages[0].text.body = args.join(' ') || 'Hola';
} else if (kind === 'button') {
  payload = fixture('interactive');
  payload.entry[0].changes[0].value.messages[0].interactive.button_reply = { id: args[0], title: args[1] || args[0] };
} else if (kind === 'image') {
  payload = fixture('image');
  payload.entry[0].changes[0].value.messages[0].image.id = args[0] || 'MEDIA_ID';
} else if (kind === 'status') {
  payload = fixture('status');
} else {
  console.error('Tipo desconocido. Usa: text | button | image | status');
  process.exit(1);
}

const value = payload.entry[0].changes[0].value;
if (value.messages) {
  value.messages[0].from = from;
  value.messages[0].id = `wamid.${randomUUID()}`;
  value.contacts[0].wa_id = from;
}

const body = JSON.stringify(payload);
const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body });
console.log(res.status, await res.text());
