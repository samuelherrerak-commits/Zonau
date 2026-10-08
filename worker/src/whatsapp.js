// Cliente mínimo de la WhatsApp Cloud API de Meta.

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export function createWhatsApp(env, fetchFn = fetch) {
  const version = env.GRAPH_VERSION || 'v21.0';
  const base = `https://graph.facebook.com/${version}`;
  const auth = { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` };

  async function post(body) {
    const res = await fetchFn(`${base}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  return {
    sendText: (to, text) => post({ to, type: 'text', text: { body: text, preview_url: true } }),

    // Hasta 3 botones; títulos de máximo 20 caracteres.
    sendButtons: (to, text, buttons) =>
      post({
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text },
          action: {
            buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: clip(b.title, 20) } })),
          },
        },
      }),

    // Hasta 10 opciones; títulos de máximo 24 caracteres.
    sendList: (to, text, buttonText, rows) =>
      post({
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text },
          action: {
            button: clip(buttonText, 20),
            sections: [{ title: 'Opciones', rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: clip(r.title, 24) })) }],
          },
        },
      }),

    markRead: (messageId) => post({ status: 'read', message_id: messageId }).catch(() => {}),

    // Descarga una imagen/PDF recibido y lo devuelve en base64.
    async downloadMedia(mediaId) {
      const metaRes = await fetchFn(`${base}/${mediaId}`, { headers: auth, signal: AbortSignal.timeout(10000) });
      if (!metaRes.ok) throw new Error(`Media meta ${metaRes.status}`);
      const meta = await metaRes.json();
      if (meta.file_size && meta.file_size > MAX_MEDIA_BYTES) throw new Error('Archivo demasiado grande');
      const fileRes = await fetchFn(meta.url, { headers: auth, signal: AbortSignal.timeout(20000) });
      if (!fileRes.ok) throw new Error(`Media download ${fileRes.status}`);
      const buf = await fileRes.arrayBuffer();
      if (buf.byteLength > MAX_MEDIA_BYTES) throw new Error('Archivo demasiado grande');
      return { base64: toBase64(buf), mimeType: meta.mime_type || 'image/jpeg' };
    },
  };
}

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Verifica X-Hub-Signature-256 = "sha256=<hmac hex del cuerpo crudo>"
export async function verifySignature(rawBody, header, appSecret) {
  if (!header || !appSecret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = 'sha256=' + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}
