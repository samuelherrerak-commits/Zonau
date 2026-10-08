// Formateo de montos y utilidades de texto.

export const toCents = (n) => Math.round(Number(n) * 100);

// 1234.5 -> "1.234,50" (formato venezolano, sin depender de ICU)
export function fmtNum(n) {
  const cents = Math.round(Math.abs(Number(n)) * 100);
  const int = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = String(cents % 100).padStart(2, '0');
  return (Number(n) < 0 ? '-' : '') + int + ',' + dec;
}

export const usd = (n) => '$' + fmtNum(n);
export const ves = (n) => 'Bs. ' + fmtNum(n);

// "Pago Móvil" -> "pagomovil"
export function slug(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// minúsculas, sin acentos, espacios simples
export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Fecha corta dd/mm en hora de Caracas
export function ddmmCaracas(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Caracas',
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { day: get('day'), month: get('month') };
}
