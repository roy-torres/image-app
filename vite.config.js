import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Runs the serverless proxy (api/generate.js) inside `vite dev` so the full
// flow works locally without `vercel dev`. Production uses the real Vercel
// function; this is dev-only glue.
function apiDevServer(env) {
  return {
    name: 'api-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.originalUrl || req.url || '').split('?')[0];
        if (url !== '/api/generate') return next();

        Object.assign(process.env, env);
        try {
          const { default: handler } = await server.ssrLoadModule('/api/generate.js');

          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;

          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: req.headers,
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
          });

          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            if (key !== 'content-length' && key !== 'content-encoding') {
              res.setHeader(key, value);
            }
          });
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          server.config.logger.error(`[api-dev-server] ${err?.stack || err}`);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Dev proxy error. See terminal.' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), apiDevServer(env)],
    build: {
      // No inline module-preload polyfill script, so the CSP can stay
      // script-src 'self' with no inline allowance. Targets are evergreen.
      modulePreload: { polyfill: false },
    },
  };
});
