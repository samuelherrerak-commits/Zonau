import { describe, it, expect } from 'vitest';
import { parsePedido, buildCart, computeQuote, paymentDetails, isVesMethod, longestDelivery } from '../src/order.js';
import { fmtNum, usd, ves } from '../src/format.js';
import { CATALOG, CONFIG, CART_MESSAGE } from './helpers.js';

describe('parsePedido', () => {
  it('lee la línea #PEDIDO y las notas por ítem', () => {
    const p = parsePedido(CART_MESSAGE);
    expect(p.items).toEqual([
      { id: 'CAM-01', qty: 2, nota: 'negra, logo en el pecho' },
      { id: 'TAZ-01', qty: 1, nota: '' },
    ]);
  });

  it('funciona aunque el cliente borre el texto legible', () => {
    expect(parsePedido('#pedido cam-01*3').items).toEqual([{ id: 'CAM-01', qty: 3, nota: '' }]);
  });

  it('limita la cantidad y une IDs repetidos', () => {
    expect(parsePedido('#PEDIDO TAZ-01*40|TAZ-01*40').items[0].qty).toBe(50);
  });

  it('devuelve null si no hay #PEDIDO', () => {
    expect(parsePedido('hola, precio de las tazas?')).toBeNull();
  });
});

describe('buildCart', () => {
  it('toma los precios del catálogo, no del mensaje', () => {
    const cart = buildCart(parsePedido('• 2x Camisa — $1\n#PEDIDO CAM-01*2'), CATALOG);
    expect(cart.subtotal).toBe(30);
  });

  it('descarta productos inexistentes o inactivos', () => {
    const cart = buildCart(parsePedido('#PEDIDO LLA-07*1|XXX-99*1|TAZ-01*1'), CATALOG);
    expect(cart.items.map((i) => i.id)).toEqual(['TAZ-01']);
    expect(cart.unavailable).toEqual(['LLA-07', 'XXX-99']);
  });

  it('calcula el tiempo de entrega más largo', () => {
    expect(longestDelivery(buildCart(parsePedido(CART_MESSAGE), CATALOG).items)).toBe('3 días hábiles');
  });
});

describe('computeQuote', () => {
  it('100%', () => {
    expect(computeQuote({ subtotal: 40, envio: 0, tipoPago: 'FULL', porcentaje: 60, tasa: 365 })).toEqual({
      total: 40, pagar: 40, restante: 0, porcentaje: 100, totalVES: 14600, pagarVES: 14600,
    });
  });

  it('adelanto 60% con delivery', () => {
    const q = computeQuote({ subtotal: 40, envio: 3, tipoPago: 'ADEL', porcentaje: 60, tasa: 365 });
    expect(q).toMatchObject({ total: 43, pagar: 25.8, restante: 17.2, pagarVES: 9417 });
  });

  it('redondea a céntimos y pagado + restante = total', () => {
    const q = computeQuote({ subtotal: 9.99, envio: 0, tipoPago: 'ADEL', porcentaje: 60, tasa: 874.7321 });
    expect(q.pagar).toBe(5.99);
    expect(Math.round((q.pagar + q.restante) * 100)).toBe(999);
    expect(q.pagarVES).toBe(5239.65);
  });

  it('sin tasa no calcula bolívares', () => {
    expect(computeQuote({ subtotal: 10, tipoPago: 'FULL', tasa: null }).pagarVES).toBeNull();
  });
});

describe('configuración', () => {
  it('encuentra los datos del método sin importar acentos', () => {
    expect(paymentDetails(CONFIG, 'Pago Móvil')).toContain('0102');
    expect(paymentDetails(CONFIG, 'Binance')).toBe('');
  });

  it('sabe qué métodos se pagan en bolívares', () => {
    expect(isVesMethod(CONFIG, 'Pago Movil')).toBe(true);
    expect(isVesMethod(CONFIG, 'Zelle')).toBe(false);
  });
});

describe('formato', () => {
  it('formatea al estilo venezolano', () => {
    expect(fmtNum(1234567.891)).toBe('1.234.567,89');
    expect(usd(40)).toBe('$40,00');
    expect(ves(14600)).toBe('Bs. 14.600,00');
  });
});
