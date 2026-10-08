// Tasa oficial BCV (Bs. por USD) con caché y cadena de respaldos.
//
// Orden: Fuente_Tasa numérica en Configuracion (forzada por la dueña)
//        -> caché fresca (30 min) -> API principal -> API secundaria
//        -> última tasa válida guardada -> Tasa_Manual -> null

const FRESH_KEY = 'rate:fresh';
const BACKUP_KEY = 'rate:backup';
const FRESH_TTL = 30 * 60;

// Cada proveedor aísla su propio parseo para poder cambiarlo sin tocar el resto.
export const PROVIDERS = [
  {
    name: 'dolarapi (BCV)',
    url: 'https://ve.dolarapi.com/v1/dolares/oficial',
    parse: (j) => ({ tasa: Number(j.promedio), fecha: j.fechaActualizacion }),
  },
  {
    name: 'open.er-api',
    url: 'https://open.er-api.com/v6/latest/USD',
    parse: (j) => ({
      tasa: j.result === 'success' ? Number(j.rates?.VES) : NaN,
      fecha: j.time_last_update_unix ? new Date(j.time_last_update_unix * 1000).toISOString() : null,
    }),
  },
];

const valid = (t) => Number.isFinite(t) && t > 0;

/**
 * @returns {Promise<{tasa:number, fuente:string, fecha:string|null} | null>}
 */
export async function getRate(config, { kv, fetchFn = fetch, providers = PROVIDERS } = {}) {
  const forced = Number(String(config?.Fuente_Tasa ?? '').replace(',', '.'));
  if (valid(forced)) return { tasa: forced, fuente: 'Manual (Configuracion)', fecha: null };

  const cached = kv && (await kv.get(FRESH_KEY, 'json'));
  if (cached && valid(cached.tasa)) return cached;

  for (const p of providers) {
    try {
      const res = await fetchFn(p.url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { tasa, fecha } = p.parse(await res.json());
      if (!valid(tasa)) throw new Error('tasa inválida');
      const rate = { tasa, fuente: p.name, fecha: fecha || null };
      if (kv) {
        await kv.put(FRESH_KEY, JSON.stringify(rate), { expirationTtl: FRESH_TTL });
        await kv.put(BACKUP_KEY, JSON.stringify(rate));
      }
      return rate;
    } catch (err) {
      console.error(`Tasa: falló ${p.name}:`, err.message);
    }
  }

  const backup = kv && (await kv.get(BACKUP_KEY, 'json'));
  if (backup && valid(backup.tasa)) return { ...backup, fuente: backup.fuente + ' (última conocida)' };

  const manual = Number(String(config?.Tasa_Manual ?? '').replace(',', '.'));
  if (valid(manual)) return { tasa: manual, fuente: 'Tasa_Manual', fecha: null };

  return null;
}

// "2026-10-08T00:00:00-04:00" -> "08/10"
export function rateDateLabel(fecha) {
  if (!fecha) return '';
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit' }).format(d);
}
