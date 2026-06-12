/**
 * server.ts — local development server only.
 *
 * On Vercel this file is NOT used. The serverless function entry-point is
 * api/index.ts, which contains all Express routes inline.
 *
 * Run locally with:   npm run dev   (uses tsx for hot-reload)
 * Or in prod mode:    npm run build && npm start
 */
import express from 'express';
import path from 'path';

// Re-use the handler that Vercel also calls — keeps a single source of truth
// for all route definitions. We just wrap it in a listen() call here.
import handler from './api/index.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const app = express();

// Forward everything through the shared handler
app.use((req, res) => handler(req as any, res as any));

// In development, inject Vite's dev middleware BEFORE the API handler so HMR
// and static assets work. In production, serve the Vite build output.
if (process.env.NODE_ENV !== 'production') {
  import('vite').then(async (viteMod) => {
    const vite = await viteMod.createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    // Vite should only handle non-API requests, so insert it as a fallback
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      vite.middlewares(req, res, next);
    });
  });
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/'))
      res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[dev] Server running on http://localhost:${PORT}`);
});
