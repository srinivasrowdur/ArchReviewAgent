import 'dotenv/config';

import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { researchCompany } from './researchAgent.js';
import { createMockReport } from './mockReport.js';
import { checkDatabaseHealth } from './db/client.js';
import { isAllowedCorsOrigin } from './cors.js';
import {
  getDetailedHealthResponse,
  getPublicHealthResponse,
  isInternalApiAuthorized
} from './publicSurface.js';
import { formatResearchError } from './formatResearchError.js';
import { createSecurityHeadersMiddleware } from './securityHeaders.js';
import type {
  ResearchProgressUpdate,
  ResearchRequest,
  ResearchResponse
} from '../shared/contracts.js';

const app = express();
const port = Number(process.env.PORT ?? 8787);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(currentDir, '../../dist');
const configuredAllowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(createSecurityHeadersMiddleware());
app.use((req, res, next) => {
  cors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(req, origin, configuredAllowedOrigins));
    }
  })(req, res, next);
});
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  await checkDatabaseHealth();
  const response = getPublicHealthResponse();

  res.status(response.status).json(response.body);
});

app.get('/api/internal/health', async (req, res) => {
  if (!isInternalApiAuthorized(req)) {
    res.status(404).end();
    return;
  }

  const database = await checkDatabaseHealth();
  const response = getDetailedHealthResponse(database);

  res.status(response.status).json(response.body);
});

app.post('/api/chat/test', (req, res) => {
  if (!isInternalApiAuthorized(req)) {
    res.status(404).end();
    return;
  }

  const { companyName: normalizedCompanyName } = getResearchRequestData(req);

  const response: ResearchResponse = {
    mode: 'test',
    report: createMockReport(normalizedCompanyName || 'Sample Vendor')
  };

  res.json(response);
});

app.post('/api/chat', async (req, res) => {
  const researchTarget = requireResearchTarget(req, res);

  if (!researchTarget) {
    return;
  }

  try {
    const report = await researchCompany(researchTarget.companyName, {
      forceRefresh: researchTarget.refresh
    });
    const response: ResearchResponse = { mode: 'live', report };

    res.json(response);
  } catch (error) {
    const { message, status } = formatResearchError(error);

    if (status === 500) {
      console.error(error);
    }

    res.status(status).json({
      error: message
    });
  }
});

app.post('/api/chat/stream', async (req, res) => {
  const researchTarget = requireResearchTarget(req, res);

  if (!researchTarget) {
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;

  res.on('close', () => {
    closed = true;
  });

  const sendEvent = (event: string, payload: unknown) => {
    if (closed || res.writableEnded) {
      return;
    }

    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sendEvent('ready', { ok: true });

  try {
    const report = await researchCompany(
      researchTarget.companyName,
      {
        forceRefresh: researchTarget.refresh,
        onProgress: (update: ResearchProgressUpdate) => {
          sendEvent('progress', update);
        }
      }
    );

    sendEvent('result', {
      mode: 'live',
      report
    });
  } catch (error) {
    const { message, status } = formatResearchError(error);

    if (status === 500) {
      console.error(error);
    }

    sendEvent('error', {
      error: message
    });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

function getResearchRequestData(req: express.Request) {
  const { companyName, refresh } = (req.body ?? {}) as Partial<ResearchRequest>;

  return {
    companyName: typeof companyName === 'string' ? companyName.trim() : '',
    refresh: refresh === true
  };
}

function requireResearchTarget(req: express.Request, res: express.Response) {
  const normalizedRequest = getResearchRequestData(req);

  if (normalizedRequest.companyName.length >= 2) {
    return normalizedRequest;
  }

  res.status(400).json({
    error: 'Enter a company or product name to research.'
  });

  return null;
}

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Enterprise guardrail server listening on http://localhost:${port}`);
});
