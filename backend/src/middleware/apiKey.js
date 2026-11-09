import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from './errors.js';

const expected = Buffer.from(config.apiKey);

/**
 * Identifica a la app ante la API mediante la cabecera X-API-Key.
 * Usa comparación en tiempo constante para no filtrar información por diferencias de tiempo.
 *
 * Es una barrera mínima de prototipo: una app móvil no puede guardar secretos.
 * En producción reemplázala por login del comercio + JWT de vida corta.
 */
export function apiKeyAuth(req, _res, next) {
  const received = Buffer.from(req.get('X-API-Key') ?? '');
  const valid = received.length === expected.length && timingSafeEqual(received, expected);
  if (!valid) return next(new AppError(401, 'UNAUTHORIZED', 'API key ausente o inválida'));
  next();
}
