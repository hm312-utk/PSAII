// src/app/core/services/chat.service.ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';

interface ChatResponse {
  success: boolean;
  reply: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);

  /**
   * POST {apiUrl}/chat → respuesta del mesero IA (el X-API-Key lo añade el interceptor).
   * 30 s: un modelo 1b en CPU puede tardar varios segundos; el backend aborta antes (25 s) con un error controlado.
   * Timeout, red caída o error HTTP llegan al suscriptor como error del Observable.
   */
  sendMessage(message: string): Observable<string> {
    return this.http.post<ChatResponse>(`${environment.apiUrl}/chat`, { message }).pipe(
      timeout(30_000),
      map((response) => response.reply),
    );
  }
}