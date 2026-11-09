// src/app/core/models/app.models.ts

// ── Catálogo (respuesta de GET /api/catalog) ────────────────────────────────

export interface Producto {
  id_producto: number;
  nombre: string;
  descripcion: string | null;
  /** Decimal como string ("45.50"): el dinero nunca viaja como float. */
  precio: string;
  imagen_url: string | null;
}

export interface Categoria {
  id_categoria: number;
  nombre: string;
  descripcion: string | null;
  productos: Producto[];
}

export interface CatalogResponse {
  success: boolean;
  categorias: Categoria[];
}

// ── Carrito ─────────────────────────────────────────────────────────────────

export interface CartItem extends Producto {
  cantidad: number;
  /** precio × cantidad, calculado en centavos enteros (sin errores de coma flotante). */
  subtotal: number;
}

// ── Pago (POST /api/process-payment) ────────────────────────────────────────

/** Una línea del pedido: la app solo manda ids y cantidades; los precios los pone el servidor. */
export interface OrderLine {
  id_producto: number;
  cantidad: number;
}

export interface ProcessPaymentRequest {
  /** Token de Google Pay tal cual lo entregó el SDK: string opaco, la app NO lo abre. */
  paymentToken: string;
  numero_mesa: string;
  currency: string;
  items: OrderLine[];
}

export interface PedidoItem {
  id_producto: number;
  nombre: string;
  cantidad: number;
  precio_unitario: string;
  subtotal: string;
}

export interface Pedido {
  id_pedido: number;
  numero_mesa: string;
  estado: string;
  total: string;
  currency: string;
  createdAt: string;
  items: PedidoItem[];
}

/** Referencia del cobro en el gateway de pagos. */
export interface PaymentRef {
  id: string;
  gateway: string;
}

export interface ProcessPaymentResponse {
  success: true;
  message: string;
  pedido: Pedido;
  payment: PaymentRef;
  /** true si es la repetición de un cobro previo (misma Idempotency-Key). */
  idempotentReplay?: boolean;
}

/** Resultado "normal" de pay(): cobrado, o el cliente cerró la hoja de Google Pay. */
export type PaymentOutcome = { status: 'success'; pedido: Pedido; payment: PaymentRef } | { status: 'cancelled' };

export type PaymentErrorCode =
  | 'EMPTY_CART'
  | 'GOOGLE_PAY_ERROR'
  | 'CARD_DECLINED'
  | 'PRODUCT_UNAVAILABLE'
  | 'PAID_NOT_RECORDED' // cobrado, pero el pedido no quedó guardado: NO reintentar el cobro
  | 'NETWORK'
  | 'UNAUTHORIZED'
  | 'REJECTED'
  | 'SERVER';

/** Error con mensaje listo para mostrar al cliente. */
export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}