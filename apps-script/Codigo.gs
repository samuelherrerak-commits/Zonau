/**
 * Zonau — Backend en Google Sheets (Google Apps Script Web App)
 *
 * GET  ?action=getCatalog              -> catálogo activo + configuración pública
 * GET  ?action=getTracking&id=XXX      -> estatus del pedido (sin datos privados)
 * POST {action, secret, ...}           -> solo para el bot (Cloudflare Worker)
 *        getConfig | getCatalogPrivate | uploadReceipt | createOrder
 *
 * Propiedades del script (Configuración del proyecto > Propiedades del script):
 *   API_SECRET       TODO: una clave larga y aleatoria; la misma va en APPS_SCRIPT_SECRET del Worker
 *   DRIVE_FOLDER_ID  TODO: ID de la carpeta de Drive donde se guardan los comprobantes
 *   SHEET_ID         (opcional) solo si el script NO está creado desde el propio Google Sheet
 */

var SHEETS = { CATALOGO: 'Catalogo', PEDIDOS: 'Pedidos', CONFIG: 'Configuracion' };

var HEADERS = {
  Catalogo: ['ID_Servicio', 'Categoria', 'Nombre', 'Descripcion', 'Precio_USD', 'Tiempo_Entrega', 'URL_Imagen', 'Personalizable', 'Activo', 'Orden'],
  Pedidos: [
    'Track_ID', 'Fecha', 'Cliente', 'Telefono', 'Pedido', 'Items_JSON', 'Subtotal_USD', 'Envio_USD', 'Total_USD',
    'Tipo_Pago', 'Porcentaje_Pagado', 'Monto_Pagado_USD', 'Restante_USD', 'Metodo_Pago', 'Tasa_BCV', 'Monto_Pagado_VES',
    'Modalidad_Entrega', 'Direccion_Envio', 'URL_Comprobante', 'Estatus', 'Guia_MRW', 'Notas_Internas', 'Actualizado'
  ],
  Configuracion: ['Variable', 'Valor', 'Descripcion']
};

var ESTATUS = ['Pago por verificar', 'En proceso', 'Listo para retirar', 'Listo para despacho', 'Enviado', 'Entregado', 'Cancelado'];
var ESTATUS_COLORES = ['#FFE08A', '#BFD7FF', '#C8F2C2', '#C8F2C2', '#E2C8FF', '#D9D9D9', '#FFB4B4'];
var TIPOS_PAGO = ['Completo', 'Adelanto'];
var MODALIDADES = ['Retiro', 'Delivery', 'Envío MRW'];

// Variables de Configuracion que se pueden mostrar en la web (nunca datos bancarios).
var PUBLIC_CONFIG = [
  'Nombre_Tienda', 'WhatsApp_Ventas', 'URL_Catalogo', 'URL_Tracking', 'Porcentaje_Adelanto',
  'Costo_Delivery_USD', 'Costo_Envio_MRW_USD', 'Nota_Envio_MRW', 'Info_Retiro', 'Horario_Atencion',
  'Instagram', 'Metodos_Activos'
];

var TRACK_ID_RE = /^[A-Z]{3}-\d{4}-[A-HJ-NP-Z2-9]{3}$/;
var CACHE_KEY_CATALOG = 'public_catalog';

// ============================================================ HTTP

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'getCatalog') return json_({ ok: true, data: getPublicCatalog_() });
    if (action === 'getTracking') return json_(getTracking_(e.parameter.id));
    if (action === 'ping') return json_({ ok: true, data: 'pong' });
    return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'SERVER_ERROR' });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var secret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
    if (!secret || body.secret !== secret) return json_({ ok: false, error: 'UNAUTHORIZED' });

    switch (body.action) {
      case 'getConfig': return json_({ ok: true, data: readConfig_() });
      case 'getCatalogPrivate': return json_({ ok: true, data: readTable_(sheet_(SHEETS.CATALOGO)) });
      case 'uploadReceipt': return json_({ ok: true, data: uploadReceipt_(body) });
      case 'createOrder': return json_(createOrder_(body.order || {}));
      default: return json_({ ok: false, error: 'UNKNOWN_ACTION' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================ Catálogo

function getPublicCatalog_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY_CATALOG);
  if (hit) return JSON.parse(hit);

  var productos = readTable_(sheet_(SHEETS.CATALOGO))
    .filter(function (p) { return isTrue_(p.Activo) && p.ID_Servicio; })
    .sort(function (a, b) { return (Number(a.Orden) || 999) - (Number(b.Orden) || 999); })
    .map(function (p) {
      return {
        id: String(p.ID_Servicio).toUpperCase(),
        categoria: String(p.Categoria || ''),
        nombre: String(p.Nombre || ''),
        descripcion: String(p.Descripcion || ''),
        precio: Number(p.Precio_USD) || 0,
        tiempoEntrega: String(p.Tiempo_Entrega || ''),
        imagen: imageUrl_(p.URL_Imagen),
        personalizable: isTrue_(p.Personalizable)
      };
    });

  var config = readConfig_();
  var publicConfig = {};
  PUBLIC_CONFIG.forEach(function (k) { if (k in config) publicConfig[k] = config[k]; });

  var data = { productos: productos, config: publicConfig };
  cache.put(CACHE_KEY_CATALOG, JSON.stringify(data), 300);
  return data;
}

// Convierte links de Google Drive en URLs de imagen directas.
function imageUrl_(url) {
  url = String(url || '').trim();
  var m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=view&)?id=)([\w-]+)/);
  return m ? 'https://lh3.googleusercontent.com/d/' + m[1] : url;
}

// ============================================================ Tracking

function getTracking_(rawId) {
  var id = String(rawId || '').toUpperCase().replace(/\s+/g, '');
  if (!TRACK_ID_RE.test(id)) return { ok: false, error: 'INVALID_ID' };

  var sh = sheet_(SHEETS.PEDIDOS);
  var cell = sh.getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
  if (!cell) return { ok: false, error: 'NOT_FOUND' };

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var values = sh.getRange(cell.getRow(), 1, 1, headers.length).getValues()[0];
  var o = {};
  headers.forEach(function (h, i) { o[h] = values[i]; });

  return {
    ok: true,
    data: {
      trackId: id,
      fecha: toIso_(o.Fecha),
      cliente: maskName_(o.Cliente),
      pedido: String(o.Pedido || ''),
      estatus: String(o.Estatus || 'Pago por verificar'),
      modalidad: String(o.Modalidad_Entrega || ''),
      guiaMRW: String(o.Guia_MRW || '').replace(/^-$/, ''),
      totalUSD: Number(o.Total_USD) || 0,
      restanteUSD: Number(o.Restante_USD) || 0,
      actualizado: toIso_(o.Actualizado || o.Fecha)
    }
  };
}

// "Samuel Herrera" -> "Samuel H."
function maskName_(name) {
  var parts = String(name || '').trim().split(/\s+/).filter(String);
  if (!parts.length) return '';
  return parts[0] + (parts[1] ? ' ' + parts[1].charAt(0).toUpperCase() + '.' : '');
}

function toIso_(v) {
  if (v instanceof Date) return v.toISOString();
  return v ? String(v) : '';
}

// ============================================================ Pedidos

function createOrder_(order) {
  var id = String(order.Track_ID || '').toUpperCase();
  var errors = [];
  if (!TRACK_ID_RE.test(id)) errors.push('Track_ID inválido');
  if (!String(order.Metodo_Pago || '').trim()) errors.push('Metodo_Pago es obligatorio');
  if (!String(order.Telefono || '').trim()) errors.push('Telefono es obligatorio');
  if (!String(order.Pedido || '').trim()) errors.push('Pedido es obligatorio');
  if (!(Number(order.Total_USD) > 0)) errors.push('Total_USD inválido');
  if (errors.length) return { ok: false, error: errors.join('; ') };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(SHEETS.PEDIDOS);
    var exists = sh.getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
    if (exists) return { ok: false, error: 'DUPLICATE_ID' };

    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var now = new Date();
    var row = headers.map(function (h) {
      if (h === 'Track_ID') return id;
      if (h === 'Fecha') return order.Fecha ? new Date(order.Fecha) : now;
      if (h === 'Actualizado') return now;
      if (h === 'Estatus') return order.Estatus || ESTATUS[0];
      if (h === 'Guia_MRW') return order.Modalidad_Entrega === 'Envío MRW' ? '' : '-';
      var v = order[h];
      return v === undefined || v === null ? '' : safe_(v);
    });
    sh.appendRow(row);
    // El teléfono como texto, para que Sheets no lo convierta en número.
    var tel = headers.indexOf('Telefono');
    if (tel >= 0) sh.getRange(sh.getLastRow(), tel + 1).setNumberFormat('@').setValue(String(order.Telefono));
    return { ok: true, trackId: id };
  } finally {
    lock.releaseLock();
  }
}

// Evita inyección de fórmulas en celdas (=, +, -, @ al inicio).
function safe_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function uploadReceipt_(body) {
  var folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  if (!folderId) throw new Error('Falta DRIVE_FOLDER_ID');
  var mime = String(body.mimeType || 'image/jpeg');
  if (!/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(mime)) throw new Error('Tipo de archivo no permitido');
  var ext = mime === 'application/pdf' ? '.pdf' : '.' + mime.split('/')[1];
  var name = String(body.fileName || 'comprobante_' + Date.now()).replace(/[^\w.-]/g, '_') + ext;
  var blob = Utilities.newBlob(Utilities.base64Decode(body.base64), mime, name);
  var file = DriveApp.getFolderById(folderId).createFile(blob);
  // El archivo queda privado: solo la dueña (y quien ella comparta la carpeta) lo puede abrir.
  return { url: file.getUrl() };
}

// ============================================================ Configuración

function readConfig_() {
  var rows = sheet_(SHEETS.CONFIG).getDataRange().getValues();
  var config = {};
  for (var i = 1; i < rows.length; i++) {
    var k = String(rows[i][0] || '').trim();
    if (k) config[k] = rows[i][1];
  }
  return config;
}

// ============================================================ Triggers

/** Trigger simple: marca la fecha de actualización y limpia la caché. */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  var name = sh.getName();

  if (name === SHEETS.CATALOGO || name === SHEETS.CONFIG) {
    CacheService.getScriptCache().remove(CACHE_KEY_CATALOG);
    return;
  }
  if (name !== SHEETS.PEDIDOS || e.range.getRow() < 2) return;

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var colEstatus = headers.indexOf('Estatus') + 1;
  var colGuia = headers.indexOf('Guia_MRW') + 1;
  var colAct = headers.indexOf('Actualizado') + 1;
  var c1 = e.range.getColumn();
  var c2 = c1 + e.range.getNumColumns() - 1;
  var touched = [colEstatus, colGuia].some(function (c) { return c >= c1 && c <= c2; });
  if (touched && colAct > 0) {
    sh.getRange(e.range.getRow(), colAct, e.range.getNumRows(), 1).setValue(new Date());
  }
}

// ============================================================ Setup

/** Ejecutar UNA vez: crea pestañas, encabezados, listas desplegables y colores. */
function setup() {
  var ss = ss_();
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = HEADERS[name];
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn())
      .setFontWeight('bold').setBackground('#111111').setFontColor('#FFFFFF');
  });

  var cat = ss.getSheetByName(SHEETS.CATALOGO);
  var boolRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  cat.getRange('H2:I').setDataValidation(boolRule);
  cat.getRange('E2:E').setNumberFormat('$#,##0.00');
  cat.getRange('A2:A').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied('=REGEXMATCH(A2,"^[A-Z]{3}-[0-9]{2}$")')
      .setHelpText('Formato: 3 letras mayúsculas, guion y 2 números. Ej: CAM-01. Las 3 letras son el prefijo del número de seguimiento.')
      .build()
  );

  var ped = ss.getSheetByName(SHEETS.PEDIDOS);
  var col = function (h) { return HEADERS.Pedidos.indexOf(h) + 1; };
  var list = function (values) { return SpreadsheetApp.newDataValidation().requireValueInList(values, true).build(); };
  ped.getRange(2, col('Estatus'), ped.getMaxRows() - 1, 1).setDataValidation(list(ESTATUS));
  ped.getRange(2, col('Tipo_Pago'), ped.getMaxRows() - 1, 1).setDataValidation(list(TIPOS_PAGO));
  ped.getRange(2, col('Modalidad_Entrega'), ped.getMaxRows() - 1, 1).setDataValidation(list(MODALIDADES));
  ['Subtotal_USD', 'Envio_USD', 'Total_USD', 'Monto_Pagado_USD', 'Restante_USD'].forEach(function (h) {
    ped.getRange(2, col(h), ped.getMaxRows() - 1, 1).setNumberFormat('$#,##0.00');
  });
  ped.getRange(2, col('Monto_Pagado_VES'), ped.getMaxRows() - 1, 1).setNumberFormat('"Bs. "#,##0.00');
  ped.getRange(2, col('Fecha'), ped.getMaxRows() - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  ped.getRange(2, col('Actualizado'), ped.getMaxRows() - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  ped.getRange(2, col('Telefono'), ped.getMaxRows() - 1, 1).setNumberFormat('@');
  ped.hideColumns(col('Items_JSON'));

  var estatusRange = ped.getRange(2, col('Estatus'), ped.getMaxRows() - 1, 1);
  var rules = ped.getConditionalFormatRules().filter(function (r) {
    return !r.getRanges().some(function (rg) { return rg.getColumn() === col('Estatus'); });
  });
  ESTATUS.forEach(function (s, i) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(ESTATUS_COLORES[i]).setRanges([estatusRange]).build());
  });
  // Saldo pendiente en rojo
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor('#C62828').setBold(true)
    .setRanges([ped.getRange(2, col('Restante_USD'), ped.getMaxRows() - 1, 1)]).build());
  ped.setConditionalFormatRules(rules);

  var conf = ss.getSheetByName(SHEETS.CONFIG);
  conf.setColumnWidth(1, 220).setColumnWidth(2, 380).setColumnWidth(3, 380);
  conf.getRange('B:B').setWrap(true);
}

/** Opcional: carga datos de ejemplo en Catalogo y Configuracion (solo si están vacías). */
function seed() {
  setup();
  var ss = ss_();
  var cat = ss.getSheetByName(SHEETS.CATALOGO);
  if (cat.getLastRow() < 2) {
    cat.getRange(2, 1, 6, 10).setValues([
      ['CAM-01', 'Camisas', 'Camisa Oversize', 'Estampado DTF full color, algodón 100%', 15, '3 días hábiles', '', true, true, 1],
      ['CAM-02', 'Camisas', 'Camisa Clásica', 'Corte regular, estampado frontal', 12, '3 días hábiles', '', true, true, 2],
      ['TAZ-01', 'Tazas', 'Taza Mágica', 'Revela tu foto con el calor', 10, '2 días hábiles', '', true, true, 3],
      ['TAZ-02', 'Tazas', 'Taza Blanca 11oz', 'Sublimada con tu diseño', 7, '2 días hábiles', '', true, true, 4],
      ['LLA-01', 'Llaveros', 'Llavero Acrílico', 'Con tu foto o nombre', 4, '2 días hábiles', '', true, true, 5],
      ['REG-01', 'Regalos', 'Box Regalo', 'Taza + llavero + tarjeta, empacado', 18, '4 días hábiles', '', true, true, 6]
    ]);
  }
  var conf = ss.getSheetByName(SHEETS.CONFIG);
  if (conf.getLastRow() < 2) {
    var rows = DEFAULT_CONFIG_();
    conf.getRange(2, 1, rows.length, 3).setValues(rows);
  }
}

function DEFAULT_CONFIG_() {
  return [
    ['Nombre_Tienda', 'Zonau', 'Nombre que usa el bot y la web.'],
    ['WhatsApp_Ventas', '58XXXXXXXXXX', 'TODO: número de ventas, formato internacional sin + ni espacios.'],
    ['Instagram', 'zonau.ccs', 'Usuario de Instagram sin @.'],
    ['URL_Catalogo', 'https://zonau.example.com', 'TODO: dirección de la web.'],
    ['URL_Tracking', 'https://zonau.example.com/tracking.html', 'TODO: dirección de la página de seguimiento.'],
    ['Porcentaje_Adelanto', 60, '% mínimo para iniciar el trabajo. Pon 100 para exigir pago completo.'],
    ['Metodos_Activos', 'Pago Móvil, Zelle, Transferencia', 'Separados por coma. Cada uno necesita su fila Datos_<Metodo>.'],
    ['Metodos_En_Bolivares', 'Pago Móvil, Transferencia', 'Métodos que se cobran en Bs. a tasa BCV. El resto se cobra en USD.'],
    ['Datos_PagoMovil', 'Banco: TODO (0000)\nCI: V-XX.XXX.XXX\nTeléfono: 04XX-XXXXXXX', 'Lo que el bot envía al elegir Pago Móvil.'],
    ['Datos_Transferencia', 'Banco: TODO\nCuenta: 0000-0000-00-0000000000\nTitular: TODO\nCI: V-XX.XXX.XXX', ''],
    ['Datos_Zelle', 'Correo: TODO@ejemplo.com\nTitular: TODO', ''],
    ['Datos_EfectivoUSD', 'Se paga al momento de retirar o con el delivery.', 'Solo si agregas "Efectivo USD" a Metodos_Activos.'],
    ['Datos_Binance', 'Pay ID: TODO', 'Solo si agregas "Binance" a Metodos_Activos.'],
    ['Info_Retiro', 'TODO: dirección, punto de referencia y horario de retiro', ''],
    ['Costo_Delivery_USD', 3, 'Delivery dentro de Caracas.'],
    ['Costo_Envio_MRW_USD', 0, '0 = cobro a destino.'],
    ['Nota_Envio_MRW', 'El envío por MRW se paga a destino.', ''],
    ['Horario_Atencion', 'Lun a Sáb, 9am a 6pm', ''],
    ['Fuente_Tasa', 'auto', '"auto" usa la tasa BCV de internet. Si escribes un número, el bot usa ese número.'],
    ['Tasa_Manual', '', 'Tasa de respaldo si internet falla.'],
    ['Mensaje_Bienvenida', '', 'Opcional. Si lo dejas vacío, el bot usa su saludo por defecto.']
  ];
}

// ============================================================ Utilidades

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('No existe la pestaña ' + name + '. Ejecuta setup().');
  return sh;
}

function readTable_(sh) {
  var values = sh.getDataRange().getValues();
  var headers = values.shift() || [];
  return values
    .filter(function (r) { return r.some(function (c) { return c !== ''; }); })
    .map(function (r) {
      var o = {};
      headers.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
}

function isTrue_(v) {
  return v === true || /^(true|si|sí|1)$/i.test(String(v).trim());
}
