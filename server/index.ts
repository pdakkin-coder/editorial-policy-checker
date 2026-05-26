import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'node:http';
import { registerRoutes } from './routes.js';
import { serveStatic } from './static.js';

const app = express();
const httpServer = createServer(app);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// Request logger
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(`[epc] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    }
  });
  next();
});

(async () => {
  registerRoutes(app);

  // Error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    console.error('[epc] error:', err);
    if (!res.headersSent) res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === 'production') {
    serveStatic(app);
  } else {
    const { setupVite } = await import('./vite.js');
    await setupVite(httpServer, app);
  }

  const PORT = parseInt(process.env.PORT || '5000', 10);
  const HOST = process.env.HOST || '0.0.0.0';

  httpServer.listen({ port: PORT, host: HOST }, () => {
    const display = HOST === '0.0.0.0' ? 'localhost' : HOST;
    const localIp = process.env.LOCAL_IP || HOST;
    console.log(`[epc] serving on http://${display}:${PORT}`);
    if (localIp !== '0.0.0.0') console.log(`[epc] network:  http://${localIp}:${PORT}`);
  });
})();
