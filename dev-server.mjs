import 'dotenv/config';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import { createServer as createViteServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'spa',
});

app.use('/api', express.raw({ type: '*/*', limit: '10mb' }));

function resolveHandler(urlPath) {
  const rel = urlPath.replace(/^\/api\//, '');
  for (const candidate of [`api/${rel}.ts`, `api/${rel}/index.ts`]) {
    const abs = path.join(__dirname, candidate);
    if (existsSync(abs)) return '/' + candidate;
  }
  return null;
}

app.all('/api/*', async (req, res) => {
  const handlerPath = resolveHandler(req.path);
  if (!handlerPath) {
    res.status(404).json({ error: `No API handler for ${req.path}` });
    return;
  }

  try {
    const mod = await vite.ssrLoadModule(handlerPath);
    const handler = mod.default;
    if (typeof handler !== 'function') {
      throw new Error(`${handlerPath} has no default export`);
    }

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }
    const init = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body?.length) {
      init.body = req.body;
    }
    const webReq = new Request(`http://localhost:47821${req.originalUrl}`, init);

    const webRes = await handler(webReq);

    res.status(webRes.status);
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    const buf = Buffer.from(await webRes.arrayBuffer());
    res.send(buf);
  } catch (err) {
    console.error(`API ${req.path} failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.use(vite.middlewares);

const port = 47821;
app.listen(port, () => {
  console.log(`✓ Local dev server ready: http://localhost:${port}`);
});
