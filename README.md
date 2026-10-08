# Zonau — Catálogo + Bot de WhatsApp + Seguimiento de pedidos

Sistema de ventas para **Zonau** (@zonau.ccs), tienda de productos personalizados en Caracas.

```
Instagram ─► web/index.html (catálogo + carrito)
         ─► "Pedir por WhatsApp" (mensaje pre-armado con #PEDIDO)
         ─► worker/ (bot: entrega, 100% o adelanto, tasa BCV, datos de pago, comprobante)
         ─► apps-script/ (Google Sheets: Catalogo, Pedidos, Configuracion)
         ─► web/tracking.html?id=CAM-0810-K9R (el cliente ve el estatus)
```

| Carpeta | Qué es |
|---|---|
| `web/` | Sitio estático (HTML, CSS y JS vanilla). Catálogo con carrito y página de seguimiento. |
| `apps-script/` | Backend: Google Sheets expuesto como API con Apps Script (`doGet` / `doPost`). |
| `worker/` | Bot de WhatsApp en Cloudflare Workers + KV. Incluye tests y un simulador. |
| `sheets/plantilla/` | CSV de ejemplo de las 3 pestañas. |
| `docs/` | [Conversaciones del bot](docs/conversaciones.md) · [Lógica del Track_ID](docs/track-id.md) · [Manual de la dueña](docs/manual-duena.md) |
| `PROMPT_MAESTRO.md` | El prompt con el que se especificó el sistema. |

## Probar sin configurar nada

```bash
cd web && python3 -m http.server 8080
# http://localhost:8080             -> catálogo con datos de ejemplo
# http://localhost:8080/tracking.html?id=CAM-0610-A2P  -> pedido "Enviado" con guía MRW
```

Mientras `API_URL` en `web/js/config.js` tenga `TODO`, la web usa `web/mock/*.json`.
IDs de ejemplo: `CAM-0810-K9R`, `TAZ-0710-X8B`, `CAM-0610-A2P`, `LLA-0510-HJK`.

```bash
cd worker && npm install && npm test   # 35 pruebas del bot
```

---

## Puesta en producción

### 1. Google Sheet + Apps Script

1. Crea un Google Sheet nuevo (ej. "Zonau — Sistema").
2. **Extensiones → Apps Script**. Borra el contenido y pega `apps-script/Codigo.gs`.
3. En **Configuración del proyecto** (⚙):
   - Marca "Mostrar el archivo de manifiesto" y pega `apps-script/appsscript.json` (zona horaria Caracas).
   - En **Propiedades del script** agrega:
     | Propiedad | Valor |
     |---|---|
     | `API_SECRET` | Una clave larga al azar (ej. `openssl rand -hex 24`). |
     | `DRIVE_FOLDER_ID` | Crea una carpeta en Drive "Comprobantes Zonau"; el ID es la parte final del link `drive.google.com/drive/folders/<ID>`. |
4. En el editor elige la función **`seed`** y presiona **Ejecutar**. Acepta los permisos.
   Crea las 3 pestañas con encabezados, listas desplegables y colores, y carga productos y configuración de ejemplo.
   (Si prefieres empezar vacío, ejecuta `setup`.)
5. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**
   - Copia la URL que termina en `/exec`.
6. Prueba: abre `<URL>/exec?action=getCatalog` en el navegador. Debe mostrar JSON con `"ok":true`.

> Cada vez que cambies el código de Apps Script: **Implementar → Gestionar implementaciones → Editar → Versión: nueva**. Así la URL no cambia.

### 2. Web (Cloudflare Pages o GitHub Pages)

1. En `web/js/config.js` pon `API_URL` (la URL `/exec`) y `WHATSAPP_FALLBACK`.
2. Publica la carpeta `web/`:
   - **Cloudflare Pages:** Workers & Pages → Create → Pages → conecta el repo → *Build output directory*: `web`, sin comando de build.
   - **GitHub Pages:** Settings → Pages → publica desde la rama, carpeta `/web` (o mueve el contenido a `/docs`).
3. En la pestaña **Configuracion** del Sheet actualiza `URL_Catalogo` y `URL_Tracking` con el dominio real.

### 3. App de WhatsApp en Meta

1. En [developers.facebook.com](https://developers.facebook.com) crea una app tipo **Business** y agrega el producto **WhatsApp**.
2. En **WhatsApp → Configuración de la API** anota el **Phone number ID**. Para pruebas, Meta te da un número de prueba; para producción agrega el número de la tienda.
3. Crea un **token permanente**: Business Settings → Usuarios del sistema → nuevo usuario (Admin) → Generar token con permisos `whatsapp_business_messaging` y `whatsapp_business_management`. (El token temporal de la consola vence en 24 h.)
4. En **Configuración de la app → Básica** copia la **Clave secreta de la app** (sirve para verificar que los mensajes vienen de Meta).

> **Importante — número de la tienda:** con la Cloud API los mensajes llegan al bot, no a la app de WhatsApp.
> Para que la dueña siga viendo y respondiendo los chats desde su teléfono (por ejemplo, cuando un cliente pide "asesor"),
> registra el número usando la **coexistencia con la app WhatsApp Business** al conectar el número en Meta.
> Si el número no admite coexistencia, usa un número nuevo solo para el bot.

### 4. Bot (Cloudflare Worker)

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create ZONAU_KV     # copia el id en wrangler.toml
npx wrangler secret put WHATSAPP_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put META_VERIFY_TOKEN       # inventa un texto, ej. zonau-verify-2026
npx wrangler secret put META_APP_SECRET
npx wrangler secret put APPS_SCRIPT_URL         # la URL /exec
npx wrangler secret put APPS_SCRIPT_SECRET      # igual a API_SECRET de Apps Script
npx wrangler deploy
```

Te devuelve una URL como `https://zonau-bot.<tu-cuenta>.workers.dev`.

### 5. Conectar el webhook

En Meta → WhatsApp → **Configuración** → Webhook → Editar:
- URL de devolución de llamada: `https://zonau-bot.<tu-cuenta>.workers.dev/webhook`
- Token de verificación: el mismo `META_VERIFY_TOKEN`
- Verificar y guardar. Luego en **Campos del webhook** suscríbete a **`messages`**.

### 6. Prueba de punta a punta

- [ ] La web muestra los productos del Sheet (no los de ejemplo).
- [ ] Agregar 2 productos con nota → "Pedir por WhatsApp" abre el chat con el mensaje y la línea `#PEDIDO`.
- [ ] El bot responde con el resumen y los botones de entrega.
- [ ] Elegir MRW → enviar datos → aparecen montos en $ y Bs. con la tasa del día.
- [ ] Elegir adelanto → Pago Móvil → llegan los datos de `Datos_PagoMovil` y el monto en Bs.
- [ ] Enviar una foto → llega el número de seguimiento.
- [ ] En el Sheet aparece la fila con estatus *Pago por verificar* y el link del comprobante abre la imagen en Drive.
- [ ] El link de seguimiento muestra el pedido. Cambiar Estatus a *Enviado* y poner una guía → aparece en la web (máx. 5 min por caché del navegador; recarga).
- [ ] Escribir "asesor" → el bot avisa y deja de responder.

---

## Desarrollo local del bot

```bash
cd worker
cp .dev.vars.example .dev.vars    # rellena con tus valores (APPS_SCRIPT_URL real si quieres escribir en el Sheet)
npm run dev                        # http://localhost:8787
npm run simulate -- text "Hola"
npm run simulate -- text "$(cat test/fixtures/cart-message.txt)"
npm run simulate -- button ENT_MRW "Envío MRW"
npm run simulate -- image MEDIA_ID
```

El simulador firma los payloads con `META_APP_SECRET` (por defecto `dev-secret`). Las respuestas del bot
intentan enviarse por la API de Meta y se ven en la consola de `wrangler dev`.

## Seguridad

- Ningún token está en el código: van en `wrangler secret` y en Propiedades del script.
- El Worker rechaza (401) cualquier POST sin firma válida de Meta (`X-Hub-Signature-256`).
- Las acciones de escritura de Apps Script exigen `API_SECRET`. La ruta pública solo entrega catálogo, configuración no sensible y el estatus del pedido (sin teléfono, comprobante ni notas internas).
- Los precios siempre se recalculan con la pestaña Catalogo; editar el mensaje de WhatsApp no cambia el total.
- Las celdas de texto que empiezan con `= + - @` se guardan como texto (evita inyección de fórmulas).
- Los comprobantes quedan privados en Drive.

## Pendientes (`TODO`) que debes completar

| Archivo | Qué |
|---|---|
| `web/styles.css:7` | Colores exactos de la marca (variables `--color-*`). |
| `web/js/config.js:4` | `API_URL` del Web App. |
| `web/js/config.js:12` | `WHATSAPP_FALLBACK`. |
| `web/js/config.js:15` | URL de rastreo de MRW. |
| `worker/wrangler.toml:9` | ID del namespace KV. |
| Secrets del Worker | Ver paso 4. |
| Propiedades del script | `API_SECRET`, `DRIVE_FOLDER_ID`. |
| Pestaña Configuracion | WhatsApp, URLs, datos de pago, info de retiro. |
| Imágenes | Columna `URL_Imagen` del Catalogo (o archivos en `web/assets/`). |

## Fase 2 (preparada, no implementada)

- **Avisar al cliente cuando cambia el estatus:** un trigger `onEdit` *instalable* en Apps Script puede hacer `UrlFetchApp.fetch` a una ruta nueva del Worker que envíe el mensaje. Fuera de la ventana de 24 h desde el último mensaje del cliente, WhatsApp solo permite **plantillas aprobadas por Meta**, así que hay que crear plantillas como `pedido_listo` y `pedido_enviado`.
- **Recordatorio del saldo** cuando el estatus pasa a "Listo".
- **Pestaña `Zonas_Delivery`** con costo por zona de Caracas (hoy es un único `Costo_Delivery_USD`).
