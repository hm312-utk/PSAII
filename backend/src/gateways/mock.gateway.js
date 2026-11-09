import { randomUUID } from 'node:crypto';
import { AppError } from '../middleware/errors.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Procesador simulado (sandbox). Imita el contrato de un PSP sin cobrar nada:
 *  - Cualquier token es aprobado (con gateway "example" Google Pay entrega "examplePaymentMethodToken").
 *  - Montos que terminan en .99 se rechazan, para probar el flujo de error de la app.
 *
 * Contrato de un gateway: { name, charge({ paymentToken, amountMinor, currency, merchantId, idempotencyKey }) }
 */
export function createMockGateway() {
  return {
    name: 'mock',

    async charge({ amountMinor, currency, merchantId }) {
      await sleep(400); // latencia de red simulada

      if (amountMinor % 100 === 99) {
        throw new AppError(402, 'CARD_DECLINED', 'El pago fue rechazado por el emisor (simulación: montos terminados en .99).');
      }

      return {
        id: `mock_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        status: 'succeeded',
        amountMinor,
        currency,
        merchantId,
      };
    },
  };
}
