// src/app/tab1/tab1.page.ts
import { ElementRef, Component, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { AlertController, LoadingController, IonInput, IonButtons, IonFooter, IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonChip, IonCol, IonContent, IonFab, IonFabButton, IonGrid, IonHeader, IonIcon, IonImg, IonItem, IonLabel, IonList, IonModal, IonNote, IonProgressBar, IonRow, IonSpinner, IonTitle, IonToolbar, ToastController,} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, addCircleOutline, close, removeCircleOutline, restaurantOutline, send, sparkles, trashOutline, warningOutline } from 'ionicons/icons';
import { environment } from '../../environments/environment';
import { Categoria, PaymentError } from '../core/models/app.models';
import { CartService } from '../core/services/cart.service';
import { CatalogService } from '../core/services/catalog.service';
import { PaymentService } from '../core/services/payment.service';
import { ChatService } from '../core/services/chat.service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  imports: [
    IonBadge, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonChip, IonCol, IonContent, IonFab,
    IonFabButton, IonFooter, IonGrid, IonHeader, IonIcon, IonImg, IonInput, IonItem, IonLabel, IonList, IonModal, IonNote, IonProgressBar,
    IonRow, IonSpinner, IonTitle, IonToolbar,
  ],
})
export class Tab1Page implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly payments = inject(PaymentService);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly chatService = inject(ChatService);
  readonly cart = inject(CartService);

  private readonly gpayContainer = viewChild<ElementRef<HTMLElement>>('gpayContainer');

  readonly mesa = 'Mesa 1';
  private readonly formato = new Intl.NumberFormat('es-HN', {
    style: 'currency',
    currency: environment.googlePay.currencyCode,
    currencyDisplay: 'narrowSymbol',
  });
  readonly dinero = (valor: string | number): string => this.formato.format(Number(valor));

  // ── Catálogo ───────────────────────────────────────────────────────────────
  readonly categorias = signal<Categoria[]>([]);
  readonly cargando = signal(true);
  readonly errorCatalogo = signal(false);

  // ── Carrito ────────────────────────────────────────────────────────────────
  readonly items = computed(() => this.cart.getItems());
  readonly total = computed(() => this.cart.getTotal());
  readonly unidades = computed(() => this.cart.getCount());
  readonly hayProductos = computed(() => this.items().length > 0);
  readonly cantidades = computed(() => new Map(this.items().map((item) => [item.id_producto, item.cantidad])));

  // ── Pago ───────────────────────────────────────────────────────────────────
  readonly gpayDisponible = signal<boolean | null>(null);
  readonly procesando = signal(false);
  readonly pagoBloqueado = signal(false);

  // ── Chat IA ────────────────────────────────────────────────────────────────
  readonly chatAbierto = signal(false);
  readonly iaPensando = signal(false);
  readonly chatMensajes = signal<ChatMessage[]>([
    { role: 'assistant', content: '¡Hola! Soy tu mesero IA. ¿Qué se te antoja probar hoy?' }
  ]);
  private chatSub?: Subscription;

  constructor() {
    addIcons({ add, addCircleOutline, close, removeCircleOutline, restaurantOutline, send, sparkles, trashOutline, warningOutline });

    effect(() => {
      const contenedor = this.gpayContainer()?.nativeElement;
      if (contenedor && this.gpayDisponible() === true && contenedor.childElementCount === 0) {
        contenedor.appendChild(this.payments.createGooglePayButton(() => void this.cobrar()));
      }
    });
  }

  async ngOnInit(): Promise<void> {
    this.cargarCatalogo();
    this.gpayDisponible.set(await this.payments.isGooglePayAvailable());
  }

  cargarCatalogo(): void {
    this.cargando.set(true);
    this.errorCatalogo.set(false);
    this.catalog.getCatalog().subscribe({
      next: (categorias) => {
        this.categorias.set(categorias);
        this.conciliarCarrito(categorias);
        this.cargando.set(false);
      },
      error: () => {
        this.errorCatalogo.set(true);
        this.cargando.set(false);
      },
    });
  }

  private conciliarCarrito(categorias: Categoria[]): void {
    const vigentes = new Map(categorias.flatMap((c) => c.productos).map((p) => [p.id_producto, p]));
    for (const item of this.cart.getItems()) {
      const vigente = vigentes.get(item.id_producto);
      if (vigente?.precio === item.precio) continue;

      this.cart.removeItem(item.id_producto, true);
      if (vigente) for (let i = 0; i < item.cantidad; i++) this.cart.addItem(vigente);
    }
  }

  async cobrar(): Promise<void> {
    if (this.procesando() || this.pagoBloqueado() || !this.hayProductos()) return;
    this.procesando.set(true);
    try {
      const resultado = await this.payments.pay(this.mesa);
      if (resultado.status === 'cancelled') return;

      this.cart.clearCart();
      await this.mostrarAlerta(
        '¡Pago exitoso!',
        `Pedido #${resultado.pedido.id_pedido} · ${this.mesa} · Total ${this.dinero(resultado.pedido.total)}`,
      );
    } catch (error) {
      await this.manejarErrorDePago(error);
    } finally {
      this.procesando.set(false);
    }
  }

  private async manejarErrorDePago(error: unknown): Promise<void> {
    if (!(error instanceof PaymentError)) return this.avisar('Ocurrió un error inesperado. Inténtalo de nuevo.');

    switch (error.code) {
      case 'PAID_NOT_RECORDED': {
        this.pagoBloqueado.set(true);
        const referencia = /referencia (\S+?)\)/.exec(error.message)?.[1];
        return this.mostrarAlerta('Cobro sin registrar: avisa a caja', error.message, referencia && `Referencia: ${referencia}`);
      }
      case 'PRODUCT_UNAVAILABLE':
        this.cargarCatalogo();
        return this.avisar('Algunos productos ya no están disponibles. Actualizamos tu pedido.', 'warning');
      default:
        return this.avisar(error.message);
    }
  }

  nuevoPedido(): void {
    this.cart.clearCart();
    this.pagoBloqueado.set(false);
  }

  // ── Lógica del Chat IA ─────────────────────────────────────────────────────

  abrirChat(): void {
    this.chatAbierto.set(true);
  }

  cerrarChat(): void {
    this.chatAbierto.set(false);
    // Si el usuario cierra el chat mientras la IA piensa, abortamos la petición HTTP
    if (this.chatSub) {
      this.chatSub.unsubscribe();
      this.chatSub = undefined;
    }
    this.iaPensando.set(false);
  }

  enviarMensajeIA(inputElement: any): void {
    const texto = inputElement.value?.toString().trim();
    if (!texto || this.iaPensando()) return;

    inputElement.value = ''; // Limpiar el input inmediatamente
    this.chatMensajes.update((msgs) => [...msgs, { role: 'user', content: texto }]);
    this.iaPensando.set(true);

    this.chatSub = this.chatService.sendMessage(texto).subscribe({
      next: (respuesta) => {
        this.chatMensajes.update((msgs) => [...msgs, { role: 'assistant', content: respuesta }]);
        this.iaPensando.set(false);
        this.chatSub = undefined;
      },
      error: (err) => {
        console.error('[IA] Error de red o servidor:', err);
        this.chatMensajes.update((msgs) => [
          ...msgs, 
          { role: 'assistant', content: 'Lo siento, estoy muy ocupado atendiendo otras mesas. ¡Inténtalo de nuevo en unos segundos!' }
        ]);
        this.iaPensando.set(false);
        this.chatSub = undefined;
      }
    });
  }

  // ── Utilidades ─────────────────────────────────────────────────────────────

  private async mostrarAlerta(header: string, message: string, subHeader?: string): Promise<void> {
    const alerta = await this.alerts.create({ header, subHeader, message, buttons: ['Entendido'], backdropDismiss: false });
    await alerta.present();
  }

  private async avisar(message: string, color: 'danger' | 'warning' = 'danger'): Promise<void> {
    const toast = await this.toasts.create({ message, color, duration: 4500, position: 'top' });
    await toast.present();
  }
}