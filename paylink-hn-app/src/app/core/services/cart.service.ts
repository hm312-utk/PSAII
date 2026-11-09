// src/app/core/services/cart.service.ts
import { Injectable, signal } from '@angular/core';
import { CartItem, Producto } from '../models/app.models';

const MAX_CANTIDAD_POR_ITEM = 50;

/** "15.99" → 1599. Todo cálculo se hace en centavos enteros para no arrastrar errores de coma flotante. */
const toCents = (precio: string): number => Math.round(Number(precio) * 100);

const buildItem = (producto: Producto, cantidad: number): CartItem => ({
  ...producto,
  cantidad,
  subtotal: (toCents(producto.precio) * cantidad) / 100,
});

/**
 * Estado del carrito con Signals. Leer getItems()/getTotal()/getCount() dentro de una
 * plantilla es reactivo: la vista se actualiza sola cuando el carrito cambia.
 */
@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly state = signal<CartItem[]>([]);

  /** Estado actual del carrito. */
  getItems(): CartItem[] {
    return this.state();
  }

  /** Unidades totales (para el globo del carrito). */
  getCount(): number {
    return this.state().reduce((unidades, item) => unidades + item.cantidad, 0);
  }

  /** Σ precio × cantidad, sumado en centavos enteros. */
  getTotal(): number {
    return this.state().reduce((cents, item) => cents + toCents(item.precio) * item.cantidad, 0) / 100;
  }

  /** Si el producto ya está, suma 1 a la cantidad; si no, lo agrega con cantidad 1. */
  addItem(producto: Producto): void {
    this.state.update((items) => {
      const actual = items.find((item) => item.id_producto === producto.id_producto);
      if (!actual) return [...items, buildItem(producto, 1)];
      if (actual.cantidad >= MAX_CANTIDAD_POR_ITEM) return items;
      return items.map((item) => (item === actual ? buildItem(item, item.cantidad + 1) : item));
    });
  }

  /** Resta 1 a la cantidad y, si llega a 0, elimina la línea. Con `quitarTodo` elimina la línea completa. */
  removeItem(idProducto: number, quitarTodo = false): void {
    this.state.update((items) =>
      items.flatMap((item) => {
        if (item.id_producto !== idProducto) return [item];
        return quitarTodo || item.cantidad <= 1 ? [] : [buildItem(item, item.cantidad - 1)];
      }),
    );
  }

  clearCart(): void {
    this.state.set([]);
  }
}