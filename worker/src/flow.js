// Máquina de estados de la conversación.
//
// IDLE -> (#PEDIDO) -> ESPERANDO_ENTREGA -> [ESPERANDO_DIRECCION] -> ESPERANDO_TIPO_PAGO
//      -> ESPERANDO_METODO -> ESPERANDO_COMPROBANTE -> (registro) -> IDLE
// Desde cualquier estado: "cancelar", nuevo #PEDIDO, "asesor" (pausa el bot).

import { usd, ves, fmtNum, normalize, slug } from './format.js';
import {
  PEDIDO_RE,
  parsePedido,
  buildCart,
  describeItems,
  longestDelivery,
  computeQuote,
  cfgNum,
  cfgList,
  paymentDetails,
  isVesMethod,
  shippingCost,
  ENTREGA_LABEL,
} from './order.js';
import { generateTrackId } from './trackId.js';
import { rateDateLabel } from './rates.js';
import { newState } from './state.js';

const QUOTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PAUSE_MS = 12 * 60 * 60 * 1000;
const MAX_ID_ATTEMPTS = 5;

export const FALLBACK_MESSAGE = 'Tuvimos un problema técnico 😓 Una persona te atenderá en breve 🙏';

/** Convierte un mensaje de Meta en una entrada simple. */
export function readInput(msg) {
  switch (msg.type) {
    case 'text':
      return { kind: 'text', text: msg.text?.body || '' };
    case 'interactive': {
      const r = msg.interactive?.button_reply || msg.interactive?.list_reply || {};
      return { kind: 'reply', id: r.id || '', text: r.title || '' };
    }
    case 'button':
      return { kind: 'text', text: msg.button?.text || '' };
    case 'image':
      return { kind: 'media', media: { id: msg.image.id, mimeType: msg.image.mime_type }, text: msg.image.caption || '' };
    case 'document':
      return { kind: 'media', media: { id: msg.document.id, mimeType: msg.document.mime_type }, text: msg.document.caption || '' };
    default:
      return { kind: 'other', text: '' };
  }
}

/**
 * Procesa un mensaje entrante.
 * deps: { wa, sheets, rates: { getRate(config) }, store, now: () => Date }
 */
export async function handleMessage(msg, contact, deps) {
  const phone = msg.from;
  const input = readInput(msg);
  const text = input.text.trim();
  const t = normalize(text);
  const now = deps.now();

  let state = (await deps.store.get(phone)) || newState();
  if (contact?.profile?.name) state.nombre = contact.profile.name;

  const save = (s) => deps.store.set(phone, s);
  const reply = (body) => deps.wa.sendText(phone, body);

  // Bot en pausa: una persona está atendiendo. Solo un pedido nuevo lo reactiva.
  if (state.step === 'PAUSADO') {
    if (now.getTime() < state.pausedUntil && !PEDIDO_RE.test(text)) return;
    state = newState(state.nombre);
  }

  const config = await deps.sheets.getConfig();
  const ctx = { phone, state, config, deps, reply, save, now };

  if (PEDIDO_RE.test(text)) return startOrder(ctx, text);

  if (/^(cancelar|cancela|anular)\b/.test(t)) {
    await save(newState(state.nombre));
    return reply('Listo, cancelé tu pedido en curso. Cuando quieras, arma uno nuevo en el catálogo:\n👉 ' + catalogUrl(config));
  }

  if (/\b(asesor|humano|una persona|hablar con alguien|agente)\b/.test(t)) {
    await save({ ...state, step: 'PAUSADO', pausedUntil: now.getTime() + PAUSE_MS });
    return reply('¡Claro! 🙌 Una persona del equipo te responderá por aquí lo antes posible.' + horario(config));
  }

  switch (state.step) {
    case 'ESPERANDO_ENTREGA':
      return onEntrega(ctx, input, t);
    case 'ESPERANDO_DIRECCION':
      return onDireccion(ctx, input, text);
    case 'ESPERANDO_TIPO_PAGO':
      return onTipoPago(ctx, input, t);
    case 'ESPERANDO_METODO':
      return onMetodo(ctx, input, t);
    case 'ESPERANDO_COMPROBANTE':
      return onComprobante(ctx, input, msg);
    default:
      return onIdle(ctx, input, t);
  }
}

// ---------------------------------------------------------------- IDLE

async function onIdle({ config, reply }, input, t) {
  if (input.kind === 'media') {
    return reply('¡Recibí tu imagen! 📸 Si es para personalizar un producto, una persona del equipo la revisará aquí mismo.');
  }
  if (/^(gracias|muchas gracias|ok|okey|listo|dale|perfecto|chevere|genial)\b/.test(t)) {
    return reply('¡A ti! 🖤 Cualquier cosa, aquí estamos.');
  }
  if (/\b(estado|estatus|seguimiento|tracking|rastrear|guia|mi pedido)\b/.test(t)) {
    return reply('Puedes consultar tu pedido con tu número de seguimiento aquí:\n👉 ' + trackingUrl(config));
  }
  const tienda = config.Nombre_Tienda || 'Zonau';
  const custom = String(config.Mensaje_Bienvenida || '').trim();
  return reply(
    custom ||
      `¡Hola! 🖤 Bienvenid@ a *${tienda}*. Personalizamos camisas, tazas, llaveros y regalos a tu medida.\n\n` +
        `Mira el catálogo completo con precios y tiempos de entrega aquí:\n👉 ${catalogUrl(config)}\n\n` +
        'Elige lo que quieras, toca *"Pedir por WhatsApp"* y te llegará tu pedido listo a este chat.'
  );
}

// ---------------------------------------------------------------- PEDIDO

async function startOrder({ phone, state, config, deps, reply, save }, text) {
  const parsed = parsePedido(text);
  const catalog = await deps.sheets.getCatalog();
  const cart = buildCart(parsed, catalog);

  if (!cart.items.length) {
    await save(newState(state.nombre));
    return reply(
      'Ups 👀 no encontré productos disponibles en tu pedido. Vuelve a armarlo desde el catálogo, por favor:\n👉 ' + catalogUrl(config)
    );
  }

  const next = { ...newState(state.nombre), step: 'ESPERANDO_ENTREGA', cart };
  await save(next);

  const nombre = firstName(state.nombre);
  let body = '';
  if (cart.unavailable.length) {
    body += `Ojo 👀 ${cart.unavailable.map((id) => `*${id}*`).join(', ')} ya no está disponible, así que no lo incluí.\n\n`;
  }
  body += `¡Recibido${nombre ? ', ' + nombre : ''}! ✅ Este es tu pedido:\n`;
  body += cart.items.map((i) => `• ${i.qty}x ${i.nombre} — ${usd(i.precio * i.qty)}${i.nota ? `\n   _${i.nota}_` : ''}`).join('\n');
  body += `\n\n*Subtotal: ${usd(cart.subtotal)}*`;
  const tiempo = longestDelivery(cart.items);
  if (tiempo) body += ` · Listo en aprox. ${tiempo}.`;
  body += '\n\n¿Cómo quieres recibirlo?';

  return deps.wa.sendButtons(phone, body, entregaButtons(config));
}

function entregaButtons(config) {
  const delivery = cfgNum(config, 'Costo_Delivery_USD', 0);
  return [
    { id: 'ENT_RETIRO', title: 'Retiro en tienda' },
    { id: 'ENT_DELIVERY', title: delivery ? `Delivery +${usd(delivery)}` : 'Delivery Caracas' },
    { id: 'ENT_MRW', title: 'Envío MRW' },
  ];
}

function parseEntrega(input, t) {
  if (input.id?.startsWith('ENT_')) return input.id.slice(4);
  if (/retir|tienda|busco|buscar/.test(t)) return 'RETIRO';
  if (/deliver|domicilio/.test(t)) return 'DELIVERY';
  if (/mrw|envio|nacional|encomienda/.test(t)) return 'MRW';
  return null;
}

async function onEntrega(ctx, input, t) {
  const { phone, state, config, deps, reply, save } = ctx;
  const entrega = parseEntrega(input, t);
  if (!entrega) {
    return deps.wa.sendButtons(phone, 'Elige cómo quieres recibir tu pedido 👇', entregaButtons(config));
  }
  state.entrega = entrega;
  state.envio = shippingCost(config, entrega);

  if (entrega === 'RETIRO') {
    state.direccion = '';
    if (config.Info_Retiro) await reply(`📍 *Retiro en tienda*\n${config.Info_Retiro}`);
    return askTipoPago(ctx);
  }

  state.step = 'ESPERANDO_DIRECCION';
  await save(state);
  if (entrega === 'DELIVERY') {
    return reply(
      `Perfecto 🛵 Delivery en Caracas${state.envio ? ` (${usd(state.envio)})` : ''}.\n` +
        'Envíame en un solo mensaje: dirección exacta, punto de referencia y teléfono de quien recibe.'
    );
  }
  const nota = config.Nota_Envio_MRW ? `\n_${config.Nota_Envio_MRW}_` : '';
  return reply(
    'Perfecto 📦 Envíame en un solo mensaje: nombre y cédula de quien recibe, teléfono, ciudad y agencia MRW.' + nota
  );
}

async function onDireccion(ctx, input, text) {
  if (input.kind !== 'text' || text.length < 10) {
    return ctx.reply('Necesito los datos de envío completos en un solo mensaje de texto, por favor 🙏');
  }
  ctx.state.direccion = text.slice(0, 500);
  await ctx.reply('¡Anotado! ✍️');
  return askTipoPago(ctx);
}

// ---------------------------------------------------------------- PAGO

async function askTipoPago(ctx) {
  const { phone, state, config, deps, save, now } = ctx;
  const porcentaje = cfgNum(config, 'Porcentaje_Adelanto', 60);
  const rate = await deps.rates.getRate(config);
  state.porcentaje = porcentaje;
  state.rate = rate; // { tasa, fuente, fecha } | null — la cotización queda congelada con esta tasa
  state.quotedAt = now.getTime();

  const full = computeQuote({ subtotal: state.cart.subtotal, envio: state.envio, tipoPago: 'FULL', tasa: rate?.tasa });

  // Si la dueña pone 100% como adelanto, no hay nada que elegir.
  if (porcentaje >= 100) {
    state.tipoPago = 'FULL';
    return askMetodo(ctx, `Total de tu pedido: *${usd(full.total)}*${vesLabel(full.totalVES, rate)}.\n\n`);
  }

  const adel = computeQuote({ subtotal: state.cart.subtotal, envio: state.envio, porcentaje, tipoPago: 'ADEL', tasa: rate?.tasa });
  const envioTxt = state.envio ? ` (incluye ${ENTREGA_LABEL[state.entrega].toLowerCase()} ${usd(state.envio)})` : '';
  const cuando = state.entrega === 'RETIRO' ? 'al retirar' : 'antes del despacho';

  let body = `Total de tu pedido: *${usd(full.total)}*${envioTxt}${vesLabel(full.totalVES, rate)}.\n\n`;
  body += 'Para iniciar tu pedido puedes:\n';
  body += `• Pagar el *100%*: ${usd(full.pagar)}${full.pagarVES ? ' / ' + ves(full.pagarVES) : ''}\n`;
  body += `• Pagar un *adelanto del ${porcentaje}%*: ${usd(adel.pagar)}${adel.pagarVES ? ' / ' + ves(adel.pagarVES) : ''} y el restante (${usd(adel.restante)}) ${cuando}.`;
  if (!rate) body += '\n\n_No pude consultar la tasa BCV en este momento; si pagas en bolívares te confirmamos el monto exacto._';

  state.step = 'ESPERANDO_TIPO_PAGO';
  await save(state);
  return deps.wa.sendButtons(phone, body, [
    { id: 'PAGO_FULL', title: 'Pagar 100%' },
    { id: 'PAGO_ADEL', title: `Adelanto ${porcentaje}%` },
  ]);
}

function vesLabel(amount, rate) {
  if (!amount || !rate) return '';
  const fecha = rateDateLabel(rate.fecha);
  return ` (${ves(amount)} · tasa BCV ${fmtNum(rate.tasa)}${fecha ? ' del ' + fecha : ''})`;
}

async function onTipoPago(ctx, input, t) {
  let tipo = null;
  if (input.id === 'PAGO_FULL' || /\b(100|completo|total|todo)\b/.test(t)) tipo = 'FULL';
  else if (input.id === 'PAGO_ADEL' || /adelant|abono|inicial|\d{1,2}\s*%|^\d{1,2}$/.test(t)) tipo = 'ADEL';
  if (!tipo) {
    return ctx.deps.wa.sendButtons(ctx.phone, '¿Vas a pagar el total o el adelanto? 👇', [
      { id: 'PAGO_FULL', title: 'Pagar 100%' },
      { id: 'PAGO_ADEL', title: `Adelanto ${ctx.state.porcentaje}%` },
    ]);
  }
  ctx.state.tipoPago = tipo;
  return askMetodo(ctx, '');
}

function metodosActivos(config) {
  return cfgList(config, 'Metodos_Activos', ['Pago Móvil', 'Zelle']);
}

async function askMetodo(ctx, prefix) {
  const { phone, state, config, deps, save } = ctx;
  state.step = 'ESPERANDO_METODO';
  await save(state);
  const metodos = metodosActivos(config);
  const body = prefix + '¿Con qué método vas a pagar?';
  const options = metodos.map((m, i) => ({ id: `MET_${i}`, title: m }));
  if (options.length <= 3) return deps.wa.sendButtons(phone, body, options);
  return deps.wa.sendList(phone, body, 'Ver métodos', options);
}

function parseMetodo(config, input, t) {
  const metodos = metodosActivos(config);
  if (input.id?.startsWith('MET_')) return metodos[Number(input.id.slice(4))] || null;
  const s = slug(t);
  if (s.length < 4) return null;
  // "pago movil" / "movil" -> "Pago Móvil"; "efectivo" -> "Efectivo USD"
  return metodos.find((m) => slug(m) === s) || metodos.find((m) => s.includes(slug(m)) || slug(m).includes(s)) || null;
}

async function onMetodo(ctx, input, t) {
  const { phone, state, config, reply, save } = ctx;
  const metodo = parseMetodo(config, input, t);
  if (!metodo) return askMetodo(ctx, 'No reconocí ese método 🤔 ');

  state.metodo = metodo;
  state.step = 'ESPERANDO_COMPROBANTE';
  await save(state);
  return reply(paymentMessage(state, config));
}

function paymentMessage(state, config) {
  const q = quoteFor(state);
  const enBs = isVesMethod(config, state.metodo);
  const datos = paymentDetails(config, state.metodo) || '_Te enviaremos los datos en breve._';
  const desc = q.porcentaje < 100 ? `${q.porcentaje}% de ${usd(q.total)}` : `100% de ${usd(q.total)}`;

  let body = `Datos para *${state.metodo}* 💳\n${datos}\n\n`;
  if (enBs && state.rate) {
    body += `*Monto a pagar: ${ves(q.pagarVES)}* (${desc} a tasa BCV ${fmtNum(state.rate.tasa)})`;
  } else if (enBs) {
    body += `*Monto a pagar: ${usd(q.pagar)}* (${desc}). En este momento no pude consultar la tasa BCV; una persona te confirmará el monto exacto en bolívares 🙏`;
  } else {
    body += `*Monto a pagar: ${usd(q.pagar)}* (${desc})`;
  }
  body += '\n\nCuando pagues, envíame aquí la *foto o captura del comprobante* 📸';
  return body;
}

function quoteFor(state) {
  return computeQuote({
    subtotal: state.cart.subtotal,
    envio: state.envio,
    porcentaje: state.porcentaje,
    tipoPago: state.tipoPago,
    tasa: state.rate?.tasa,
  });
}

// ---------------------------------------------------------------- COMPROBANTE

async function onComprobante(ctx, input, msg) {
  const { state, config, deps, reply, save, now } = ctx;

  if (input.kind !== 'media') {
    return reply('¡Genial! Solo me falta la *foto o captura del comprobante* para registrar tu pedido 📸 Envíala por aquí.');
  }

  // Cotización vencida: se recalcula con la tasa actual antes de registrar.
  if (now.getTime() - (state.quotedAt || 0) > QUOTE_MAX_AGE_MS) {
    state.rate = await deps.rates.getRate(config);
    state.porcentaje = state.tipoPago === 'FULL' ? state.porcentaje : cfgNum(config, 'Porcentaje_Adelanto', state.porcentaje);
    state.quotedAt = now.getTime();
    await save(state);
    return reply(
      'Tu cotización tenía más de 24 horas, así que la actualicé con la tasa de hoy 🔄\n\n' +
        paymentMessage(state, config) +
        '\n\n_Si ya pagaste con el monto anterior, envía de nuevo el comprobante y lo revisamos._'
    );
  }

  await deps.wa.markRead?.(msg.id);

  let urlComprobante = '';
  try {
    const file = await deps.wa.downloadMedia(input.media.id);
    urlComprobante = await deps.sheets.uploadReceipt({
      ...file,
      fileName: `comprobante_${ctx.phone}_${now.getTime()}`,
    });
  } catch (err) {
    // No perdemos el pedido por un fallo al subir la imagen: queda en el chat de WhatsApp.
    console.error('Comprobante no subido:', err.message);
    urlComprobante = 'PENDIENTE: ver comprobante en WhatsApp';
  }

  const q = quoteFor(state);
  const enBs = isVesMethod(config, state.metodo);
  const items = state.cart.items;
  const order = {
    Fecha: now.toISOString(),
    Cliente: state.nombre || '',
    Telefono: ctx.phone,
    Pedido: describeItems(items) + (state.cart.notaGeneral ? ` · Nota: ${state.cart.notaGeneral}` : ''),
    Items_JSON: JSON.stringify(items.map(({ id, qty, precio, nota }) => ({ id, qty, precio, nota }))),
    Subtotal_USD: state.cart.subtotal,
    Envio_USD: state.envio || 0,
    Total_USD: q.total,
    Tipo_Pago: state.tipoPago === 'FULL' ? 'Completo' : 'Adelanto',
    Porcentaje_Pagado: q.porcentaje,
    Monto_Pagado_USD: q.pagar,
    Restante_USD: q.restante,
    Metodo_Pago: state.metodo,
    Tasa_BCV: state.rate?.tasa ?? '',
    Monto_Pagado_VES: enBs && q.pagarVES ? q.pagarVES : '',
    Modalidad_Entrega: ENTREGA_LABEL[state.entrega],
    Direccion_Envio: state.direccion || '',
    URL_Comprobante: urlComprobante,
    Estatus: 'Pago por verificar',
  };

  let trackId = null;
  for (let i = 0; i < MAX_ID_ATTEMPTS && !trackId; i++) {
    const candidate = generateTrackId(items, now);
    const res = await deps.sheets.createOrder({ ...order, Track_ID: candidate });
    if (res.ok) trackId = candidate;
  }
  if (!trackId) throw new Error('No se pudo generar un Track_ID único');

  await save(newState(state.nombre));

  let body = `¡Pedido registrado! 🙌\nTu número de seguimiento es: *${trackId}*\n\n`;
  body += `Consulta el estado de tu pedido cuando quieras aquí:\n👉 ${trackingUrl(config, trackId)}\n\n`;
  body += 'Estado actual: _Pago por verificar_. Te avisaremos cuando confirmemos tu pago.';
  if (q.restante > 0) {
    body += `\nRestante a pagar ${state.entrega === 'RETIRO' ? 'al retirar' : 'antes del despacho'}: *${usd(q.restante)}*.`;
  }
  if (state.entrega === 'MRW') body += '\nEl número de guía MRW aparecerá en el link cuando enviemos tu paquete.';
  return reply(body);
}

// ---------------------------------------------------------------- helpers

function catalogUrl(config) {
  return config.URL_Catalogo || 'https://zonau.example.com';
}

function trackingUrl(config, id) {
  const base = config.URL_Tracking || catalogUrl(config).replace(/\/$/, '') + '/tracking.html';
  return id ? `${base}?id=${encodeURIComponent(id)}` : base;
}

function horario(config) {
  return config.Horario_Atencion ? `\nHorario de atención: ${config.Horario_Atencion}` : '';
}

function firstName(nombre) {
  return String(nombre || '').trim().split(/\s+/)[0] || '';
}
