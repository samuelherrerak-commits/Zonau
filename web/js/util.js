// Crea elementos sin innerHTML: todo texto del Sheet entra como textContent.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// 1234.5 -> "1.234,50"
export function fmtNum(n) {
  const cents = Math.round(Math.abs(Number(n)) * 100);
  const int = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return int + ',' + String(cents % 100).padStart(2, '0');
}
export const usd = (n) => '$' + fmtNum(n);

export function waNumber(config, fallback) {
  return String(config?.WhatsApp_Ventas || fallback).replace(/\D/g, '');
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(d);
}
