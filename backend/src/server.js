import { createApp } from './app.js';
import { config } from './config.js';
import { gateway } from './gateways/index.js';

const server = createApp().listen(config.port, config.host, () => {
  console.info(`PayLink HN API en http://${config.host}:${config.port} (gateway: ${gateway.name}, entorno: ${config.nodeEnv})`);
});

// Cierre ordenado: systemd envía SIGTERM al parar o reiniciar el servicio.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
