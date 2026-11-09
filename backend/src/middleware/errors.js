/** Error "esperado": lleva el status HTTP y un código estable que la app puede interpretar. */
export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export function notFound(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada'));
}

// Express identifica un manejador de errores por sus 4 parámetros.
export function errorHandler(err, _req, res, _next) {
  // Errores de express.json(): cuerpo mal formado o demasiado grande.
  if (err.type === 'entity.parse.failed') {
    err = new AppError(400, 'INVALID_JSON', 'El cuerpo de la petición no es un JSON válido');
  } else if (err.type === 'entity.too.large') {
    err = new AppError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo de la petición es demasiado grande');
  }

  if (!(err instanceof AppError)) {
    // Nunca registres el body ni el token: son datos de pago.
    console.error('[error]', err.name, err.message);
    err = new AppError(500, 'INTERNAL_ERROR', 'Error interno del servidor');
  }

  res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
}
