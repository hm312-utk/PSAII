import Stripe from 'stripe';
import { AppError } from '../middleware/errors.js';

/**
 * Con tokenización gateway=stripe, Google Pay entrega un JSON con un Token de Stripe:
 *   {"id":"tok_1Abc...","object":"token","card":{...}}
 * Aquí (y solo aquí, en el servidor) se interpreta.
 */
function extractStripeTokenId(paymentToken) {
  try {
    const parsed = JSON.parse(paymentToken);
    if (parsed?.object === 'token' && typeof parsed.id === 'string') return parsed.id;
  } catch {
    // cae al error de abajo
  }
  throw new AppError(400, 'INVALID_PAYMENT_TOKEN', 'El token no tiene el formato de Stripe esperado');
}

/** Gateway contra el sandbox de Stripe (llave sk_test_...). */
export function createStripeGateway(secretKey) {
  const stripe = new Stripe(secretKey);

  return {
    name: 'stripe-sandbox',

    async charge({ paymentToken, amountMinor, currency, merchantId, idempotencyKey }) {
      const tokenId = extractStripeTokenId(paymentToken);

      try {
        // 1) El token de Google Pay se convierte en un PaymentMethod…
        const paymentMethod = await stripe.paymentMethods.create(
          { type: 'card', card: { token: tokenId } },
          { idempotencyKey: `${idempotencyKey}-pm` },
        );

        // 2) …y se cobra con un PaymentIntent confirmado en el mismo paso.
        const intent = await stripe.paymentIntents.create(
          {
            amount: amountMinor,
            currency: currency.toLowerCase(),
            payment_method: paymentMethod.id,
            confirm: true,
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
            description: `PayLink HN - ${merchantId}`,
            metadata: { merchantId },
          },
          { idempotencyKey: `${idempotencyKey}-pi` },
        );

        if (intent.status !== 'succeeded') {
          throw new AppError(402, 'PAYMENT_NOT_COMPLETED', `El pago no se completó (estado: ${intent.status})`);
        }
        return { id: intent.id, status: intent.status, amountMinor, currency, merchantId };
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof Stripe.errors.StripeCardError) {
          throw new AppError(402, 'CARD_DECLINED', error.message);
        }
        console.error('[stripe]', error.type ?? error.name, error.code ?? '');
        throw new AppError(502, 'GATEWAY_ERROR', 'El procesador de pagos no respondió correctamente');
      }
    },
  };
}
