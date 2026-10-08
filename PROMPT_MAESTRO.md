# Prompt Maestro — Sistema Zonau (Catálogo + Bot WhatsApp + Tracking)

> Copia **todo** lo que está debajo de la línea y pégalo en Claude Code dentro de un repositorio vacío.
> Antes de pegarlo, rellena los datos de la sección "DATOS DEL NEGOCIO" si ya los tienes; si no, déjalos como están y Claude Code los marcará como `TODO`.

---

Actúa como un desarrollador Full Stack senior y arquitecto de software. Vas a construir, en este repositorio, un sistema completo de ventas por WhatsApp para **Zonau** (@zonau.ccs), una tienda de Caracas que vende productos personalizados: camisas, tazas, llaveros y regalos. Escribe todo el código, la documentación y los datos de ejemplo. No me pidas confirmación entre pasos: trabaja por fases, y al final de cada fase haz un commit.

## 0. DATOS DEL NEGOCIO (rellenar o dejar como TODO)

- Nombre comercial: Zonau
- Instagram: @zonau.ccs
- Número de WhatsApp de ventas (formato internacional sin "+"): `58XXXXXXXXXX`
- Dominio del sitio: `https://zonau.example.com` (será Cloudflare Pages o GitHub Pages)
- Zona horaria: `America/Caracas`
- Moneda base: USD. Moneda de pago local: VES (bolívares) a tasa BCV.

## 1. STACK Y RESTRICCIONES

1. **Frontend**: sitio 100% estático. HTML + CSS puro + JavaScript vanilla (ES modules). Sin frameworks, sin build step, sin npm para el frontend. Debe funcionar abriendo los archivos desde cualquier hosting estático.
2. **Backend / base de datos**: Google Sheets expuesto como API mediante **Google Apps Script** publicado como Web App (`doGet` y `doPost`).
3. **Bot**: **Cloudflare Worker** conectado a la **WhatsApp Cloud API de Meta**. Usa **Cloudflare KV** para el estado de la conversación (la memoria de un Worker NO persiste entre peticiones; no uses variables globales como estado). Usa `wrangler.toml` y secrets de Wrangler para los tokens.
4. **Cero secretos en el frontend ni en el repositorio.** Todos los tokens van en `wrangler secret` o en las Propiedades del Script de Apps Script. Deja marcados con `// TODO:` todos los lugares donde yo deba poner IDs, URLs o tokens.
5. Todo el texto visible para el cliente va en **español de Venezuela**, cercano pero profesional.

## 2. FLUJO DE NEGOCIO COMPLETO

```
Instagram / WhatsApp ─► Landing (catálogo) ─► Carrito ─► Botón "Pedir por WhatsApp"
      ─► mensaje pre-armado ─► Bot valida y cotiza (USD + Bs. BCV, 100% o adelanto %)
      ─► cliente elige pago + entrega ─► envía comprobante (foto)
      ─► Bot genera Track_ID, guarda pedido en Sheets, responde con link de tracking
      ─► Dueña verifica pago y cambia estatus en Sheets ─► cliente consulta tracking
```

1. Si el cliente escribe al WhatsApp sin venir del catálogo (ej. "hola", "info", "precio"), el bot responde con bienvenida y el link del catálogo. No intenta armar carritos por chat.
2. En la landing el cliente selecciona productos y cantidades (carrito guardado en `localStorage`), puede escribir una nota de personalización por producto (texto, color, talla) y ve el total en USD.
3. El botón "Pedir por WhatsApp" abre `https://wa.me/<NUMERO>?text=<mensaje codificado>` con un mensaje legible para humanos **que además incluye una línea de código máquina** para que el bot lo procese sin ambigüedad (ver sección 6).
4. El bot recibe el mensaje, **recalcula los precios desde la pestaña Catalogo** (nunca confía en los precios que vienen en el texto, porque el cliente puede editarlo), consulta la tasa BCV y la Configuracion, y responde con el resumen, los montos y las opciones.
5. **Política de pago anticipado**: el cliente elige pagar el **100%** o un **adelanto del X%** (X viene de `Configuracion.Porcentaje_Adelanto`, por defecto 60). El restante se paga cuando el producto está listo (al retirar) o antes del despacho (si es envío).
6. El cliente elige **modalidad de entrega**: Retiro en tienda, Delivery (Caracas) o Envío nacional por MRW. El costo de delivery/envío sale de Configuracion y se suma al total.
7. El cliente elige **método de pago** (Pago Móvil, Transferencia, Zelle, Efectivo USD, Binance, etc. — solo los que estén activos en Configuracion). **El método de pago es obligatorio**: el bot no puede registrar ningún pedido sin él.
8. El bot envía los datos bancarios del método elegido y el monto exacto en la moneda correspondiente (Bs. para Pago Móvil/Transferencia, USD para Zelle/Efectivo/Binance).
9. El cliente envía la **foto del comprobante**. El bot descarga la imagen desde la API de Meta, la sube a una carpeta de Google Drive (vía Apps Script) y guarda el enlace.
10. El bot genera el **Track_ID**, registra el pedido en la pestaña Pedidos con estatus `Pago por verificar` y responde con el número de seguimiento y el link de tracking.
11. La dueña revisa el comprobante en Sheets, cambia el estatus manualmente (lista desplegable) y, si es MRW, carga el número de guía.
12. El cliente consulta `tracking.html?id=TRACK_ID` y ve una línea de tiempo con el estatus actual.

## 3. GOOGLE SHEETS — ESTRUCTURA EXACTA

Crea un archivo `sheets/plantilla/` con un CSV por pestaña (con filas de ejemplo) para que yo pueda importarlos, y además una función `setup()` en Apps Script que cree las pestañas, encabezados, validaciones de datos (listas desplegables), formatos y congele la primera fila si no existen.

### Pestaña `Catalogo`

| ID_Servicio | Categoria | Nombre | Descripcion | Precio_USD | Tiempo_Entrega | URL_Imagen | Personalizable | Activo | Orden |
|---|---|---|---|---|---|---|---|---|---|
| TAZ-01 | Tazas | Taza Mágica | Revela tu foto con el calor | 10 | 2 días hábiles | https://... | TRUE | TRUE | 1 |
| CAM-01 | Camisas | Camisa Oversize | Estampado DTF a tu medida | 15 | 3 días hábiles | https://... | TRUE | TRUE | 2 |
| LLA-01 | Llaveros | Llavero Acrílico | Con tu foto o nombre | 4 | 2 días hábiles | https://... | TRUE | TRUE | 3 |

- Las **3 primeras letras de `ID_Servicio`** son el prefijo del Track_ID. Valídalo en `setup()` y en el endpoint (regex `^[A-Z]{3}-\d{2}$`).
- Solo se exponen al público los productos con `Activo = TRUE`, ordenados por `Orden`.

### Pestaña `Pedidos`

| Columna | Tipo | Quién la llena | Notas |
|---|---|---|---|
| Track_ID | texto | Bot | Único. Ver sección 5. |
| Fecha | fecha-hora | Bot | Hora de Caracas. |
| Cliente | texto | Bot | Nombre de perfil de WhatsApp o el que indique el cliente. |
| Telefono | texto | Bot | `wa_id` del cliente. Nunca se expone en el tracking. |
| Pedido | texto | Bot | Legible: `2x Camisa Oversize (negra, logo) · 1x Taza Mágica` |
| Items_JSON | texto | Bot | `[{"id":"CAM-01","qty":2,"precio":15,"nota":"negra, logo"}]` |
| Subtotal_USD | número | Bot | Suma de productos (recalculada desde Catalogo). |
| Envio_USD | número | Bot | Según modalidad. |
| Total_USD | número | Bot | Subtotal + Envío. |
| Tipo_Pago | lista | Bot | `Completo` / `Adelanto` |
| Porcentaje_Pagado | número | Bot | 100 o el % de adelanto vigente al momento del pedido. |
| Monto_Pagado_USD | número | Bot | |
| Restante_USD | número | Bot | Total − Pagado. La dueña lo pone en 0 cuando cobra el saldo. |
| Metodo_Pago | lista | Bot | **Obligatorio.** |
| Tasa_BCV | número | Bot | Tasa usada en la cotización. |
| Monto_Pagado_VES | número | Bot | Si aplica. |
| Modalidad_Entrega | lista | Bot | `Retiro` / `Delivery` / `Envío MRW` |
| Direccion_Envio | texto | Bot | Para Delivery/MRW: ciudad, agencia MRW, cédula, nombre de quien recibe. |
| URL_Comprobante | URL | Bot | Link al archivo en Drive. |
| Estatus | lista | Dueña | Ver estatus abajo. |
| Guia_MRW | texto | Dueña | Solo envíos nacionales. |
| Notas_Internas | texto | Dueña | Nunca se exponen. |
| Actualizado | fecha-hora | Apps Script | Se actualiza con un trigger `onEdit` cuando cambia Estatus. |

**Estatus permitidos (lista desplegable, en este orden):**
1. `Pago por verificar`
2. `En proceso`
3. `Listo para retirar` (solo modalidad Retiro)
4. `Listo para despacho` (Delivery / MRW, esperando saldo restante si aplica)
5. `Enviado` (requiere Guia_MRW si es MRW)
6. `Entregado`
7. `Cancelado`

Aplica formato condicional por color a la columna Estatus para que la dueña vea de un vistazo el estado de cada pedido.

### Pestaña `Configuracion` (Variable | Valor | Descripcion)

| Variable | Valor de ejemplo | Descripcion |
|---|---|---|
| Nombre_Tienda | Zonau | |
| WhatsApp_Ventas | 58XXXXXXXXXX | |
| URL_Catalogo | https://zonau.example.com | |
| URL_Tracking | https://zonau.example.com/tracking.html | |
| Porcentaje_Adelanto | 60 | % mínimo para iniciar el trabajo. |
| Metodos_Activos | Pago Móvil, Transferencia, Zelle, Efectivo USD | Separados por coma. |
| Datos_PagoMovil | Banco: 0102 · CI: V-XX.XXX.XXX · Tel: 0414-XXXXXXX | |
| Datos_Transferencia | Banco ... · Cuenta ... · Titular ... · CI ... | |
| Datos_Zelle | correo@ejemplo.com · Titular: ... | |
| Datos_Binance | Pay ID ... | |
| Info_Retiro | Dirección, horario y punto de referencia | |
| Costo_Delivery_USD | 3 | Delivery dentro de Caracas. |
| Costo_Envio_MRW_USD | 0 | 0 = cobro a destino. |
| Nota_Envio_MRW | El envío por MRW se paga a destino. | |
| Fuente_Tasa | auto | `auto` usa la API; un número fuerza esa tasa. |
| Tasa_Manual | | Tasa de respaldo si la API falla. |
| Mensaje_Bienvenida | (texto opcional) | Si está vacío, usar el texto por defecto. |
| Horario_Atencion | Lun–Sáb 9am–6pm | |

El código debe leer esta pestaña como un diccionario `{Variable: Valor}` y **nunca** tener esos valores escritos a mano en el Worker o en el frontend. Cualquier variable nueva que la dueña agregue debe estar disponible sin tocar código.

## 4. GOOGLE APPS SCRIPT — `apps-script/Codigo.gs`

Implementa:

- `doGet(e)` con rutas por `?action=`:
  - `getCatalog` → productos activos + configuración pública (nombre, WhatsApp, porcentaje de adelanto, costos de envío, info de retiro). **No** devuelvas datos bancarios en esta ruta pública.
  - `getTracking&id=XXX` → `{ trackId, fecha, pedido, estatus, modalidad, guiaMRW, restanteUSD, actualizado, clienteInicial }`. Nunca devuelvas el teléfono, el comprobante ni las notas internas. Muestra el nombre del cliente enmascarado (ej. "Samuel H."). Valida el formato del ID antes de buscar.
- `doPost(e)` que reciba `text/plain` con JSON y exija un campo `secret` igual a la propiedad del script `API_SECRET` (Apps Script no permite leer headers). Acciones:
  - `getConfig` → configuración completa (incluye datos bancarios). Solo para el Worker.
  - `getCatalogPrivate` → catálogo para recalcular precios.
  - `uploadReceipt` → recibe `{ base64, mimeType, fileName }`, lo guarda en la carpeta de Drive `DRIVE_FOLDER_ID` y devuelve la URL.
  - `createOrder` → valida todos los campos (incluyendo método de pago obligatorio), verifica que el Track_ID no exista, agrega la fila y devuelve `{ ok: true, trackId }`. Si el ID ya existe devuelve `{ ok: false, error: "DUPLICATE_ID" }` para que el Worker genere otro.
- Usa `LockService.getScriptLock()` en `createOrder` para evitar escrituras simultáneas.
- Cachea `getCatalog` con `CacheService` durante 5 minutos y limpia la caché desde `onEdit` cuando se edite la pestaña Catalogo o Configuracion.
- Trigger `onEdit` que actualice la columna `Actualizado` cuando cambie Estatus.
- Todas las respuestas en JSON con `ContentService` y un formato uniforme `{ ok, data, error }`.
- Incluye `setup()` (crea estructura) y `seed()` (carga datos de ejemplo).
- Configuración vía `PropertiesService`: `SHEET_ID`, `API_SECRET`, `DRIVE_FOLDER_ID`. Marca con `// TODO:`.

## 5. LÓGICA DEL TRACK_ID (número de guía único)

**Formato:** `[PREFIJO]-[DDMM]-[XXX]` → ejemplo `CAM-0810-K9R`

- **PREFIJO (3 letras):** las 3 primeras letras del `ID_Servicio` del **producto principal**, definido como el ítem con mayor subtotal (precio × cantidad) del pedido. En empate, el primero del carrito.
- **DDMM (4 dígitos):** día y mes de la compra en **hora de Caracas** (`America/Caracas`), no en UTC (un Worker corre en UTC y un pedido a las 10 pm cambiaría de día).
- **XXX (3 caracteres):** aleatorios del alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin `O`, `0`, `I`, `1` para evitar confusiones al leerlo o dictarlo). Genera con `crypto.getRandomValues`, no con `Math.random`.
- Espacio: 32³ = 32.768 combinaciones por prefijo por día, más que suficiente.
- **Unicidad garantizada:** el Worker genera el ID y lo manda en `createOrder`; Apps Script verifica bajo lock que no exista. Si existe, devuelve `DUPLICATE_ID` y el Worker reintenta con un nuevo sufijo (máximo 5 intentos).
- El ID se normaliza a mayúsculas y sin espacios en el tracking (el cliente puede escribir `cam-0810-k9r`).
- Pon esta lógica en una función pura `generateTrackId(items, catalog, date)` en `worker/src/trackId.js`, con tests (ver sección 10).

Pseudocódigo de referencia:

```js
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateTrackId(items, now = new Date()) {
  const main = items.reduce((a, b) => (b.precio * b.qty > a.precio * a.qty ? b : a));
  const prefix = main.id.slice(0, 3).toUpperCase();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Caracas', day: '2-digit', month: '2-digit',
  }).formatToParts(now);
  const ddmm = parts.find(p => p.type === 'day').value + parts.find(p => p.type === 'month').value;
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  const suffix = [...bytes].map(b => ALPHABET[b % 32]).join(''); // 256 % 32 = 0 → sin sesgo
  return `${prefix}-${ddmm}-${suffix}`;
}
```

## 6. FORMATO DEL MENSAJE PRE-ARMADO (Landing → WhatsApp)

El mensaje debe verse bien para un humano y contener al final una línea de código que el bot pueda leer aunque el cliente borre o edite el resto:

```
Hola Zonau! 🖤 Quiero hacer este pedido:

• 2x Camisa Oversize — $30
  Nota: negra, logo en el pecho
• 1x Taza Mágica — $10
  Nota: foto que envío por aquí

Total estimado: $40

#PEDIDO CAM-01*2|TAZ-01*1
```

- La línea `#PEDIDO` usa `ID*cantidad` separados por `|`. Las notas de personalización viajan en el texto legible; el bot las extrae buscando la línea `Nota:` debajo de cada ítem (si no puede, guarda el texto completo del mensaje en `Items_JSON` como nota general).
- El bot detecta un pedido con la regex `/#PEDIDO\s+([A-Z]{3}-\d{2}\*\d+(\|[A-Z]{3}-\d{2}\*\d+)*)/i`.
- Si un ID no existe o está inactivo, el bot lo informa y cotiza solo el resto (o pide volver al catálogo si nada es válido).
- Cantidad máxima por ítem: 50 (evita abusos); el link `wa.me` debe mantenerse por debajo de ~2000 caracteres.

## 7. BOT — CLOUDFLARE WORKER (`worker/`)

### Estructura

```
worker/
  wrangler.toml
  src/
    index.js        // router: GET /webhook (verificación), POST /webhook (mensajes)
    whatsapp.js     // enviar texto, botones interactivos, listas; descargar media
    sheets.js       // cliente del Apps Script (getConfig, getCatalogPrivate, uploadReceipt, createOrder)
    rates.js        // tasa BCV con caché y fallback
    state.js        // estado de conversación en KV
    flow.js         // máquina de estados
    trackId.js      // generación de Track_ID
    format.js       // formateo de montos USD y Bs.
  test/
```

### Requisitos técnicos

- **Verificación de webhook**: `GET` con `hub.mode`, `hub.verify_token`, `hub.challenge`.
- **Validación de firma**: verifica `X-Hub-Signature-256` con HMAC-SHA256 usando `META_APP_SECRET`. Rechaza con 401 si no coincide.
- **Responde 200 a Meta de inmediato** y procesa el mensaje con `ctx.waitUntil()` para evitar reintentos de Meta.
- **Idempotencia**: guarda en KV el `message.id` procesado (TTL 24 h) y descarta duplicados; Meta reenvía webhooks.
- Ignora eventos `statuses` (entregado/leído) y mensajes de grupos.
- Usa **mensajes interactivos** de WhatsApp (botones `reply` de hasta 3 opciones y `list` para más) para elegir tipo de pago, entrega y método. Acepta también texto libre como respaldo ("60", "completo", "zelle", "mrw").
- Marca los mensajes como leídos (`status: read`) al procesarlos.
- **Descarga de comprobante**: para `type: image` o `type: document` (PDF), obtén la URL con `GET https://graph.facebook.com/v21.0/{media_id}` y descarga el binario con el header `Authorization: Bearer WHATSAPP_TOKEN`; conviértelo a base64 y envíalo a `uploadReceipt`. Límite: 5 MB.
- Secrets (vía `wrangler secret put`): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `META_VERIFY_TOKEN`, `META_APP_SECRET`, `APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`.
- KV namespace `ZONAU_KV` para: estado de conversación (TTL 48 h), idempotencia, caché de tasa (TTL 30 min), caché de config/catálogo (TTL 5 min).
- Todas las llamadas externas con `AbortSignal.timeout()` y manejo de errores. Si algo falla, el bot nunca se queda callado: responde "Tuvimos un problema técnico, una persona te atenderá en breve 🙏" y registra el error con `console.error`.

### Tasa BCV (`rates.js`)

- Proveedor configurable con al menos dos fuentes públicas y fallback en cadena (por ejemplo `https://ve.dolarapi.com/v1/dolares/oficial` y la API de pydolarve para `page=bcv`). **Verifica que los endpoints respondan y su forma de JSON antes de codificarlos**, y aísla el parseo de cada proveedor en una función propia para poder cambiarlo fácilmente.
- Orden de prioridad: `Configuracion.Fuente_Tasa` numérica (forzada por la dueña) → API principal → API secundaria → última tasa válida en KV → `Configuracion.Tasa_Manual` → error controlado.
- Devuelve `{ tasa, fuente, fecha }` y el bot muestra la fecha de la tasa en la cotización.
- Montos en Bs. redondeados a 2 decimales con formato venezolano (`Bs. 1.234,56`). USD con formato `$40,00`.

### Máquina de estados (`flow.js`)

| Estado | Entrada esperada | Acción | Siguiente |
|---|---|---|---|
| `IDLE` | Cualquier texto sin `#PEDIDO` | Bienvenida + link al catálogo | `IDLE` |
| `IDLE` | Texto con `#PEDIDO` | Recalcula carrito, pide modalidad de entrega (botones) | `ESPERANDO_ENTREGA` |
| `ESPERANDO_ENTREGA` | Retiro / Delivery / MRW | Si es Delivery o MRW, pide datos de envío | `ESPERANDO_DIRECCION` o `ESPERANDO_TIPO_PAGO` |
| `ESPERANDO_DIRECCION` | Texto libre | Guarda dirección/datos MRW | `ESPERANDO_TIPO_PAGO` |
| `ESPERANDO_TIPO_PAGO` | 100% / Adelanto X% | Muestra montos | `ESPERANDO_METODO` |
| `ESPERANDO_METODO` | Método activo | Envía datos bancarios + monto exacto en la moneda del método | `ESPERANDO_COMPROBANTE` |
| `ESPERANDO_COMPROBANTE` | Imagen o PDF | Sube comprobante, genera Track_ID, `createOrder`, responde con tracking | `IDLE` |
| `ESPERANDO_COMPROBANTE` | Texto | Recuerda que debe enviar la foto del comprobante | igual |
| Cualquiera | "cancelar" | Borra el estado | `IDLE` |
| Cualquiera | Nuevo `#PEDIDO` | Reinicia con el nuevo carrito | `ESPERANDO_ENTREGA` |
| Cualquiera | "humano", "asesor", "ayuda" | Avisa que una persona responderá; pausa el bot 12 h para ese número | `PAUSADO` |

- **La cotización se congela** al momento de elegir método de pago: se guarda en KV la tasa, el porcentaje de adelanto y los precios. Si el cliente envía el comprobante 6 horas después, se registra con lo cotizado (no con la tasa nueva). Si pasan más de 24 h, el bot recotiza y lo avisa.
- Guarda en KV el nombre del perfil de WhatsApp (`contacts[0].profile.name`) como nombre del cliente.

## 8. EJEMPLOS DE CONVERSACIÓN (implementar exactamente este tono)

Incluye estos ejemplos en `docs/conversaciones.md` y úsalos como base de los tests de `flow.js`.

### A) Cliente que llega sin carrito

> **Cliente:** Hola, vi sus productos en Instagram, ¿qué precio tienen las tazas?
>
> **Bot:** ¡Hola! 🖤 Bienvenid@ a **Zonau**. Personalizamos camisas, tazas, llaveros y regalos a tu medida.
> Mira el catálogo completo con precios y tiempos de entrega aquí:
> 👉 https://zonau.example.com
> Elige lo que quieras, toca **"Pedir por WhatsApp"** y te llegará tu pedido listo a este chat.

### B) Pedido completo desde el catálogo, con adelanto y envío MRW

> **Cliente:** Hola Zonau! 🖤 Quiero hacer este pedido:
> • 2x Camisa Oversize — $30 · Nota: negra, logo en el pecho
> • 1x Taza Mágica — $10
> Total estimado: $40
> #PEDIDO CAM-01*2|TAZ-01*1
>
> **Bot:** ¡Recibido, Samuel! ✅ Este es tu pedido:
> • 2x Camisa Oversize — $30,00 _(negra, logo en el pecho)_
> • 1x Taza Mágica — $10,00
> **Subtotal: $40,00** · Listo en aprox. 3 días hábiles.
> ¿Cómo quieres recibirlo?
> [ Retiro en tienda ] [ Delivery Caracas ] [ Envío MRW ]
>
> **Cliente:** *(toca "Envío MRW")*
>
> **Bot:** Perfecto 📦 Envíame en un solo mensaje: nombre y cédula de quien recibe, teléfono, ciudad y agencia MRW.
> _El envío por MRW se paga a destino._
>
> **Cliente:** Samuel Herrera, V-12.345.678, 0414-1234567, Valencia, MRW Av. Bolívar Norte
>
> **Bot:** ¡Anotado! Total de tu pedido: **$40,00** (Bs. 14.600,00 · tasa BCV 365,00 del 08/10).
> Para iniciar tu pedido puedes:
> • Pagar el **100%**: $40,00 / Bs. 14.600,00
> • Pagar un **adelanto del 60%**: $24,00 / Bs. 8.760,00 y el restante ($16,00) antes del despacho.
> [ Pagar 100% ] [ Adelanto 60% ]
>
> **Cliente:** *(toca "Adelanto 60%")*
>
> **Bot:** ¿Con qué método vas a pagar?
> [ Pago Móvil ] [ Zelle ] [ Transferencia ]
>
> **Cliente:** *(toca "Pago Móvil")*
>
> **Bot:** Datos para **Pago Móvil** 💳
> Banco: Venezuela (0102)
> CI: V-XX.XXX.XXX
> Teléfono: 0414-XXXXXXX
> **Monto a pagar: Bs. 8.760,00** (60% de $40,00 a tasa BCV 365,00)
> Cuando pagues, envíame aquí la **foto o captura del comprobante** 📸
>
> **Cliente:** *(envía imagen)*
>
> **Bot:** ¡Pedido registrado! 🙌
> Tu número de seguimiento es: **CAM-0810-K9R**
> Consulta el estado de tu pedido cuando quieras aquí:
> 👉 https://zonau.example.com/tracking.html?id=CAM-0810-K9R
> Estado actual: _Pago por verificar_. Te avisaremos cuando confirmemos tu pago.
> Restante a pagar antes del despacho: **$16,00**. El número de guía MRW aparecerá en el link cuando enviemos tu paquete.

### C) Cliente que escribe texto cuando se espera el comprobante

> **Cliente:** ya pagué
>
> **Bot:** ¡Genial! Solo me falta la **foto o captura del comprobante** para registrar tu pedido 📸 Envíala por aquí.

### D) Producto inexistente o inactivo en el mensaje

> **Bot:** Ojo 👀 el producto **LLA-07** ya no está disponible, así que no lo incluí. Este es tu pedido actualizado: ...

### E) La API de la tasa falla y no hay respaldo

> **Bot:** Tu pedido quedó en **$40,00**. En este momento no pude consultar la tasa BCV; si pagas en bolívares, una persona te confirmará el monto exacto en unos minutos 🙏

## 9. FRONTEND (`web/`)

### Archivos

```
web/
  index.html      // catálogo + carrito
  tracking.html   // consulta de pedido
  styles.css
  js/
    config.js     // API_URL del Apps Script (TODO) — único lugar con la URL
    api.js        // fetch con timeout y caché en sessionStorage
    catalog.js    // render de tarjetas, filtros por categoría
    cart.js       // carrito en localStorage, armado del mensaje y del link wa.me
    tracking.js   // consulta y línea de tiempo
  assets/
```

### Diseño — estética de @zonau.ccs

- Inspirado en el Instagram **@zonau.ccs**: revisa su perfil y extrae la paleta real (colores de su logo, feed y highlights). Define todo como variables CSS en `:root` (`--color-bg`, `--color-fg`, `--color-accent`, `--color-muted`, `--font-display`, `--font-body`) para que yo pueda ajustar los colores exactos en un solo lugar. Como punto de partida usa: fondo blanco hueso, negro profundo, grises carbón y **un solo color de acento** de la marca.
- Minimalista, urbano y crudo, estilo streetwear caraqueño: tipografía sans-serif gruesa para títulos (Google Fonts, ej. "Archivo Black" o "Space Grotesk"), bordes rectos, líneas de 2 px, mucho espacio en blanco, fotos de producto protagonistas en formato cuadrado, sin sombras difusas ni gradientes.
- Mobile-first (la mayoría llega desde Instagram en el teléfono). Sin scroll horizontal. Botones táctiles de mínimo 44 px.
- Accesible: contraste AA, `alt` en imágenes, foco visible, `aria-live` en el contador del carrito y en el resultado del tracking.
- Modo claro únicamente (es la estética de la marca), a menos que la paleta de Instagram sea oscura; en ese caso, modo oscuro únicamente.

### `index.html`

- Header con logo/nombre, link a "Rastrea tu pedido".
- Hero corto: "Lo que imaginas, lo personalizamos." + CTA al catálogo.
- Filtros por categoría (chips) generados desde los datos.
- Tarjetas: imagen, nombre, descripción, precio USD, tiempo de entrega, selector de cantidad (− / +) y campo opcional "Detalles de personalización".
- Barra/botón flotante inferior con el número de ítems y el total, que abre un panel de resumen del carrito y el botón **"Pedir por WhatsApp"**.
- Bloque "¿Cómo funciona?" con 4 pasos: Elige → Pide por WhatsApp → Paga el 100% o el {Porcentaje_Adelanto}% → Rastrea tu pedido. El porcentaje sale de la API.
- Estados de carga (skeletons), error con botón reintentar, y catálogo vacío.
- Si un producto del carrito guardado ya no existe en el catálogo, se elimina en silencio al cargar.

### `tracking.html`

- Input para el Track_ID (autocompletado desde `?id=` en la URL) y botón "Consultar".
- Línea de tiempo visual según la modalidad:
  - Retiro: Pago por verificar → En proceso → Listo para retirar → Entregado
  - Delivery: Pago por verificar → En proceso → Listo para despacho → Enviado → Entregado
  - MRW: Pago por verificar → En proceso → Listo para despacho → Enviado (con **guía MRW** y botón para copiarla + link a la web de rastreo de MRW) → Entregado
- Si `Restante_USD > 0` y el estatus es "Listo para retirar" o "Listo para despacho", muestra un aviso: "Tu pedido está listo. Recuerda pagar el restante de $X para retirarlo / despacharlo" con botón a WhatsApp.
- Estado `Cancelado` con estilo propio. ID no encontrado con mensaje amable.
- Actualiza la URL con `history.replaceState` para que el link se pueda compartir.

### Notas técnicas del frontend

- `fetch` GET al Web App de Apps Script (sigue la redirección 302 por defecto; no envíes headers personalizados para evitar preflight CORS).
- Escapa todo el texto que venga del Sheet antes de insertarlo en el DOM (usa `textContent`, no `innerHTML` con datos).
- Imágenes con `loading="lazy"`, `width`/`height` definidos, y fallback si la URL falla. Documenta cómo usar imágenes de Google Drive (formato de URL directo) o subirlas a `web/assets/`.

## 10. CALIDAD Y PRUEBAS

- Tests con **Vitest** solo para el Worker (`worker/test/`): `generateTrackId` (formato, alfabeto sin O/0/I/1, prefijo del ítem principal, fecha en hora de Caracas cerca de medianoche UTC), parseo de `#PEDIDO`, cálculo de montos (100%, 60%, con envío, redondeo), y la máquina de estados usando los ejemplos de la sección 8 con `fetch` mockeado.
- Un script `worker/scripts/simulate.js` que envíe al Worker local (`wrangler dev`) los payloads de ejemplo de Meta (texto, interactivo, imagen) para probar la conversación sin un teléfono real. Incluye los JSON de ejemplo en `worker/test/fixtures/`.
- Prueba los HTML en un navegador real a 375 px y 1280 px de ancho, con datos de ejemplo (`web/js/config.js` debe permitir `USE_MOCK = true` para cargar `web/mock/catalog.json` y `web/mock/tracking.json` sin backend).

## 11. ENTREGABLES

1. `web/` — `index.html`, `tracking.html`, `styles.css`, `js/*.js`, `mock/*.json`.
2. `apps-script/Codigo.gs` (+ `appsscript.json` con zona horaria `America/Caracas`).
3. `worker/` — código del bot, `wrangler.toml`, tests y simulador.
4. `sheets/plantilla/Catalogo.csv`, `Pedidos.csv`, `Configuracion.csv` con datos de ejemplo.
5. `docs/conversaciones.md` — los ejemplos de la sección 8, más una tabla con cómo queda cada fila en la pestaña Pedidos después de cada ejemplo.
6. `docs/track-id.md` — explicación de la lógica del Track_ID para la dueña.
7. `docs/manual-duena.md` — guía para la dueña, en lenguaje no técnico: cómo agregar productos, cambiar precios, cambiar el % de adelanto o el costo del delivery, verificar pagos, cambiar estatus y cargar la guía MRW.
8. `README.md` — instrucciones paso a paso:
   - Crear el Google Sheet, pegar el Apps Script, configurar las Propiedades del Script, ejecutar `setup()` y publicar como Web App ("Ejecutar como: yo", "Acceso: cualquier persona").
   - Crear la app en Meta for Developers, obtener el número de prueba, generar el token permanente (usuario del sistema), configurar el webhook con la URL del Worker y el verify token, y suscribirse al campo `messages`.
   - `wrangler kv namespace create`, `wrangler secret put` para cada secreto, `wrangler deploy`.
   - Publicar `web/` en Cloudflare Pages o GitHub Pages y actualizar `URL_Catalogo` y `URL_Tracking` en Configuracion.
   - Lista de verificación de punta a punta (pedido de prueba completo).

## 12. FASE 2 (dejar preparado, no implementar todavía)

- Notificar al cliente por WhatsApp cuando la dueña cambie el estatus en Sheets (trigger `onEdit` instalable → POST al Worker → mensaje). Documenta que fuera de la ventana de 24 h de WhatsApp esto requiere **plantillas aprobadas por Meta**.
- Recordatorio automático del saldo restante cuando el estatus pase a "Listo".
- Pestaña `Zonas_Delivery` con costo por zona de Caracas (por ahora es un solo costo en Configuracion).

## 13. FORMA DE TRABAJO

1. Empieza creando la estructura de carpetas y el `README.md` con el plan.
2. Fase 1: Apps Script + plantillas CSV. Commit.
3. Fase 2: Frontend con datos mock. Pruébalo en el navegador. Commit.
4. Fase 3: Worker + tests + simulador. Corre los tests. Commit.
5. Fase 4: Documentación (conversaciones, track-id, manual de la dueña). Commit.
6. Al final, dame un resumen con: lo que quedó listo, cada `TODO` que debo completar yo (con archivo y línea) y los pasos exactos para ponerlo en producción.
