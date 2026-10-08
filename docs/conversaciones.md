# Conversaciones del bot

Estos textos los genera el código real del bot (`worker/src/flow.js`) y se prueban en
`worker/test/flow.test.js`. En los ejemplos la tasa BCV es 365,00, el adelanto es 60%
y el delivery cuesta $3. En producción esos valores salen de la pestaña **Configuracion**.

Los `[Botones]` son botones de WhatsApp. El cliente también puede escribir la respuesta
("mrw", "60", "zelle", "completo").

---

## A) El cliente escribe sin pasar por el catálogo

> **Cliente:** Hola, vi sus productos en Instagram, ¿qué precio tienen las tazas?
>
> **Bot:** ¡Hola! 🖤 Bienvenid@ a *Zonau*. Personalizamos camisas, tazas, llaveros y regalos a tu medida.
>
> Mira el catálogo completo con precios y tiempos de entrega aquí:
> 👉 https://zonau.example.com
>
> Elige lo que quieras, toca *"Pedir por WhatsApp"* y te llegará tu pedido listo a este chat.

El bot no arma carritos por chat. Siempre manda al catálogo.

## B) Pedido completo: adelanto del 60%, envío MRW y Pago Móvil

El cliente arma el carrito en la web y toca **Pedir por WhatsApp**. WhatsApp se abre con este mensaje ya escrito:

> **Cliente:** Hola Zonau! 🖤 Quiero hacer este pedido:
>
> • 2x Camisa Oversize — $30,00
>   Nota: negra, logo en el pecho
> • 1x Taza Mágica — $10,00
>
> Total estimado: $40,00
>
> #PEDIDO CAM-01*2|TAZ-01*1

La última línea (`#PEDIDO …`) es la que lee el bot. Los precios del texto solo son informativos: el bot los vuelve a calcular con la pestaña Catalogo, así nadie puede cambiar el precio editando el mensaje.

> **Bot:** ¡Recibido, Samuel! ✅ Este es tu pedido:
> • 2x Camisa Oversize — $30,00
>    _negra, logo en el pecho_
> • 1x Taza Mágica — $10,00
>
> *Subtotal: $40,00* · Listo en aprox. 3 días hábiles.
>
> ¿Cómo quieres recibirlo?
> [Retiro en tienda] [Delivery +$3,00] [Envío MRW]

> **Cliente:** *(toca "Envío MRW")*
>
> **Bot:** Perfecto 📦 Envíame en un solo mensaje: nombre y cédula de quien recibe, teléfono, ciudad y agencia MRW.
> _El envío por MRW se paga a destino._

> **Cliente:** Samuel Herrera, V-12.345.678, 0414-1234567, Valencia, MRW Av. Bolívar Norte
>
> **Bot:** ¡Anotado! ✍️
>
> **Bot:** Total de tu pedido: *$40,00* (Bs. 14.600,00 · tasa BCV 365,00 del 08/10).
>
> Para iniciar tu pedido puedes:
> • Pagar el *100%*: $40,00 / Bs. 14.600,00
> • Pagar un *adelanto del 60%*: $24,00 / Bs. 8.760,00 y el restante ($16,00) antes del despacho.
> [Pagar 100%] [Adelanto 60%]

> **Cliente:** *(toca "Adelanto 60%")*
>
> **Bot:** ¿Con qué método vas a pagar?
> [Pago Móvil] [Zelle] [Transferencia]

> **Cliente:** *(toca "Pago Móvil")*
>
> **Bot:** Datos para *Pago Móvil* 💳
> Banco: Venezuela (0102)
> CI: V-XX.XXX.XXX
> Teléfono: 0414-XXXXXXX
>
> *Monto a pagar: Bs. 8.760,00* (60% de $40,00 a tasa BCV 365,00)
>
> Cuando pagues, envíame aquí la *foto o captura del comprobante* 📸

## C) El cliente escribe cuando el bot espera el comprobante

> **Cliente:** ya pagué
>
> **Bot:** ¡Genial! Solo me falta la *foto o captura del comprobante* para registrar tu pedido 📸 Envíala por aquí.

> **Cliente:** *(envía la foto del comprobante)*
>
> **Bot:** ¡Pedido registrado! 🙌
> Tu número de seguimiento es: *CAM-0810-K9R*
>
> Consulta el estado de tu pedido cuando quieras aquí:
> 👉 https://zonau.example.com/tracking.html?id=CAM-0810-K9R
>
> Estado actual: _Pago por verificar_. Te avisaremos cuando confirmemos tu pago.
> Restante a pagar antes del despacho: *$16,00*.
> El número de guía MRW aparecerá en el link cuando enviemos tu paquete.

## D) Un producto ya no está disponible

> **Cliente:** … #PEDIDO LLA-07*1|TAZ-01*1
>
> **Bot:** Ojo 👀 *LLA-07* ya no está disponible, así que no lo incluí.
>
> ¡Recibido! ✅ Este es tu pedido:
> • 1x Taza Mágica — $10,00
> …

## E) La API de la tasa BCV no responde y no hay tasa de respaldo

> **Bot:** Total de tu pedido: *$40,00*.
> …
> _No pude consultar la tasa BCV en este momento; si pagas en bolívares te confirmamos el monto exacto._

Si el cliente elige Pago Móvil:

> **Bot:** *Monto a pagar: $40,00* (100% de $40,00). En este momento no pude consultar la tasa BCV; una persona te confirmará el monto exacto en bolívares 🙏

El pedido se registra igual, con `Tasa_BCV` vacía.

## Otros comandos

| El cliente escribe | El bot hace |
|---|---|
| `cancelar` | Borra el pedido en curso y manda el link del catálogo. |
| `asesor`, `humano`, `una persona` | Avisa que alguien del equipo responderá y **se calla 12 horas** con ese cliente. Un pedido nuevo desde el catálogo lo reactiva. |
| `estado`, `mi pedido`, `seguimiento` | Manda el link de la página de seguimiento. |
| `gracias`, `ok`, `listo` | Responde corto, sin repetir la bienvenida. |
| Una foto fuera del paso del comprobante | "¡Recibí tu imagen! Si es para personalizar…" |
| Comprobante más de 24 h después de cotizar | Recalcula con la tasa del día, muestra el monto nuevo y pide reenviar el comprobante. |

---

## Cómo queda cada pedido en la pestaña Pedidos

Fila que crea el ejemplo **B** (copiada de la salida real del bot):

| Columna | Valor |
|---|---|
| Track_ID | `CAM-0810-K9R` |
| Fecha | 08/10/2026 11:00 |
| Cliente | Samuel Herrera |
| Telefono | 584141234567 |
| Pedido | 2x Camisa Oversize (negra, logo en el pecho) · 1x Taza Mágica |
| Items_JSON *(oculta)* | `[{"id":"CAM-01","qty":2,"precio":15,"nota":"negra, logo en el pecho"},{"id":"TAZ-01","qty":1,"precio":10,"nota":""}]` |
| Subtotal_USD | $40,00 |
| Envio_USD | $0,00 |
| Total_USD | $40,00 |
| Tipo_Pago | Adelanto |
| Porcentaje_Pagado | 60 |
| Monto_Pagado_USD | $24,00 |
| Restante_USD | **$16,00** (en rojo hasta que sea 0) |
| Metodo_Pago | Pago Móvil |
| Tasa_BCV | 365 |
| Monto_Pagado_VES | Bs. 8.760,00 |
| Modalidad_Entrega | Envío MRW |
| Direccion_Envio | Samuel Herrera, V-12.345.678, 0414-1234567, Valencia, MRW Av. Bolívar Norte |
| URL_Comprobante | enlace al archivo en Google Drive |
| Estatus | Pago por verificar |
| Guia_MRW | *(vacío: lo llena la dueña al despachar)* |
| Notas_Internas | *(vacío)* |
| Actualizado | 08/10/2026 11:00 |

Otras variantes:

| Caso | Diferencias en la fila |
|---|---|
| Retiro + 100% + Zelle | `Tipo_Pago = Completo`, `Porcentaje_Pagado = 100`, `Restante_USD = 0`, `Monto_Pagado_VES` vacío (Zelle es en USD), `Guia_MRW = -` |
| Delivery + adelanto | `Envio_USD = 3`, `Total_USD = 43`, `Monto_Pagado_USD = 25,80`, `Restante_USD = 17,20` |
| Sin tasa BCV | `Tasa_BCV` y `Monto_Pagado_VES` vacíos |
| Falló la subida del comprobante | `URL_Comprobante = PENDIENTE: ver comprobante en WhatsApp`. El pedido no se pierde. |
