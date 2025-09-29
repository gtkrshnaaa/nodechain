import { createServer } from './server.js';
import config from './node.config.json' assert { type: 'json' };

const app = await createServer(config);
await app.listen({ host: '0.0.0.0', port: config.port });
