// src/app/core/interceptors/api.interceptor.ts
import { HttpInterceptorFn } from '@angular/common/http';
import { throwError } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Interceptor funcional (Angular 15+, el que usa la plantilla actual de Ionic).
 *  - Inyecta X-API-Key SOLO en las peticiones hacia environment.apiUrl (nunca a terceros,
 *    p. ej. pay.google.com).
 *  - En producción se niega a enviar nada por HTTP plano.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  if (environment.production && !req.url.startsWith('https://')) {
    return throwError(() => new Error('La API debe usarse por HTTPS en producción'));
  }

  return next(req.clone({ setHeaders: { 'X-API-Key': environment.apiKey } }));
};