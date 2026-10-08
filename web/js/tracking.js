// Página de seguimiento: consulta el Track_ID y dibuja la línea de tiempo.
import { getTracking, getCatalog } from './api.js';
import { MRW_TRACKING_URL, WHATSAPP_FALLBACK } from './config.js';
import { el, usd, formatDate, waNumber } from './util.js';

const TRACK_ID_RE = /^[A-Z]{3}-\d{4}-[A-HJ-NP-Z2-9]{3}$/;

const FLOWS = {
  Retiro: ['Pago por verificar', 'En proceso', 'Listo para retirar', 'Entregado'],
  Delivery: ['Pago por verificar', 'En proceso', 'Listo para despacho', 'Enviado', 'Entregado'],
  'Envío MRW': ['Pago por verificar', 'En proceso', 'Listo para despacho', 'Enviado', 'Entregado'],
};

const DESCRIPTIONS = {
  'Pago por verificar': 'Recibimos tu comprobante y lo estamos verificando.',
  'En proceso': 'Pago confirmado. Estamos personalizando tu pedido.',
  'Listo para retirar': '¡Tu pedido está listo! Puedes pasar a retirarlo.',
  'Listo para despacho': 'Tu pedido está listo y en preparación para el envío.',
  Enviado: 'Tu pedido va en camino.',
  Entregado: 'Pedido entregado. ¡Gracias por tu compra! 🖤',
};

const form = document.querySelector('#track-form');
const input = document.querySelector('#track-id');
const result = document.querySelector('#track-result');

const normalize = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  lookup(normalize(input.value));
});

const initial = normalize(new URLSearchParams(location.search).get('id'));
if (initial) {
  input.value = initial;
  lookup(initial);
}

async function lookup(id) {
  input.value = id;
  if (!TRACK_ID_RE.test(id)) {
    return message('Revisa el número', 'El formato es 3 letras, 4 números y 3 caracteres. Ej: CAM-0810-K9R.');
  }
  const url = new URL(location.href);
  url.searchParams.set('id', id);
  history.replaceState(null, '', url);

  result.replaceChildren(el('p', { class: 'muted' }, 'Buscando tu pedido…'));
  try {
    const res = await getTracking(id);
    if (!res.ok) {
      return message('No encontramos ese pedido', 'Verifica el número que te enviamos por WhatsApp. Si acabas de pagar, puede tardar unos minutos en aparecer.');
    }
    render(res.data);
  } catch (err) {
    console.error(err);
    message('No pudimos consultar', 'Revisa tu conexión e intenta de nuevo.');
  }
}

function message(title, text) {
  result.replaceChildren(el('div', { class: 'state' }, el('h3', {}, title), el('p', { class: 'muted' }, text)));
}

function render(o) {
  const cancelled = o.estatus === 'Cancelado';
  const flow = FLOWS[o.modalidad] || FLOWS.Retiro;
  const current = flow.indexOf(o.estatus);

  const timeline = cancelled
    ? null
    : el('ol', { class: 'timeline', 'aria-label': 'Progreso del pedido' },
        flow.map((s, i) => {
          const done = i < current || (i === current && s === 'Entregado');
          const cls = done ? 'tl-step done' : i === current ? 'tl-step current' : 'tl-step';
          return el('li', { class: cls, 'aria-current': i === current ? 'step' : false },
            el('span', { class: 'tl-dot', 'aria-hidden': 'true' }, done ? '✓' : String(i + 1)),
            el('div', {},
              el('p', { class: 'tl-title' }, done && s === 'Pago por verificar' ? 'Pago verificado' : s),
              i === current ? el('p', { class: 'tl-desc' }, DESCRIPTIONS[s] || '') : null
            )
          );
        })
      );

  result.replaceChildren(
    el('article', { class: 'track-card' },
      el('header', { class: 'track-card-head' },
        el('span', { class: 'label' }, 'Pedido'),
        el('span', { class: 'track-id' }, o.trackId),
        el('span', { class: 'track-status' + (cancelled ? ' is-cancel' : '') }, o.estatus)
      ),
      el('dl', { class: 'track-details' },
        o.cliente ? [el('dt', {}, 'Cliente'), el('dd', {}, o.cliente)] : null,
        [el('dt', {}, 'Pedido'), el('dd', {}, o.pedido)],
        [el('dt', {}, 'Entrega'), el('dd', {}, o.modalidad || '—')],
        o.fecha ? [el('dt', {}, 'Fecha'), el('dd', {}, formatDate(o.fecha))] : null,
        o.actualizado ? [el('dt', {}, 'Actualizado'), el('dd', {}, formatDate(o.actualizado))] : null
      ),
      cancelled ? el('div', { class: 'alert' }, el('p', {}, 'Este pedido fue cancelado. Si tienes dudas, escríbenos por WhatsApp.'), waButton(o, 'Escribir por WhatsApp')) : null,
      balanceAlert(o),
      timeline,
      guideBox(o)
    )
  );
}

function balanceAlert(o) {
  const listo = o.estatus === 'Listo para retirar' || o.estatus === 'Listo para despacho';
  if (!listo || !(o.restanteUSD > 0)) return null;
  const accion = o.estatus === 'Listo para retirar' ? 'retirarlo' : 'despacharlo';
  return el('div', { class: 'alert', role: 'status' },
    el('p', {}, el('strong', {}, '¡Tu pedido está listo! '), `Recuerda pagar el restante de ${usd(o.restanteUSD)} para ${accion}.`),
    waButton(o, 'Pagar restante por WhatsApp', `Hola! Quiero pagar el restante de mi pedido ${o.trackId}`)
  );
}

function guideBox(o) {
  if (o.modalidad !== 'Envío MRW' || !o.guiaMRW) return null;
  const copy = el('button', { class: 'btn', type: 'button' }, 'Copiar guía');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(o.guiaMRW);
      copy.textContent = '¡Copiada!';
    } catch {
      copy.textContent = o.guiaMRW;
    }
  });
  return el('div', { class: 'guide-box' },
    el('span', { class: 'label' }, 'Guía MRW'),
    el('span', { class: 'guide-num' }, o.guiaMRW),
    el('div', { class: 'guide-actions' },
      copy,
      el('a', { class: 'btn btn-primary', href: MRW_TRACKING_URL, target: '_blank', rel: 'noopener' }, 'Rastrear en MRW ↗')
    )
  );
}

let waNum = null;
function waButton(o, label, text = `Hola! Tengo una consulta sobre mi pedido ${o.trackId}`) {
  const a = el('a', { class: 'btn btn-wa', target: '_blank', rel: 'noopener', href: `https://wa.me/${WHATSAPP_FALLBACK}?text=${encodeURIComponent(text)}` }, label);
  // El número real viene de Configuracion (vía getCatalog, que está en caché).
  (waNum ? Promise.resolve(waNum) : getCatalog().then((d) => (waNum = waNumber(d.config, WHATSAPP_FALLBACK))))
    .then((n) => (a.href = `https://wa.me/${n}?text=${encodeURIComponent(text)}`))
    .catch(() => {});
  return a;
}
