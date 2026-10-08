// Único lugar del frontend con la URL del backend.

// TODO: pega aquí la URL del Web App de Google Apps Script (termina en /exec).
export const API_URL = 'https://script.google.com/macros/s/TODO/exec';

// Con la URL sin configurar, la web usa los datos de ejemplo de /mock.
// También puedes forzarlo con ?mock=1 en la URL.
export const USE_MOCK = API_URL.includes('TODO') || new URLSearchParams(location.search).has('mock');

// Respaldo si la pestaña Configuracion no trae WhatsApp_Ventas.
// TODO: número de ventas en formato internacional, sin "+" ni espacios.
export const WHATSAPP_FALLBACK = '58XXXXXXXXXX';

// TODO: verifica la página de rastreo de MRW Venezuela.
export const MRW_TRACKING_URL = 'https://www.mrw.com.ve/';
