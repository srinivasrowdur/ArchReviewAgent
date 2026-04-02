import 'dotenv/config';

import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IncompleteResearchError,
  InvalidVendorInputError,
  MissingOpenAIKeyError,
  ResearchGenerationError,
  ResearchTimeoutError,
  VendorResolutionError,
  researchCompany,
  researchCompanyStream
} from './researchAgent.js';
import { createMockReport } from './mockReport.js';
import type {
  ResearchProgressUpdate,
  ResearchRequest,
  ResearchResponse
} from '../shared/contracts.js';

const app = express();
const port = Number(process.env.PORT ?? 8787);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(currentDir, '../../dist');

app.use(
  cors({
    origin: true
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true
  });
});

app.post('/api/chat/test', (req, res) => {
  const { companyName } = (req.body ?? {}) as Partial<ResearchRequest>;
  const normalizedCompanyName =
    typeof companyName === 'string' ? companyName.trim() : '';

  const response: ResearchResponse = {
    mode: 'test',
    report: createMockReport(normalizedCompanyName || 'Sample Vendor')
  };

  res.json(response);
});

app.post('/api/chat', async (req, res) => {
  const { companyName } = (req.body ?? {}) as Partial<ResearchRequest>;
  const normalizedCompanyName =
    typeof companyName === 'string' ? companyName.trim() : '';

  if (normalizedCompanyName.length < 2) {
    res.status(400).json({
      error: 'Enter a company or product name to research.'
    });
    return;
  }

  try {
    const report = await researchCompany(normalizedCompanyName);
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
  const { companyName } = (req.body ?? {}) as Partial<ResearchRequest>;
  const normalizedCompanyName =
    typeof companyName === 'string' ? companyName.trim() : '';

  if (normalizedCompanyName.length < 2) {
    res.status(400).json({
      error: 'Enter a company or product name to research.'
    });
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
    const report = await researchCompanyStream(
      normalizedCompanyName,
      (update: ResearchProgressUpdate) => {
        sendEvent('progress', update);
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

function formatResearchError(error: unknown) {
  if (error instanceof MissingOpenAIKeyError) {
    return {
      status: 500,
      message: 'Set OPENAI_API_KEY before starting the backend.'
    };
  }

  if (error instanceof InvalidVendorInputError) {
    return {
      status: 400,
      message: error.message
    };
  }

  if (error instanceof VendorResolutionError) {
    return {
      status: 422,
      message: error.message
    };
  }

  if (error instanceof IncompleteResearchError) {
    return {
      status: 502,
      message:
        'The agent could not find enough evidence for EU residency and deployment guardrails. Try a more specific company or product name.'
    };
  }

  if (error instanceof ResearchTimeoutError) {
    return {
      status: 504,
      message:
        'Live research took too long. Retry, try a more specific vendor name, or use test mode for a fast UI check.'
    };
  }

  if (error instanceof ResearchGenerationError) {
    return {
      status: 502,
      message:
        'The live research run failed before producing a complete verdict. Retry once, or try a more specific vendor or product name.'
    };
  }

  return {
    status: 500,
    message: 'Unexpected backend error while running enterprise research.'
  };
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
