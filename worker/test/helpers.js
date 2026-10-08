// Dobles de prueba compartidos por los tests.

export const CATALOG = [
  { ID_Servicio: 'TAZ-01', Nombre: 'Taza Mágica', Precio_USD: 10, Tiempo_Entrega: '2 días hábiles', Activo: true },
  { ID_Servicio: 'CAM-01', Nombre: 'Camisa Oversize', Precio_USD: 15, Tiempo_Entrega: '3 días hábiles', Activo: true },
  { ID_Servicio: 'LLA-01', Nombre: 'Llavero Acrílico', Precio_USD: 4, Tiempo_Entrega: '2 días hábiles', Activo: true },
  { ID_Servicio: 'LLA-07', Nombre: 'Llavero Viejo', Precio_USD: 3, Tiempo_Entrega: '1 día hábil', Activo: false },
];

export const CONFIG = {
  Nombre_Tienda: 'Zonau',
  URL_Catalogo: 'https://zonau.example.com',
  URL_Tracking: 'https://zonau.example.com/tracking.html',
  Porcentaje_Adelanto: 60,
  Metodos_Activos: 'Pago Móvil, Zelle, Transferencia',
  Metodos_En_Bolivares: 'Pago Móvil, Transferencia',
  Datos_PagoMovil: 'Banco: Venezuela (0102)\nCI: V-XX.XXX.XXX\nTeléfono: 0414-XXXXXXX',
  Datos_Zelle: 'zonau@ejemplo.com · Titular: Zonau',
  Datos_Transferencia: 'Banco ... Cuenta ...',
  Info_Retiro: 'Chacao, Caracas. Lun–Sáb 9am–6pm',
  Costo_Delivery_USD: 3,
  Costo_Envio_MRW_USD: 0,
  Nota_Envio_MRW: 'El envío por MRW se paga a destino.',
};

export function makeDeps({ rate = { tasa: 365, fuente: 'test', fecha: '2026-10-08T00:00:00-04:00' }, config = CONFIG, now } = {}) {
  const sent = [];
  const orders = [];
  const states = new Map();
  let clock = now || new Date('2026-10-08T15:00:00Z');
  const deps = {
    sent,
    orders,
    states,
    setNow: (d) => (clock = d),
    wa: {
      sendText: async (to, text) => sent.push({ to, type: 'text', text }),
      sendButtons: async (to, text, buttons) => sent.push({ to, type: 'buttons', text, buttons }),
      sendList: async (to, text, buttonText, rows) => sent.push({ to, type: 'list', text, rows }),
      markRead: async () => {},
      downloadMedia: async () => ({ base64: 'AAAA', mimeType: 'image/jpeg' }),
    },
    sheets: {
      getConfig: async () => config,
      getCatalog: async () => CATALOG,
      uploadReceipt: async () => 'https://drive.google.com/file/d/abc/view',
      createOrder: async (order) => {
        if (orders.some((o) => o.Track_ID === order.Track_ID)) return { ok: false, error: 'DUPLICATE_ID' };
        orders.push(order);
        return { ok: true, trackId: order.Track_ID };
      },
    },
    rates: { getRate: async () => rate },
    store: {
      get: async (p) => (states.has(p) ? structuredClone(states.get(p)) : null),
      set: async (p, s) => states.set(p, structuredClone(s)),
    },
    now: () => clock,
  };
  return deps;
}

let n = 0;
export const PHONE = '584141234567';
export const text = (body) => ({ id: `wamid.${++n}`, from: PHONE, type: 'text', text: { body } });
export const button = (id, title) => ({
  id: `wamid.${++n}`,
  from: PHONE,
  type: 'interactive',
  interactive: { type: 'button_reply', button_reply: { id, title } },
});
export const image = () => ({ id: `wamid.${++n}`, from: PHONE, type: 'image', image: { id: 'media123', mime_type: 'image/jpeg' } });
export const CONTACT = { wa_id: PHONE, profile: { name: 'Samuel Herrera' } };

export const CART_MESSAGE = `Hola Zonau! 🖤 Quiero hacer este pedido:

• 2x Camisa Oversize — $30
  Nota: negra, logo en el pecho
• 1x Taza Mágica — $10

Total estimado: $40

#PEDIDO CAM-01*2|TAZ-01*1`;
