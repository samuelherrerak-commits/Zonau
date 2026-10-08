// Página del catálogo: render de productos, filtros, carrito y checkout por WhatsApp.
import { getCatalog } from './api.js';
import { WHATSAPP_FALLBACK } from './config.js';
import { el, usd, waNumber } from './util.js';
import * as cart from './cart.js';

const $ = (s) => document.querySelector(s);
const grid = $('#grid');
const chips = $('#chips');
const stateBox = $('#catalog-state');
const dialog = $('#cart-dialog');

let products = [];
let config = {};
let filter = 'Todos';
const cards = new Map(); // id -> { card, actions, hadQty }

init();

async function init() {
  bindCartUI();
  try {
    ({ productos: products, config } = await getCatalog());
  } catch (err) {
    console.error(err);
    return showState('No pudimos cargar el catálogo', 'Revisa tu conexión e intenta de nuevo.', true);
  }
  cart.prune(products);
  applyConfig();
  renderChips();
  renderGrid();
  updateCartUI();
}

function applyConfig() {
  const pct = Number(config.Porcentaje_Adelanto) || 60;
  document.querySelectorAll('[data-pct]').forEach((n) => (n.textContent = pct));
  const fab = $('#wa-fab');
  const text = `Hola ${config.Nombre_Tienda || 'Zonau'}! Quiero información 🖤`;
  fab.href = cart.waLink(waNumber(config, WHATSAPP_FALLBACK), text);
  if (config.Instagram) $('#ig-link').href = `https://instagram.com/${String(config.Instagram).replace('@', '')}`;
}

// ---------------------------------------------------------------- render

function showState(title, msg, retry) {
  grid.replaceChildren();
  grid.setAttribute('aria-busy', 'false');
  stateBox.hidden = false;
  stateBox.replaceChildren(
    el('h3', {}, title),
    el('p', { class: 'muted' }, msg),
    retry ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'Reintentar') : null
  );
}

function renderChips() {
  const cats = ['Todos', ...new Set(products.map((p) => p.categoria).filter(Boolean))];
  chips.hidden = cats.length < 3;
  chips.replaceChildren(
    ...cats.map((c) =>
      el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(c === filter),
        onclick: () => { filter = c; renderChips(); renderGrid(); },
      }, c)
    )
  );
}

function renderGrid() {
  grid.setAttribute('aria-busy', 'false');
  const visible = products.filter((p) => filter === 'Todos' || p.categoria === filter);
  if (!products.length) return showState('Catálogo en preparación', 'Pronto tendremos productos aquí. Escríbenos por WhatsApp mientras tanto.');
  stateBox.hidden = true;
  cards.clear();
  grid.replaceChildren(...visible.map(productCard));
}

function productCard(p) {
  const media = el('div', { class: 'card-media' },
    p.imagen ? el('img', { src: p.imagen, alt: p.nombre, loading: 'lazy', width: 600, height: 600, onerror: (e) => e.target.replaceWith(placeholder(p)) }) : placeholder(p),
    p.categoria ? el('span', { class: 'card-tag' }, p.categoria) : null
  );
  const body = el('div', { class: 'card-body' },
    el('h3', { class: 'card-title' }, p.nombre),
    p.descripcion ? el('p', { class: 'card-desc' }, p.descripcion) : null,
    el('div', { class: 'card-meta' },
      el('span', { class: 'price' }, usd(p.precio)),
      p.tiempoEntrega ? el('span', { class: 'eta' }, '⏱ ' + p.tiempoEntrega) : null
    )
  );
  const actions = el('div', { class: 'card-actions' });
  const card = el('article', { class: 'card', 'aria-label': p.nombre }, media, body, actions);
  const entry = { card, actions, p, hadQty: null };
  cards.set(p.id, entry);
  renderActions(entry);
  return card;
}

function placeholder(p) {
  return el('div', { class: 'card-placeholder', 'aria-hidden': 'true' }, p.categoria || p.nombre);
}

function stepper(id, label) {
  const { qty } = cart.getItem(id);
  return el('div', { class: 'stepper', role: 'group', 'aria-label': `Cantidad de ${label}` },
    el('button', { type: 'button', 'aria-label': 'Quitar uno', onclick: () => cart.setQty(id, cart.getItem(id).qty - 1) }, '−'),
    el('output', { 'aria-live': 'polite' }, String(qty)),
    el('button', { type: 'button', 'aria-label': 'Agregar uno', onclick: () => cart.setQty(id, cart.getItem(id).qty + 1) }, '+')
  );
}

// Solo re-renderiza si el producto entra o sale del carrito, para no perder el foco del textarea.
function renderActions(entry) {
  const { p, actions, card } = entry;
  const { qty, nota } = cart.getItem(p.id);
  const has = qty > 0;
  card.classList.toggle('in-cart', has);
  if (entry.hadQty === has) {
    const out = actions.querySelector('output');
    if (out) out.textContent = String(qty);
    return;
  }
  entry.hadQty = has;
  if (!has) {
    actions.replaceChildren(
      el('button', { class: 'btn btn-primary add-btn', type: 'button', onclick: () => cart.setQty(p.id, 1) }, 'Agregar +')
    );
    return;
  }
  const noteId = `nota-${p.id}`;
  actions.replaceChildren(
    stepper(p.id, p.nombre),
    p.personalizable ? el('label', { class: 'note-label', for: noteId }, 'Detalles de personalización') : null,
    p.personalizable
      ? el('textarea', {
          class: 'note-field', id: noteId, maxlength: 200, rows: 2,
          placeholder: 'Color, talla, texto, foto que enviarás…',
          oninput: (e) => cart.setNota(p.id, e.target.value),
        })
      : null
  );
  const ta = actions.querySelector('textarea');
  if (ta) ta.value = nota;
}

// ---------------------------------------------------------------- carrito

function bindCartUI() {
  cart.onChange(() => {
    cards.forEach(renderActions);
    updateCartUI();
    if (dialog.open) renderDrawer();
  });
  $('#open-cart').addEventListener('click', () => {
    renderDrawer();
    dialog.showModal();
  });
  $('#close-cart').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  $('#clear-cart').addEventListener('click', () => {
    if (confirm('¿Vaciar tu pedido?')) { cart.clear(); dialog.close(); }
  });
  $('#checkout').addEventListener('click', (e) => {
    const { count } = cart.totals(products);
    if (!count) { e.preventDefault(); return; }
    e.currentTarget.href = cart.waLink(waNumber(config, WHATSAPP_FALLBACK), cart.buildMessage(products, config.Nombre_Tienda || 'Zonau'));
  });
}

function updateCartUI() {
  const { count, total } = cart.totals(products);
  $('#cart-bar').hidden = count === 0;
  document.body.classList.toggle('has-cart', count > 0);
  $('#cart-count').textContent = `${count} ${count === 1 ? 'producto' : 'productos'}`;
  $('#cart-total').textContent = usd(total);
  $('#drawer-total').textContent = usd(total);
  if (count === 0 && dialog.open) dialog.close();
}

function renderDrawer() {
  const ls = cart.lines(products);
  $('#cart-lines').replaceChildren(
    ...ls.map((l) =>
      el('li', { class: 'cart-line' },
        el('span', { class: 'cart-line-name' }, `${l.qty}x ${l.nombre}`),
        el('span', { class: 'cart-line-price' }, usd(l.subtotal)),
        l.nota ? el('span', { class: 'cart-line-note' }, l.nota) : null,
        stepper(l.id, l.nombre)
      )
    )
  );
}
