import { AppError } from '../middleware/errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;

/** key → { fingerprint, promise, expiresAt }. En memoria: en producción usa Redis o la base de datos. */
const entries = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of entries) if (entry.expiresAt < now) entries.delete(key);
}, 60 * 60 * 1000).unref();

/**
 * Ejecuta `task` una sola vez por `key`. Si la app reintenta (timeout, red caída) con la misma
 * clave, devuelve el resultado original en vez de cobrar dos veces.
 * Se guarda la promesa (no el resultado) para cubrir también dos peticiones simultáneas.
 */
export async function runOnce(key, fingerprint, task) {
  const existing = entries.get(key);

  if (existing && existing.expiresAt > Date.now()) {
    if (existing.fingerprint !== fingerprint) {
      throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Esa Idempotency-Key ya se usó con otros datos de pago');
    }
    return { ...(await existing.promise), replayed: true };
  }

  const promise = task();
  entries.set(key, { fingerprint, promise, expiresAt: Date.now() + TTL_MS });

  try {
    return await promise;
  } catch (error) {
    entries.delete(key); // un intento fallido no debe bloquear el reintento
    throw error;
  }
}
