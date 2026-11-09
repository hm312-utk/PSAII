import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

// Las variables deben existir ANTES de importar la app: config.js las lee al cargarse.
process.env.API_KEY = 'test-api-key-0123456789abcdef';
process.env.PAYMENT_GATEWAY = 'mock';
process.env.CORS_ORIGINS = 'http://localhost:8100';

const { createApp } = await import('../src/app.js');

const API_KEY = process.env.API_KEY;
const ALLOWED_ORIGIN = 'http://localhost:8100';
const validBody = {
  paymentToken: 'examplePaymentMethodToken',
  amount: '150.50',
  currency: 'USD',
  merchantId: 'COMERCIO-001',
};

/** Levanta una instancia de la app en un puerto libre (cada una trae su propio rate limiter). */
async function startServer() {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

describe('API de PayLink HN', () => {
  let server;
  let baseUrl;

  before(async () => ({ server, baseUrl } = await startServer()));
  after(() => server.close());

  const newKey = () => `test-${crypto.randomUUID()}`;

  async function postPayment(body, { key = newKey(), apiKey = API_KEY } = {}) {
    const response = await fetch(`${baseUrl}/api/process-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-API-Key': apiKey }),
        ...(key && { 'Idempotency-Key': key }),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  }

  it('GET /api/health responde sin autenticación', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  it('aprueba un pago válido y nunca devuelve el token', async () => {
    const { status, json } = await postPayment(validBody);
    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.message, 'Pago exitoso');
    assert.equal(json.payment.status, 'succeeded');
    assert.equal(json.payment.amount, '150.50');
    assert.equal(json.payment.merchantId, 'COMERCIO-001');
    assert.ok(!JSON.stringify(json).includes(validBody.paymentToken));
  });

  it('es idempotente: la misma clave devuelve el mismo pago sin cobrar de nuevo', async () => {
    const key = newKey();
    const first = await postPayment(validBody, { key });
    const second = await postPayment(validBody, { key });
    assert.equal(second.status, 200);
    assert.equal(second.json.payment.id, first.json.payment.id);
    assert.equal(second.json.idempotentReplay, true);
  });

  it('rechaza reutilizar una clave con otros datos (422)', async () => {
    const key = newKey();
    await postPayment(validBody, { key });
    const { status, json } = await postPayment({ ...validBody, amount: '999.00' }, { key });
    assert.equal(status, 422);
    assert.equal(json.error.code, 'IDEMPOTENCY_KEY_REUSED');
  });

  it('simula el rechazo del emisor con montos terminados en .99 (402)', async () => {
    const { status, json } = await postPayment({ ...validBody, amount: '10.99' });
    assert.equal(status, 402);
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'CARD_DECLINED');
  });

  it('exige API key (401)', async () => {
    const { status, json } = await postPayment(validBody, { apiKey: null });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  });

  it('exige Idempotency-Key (400)', async () => {
    const { status } = await postPayment(validBody, { key: null });
    assert.equal(status, 400);
  });

  it('valida el monto (400)', async () => {
    for (const amount of ['0', '10.999', '-5', 'abc', '99999999', 150.5]) {
      const { status } = await postPayment({ ...validBody, amount });
      assert.equal(status, 400, `amount=${amount} debería ser inválido`);
    }
  });

  it('valida token, moneda y comercio (400)', async () => {
    for (const patch of [{ paymentToken: '' }, { currency: 'EUR' }, { merchantId: 'x y' }]) {
      const { status } = await postPayment({ ...validBody, ...patch });
      assert.equal(status, 400, `${JSON.stringify(patch)} debería ser inválido`);
    }
  });

  it('CORS: responde el preflight de un origen permitido', async () => {
    const response = await fetch(`${baseUrl}/api/process-payment`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-api-key,idempotency-key',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.match(response.headers.get('access-control-allow-headers'), /idempotency-key/i);
  });

  it('CORS: bloquea un origen que no está en la lista blanca (403)', async () => {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://sitio-malicioso.example' } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});

describe('Rate limit', () => {
  it('responde 429 tras 20 solicitudes por minuto', async () => {
    const { server, baseUrl } = await startServer();
    try {
      let last;
      for (let i = 0; i < 21; i++) last = await fetch(`${baseUrl}/api/process-payment`, { method: 'POST' });
      assert.equal(last.status, 429);
    } finally {
      server.close();
    }
  });
});
