// src/routes/chat.js
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';

// Configurable por .env (todo opcional); los valores por defecto sirven para Ollama local con llama3.2:1b.
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:1b';
// Debe ser MENOR que el timeout del cliente (30 s en ChatService): así el servidor falla primero, con un error
// controlado, y deja de gastar CPU en una respuesta que la app ya no va a esperar.
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 25_000);
// Opcional: limita los hilos de inferencia para dejar núcleos libres a MariaDB y a los cobros.
const OLLAMA_NUM_THREAD = Number(process.env.OLLAMA_NUM_THREAD) || undefined;

const MAX_MENSAJE = 300;
const MAX_CONSULTAS_SIMULTANEAS = 2; // el rate limit acota la frecuencia, no cuántas inferencias corren a la vez
const SIMBOLO_MONEDA = '$'; // el mismo que ve el cliente en el menú

const router = Router();
let consultasEnCurso = 0;

const promptDeSistema = (menu) =>
  'Eres el mesero IA de PayLink HN. Eres hondureño, amable y muy conciso (máximo 2 oraciones). ' +
  `Este es el menú actual del restaurante: ${menu}. ` +
  'Responde a lo que pide el usuario sugiriendo opciones reales del menú. ' +
  'NO inventes productos ni precios que no estén en el menú. No uses formato Markdown.';

/** RAG dinámico: el menú vigente en la BD como texto simple. "Bebidas: Limonada ($30.00), Horchata ($28.00). Platos: …" */
async function construirMenu() {
  const filas = await pool.query(
    `SELECT c.nombre AS categoria, p.nombre, p.precio
       FROM Productos p
       INNER JOIN Categorias c ON c.id_categoria = p.id_categoria
      WHERE p.disponible = 1 AND c.activo = 1
      ORDER BY c.id_categoria, p.nombre`,
  );
  if (filas.length === 0) return 'hoy no hay productos disponibles';

  const porCategoria = new Map();
  for (const { categoria, nombre, precio } of filas) {
    if (!porCategoria.has(categoria)) porCategoria.set(categoria, []);
    porCategoria.get(categoria).push(`${nombre} (${SIMBOLO_MONEDA}${precio})`);
  }
  return [...porCategoria].map(([categoria, items]) => `${categoria}: ${items.join(', ')}`).join('. ');
}

/** Los modelos pequeños a veces ignoran "sin Markdown" o se cortan a media frase: se corrige aquí, no en la app. */
function limpiarRespuesta(texto) {
  const limpio = texto.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  if (/[.!?)"]$/.test(limpio)) return limpio;
  // Cortada por num_predict: se queda con la última oración completa (si no hay ninguna, se deja tal cual).
  return limpio.match(/^.*[.!?](?=\s)/)?.[0] ?? limpio;
}

/** POST a Ollama. Cualquier fallo se traduce a un AppError controlado (nunca se filtra el error interno al cliente). */
async function consultarOllama(sistema, mensaje) {
  try {
    const respuesta = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS), // fetch no trae timeout propio: sin esto podría colgarse minutos
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: mensaje },
        ],
        stream: false, // imprescindible: una sola respuesta JSON en vez de un flujo de fragmentos
        keep_alive: '30m', // Ollama descarga el modelo tras 5 min inactivo; recargarlo come varios segundos de la primera consulta
        options: { temperature: 0.3, num_predict: 160, ...(OLLAMA_NUM_THREAD && { num_thread: OLLAMA_NUM_THREAD }) },
      }),
    });

    if (!respuesta.ok) {
      console.error('[chat] Ollama respondió', respuesta.status, (await respuesta.text()).slice(0, 200));
      throw new AppError(502, 'AI_UNAVAILABLE', 'El mesero IA no está disponible por ahora.');
    }

    const contenido = (await respuesta.json())?.message?.content;
    if (typeof contenido !== 'string' || contenido.trim() === '') {
      throw new AppError(502, 'AI_BAD_RESPONSE', 'El mesero IA no pudo responder esta vez.');
    }
    return limpiarRespuesta(contenido);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error.name === 'TimeoutError') {
      throw new AppError(504, 'AI_TIMEOUT', 'El mesero IA tardó demasiado en responder.');
    }
    // Servicio caído (ECONNREFUSED), JSON inválido, etc.
    console.error('[chat] Ollama no respondió:', error.cause?.code ?? error.name, error.message);
    throw new AppError(502, 'AI_UNAVAILABLE', 'El mesero IA no está disponible por ahora.');
  }
}

/**
 * POST /api/chat   Body: { message }   →   { success: true, reply }
 * La IA solo devuelve texto: no toca el carrito ni los precios (los cobros siguen saliendo de la BD).
 */
router.post('/chat', async (req, res) => {
  const mensaje = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (mensaje.length === 0 || mensaje.length > MAX_MENSAJE) {
    throw new AppError(400, 'INVALID_REQUEST', `message es obligatorio (máximo ${MAX_MENSAJE} caracteres)`);
  }
  if (consultasEnCurso >= MAX_CONSULTAS_SIMULTANEAS) {
    throw new AppError(503, 'AI_BUSY', 'El mesero IA está ocupado. Inténtalo de nuevo en un momento.');
  }

  consultasEnCurso++;
  const inicio = Date.now();
  try {
    const reply = await consultarOllama(promptDeSistema(await construirMenu()), mensaje);
    console.info('[chat] respuesta en', Date.now() - inicio, 'ms');
    res.json({ success: true, reply });
  } finally {
    consultasEnCurso--;
  }
});

export default router;
