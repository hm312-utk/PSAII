import mariadb from 'mariadb';
import { config } from '../config.js';

export const pool = mariadb.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.connectionLimit,

  charset: 'utf8mb4', // el driver ya lo negocia así por defecto; explícito para no depender de eso
  insertIdAsNumber: true, // si no, un INSERT devuelve insertId como BigInt y rompe JSON.stringify
  decimalAsNumber: false, // DECIMAL (dinero) llega como string "45.50", nunca como float
  bigIntAsNumber: true, // ningún BIGINT en este esquema; evita BigInt también ahí si llegara a haber uno

  connectTimeout: 5000,
  acquireTimeout: 5000,
});

/**
 * Pide una conexión, ejecuta `work(conn)` dentro de una transacción y hace commit.
 * Si `work` lanza, hace rollback y relanza el error. Siempre libera la conexión al pool.
 * Usar para cualquier operación que haga más de un INSERT/UPDATE que deba ser atómico
 * (por ejemplo: crear un Pedido + su Detalle_Pedido + actualizar cantidad_vendida).
 */
export async function withTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {}); // si el rollback también falla, prevalece el error original
    throw error;
  } finally {
    conn.release();
  }
}

/** Confirma al arrancar que la base de datos responde, con un mensaje claro si no. */
export async function pingDatabase() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
  } finally {
    conn.release();
  }
}
