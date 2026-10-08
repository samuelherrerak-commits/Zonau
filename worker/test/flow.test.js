// Recorre las conversaciones de docs/conversaciones.md.
import { describe, it, expect } from 'vitest';
import { handleMessage } from '../src/flow.js';
import { TRACK_ID_RE } from '../src/trackId.js';
import { makeDeps, text, button, image, CONTACT, CART_MESSAGE, PHONE } from './helpers.js';

const last = (deps) => deps.sent[deps.sent.length - 1];
const step = (deps) => deps.states.get(PHONE)?.step;

describe('A) cliente sin carrito', () => {
  it('responde con bienvenida y link al catálogo', async () => {
    const deps = makeDeps();
    await handleMessage(text('Hola, ¿qué precio tienen las tazas?'), CONTACT, deps);
    expect(last(deps).text).toContain('https://zonau.example.com');
    expect(last(deps).text).toContain('Pedir por WhatsApp');
  });
});

describe('B) pedido con adelanto 60% y envío MRW', () => {
  it('recorre todo el flujo y registra el pedido', async () => {
    const deps = makeDeps();

    await handleMessage(text(CART_MESSAGE), CONTACT, deps);
    expect(step(deps)).toBe('ESPERANDO_ENTREGA');
    expect(last(deps).type).toBe('buttons');
    expect(last(deps).text).toContain('¡Recibido, Samuel!');
    expect(last(deps).text).toContain('Subtotal: $40,00');
    expect(last(deps).text).toContain('3 días hábiles');

    await handleMessage(button('ENT_MRW', 'Envío MRW'), CONTACT, deps);
    expect(step(deps)).toBe('ESPERANDO_DIRECCION');
    expect(last(deps).text).toContain('agencia MRW');

    await handleMessage(text('Samuel Herrera, V-12.345.678, 0414-1234567, Valencia, MRW Av. Bolívar Norte'), CONTACT, deps);
    expect(step(deps)).toBe('ESPERANDO_TIPO_PAGO');
    const quote = last(deps);
    expect(quote.text).toContain('Bs. 14.600,00');
    expect(quote.text).toContain('$24,00 / Bs. 8.760,00');
    expect(quote.text).toContain('restante ($16,00) antes del despacho');
    expect(quote.buttons.map((b) => b.title)).toEqual(['Pagar 100%', 'Adelanto 60%']);

    await handleMessage(button('PAGO_ADEL', 'Adelanto 60%'), CONTACT, deps);
    expect(step(deps)).toBe('ESPERANDO_METODO');
    expect(last(deps).buttons.map((b) => b.title)).toEqual(['Pago Móvil', 'Zelle', 'Transferencia']);

    await handleMessage(button('MET_0', 'Pago Móvil'), CONTACT, deps);
    expect(step(deps)).toBe('ESPERANDO_COMPROBANTE');
    expect(last(deps).text).toContain('Banco: Venezuela (0102)');
    expect(last(deps).text).toContain('Monto a pagar: Bs. 8.760,00');

    // C) texto cuando se espera el comprobante
    await handleMessage(text('ya pagué'), CONTACT, deps);
    expect(last(deps).text).toContain('foto o captura del comprobante');
    expect(step(deps)).toBe('ESPERANDO_COMPROBANTE');

    await handleMessage(image(), CONTACT, deps);
    expect(step(deps)).toBe('IDLE');
    expect(deps.orders).toHaveLength(1);
    const o = deps.orders[0];
    expect(o.Track_ID).toMatch(TRACK_ID_RE);
    expect(o.Track_ID.startsWith('CAM-0810-')).toBe(true);
    expect(o).toMatchObject({
      Cliente: 'Samuel Herrera',
      Telefono: PHONE,
      Pedido: '2x Camisa Oversize (negra, logo en el pecho) · 1x Taza Mágica',
      Subtotal_USD: 40,
      Envio_USD: 0,
      Total_USD: 40,
      Tipo_Pago: 'Adelanto',
      Porcentaje_Pagado: 60,
      Monto_Pagado_USD: 24,
      Restante_USD: 16,
      Metodo_Pago: 'Pago Móvil',
      Tasa_BCV: 365,
      Monto_Pagado_VES: 8760,
      Modalidad_Entrega: 'Envío MRW',
      Estatus: 'Pago por verificar',
    });
    expect(last(deps).text).toContain(`tracking.html?id=${o.Track_ID}`);
    expect(last(deps).text).toContain('Restante a pagar antes del despacho: *$16,00*');
  });
});

describe('otros casos', () => {
  async function toMethod(deps, entrega = 'ENT_RETIRO') {
    await handleMessage(text(CART_MESSAGE), CONTACT, deps);
    await handleMessage(button(entrega, ''), CONTACT, deps);
  }

  it('retiro + 100% + Zelle cobra en USD', async () => {
    const deps = makeDeps();
    await toMethod(deps);
    expect(step(deps)).toBe('ESPERANDO_TIPO_PAGO');
    await handleMessage(text('completo'), CONTACT, deps);
    await handleMessage(text('zelle'), CONTACT, deps);
    expect(last(deps).text).toContain('Monto a pagar: $40,00');
    await handleMessage(image(), CONTACT, deps);
    expect(deps.orders[0]).toMatchObject({ Metodo_Pago: 'Zelle', Restante_USD: 0, Monto_Pagado_VES: '', Modalidad_Entrega: 'Retiro' });
  });

  it('delivery suma el costo de Configuracion', async () => {
    const deps = makeDeps();
    await toMethod(deps, 'ENT_DELIVERY');
    await handleMessage(text('Av. Francisco de Miranda, Edif. X, piso 3, 0414-0000000'), CONTACT, deps);
    expect(last(deps).text).toContain('Total de tu pedido: *$43,00*');
  });

  it('D) informa productos no disponibles', async () => {
    const deps = makeDeps();
    await handleMessage(text('#PEDIDO LLA-07*1|TAZ-01*1'), CONTACT, deps);
    expect(last(deps).text).toContain('*LLA-07* ya no está disponible');
  });

  it('E) sin tasa BCV sigue funcionando en USD', async () => {
    const deps = makeDeps({ rate: null });
    await toMethod(deps);
    expect(last(deps).text).toContain('No pude consultar la tasa BCV');
    await handleMessage(button('PAGO_FULL', ''), CONTACT, deps);
    await handleMessage(button('MET_0', ''), CONTACT, deps);
    expect(last(deps).text).toContain('una persona te confirmará el monto exacto en bolívares');
    await handleMessage(image(), CONTACT, deps);
    expect(deps.orders[0].Tasa_BCV).toBe('');
  });

  it('cancelar borra el pedido en curso', async () => {
    const deps = makeDeps();
    await toMethod(deps);
    await handleMessage(text('cancelar'), CONTACT, deps);
    expect(step(deps)).toBe('IDLE');
  });

  it('asesor pausa el bot y un #PEDIDO nuevo lo reactiva', async () => {
    const deps = makeDeps();
    await handleMessage(text('quiero hablar con un asesor'), CONTACT, deps);
    const n = deps.sent.length;
    await handleMessage(text('hola?'), CONTACT, deps);
    expect(deps.sent.length).toBe(n);
    await handleMessage(text(CART_MESSAGE), CONTACT, deps);
    expect(step(deps)).toBe('ESPERANDO_ENTREGA');
  });

  it('reintenta si el Track_ID ya existe', async () => {
    const deps = makeDeps();
    let calls = 0;
    const original = deps.sheets.createOrder;
    deps.sheets.createOrder = async (o) => (++calls === 1 ? { ok: false, error: 'DUPLICATE_ID' } : original(o));
    await toMethod(deps);
    await handleMessage(button('PAGO_FULL', ''), CONTACT, deps);
    await handleMessage(button('MET_1', ''), CONTACT, deps);
    await handleMessage(image(), CONTACT, deps);
    expect(calls).toBe(2);
    expect(deps.orders).toHaveLength(1);
  });

  it('recotiza si el comprobante llega después de 24 h', async () => {
    const deps = makeDeps();
    await toMethod(deps);
    await handleMessage(button('PAGO_FULL', ''), CONTACT, deps);
    await handleMessage(button('MET_0', ''), CONTACT, deps);
    deps.setNow(new Date('2026-10-09T16:00:00Z'));
    await handleMessage(image(), CONTACT, deps);
    expect(deps.orders).toHaveLength(0);
    expect(last(deps).text).toContain('más de 24 horas');
    await handleMessage(image(), CONTACT, deps);
    expect(deps.orders).toHaveLength(1);
  });

  it('registra el pedido aunque falle la subida del comprobante', async () => {
    const deps = makeDeps();
    deps.wa.downloadMedia = async () => {
      throw new Error('boom');
    };
    await toMethod(deps);
    await handleMessage(button('PAGO_FULL', ''), CONTACT, deps);
    await handleMessage(button('MET_1', ''), CONTACT, deps);
    await handleMessage(image(), CONTACT, deps);
    expect(deps.orders[0].URL_Comprobante).toMatch(/PENDIENTE/);
  });
});
