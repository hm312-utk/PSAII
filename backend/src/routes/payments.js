import { Router } from 'express';
import { config } from '../config.js';
import { pool, withTransaction } from '../db/pool.js';
import { gateway } from '../gateways/index.js';
import { AppError } from '../middleware/errors.js';
import { formatMinorUnits, toMinorUnits } from '../utils/money.js';
import { runOnce } from '../utils/idempotency.js';

const router = Router();

const MAX_TOKEN_LENGTH = 8192; // los tokens de Google Pay pesan pocos KB
const MESA_RE = /^[\p{L}\p{N} _-]{1,20}$/u; // "5", "Mesa 12", "Para llevar", "Mostrador"…
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_ITEMS = 50;
const MAX_CANTIDAD_POR_ITEM = 50;

/**
 * Valida la forma de la petición y fusiona líneas repetidas del mismo producto
 * (si el cliente manda el mismo id_producto dos veces, se suman las cantidades
 * en vez de tratarlo como un error).
 * Todo lo que llega del cliente es no confiable — esto es solo la forma, no los precios:
 * los precios se resuelven después contra la base de datos, nunca contra lo que mande el cliente.
 */
function parseOrderRequest(body, idempotencyKey) {
  const { paymentToken, numero_mesa, currency, items } = body ?? {};
  const invalid = (message) => new AppError(400, 'INVALID_REQUEST', message);

  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    throw invalid('Falta la cabecera Idempotency-Key (16 a 64 caracteres: letras, números, "-" o "_")');
  }
  if (typeof paymentToken !== 'string' || paymentToken.length === 0 || paymentToken.length > MAX_TOKEN_LENGTH) {
    throw invalid('paymentToken es obligatorio y debe ser un string');
  }
  if (typeof numero_mesa !== 'string' || !MESA_RE.test(numero_mesa.trim())) {
    throw invalid('numero_mesa es obligatorio (máx. 20 caracteres: letras, números, espacio, "-" o "_")');
  }
  if (typeof currency !== 'string' || !config.allowedCurrencies.includes(currency.toUpperCase())) {
    throw invalid(`currency no permitida. Usa una de: ${config.allowedCurrencies.join(', ')}`);
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    throw invalid(`items debe ser un arreglo de 1 a ${MAX_ITEMS} productos`);
  }

  const cantidadPorProducto = new Map(); // fusiona líneas repetidas
  for (const item of items) {
    const id = Number(item?.id_producto);
    const cantidad = Number(item?.cantidad);
    if (!Number.isInteger(id) || id <= 0) throw invalid('Cada item necesita un id_producto entero positivo');
    if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD_POR_ITEM) {
      throw invalid(`cantidad inválida para id_producto ${id} (debe ser entero entre 1 y ${MAX_CANTIDAD_POR_ITEM})`);
    }
    cantidadPorProducto.set(id, (cantidadPorProducto.get(id) ?? 0) + cantidad);
  }

  return {
    paymentToken,
    numero_mesa: numero_mesa.trim(),
    currency: currency.toUpperCase(),
    idempotencyKey,
    cantidadPorProducto,
  };
}

/**
 * Busca en la base de datos los productos pedidos y arma las líneas del carrito con el
 * PRECIO VIGENTE EN BD (nunca uno enviado por el cliente). Si algún id no existe o no
 * está disponible, rechaza todo el pedido: más simple y más seguro que cobrar solo una
 * parte del carrito sin que el cliente lo sepa.
 */
async function resolveCartItems(cantidadPorProducto) {
  const ids = [...cantidadPorProducto.keys()];
  const placeholders = ids.map(() => '?').join(',');
  const productos = await pool.query(
    `SELECT id_producto, nombre, precio FROM Productos WHERE disponible = 1 AND id_producto IN (${placeholders})`,
    ids,
  );

  const porId = new Map(productos.map((p) => [p.id_producto, p]));
  const faltantes = ids.filter((id) => !porId.has(id));
  if (faltantes.length > 0) {
    throw new AppError(
      409,
      'PRODUCT_UNAVAILABLE',
      `Estos productos ya no están disponibles: ${faltantes.join(', ')}. Actualiza el carrito.`,
    );
  }

  return ids.map((id) => {
    const producto = porId.get(id);
    const cantidad = cantidadPorProducto.get(id);
    return {
      id_producto: id,
      nombre: producto.nombre,
      cantidad,
      precioUnitario: producto.precio, // string decimal tal cual viene de la columna DECIMAL
      precioUnitarioMinor: toMinorUnits(producto.precio),
    };
  });
}

/**
 * Pago + pedido como una sola operación idempotente:
 *   1) cobra en el gateway (mock/Stripe) por el total calculado en el servidor,
 *   2) si el cobro aprueba, inserta Pedido + Detalle_Pedido y suma cantidad_vendida.
 * Devuelve { ok:true, ... } en éxito, o { ok:false, ... } si el cobro se completó pero
 * el registro en BD falló (ver nota de reconciliación más abajo). Nunca relanza en ese
 * segundo caso: así el resultado queda cacheado por Idempotency-Key y un reintento con
 * la misma clave no vuelve a cobrar.
 */
async function chargeAndPersistOrder({ paymentToken, numero_mesa, currency, idempotencyKey }, cartItems, totalMinor) {
  const charge = await gateway.charge({
    paymentToken,
    amountMinor: totalMinor,
    currency,
    merchantId: config.merchantId,
    idempotencyKey,
  });

  try {
    const idPedido = await withTransaction(async (conn) => {
      const insertPedido = await conn.query(
        'INSERT INTO Pedidos (numero_mesa, total, estado, token_pago_gpay) VALUES (?, ?, ?, ?)',
        [numero_mesa, formatMinorUnits(totalMinor), 'Pagado', charge.id],
      );

      for (const item of cartItems) {
        await conn.query(
          'INSERT INTO Detalle_Pedido (id_pedido, id_producto, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
          [insertPedido.insertId, item.id_producto, item.cantidad, item.precioUnitario],
        );
        // cantidad_vendida acumulada: la base para la futura IA de recomendaciones.
        await conn.query('UPDATE Productos SET cantidad_vendida = cantidad_vendida + ? WHERE id_producto = ?', [
          item.cantidad,
          item.id_producto,
        ]);
      }

      return insertPedido.insertId;
    });

    return { ok: true, idPedido, charge, createdAt: new Date().toISOString() };
  } catch (dbError) {
    // El dinero YA se cobró; perder el pedido aquí es grave. No se relanza (ver arriba):
    // se registra con todo el detalle para reconciliar a mano y se avisa igual como fallo.
    console.error('[CRÍTICO] Pago cobrado pero el pedido no se pudo registrar en BD', {
      gatewayId: charge.id,
      gateway: gateway.name,
      numero_mesa,
      totalMinor,
      currency,
      items: cartItems.map(({ id_producto, cantidad }) => ({ id_producto, cantidad })),
      error: dbError.message,
    });
    return { ok: false, charge, createdAt: new Date().toISOString() };
  }
}

/**
 * POST /api/process-payment
 * Body: { paymentToken, numero_mesa, currency, items: [{ id_producto, cantidad }] }
 */
router.post('/process-payment', async (req, res) => {
  const input = parseOrderRequest(req.body, req.get('Idempotency-Key'));
  const cartItems = await resolveCartItems(input.cantidadPorProducto);

  const totalMinor = cartItems.reduce((sum, item) => sum + item.precioUnitarioMinor * item.cantidad, 0);
  if (totalMinor <= 0 || totalMinor > config.maxAmountMinor) {
    throw new AppError(400, 'INVALID_REQUEST', `El total del carrito debe ser mayor que 0 y no superar ${config.maxAmountMinor / 100}`);
  }

  // Huella para detectar si la misma Idempotency-Key se reutiliza con un carrito distinto.
  const fingerprint = JSON.stringify({
    mesa: input.numero_mesa,
    currency: input.currency,
    items: cartItems.map((i) => [i.id_producto, i.cantidad]).sort((a, b) => a[0] - b[0]),
  });

  const result = await runOnce(input.idempotencyKey, fingerprint, () =>
    chargeAndPersistOrder(input, cartItems, totalMinor),
  );

  if (!result.ok) {
    throw new AppError(
      500,
      'ORDER_PERSIST_FAILED',
      `El pago se procesó (referencia ${result.charge.id}) pero no se pudo registrar el pedido. Contacta a soporte con esa referencia; no vuelvas a intentar el cobro.`,
    );
  }

  console.info('[pedido]', {
    id_pedido: result.idPedido,
    gatewayId: result.charge.id,
    gateway: gateway.name,
    numero_mesa: input.numero_mesa,
    total: formatMinorUnits(totalMinor),
    currency: input.currency,
    replayed: Boolean(result.replayed),
  });

  res.status(200).json({
    success: true,
    message: 'Pedido pagado y registrado',
    pedido: {
      id_pedido: result.idPedido,
      numero_mesa: input.numero_mesa,
      estado: 'Pagado',
      total: formatMinorUnits(totalMinor),
      currency: input.currency,
      createdAt: result.createdAt,
      items: cartItems.map((item) => ({
        id_producto: item.id_producto,
        nombre: item.nombre,
        cantidad: item.cantidad,
        precio_unitario: item.precioUnitario,
        subtotal: formatMinorUnits(item.precioUnitarioMinor * item.cantidad),
      })),
    },
    payment: { id: result.charge.id, gateway: gateway.name },
    ...(result.replayed && { idempotentReplay: true }),
  });
});

export default router;
