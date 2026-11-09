// src/app/core/services/payment.service.ts
/// <reference types="googlepay" />
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TimeoutError, firstValueFrom, retry, throwError, timeout, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PaymentError, PaymentOutcome, ProcessPaymentRequest, ProcessPaymentResponse } from '../models/app.models';
import { CartService } from './cart.service';

const GOOGLE_PAY_SDK_URL = 'https://pay.google.com/gp/p/js/pay.js';
const API_VERSION = { apiVersion: 2, apiVersionMinor: 0 } as const;
const REQUEST_TIMEOUT_MS = 20_000;
const NUMERO_MESA_POR_DEFECTO = 'Mesa 1'; // hardcodeado por ahora; luego vendrá de la configuración del kiosko

/**
 * Cobro del carrito con Google Pay en dos pasos independientes:
 *   1. Generación  → Google Pay (entorno TEST) muestra el total del carrito y entrega un token cifrado.
 *   2. Transmisión → ese token, SIN abrirlo, viaja por POST al backend junto con los ítems del carrito.
 * La app nunca desencripta, parsea ni guarda el token. Los precios los resuelve el servidor.
 */
@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly http = inject(HttpClient);
  private readonly cart = inject(CartService);
  private client?: google.payments.api.PaymentsClient;
  private sdkLoading?: Promise<void>;

  // ── Google Pay: disponibilidad y botón ─────────────────────────────────────

  /** Carga el SDK y pregunta si este dispositivo/navegador puede pagar con Google Pay. */
  async isGooglePayAvailable(): Promise<boolean> {
    try {
      await this.loadGooglePaySdk();
      const response = await this.getClient().isReadyToPay({
        ...API_VERSION,
        allowedPaymentMethods: [this.baseCardMethod()],
      });
      return response.result;
    } catch {
      return false;
    }
  }

  /** Botón OFICIAL de Google Pay (Google exige su botón; ya viene localizado en español). */
  createGooglePayButton(onClick: () => void): HTMLElement {
    const darkTheme = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    return this.getClient().createButton({
      buttonType: 'pay',
      buttonColor: darkTheme ? 'white' : 'black', // el botón negro se pierde sobre fondo oscuro
      buttonSizeMode: 'fill',
      buttonLocale: 'es',
      onClick,
    });
  }

  // ── Flujo completo: carrito → Google Pay → token → backend ─────────────────

  /**
   * Cobra lo que hay en el carrito. No recibe monto: ítems y total salen del CartService.
   * No vacía el carrito; eso lo decide la vista tras un éxito.
   * @throws PaymentError con mensaje listo para mostrar
   */
  async pay(numeroMesa = NUMERO_MESA_POR_DEFECTO): Promise<PaymentOutcome> {
    // Foto del carrito: lo que Google Pay muestra y lo que se envía salen del mismo instante.
    const items = this.cart.getItems();
    const total = this.cart.getTotal();
    if (items.length === 0 || total <= 0) throw new PaymentError('EMPTY_CART', 'El carrito está vacío.');

    const currency = environment.googlePay.currencyCode;

    // Paso 1 · Generación: Google Pay muestra el total del carrito y entrega el token cifrado.
    const paymentToken = await this.requestGooglePayToken(total.toFixed(2), currency);
    if (paymentToken === null) return { status: 'cancelled' };

    // Paso 2 · Transmisión: token crudo + carrito. Solo ids y cantidades: el servidor pone los precios.
    const response = await this.sendOrderToBackend({
      paymentToken,
      numero_mesa: numeroMesa,
      currency,
      items: items.map(({ id_producto, cantidad }) => ({ id_producto, cantidad })),
    });
    return { status: 'success', pedido: response.pedido, payment: response.payment };
  }

  /** Abre la hoja de pago y devuelve el token tal cual (string opaco), o null si el cliente cancela. */
  private async requestGooglePayToken(totalPrice: string, currency: string): Promise<string | null> {
    try {
      await this.loadGooglePaySdk();
      const paymentData = await this.getClient().loadPaymentData(this.buildPaymentDataRequest(totalPrice, currency));
      return paymentData.paymentMethodData.tokenizationData.token;
    } catch (error) {
      if ((error as Partial<google.payments.api.PaymentsError> | null)?.statusCode === 'CANCELED') return null;
      throw new PaymentError('GOOGLE_PAY_ERROR', 'Google Pay no pudo completar la solicitud. Inténtalo de nuevo.');
    }
  }

  private async sendOrderToBackend(body: ProcessPaymentRequest): Promise<ProcessPaymentResponse> {
    // Una clave por intento de pago: si se reintenta por un fallo de red, el backend no cobra dos veces.
    const idempotencyKey = this.newIdempotencyKey();

    try {
      return await firstValueFrom(
        this.http
          .post<ProcessPaymentResponse>(`${environment.apiUrl}/process-payment`, body, {
            headers: { 'Idempotency-Key': idempotencyKey },
          })
          .pipe(
            timeout(REQUEST_TIMEOUT_MS),
            retry({
              count: 2,
              delay: (error, attempt) => (this.isTransient(error) ? timer(attempt * 800) : throwError(() => error)),
            }),
          ),
      );
    } catch (error) {
      throw this.toPaymentError(error);
    }
  }

  // ── Google Pay: configuración de la solicitud ──────────────────────────────

  private getClient(): google.payments.api.PaymentsClient {
    // `google` existe solo después de cargar pay.js; por eso el cliente se crea de forma perezosa.
    // El valor sale de environment.googlePay.environment ('TEST'); el cast es solo para el compilador.
    this.client ??= new google.payments.api.PaymentsClient({
      environment: environment.googlePay.environment as google.payments.api.Environment,
    });
    return this.client;
  }

  private baseCardMethod(): google.payments.api.IsReadyToPayPaymentMethodSpecification {
    return {
      type: 'CARD',
      parameters: {
        allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
        allowedCardNetworks: ['VISA', 'MASTERCARD'],
      },
    };
  }

  /** Acepta `tokenization` plano ({gateway, …}) o anidado ({type, parameters: {gateway, …}}). */
  private tokenizationParameters(): google.payments.api.PaymentGatewayTokenizationParameters {
    const raw: Record<string, unknown> = environment.googlePay.tokenization;
    return (raw['parameters'] ?? raw) as google.payments.api.PaymentGatewayTokenizationParameters;
  }

  private buildPaymentDataRequest(totalPrice: string, currency: string): google.payments.api.PaymentDataRequest {
    return {
      ...API_VERSION,
      allowedPaymentMethods: [
        {
          ...this.baseCardMethod(),
          // PAYMENT_GATEWAY: Google cifra los datos de la tarjeta para el procesador, no para nosotros.
          tokenizationSpecification: { type: 'PAYMENT_GATEWAY', parameters: this.tokenizationParameters() },
        },
      ],
      merchantInfo: { merchantId: environment.googlePay.merchantId, merchantName: environment.googlePay.merchantName },
      transactionInfo: {
        totalPriceStatus: 'FINAL',
        totalPrice,
        currencyCode: currency,
        checkoutOption: 'COMPLETE_IMMEDIATE_PURCHASE', // el botón de la hoja dice "Pagar", no "Continuar"
      },
    };
  }

  private loadGooglePaySdk(): Promise<void> {
    this.sdkLoading ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GOOGLE_PAY_SDK_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        this.sdkLoading = undefined; // permite reintentar si no había red
        reject(new Error('No se pudo cargar el SDK de Google Pay'));
      };
      document.head.appendChild(script);
    });
    return this.sdkLoading;
  }

  // ── Utilidades ─────────────────────────────────────────────────────────────

  private newIdempotencyKey(): string {
    // randomUUID solo existe en contextos seguros; getRandomValues funciona en cualquiera.
    return (
      globalThis.crypto.randomUUID?.() ??
      Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    );
  }

  /** Fallos que merecen reintento automático (seguro gracias a la Idempotency-Key). */
  private isTransient(error: unknown): boolean {
    return error instanceof TimeoutError || (error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 502));
  }

  private toPaymentError(error: unknown): PaymentError {
    if (error instanceof TimeoutError || (error instanceof HttpErrorResponse && error.status === 0)) {
      return new PaymentError('NETWORK', 'No se pudo contactar al servidor. Revisa la conexión e inténtalo de nuevo.');
    }

    if (error instanceof HttpErrorResponse) {
      const api: { code?: string; message?: string } | undefined = error.error?.error;

      // Cobro aprobado pero pedido sin guardar. El mensaje del servidor trae la referencia y pide NO
      // reintentar: jamás debe degradarse a un genérico "inténtalo de nuevo" (cobraría dos veces).
      if (api?.code === 'ORDER_PERSIST_FAILED') {
        return new PaymentError(
          'PAID_NOT_RECORDED',
          api.message ?? 'El pago se procesó pero el pedido no quedó registrado. No vuelvas a cobrar; avisa al personal.',
        );
      }
      if (api?.code === 'PRODUCT_UNAVAILABLE') {
        return new PaymentError('PRODUCT_UNAVAILABLE', api.message ?? 'Hay productos que ya no están disponibles. Actualiza el carrito.');
      }

      if (error.status === 401) {
        return new PaymentError('UNAUTHORIZED', 'Esta app no está autorizada para cobrar. Contacta a soporte.');
      }
      if (error.status === 402) {
        return new PaymentError('CARD_DECLINED', api?.message ?? 'El pago fue rechazado. Prueba con otra tarjeta.');
      }
      if (error.status === 429) {
        return new PaymentError('REJECTED', 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentar.');
      }
      if (error.status >= 400 && error.status < 500) {
        return new PaymentError('REJECTED', api?.message ?? 'El servidor rechazó la solicitud de pago.');
      }
    }

    return new PaymentError('SERVER', 'No se pudo procesar el pago por un error del servidor. Inténtalo de nuevo.');
  }
}