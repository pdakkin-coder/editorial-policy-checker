import type { Express } from 'express';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';

export function serveStatic(app: Express) {
  const distPublic = path.resolve(import.meta.dirname, '..', 'dist', 'public');
  if (!fs.existsSync(distPublic)) {
    console.warn('[epc] dist/public not found — run npm run build first');
    return;
  }
  app.use(express.static(distPublic));
  app.get('/{*path}', (_req, res) =>
    res.sendFile(path.join(distPublic, 'index.html'))
  );
}
