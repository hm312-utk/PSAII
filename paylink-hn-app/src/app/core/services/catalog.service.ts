// src/app/core/services/catalog.service.ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CatalogResponse, Categoria } from '../models/app.models';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);

  /**
   * GET {apiUrl}/catalog → categorías con sus productos, solo lo vendible hoy.
   * (apiUrl ya termina en /api; el X-API-Key lo añade el interceptor.)
   */
  getCatalog(): Observable<Categoria[]> {
    return this.http.get<CatalogResponse>(`${environment.apiUrl}/catalog`).pipe(
      timeout(15_000),
      map((response) => response.categorias),
    );
  }
}