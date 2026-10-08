import { describe, it, expect } from 'vitest';
import { getRate, PROVIDERS } from '../src/rates.js';

function memoryKV() {
  const m = new Map();
  return {
    get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => m.set(k, v),
    delete: async (k) => m.delete(k),
    m,
  };
}

const ok = (body) => ({ ok: true, json: async () => body });
const fail = () => {
  throw new Error('network');
};

describe('getRate', () => {
  it('usa la tasa forzada en Configuracion', async () => {
    expect((await getRate({ Fuente_Tasa: '400,5' }, { fetchFn: fail })).tasa).toBe(400.5);
  });

  it('lee dolarapi', async () => {
    const r = await getRate({}, { kv: memoryKV(), fetchFn: async () => ok({ promedio: 874.7321, fechaActualizacion: '2026-10-08T00:00:00-04:00' }) });
    expect(r).toMatchObject({ tasa: 874.7321, fuente: 'dolarapi (BCV)' });
  });

  it('cae al segundo proveedor', async () => {
    const fetchFn = async (url) => (url === PROVIDERS[0].url ? fail() : ok({ result: 'success', rates: { VES: 870 }, time_last_update_unix: 1 }));
    expect((await getRate({}, { kv: memoryKV(), fetchFn })).tasa).toBe(870);
  });

  it('usa la última tasa conocida y luego Tasa_Manual', async () => {
    const kv = memoryKV();
    kv.m.set('rate:backup', JSON.stringify({ tasa: 860, fuente: 'x', fecha: null }));
    expect((await getRate({}, { kv, fetchFn: fail })).tasa).toBe(860);
    expect((await getRate({ Tasa_Manual: 850 }, { kv: memoryKV(), fetchFn: fail })).tasa).toBe(850);
    expect(await getRate({}, { kv: memoryKV(), fetchFn: fail })).toBeNull();
  });
});
