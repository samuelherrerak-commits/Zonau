# El número de seguimiento (Track_ID)

Cada pedido recibe un código único como este:

```
CAM-0810-K9R
 │    │    └── 3 caracteres al azar
 │    └─────── día y mes de la compra (08 de octubre)
 └──────────── producto principal (CAM = camisas)
```

## Cómo se arma

1. **Prefijo (3 letras):** son las 3 primeras letras del `ID_Servicio` del producto
   principal del pedido. El principal es el que más dinero suma (precio × cantidad).
   Si hay empate, el primero del carrito.
   - 2 camisas de $15 ($30) + 1 taza de $10 → `CAM`
   - 1 llavero de $4 → `LLA`
   - Por eso los IDs del catálogo deben ser 3 letras, guion y 2 números (`CAM-01`, `TAZ-02`).
2. **Fecha (4 números):** día y mes **en hora de Caracas**. Un pedido hecho el 8 de octubre a las
   10:30 pm sigue siendo `0810` (aunque en el servidor ya sea 9 de octubre).
3. **Final (3 caracteres):** letras y números al azar, **sin O, 0, I ni 1**, para que nadie confunda
   una "O" con un cero al leerlo o dictarlo por teléfono. Quedan 32 caracteres posibles.

## ¿Se puede repetir?

No. Para un mismo producto y día hay 32 × 32 × 32 = **32.768** códigos posibles. Además:

- El bot genera el código y lo envía a Google Sheets.
- Google Sheets revisa (con un "candado", para que dos pedidos al mismo tiempo no choquen) si
  ese código ya existe en la columna `Track_ID`.
- Si ya existe, responde `DUPLICATE_ID` y el bot genera otro. Lo intenta hasta 5 veces.

## Dónde está el código

| Qué | Archivo |
|---|---|
| Generación | `worker/src/trackId.js` → `generateTrackId()` |
| Verificación de duplicados | `apps-script/Codigo.gs` → `createOrder_()` |
| Pruebas | `worker/test/trackId.test.js` |

## Para el cliente

- Puede escribirlo en minúsculas o con espacios: `cam-0810-k9r` funciona igual.
- El link directo es `https://<tu-dominio>/tracking.html?id=CAM-0810-K9R`.
- La página de seguimiento **nunca** muestra el teléfono, el comprobante ni las notas internas.
  Solo muestra el nombre abreviado ("Samuel H."), el pedido, el estatus y la guía MRW.
