import { config } from '../config.js';
import { createMockGateway } from './mock.gateway.js';
import { createStripeGateway } from './stripe.gateway.js';

/** Selecciona el procesador según PAYMENT_GATEWAY. Añadir otro PSP = añadir otro adaptador aquí. */
export const gateway =
  config.gateway === 'stripe' ? createStripeGateway(config.stripeSecretKey) : createMockGateway();
