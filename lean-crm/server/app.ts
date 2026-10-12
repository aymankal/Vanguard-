import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { api, errorHandler } from './api.js';
import { ai } from './ai.js';
import { auth, attachScope, allowRoles } from './auth.js';
import { agency, portalRoutes } from './agency.js';

const requireAgency = (req: Request, res: Response, next: NextFunction) =>
  req.scope.agency ? next() : res.status(404).json({ error: 'Agency Mode is off.' });

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.use('/api/auth', auth);
  app.use('/api', attachScope); // every route below runs with req.scope
  app.use('/api/agency', requireAgency, allowRoles('owner'), agency);
  app.use('/api/portal', requireAgency, allowRoles('client', 'owner'), portalRoutes);
  app.use('/api/ai', allowRoles('owner', 'rep'), ai);
  app.use('/api', allowRoles('owner', 'rep'), api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', errorHandler);

  // Production: serve the built client.
  const dist = new URL('../dist', import.meta.url).pathname;
  if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}
