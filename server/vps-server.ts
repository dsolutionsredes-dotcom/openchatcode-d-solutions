import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { ViteDevServer } from 'vite';
import { serverPlugins } from './plugins/index.ts';
import { getKey, seedKeystore } from './keystore.ts';
import { proxyMiddleware } from './proxy.ts';
import { parseEnvText } from '../desktop/env-file.ts';
import { createMiniConnect } from '../desktop/mini-connect.ts';
import { distStaticMiddleware, uploadsMiddleware } from '../desktop/static-files.ts';

const HOST = process.env.OPENCHATCUT_HOST?.trim() || '0.0.0.0';
const PORT = Number(process.env.PORT || process.env.OPENCHATCUT_PORT || 5199);
const PUBLIC_ORIGIN = process.env.OPENCHATCUT_PUBLIC_ORIGIN?.trim()
  || `http://127.0.0.1:${PORT}`;

export interface VpsServer {
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  readonly origin: string;
}

async function seedFromEnvLocal(): Promise<void> {
  const text = await readFile(resolve(process.cwd(), '.env.local'), 'utf8').catch(() => '');
  seedKeystore(parseEnvText(text));
}

function assemblyHeaders(): Record<string, string> {
  const key = getKey('ASSEMBLYAI_API_KEY');
  return key ? { authorization: key } : {};
}

export async function startVpsServer(
  distDir = resolve(process.cwd(), 'dist'),
): Promise<VpsServer> {
  await seedFromEnvLocal();

  const app = createMiniConnect((err) => {
    console.error('[vps-server]', err instanceof Error ? err.message : err);
  });
  const server = createServer((req, res) => app.handle(req, res));

  app.use('/health', (req, res, next) => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, status: 'ok', engine: 'openchatcut', version: '0.2.9' }));
  });

  app.use('/assemblyai', proxyMiddleware({
    target: () => 'https://api.assemblyai.com',
    headers: assemblyHeaders,
  }));

  const fake = {
    middlewares: { use: app.use.bind(app) },
    httpServer: server,
    config: {
      logger: {
        info: (msg: string) => console.log(msg),
        warn: (msg: string) => console.warn(msg),
        error: (msg: string) => console.error(msg),
      },
    },
  } as unknown as ViteDevServer;

  for (const plugin of serverPlugins({ projectStoreHttp: false })) {
    const hook = plugin.configureServer;
    const fn = typeof hook === 'function' ? hook : hook?.handler;
    await fn?.call(plugin as never, fake);
  }

  app.use('/media/uploads', uploadsMiddleware());
  app.use(distStaticMiddleware(distDir));

  await new Promise<void>((resolveListen, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(PORT, HOST);
  });

  const origin = PUBLIC_ORIGIN;
  console.log(`[vps-server] listening on ${origin}`);
  return { server, host: HOST, port: PORT, origin };
}

const entrypoint = process.argv[1];
if (entrypoint && resolve(entrypoint) === fileURLToPath(import.meta.url)) {
  startVpsServer().catch((err) => {
    console.error('[vps-server] boot failed:', err instanceof Error ? err.stack ?? err.message : err);
    process.exitCode = 1;
  });
}
