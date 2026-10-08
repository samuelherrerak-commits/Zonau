# Manual para la dueña

Todo se maneja desde el **Google Sheet**. No hace falta tocar código.
Los cambios del catálogo y de la configuración tardan **hasta 5 minutos** en verse en la web y en el bot.

---

## 1. Productos (pestaña **Catalogo**)

| Columna | Qué poner |
|---|---|
| ID_Servicio | Código único: 3 letras, guion, 2 números. Ej: `CAM-03`. **Las 3 letras aparecen en el número de seguimiento**, así que usa siempre las mismas por tipo (CAM camisas, TAZ tazas, LLA llaveros, REG regalos…). No cambies el ID de un producto que ya se vende. |
| Categoria | Camisas, Tazas, Llaveros, Regalos… Crea los filtros de la web. |
| Nombre | Como lo verá el cliente. |
| Descripcion | Una línea corta. |
| Precio_USD | Solo el número: `15` o `12.5`. |
| Tiempo_Entrega | Texto libre: `3 días hábiles`. |
| URL_Imagen | Link de la foto. Si está en Google Drive: compártela como "Cualquier persona con el enlace" y pega el link tal cual. |
| Personalizable | ☑ si el cliente puede escribir detalles (color, talla, texto). |
| Activo | ☑ para mostrarlo. Desmárcalo para ocultarlo sin borrarlo. |
| Orden | 1, 2, 3… Orden en la web. |

**Agregar un producto:** escribe una fila nueva al final.
**Quitar un producto:** desmarca *Activo* (mejor que borrar la fila).

## 2. Configuración (pestaña **Configuracion**)

Cambia solo la columna **Valor**. No cambies los nombres de la columna Variable.

| Variable | Para qué sirve |
|---|---|
| Porcentaje_Adelanto | El % mínimo para empezar un trabajo. Pon `100` si quieres exigir el pago completo. |
| Metodos_Activos | Los métodos que el bot ofrece, separados por coma: `Pago Móvil, Zelle, Transferencia`. |
| Metodos_En_Bolivares | Cuáles se cobran en Bs. con la tasa BCV. Los demás se cobran en $. |
| Datos_PagoMovil, Datos_Zelle… | Lo que el bot envía al cliente cuando elige ese método. Puedes usar varias líneas (Alt+Enter / Cmd+Enter dentro de la celda). Para un método nuevo, por ejemplo "Binance", agrégalo a Metodos_Activos y crea la fila `Datos_Binance`. |
| Costo_Delivery_USD | Lo que se suma si eligen delivery en Caracas. |
| Costo_Envio_MRW_USD | `0` si el envío MRW es cobro a destino. |
| Nota_Envio_MRW | Aviso que el bot muestra al elegir MRW. |
| Info_Retiro | Dirección y horario. El bot lo envía al elegir retiro en tienda. |
| Fuente_Tasa | `auto` = la tasa BCV de internet. Si escribes un número (ej. `365.5`), el bot usa ese número hasta que vuelvas a poner `auto`. |
| Tasa_Manual | Respaldo por si la tasa de internet falla. |
| Mensaje_Bienvenida | Si lo dejas vacío el bot usa su saludo. Si escribes algo, usa tu texto (incluye el link del catálogo). |
| WhatsApp_Ventas | El número que abre el botón de la web. |

## 3. Pedidos (pestaña **Pedidos**)

Cada pedido llega solo, en una fila nueva, con estatus **Pago por verificar**.

### Rutina con cada pedido nuevo

1. Abre el link de **URL_Comprobante** y verifica que el pago llegó a tu cuenta
   (monto en **Monto_Pagado_VES** o **Monto_Pagado_USD**).
2. Cambia **Estatus** a **En proceso**. La columna *Actualizado* se pone sola.
3. Cuando termines el producto:
   - Si es **Retiro**: Estatus → **Listo para retirar**.
   - Si es **Delivery** o **Envío MRW**: Estatus → **Listo para despacho**.
   - Si **Restante_USD** es mayor que 0 (en rojo), el cliente verá en su link de seguimiento
     un aviso para pagar el restante.
4. Cuando cobres el restante, cambia **Restante_USD** a `0` y anota en **Notas_Internas**
   (ej. "Saldo cobrado 08/10 Pago Móvil").
5. Al despachar por MRW: copia el número de guía en **Guia_MRW** y Estatus → **Enviado**.
6. Al entregar: Estatus → **Entregado**.

### Los estatus

| Estatus | El cliente ve |
|---|---|
| Pago por verificar | "Recibimos tu comprobante y lo estamos verificando." |
| En proceso | "Pago confirmado. Estamos personalizando tu pedido." |
| Listo para retirar | "¡Tu pedido está listo! Puedes pasar a retirarlo." (+ aviso de saldo si debe) |
| Listo para despacho | "Tu pedido está listo y en preparación para el envío." (+ aviso de saldo si debe) |
| Enviado | "Tu pedido va en camino." + número de guía MRW con botón para copiarlo |
| Entregado | "Pedido entregado. ¡Gracias por tu compra! 🖤" |
| Cancelado | "Este pedido fue cancelado." + botón de WhatsApp |

### Cosas que conviene saber

- **No cambies los títulos de las columnas** (fila 1). El orden sí lo puedes cambiar.
- **Notas_Internas** y el teléfono nunca se muestran al cliente.
- Los comprobantes se guardan en la carpeta de Google Drive configurada y solo tú puedes abrirlos.
- Si un cliente escribe "asesor", el bot deja de responderle por 12 horas para que tú lo atiendas.
- Si el link del comprobante dice **PENDIENTE**, hubo un problema al guardar la imagen:
  búscala en el chat de WhatsApp de ese cliente.
