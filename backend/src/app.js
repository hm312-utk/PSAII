import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { apiKeyAuth } from './middleware/apiKey.js';
import { AppError, errorHandler, notFound } from './middleware/errors.js';
import catalogRouter from './routes/catalog.js';
import paymentsRouter from './routes/payments.js';
import chatRouter from './routes/chat.js';

export function createApp() {
  const app = express();

  // Nginx está delante: así req.ip (y el rate limit) usan la IP real del cliente.
  app.set('trust proxy', 1);

  app.use(helmet());

  // ── CORS ────────────────────────────────────────────────────────────────
  // Solo los orígenes de la app (lista blanca en CORS_ORIGINS) pueden leer respuestas desde un navegador/WebView.
  const allowedOrigins = new Set(config.corsOrigins);
  app.use(
    cors({
      origin(origin, callback) {
        // Sin cabecera Origin = curl, Postman o servidor-a-servidor: no es una petición de navegador.
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', `Origen no permitido por CORS: ${origin}`));
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-API-Key', 'Idempotency-Key'],
      maxAge: 600, // el navegador cachea el preflight 10 minutos
    }),
  );

  // 32kb: sobra para el token de Google Pay (hasta 8kb) más un carrito de hasta 50 líneas.
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  const makeLimiter = (limit) =>
    rateLimit({
      windowMs: 60_000,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Demasiadas solicitudes. Espera un minuto.')),
    });

  // El límite va ANTES que la API key a propósito: así una ráfaga sin credenciales válidas
  // también queda acotada, en vez de golpear sin límite la verificación de la API key.
  // El catálogo se consulta mucho más seguido que lo que se cobra (se carga al abrir el
  // kiosko, al reiniciar entre clientes, etc.), así que tiene un límite más generoso.
  app.use('/api/catalog', makeLimiter(60));
  app.use('/api/process-payment', makeLimiter(20));
  app.use('/api/chat', makeLimiter(10));
  // Toda ruta de /api a partir de aquí exige X-API-Key (el health check, arriba, queda fuera).
  app.use('/api', apiKeyAuth);
  app.use('/api', chatRouter);
  app.use('/api', catalogRouter);
  app.use('/api', paymentsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
