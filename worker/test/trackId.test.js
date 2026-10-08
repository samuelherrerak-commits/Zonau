import { describe, it, expect } from 'vitest';
import { generateTrackId, ALPHABET, TRACK_ID_RE, mainItem, normalizeTrackId } from '../src/trackId.js';

const items = [
  { id: 'TAZ-01', precio: 10, qty: 1 },
  { id: 'CAM-01', precio: 15, qty: 2 },
];

describe('generateTrackId', () => {
  it('tiene el formato PREFIJO-DDMM-XXX', () => {
    const id = generateTrackId(items, new Date('2026-10-08T15:00:00Z'));
    expect(id).toMatch(TRACK_ID_RE);
    expect(id.startsWith('CAM-0810-')).toBe(true);
  });

  it('el alfabeto no contiene O, 0, I ni 1', () => {
    expect(ALPHABET).toHaveLength(32);
    expect(ALPHABET).not.toMatch(/[O0I1]/);
    for (let i = 0; i < 500; i++) {
      expect(generateTrackId(items).slice(-3)).not.toMatch(/[O0I1]/);
    }
  });

  it('usa el producto con mayor subtotal como prefijo, y el primero en empate', () => {
    expect(mainItem(items).id).toBe('CAM-01');
    expect(mainItem([{ id: 'LLA-01', precio: 5, qty: 2 }, { id: 'TAZ-01', precio: 10, qty: 1 }]).id).toBe('LLA-01');
  });

  it('usa la fecha de Caracas, no UTC (10:30 pm del 8 = 02:30 UTC del 9)', () => {
    const id = generateTrackId(items, new Date('2026-10-09T02:30:00Z'));
    expect(id.slice(4, 8)).toBe('0810');
  });

  it('mapea bytes al alfabeto de forma determinista', () => {
    const id = generateTrackId(items, new Date('2026-10-08T15:00:00Z'), () => new Uint8Array([0, 33, 255]));
    expect(id).toBe('CAM-0810-AB9');
  });

  it('normaliza lo que escribe el cliente', () => {
    expect(normalizeTrackId(' cam-0810-k9r ')).toBe('CAM-0810-K9R');
  });
});
