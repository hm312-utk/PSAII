import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

/**
 * GET /api/catalog
 * Menú agrupado por categoría, listo para pintar en el kiosko.
 * Solo incluye categorías activas y productos disponibles: lo que el cliente
 * ve siempre es lo que puede comprar en este momento.
 */
router.get('/catalog', async (_req, res) => {
  const rows = await pool.query(
    `SELECT
       c.id_categoria, c.nombre AS categoria_nombre, c.descripcion AS categoria_descripcion,
       p.id_producto, p.nombre AS producto_nombre, p.descripcion AS producto_descripcion,
       p.precio, p.imagen_url
     FROM Categorias c
     INNER JOIN Productos p ON p.id_categoria = c.id_categoria AND p.disponible = 1
     WHERE c.activo = 1
     ORDER BY c.id_categoria, p.nombre`,
  );

  // Agrupar en JS: una sola consulta (sin N+1) y la forma anidada que el frontend necesita.
  const categorias = [];
  const porId = new Map();

  for (const row of rows) {
    let categoria = porId.get(row.id_categoria);
    if (!categoria) {
      categoria = {
        id_categoria: row.id_categoria,
        nombre: row.categoria_nombre,
        descripcion: row.categoria_descripcion,
        productos: [],
      };
      porId.set(row.id_categoria, categoria);
      categorias.push(categoria);
    }

    categoria.productos.push({
      id_producto: row.id_producto,
      nombre: row.producto_nombre,
      descripcion: row.producto_descripcion,
      precio: row.precio, // string decimal, p. ej. "45.50" — igual que `amount` en el pago
      imagen_url: row.imagen_url,
    });
  }

  res.json({ success: true, categorias });
});

export default router;
