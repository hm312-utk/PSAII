import dotenv from 'dotenv';

// Carga .env si existe. En Rocky Linux, systemd inyecta las variables con EnvironmentFile.
dotenv.config({ quiet: true });

const env = process.env;

const list = (value, fallback = '') =>
  (value ?? fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const config = Object.freeze({
  nodeEnv: env.NODE_ENV ?? 'development',
  port: Number(env.PORT ?? 3000),
  // Detrás de Nginx basta con escuchar en loopback: el puerto 3000 nunca queda expuesto.
  host: env.HOST ?? '127.0.0.1',

  apiKey: env.API_KEY ?? '',
  corsOrigins: list(env.CORS_ORIGINS),

  gateway: env.PAYMENT_GATEWAY ?? 'mock', // 'mock' | 'stripe'
  stripeSecretKey: env.STRIPE_SECRET_KEY ?? '',
  allowedCurrencies: list(env.ALLOWED_CURRENCIES, 'USD,HNL').map((code) => code.toUpperCase()),
  // Tope por cobro, en unidades menores (centavos). Protege el sandbox de montos absurdos.
  maxAmountMinor: Math.round(Number(env.MAX_AMOUNT ?? 10000) * 100),

  // Identifica al comercio ante el gateway de pagos. Fijo en el servidor (no lo manda la
  // app): en un kiosko de autoservicio, el dispositivo ES ese comercio; permitir que el
  // cliente lo indique dejaría que cualquiera reclamara el cobro para otro comercio.
  merchantId: env.MERCHANT_ID ?? 'COMERCIO-001',

  // ── Base de datos (MariaDB) ────────────────────────────────────────────
  db: {
    host: env.DB_HOST ?? '127.0.0.1',
    port: Number(env.DB_PORT ?? 3306),
    user: env.DB_USER ?? '',
    password: env.DB_PASS ?? '',
    database: env.DB_NAME ?? '',
    connectionLimit: Number(env.DB_CONNECTION_LIMIT ?? 5),
  },
});

// Fallar al arrancar es mejor que arrancar mal configurado.
if (config.apiKey.length < 16) {
  throw new Error('API_KEY es obligatoria y debe tener al menos 16 caracteres (genera una: openssl rand -hex 32)');
}
if (config.apiKey.startsWith('cambia-esto')) {
  throw new Error('API_KEY sigue con el valor de ejemplo de .env.example. Genera una propia: openssl rand -hex 32');
}
if (!['mock', 'stripe'].includes(config.gateway)) {
  throw new Error(`PAYMENT_GATEWAY inválido: "${config.gateway}". Usa "mock" o "stripe".`);
}
if (config.gateway === 'stripe' && !config.stripeSecretKey.startsWith('sk_test_')) {
  throw new Error('STRIPE_SECRET_KEY debe ser una llave de pruebas (sk_test_...). Este prototipo rechaza llaves live.');
}
for (const key of ['user', 'password', 'database']) {
  if (!config.db[key]) {
    throw new Error(`DB_${key.toUpperCase()} es obligatoria (conexión a MariaDB). Revisa tu .env.`);
  }
}
