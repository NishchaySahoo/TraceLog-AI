import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/app';
import { Runbook } from '../src/models/Runbook';
import { RunbookChunk } from '../src/models/RunbookChunk';
import { IncidentLog } from '../src/models/IncidentLog';
import { PostmortemReport } from '../src/models/PostmortemReport';
import { MockLLMProvider } from '../src/providers/llm/mock';
import { LLMService } from '../src/services/llm.service';

describe('Phase 4: Full Pipeline Integration Tests (Supertest + MongoDB)', () => {
  let mongoServer: MongoMemoryServer;
  const app = createApp();

  beforeAll(async () => {
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/tracelog_test', {
        serverSelectionTimeoutMS: 2000
      });
    } catch {
      mongoServer = await MongoMemoryServer.create();
      const uri = mongoServer.getUri();
      await mongoose.connect(uri);
    }
    // Clean collections before test run
    await Runbook.deleteMany({});
    await RunbookChunk.deleteMany({});
    await IncidentLog.deleteMany({});
    await PostmortemReport.deleteMany({});
  }, 120000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await Runbook.deleteMany({});
      await RunbookChunk.deleteMany({});
      await IncidentLog.deleteMany({});
      await PostmortemReport.deleteMany({});
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('Runbook Management Endpoints (/api/v1/runbooks)', () => {
    let uploadedRunbookId: string;

    const sampleMarkdown = `---
service: postgres
tags: [database, pool]
---

# PostgreSQL Operations

## Connection Pooling Issues

### Resolution Steps
When logs indicate ConnectionPoolTimeoutError:
1. Run SELECT * FROM pg_stat_activity;
2. Terminate idle connections.
`;

    it('POST /runbooks/upload - should upload and index a new markdown runbook', async () => {
      const res = await request(app)
        .post('/api/v1/runbooks/upload')
        .attach('file', Buffer.from(sampleMarkdown, 'utf-8'), 'postgres.md');

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('runbook');
      expect(res.body.skipped).toBe(false);
      expect(res.body.totalChunks).toBeGreaterThan(0);
      expect(res.body.runbook.serviceName).toBe('postgres');
      expect(res.body.runbook.fileName).toBe('postgres.md');

      uploadedRunbookId = res.body.runbook.id;

      // Verify DB persistence
      const count = await RunbookChunk.countDocuments({ runbookId: uploadedRunbookId });
      expect(count).toBe(res.body.totalChunks);
    });

    it('POST /runbooks/upload - should skip unchanged runbook with identical content hash', async () => {
      const res = await request(app)
        .post('/api/v1/runbooks/upload')
        .attach('file', Buffer.from(sampleMarkdown, 'utf-8'), 'postgres.md');

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(true);
      expect(res.body.runbook.id).toBe(uploadedRunbookId);
    });

    it('POST /runbooks/upload - should replace changed runbook atomically', async () => {
      const modifiedMarkdown =
        sampleMarkdown +
        '\n\n# Advanced Operations\n\n## Failover Procedures\nDetailed failover operations for replica nodes when primary crashes.\nVerify replication lag before promoting standby node to primary.\n';

      const res = await request(app)
        .post('/api/v1/runbooks/upload')
        .attach('file', Buffer.from(modifiedMarkdown, 'utf-8'), 'postgres.md');

      expect(res.status).toBe(201);
      expect(res.body.skipped).toBe(false);
      expect(res.body.runbook.id).toBe(uploadedRunbookId);
      expect(res.body.totalChunks).toBeGreaterThanOrEqual(2);
    });

    it('GET /runbooks - should list runbooks without returning raw embeddings', async () => {
      const res = await request(app).get('/api/v1/runbooks');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.runbooks)).toBe(true);
      expect(res.body.runbooks.length).toBeGreaterThan(0);

      const rb = res.body.runbooks[0];
      expect(rb).toHaveProperty('id');
      expect(rb).toHaveProperty('serviceName');
      expect(rb).not.toHaveProperty('embedding');
    });

    it('GET /runbooks/:id - should get single runbook with chunk headers and no embeddings', async () => {
      const res = await request(app).get(`/api/v1/runbooks/${uploadedRunbookId}`);

      expect(res.status).toBe(200);
      expect(res.body.runbook.id).toBe(uploadedRunbookId);
      expect(Array.isArray(res.body.chunks)).toBe(true);
      expect(res.body.chunks.length).toBeGreaterThan(0);

      for (const chunk of res.body.chunks) {
        expect(chunk).toHaveProperty('headerContext');
        expect(chunk).not.toHaveProperty('embedding');
      }
    });

    it('DELETE /runbooks/:id - should delete runbook and cascade delete its chunks', async () => {
      const res = await request(app).delete(`/api/v1/runbooks/${uploadedRunbookId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const rb = await Runbook.findById(uploadedRunbookId);
      expect(rb).toBeNull();

      const chunksCount = await RunbookChunk.countDocuments({ runbookId: uploadedRunbookId });
      expect(chunksCount).toBe(0);
    });
  });

  describe('Incident Triage & Pipeline Endpoints (/api/v1/incidents)', () => {
    let incidentId: string;

    beforeAll(async () => {
      // Seed a runbook for triage matching
      const runbookMd = `---
service: postgres
tags: [database, pool]
---

# PostgreSQL Operations

## Connection Pooling Issues

### Resolution Steps
When application logs indicate ConnectionPoolTimeoutError:
1. Terminate idle-in-transaction connections.
2. Increase max_connections or restart pooler.
`;
      await request(app)
        .post('/api/v1/runbooks/upload')
        .attach('file', Buffer.from(runbookMd, 'utf-8'), 'postgres.md');
    });

    it('POST /incidents/triage - runs full triage happy path, maps citations, and computes confidence', async () => {
      const testLog = `
2026-10-14T09:30:12.123Z [error] [postgres] ConnectionPoolTimeoutError: Timeout acquiring connection from pool
    at ConnectionPool.acquire (/app/node_modules/pg-pool/index.js:312:19)
    at DatabaseClient.query (/app/src/db/client.ts:45:10)
remaining connection slots are reserved for non-replication superuser connections
      `;

      const res = await request(app)
        .post('/api/v1/incidents/triage')
        .send({
          rawLog: testLog,
          serviceName: 'postgres'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('incident');
      expect(res.body).toHaveProperty('report');
      expect(res.body).toHaveProperty('repeatInfo');

      const { incident, report, repeatInfo } = res.body;

      incidentId = incident.id;
      expect(incident.serviceName).toBe('postgres');
      expect(incident.severity).toBe('HIGH');
      expect(incident.status).toBe('TRIAGED');
      expect(incident.errorSignature).toContain('ConnectionPoolTimeoutError');
      expect(repeatInfo.priorCount).toBe(0);

      expect(report.summary).toBeDefined();
      expect(report.confidence).toBeGreaterThan(0);
      expect(report.insufficientContext).toBe(false);
      expect(report.citations.length).toBeGreaterThan(0);

      const citation = report.citations[0];
      expect(citation).toHaveProperty('ref');
      expect(citation).toHaveProperty('chunkId');
      expect(citation).toHaveProperty('fileName');
      expect(citation).toHaveProperty('cosineSimilarity');
    });

    it('POST /incidents/triage - detects repeat incidents with identical signatureHash', async () => {
      const identicalLog = `
2026-10-14T10:00:00.000Z [error] [postgres] ConnectionPoolTimeoutError: Timeout acquiring connection from pool
    at ConnectionPool.acquire (/app/node_modules/pg-pool/index.js:312:19)
    at DatabaseClient.query (/app/src/db/client.ts:45:10)
remaining connection slots are reserved for non-replication superuser connections
      `;

      const res = await request(app)
        .post('/api/v1/incidents/triage')
        .send({
          rawLog: identicalLog,
          serviceName: 'postgres'
        });

      expect(res.status).toBe(200);
      expect(res.body.repeatInfo.priorCount).toBe(1);
      expect(res.body.repeatInfo.lastIncidentId).toBe(incidentId);
      expect(res.body.repeatInfo.lastSeenAt).toBeDefined();
    });

    it('POST /incidents/triage - handles insufficientContext when no runbook matches', async () => {
      const unknownLog = `
2026-10-14T11:00:00.000Z [fatal] [obscure-service] QuantumFluxDisruptionError: Flux capacitor desynchronized
    at QuantumCore.stabilize (/opt/quantum/engine.ts:99:12)
      `;

      const res = await request(app)
        .post('/api/v1/incidents/triage')
        .send({
          rawLog: unknownLog,
          serviceName: 'obscure-service'
        });

      expect(res.status).toBe(200);
      const { report, incident } = res.body;

      expect(report.insufficientContext).toBe(true);
      expect(report.confidence).toBe(0);
      expect(report.citations).toEqual([]);
      expect(incident.status).toBe('OPEN');
    });

    it('GET /incidents - supports pagination, search query, and severity filters', async () => {
      const res = await request(app).get('/api/v1/incidents?page=1&limit=5&severity=HIGH');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.incidents)).toBe(true);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page', 1);
      expect(res.body).toHaveProperty('limit', 5);

      for (const inc of res.body.incidents) {
        expect(inc.severity).toBe('HIGH');
        expect(inc.rawLog).toBeUndefined(); // rawLog excluded by default
      }
    });

    it('GET /incidents/:id - retrieves incident details with sanitized log and report', async () => {
      const res = await request(app).get(`/api/v1/incidents/${incidentId}`);

      expect(res.status).toBe(200);
      expect(res.body.incident.id).toBe(incidentId);
      expect(res.body.incident.sanitizedLog).toBeDefined();
      expect(res.body.report.incidentId).toBe(incidentId);
    });

    it('PATCH /incidents/:id/status - updates status to RESOLVED', async () => {
      const res = await request(app)
        .patch(`/api/v1/incidents/${incidentId}/status`)
        .send({ status: 'RESOLVED' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('RESOLVED');

      const updated = await IncidentLog.findById(incidentId);
      expect(updated?.status).toBe('RESOLVED');
    });
  });

  describe('LLM Malformed JSON & Retry Logic', () => {
    it('throws 502 LLM_OUTPUT_MALFORMED when LLM fails JSON validation twice', async () => {
      const mockProvider = new MockLLMProvider('mock-faulty');
      // Return invalid non-JSON every time
      mockProvider.setResponseGenerator(() => 'This is not JSON at all');

      const service = new LLMService(mockProvider);
      const fakeRetrieved = [
        {
          chunkId: 'chunk1',
          runbookId: 'rb1',
          serviceName: 'postgres',
          fileName: 'postgres.md',
          headerPath: ['H1'],
          headerContext: 'H1',
          anchor: 'h1',
          chunkText: 'Text',
          cosineSimilarity: 0.9,
          fusedScore: 0.05,
          retrievalSources: ['keyword' as const]
        }
      ];

      await expect(service.synthesize('log', 'sig', fakeRetrieved)).rejects.toMatchObject({
        statusCode: 502,
        code: 'LLM_OUTPUT_MALFORMED'
      });
    });

    it('successfully recovers when first attempt is malformed but retry succeeds', async () => {
      let callCount = 0;
      const mockProvider = new MockLLMProvider('mock-recovering');
      mockProvider.setResponseGenerator(() => {
        callCount++;
        if (callCount === 1) {
          return 'INVALID JSON';
        }
        return JSON.stringify({
          severity: 'LOW',
          summary: 'Recovered summary after retry',
          probableRootCause: 'Recovered root cause',
          immediateMitigation: [{ step: 'Step 1', refs: [1] }],
          longTermFixes: [],
          hypotheses: [],
          usedRefs: [1]
        });
      });

      const service = new LLMService(mockProvider);
      const fakeRetrieved = [
        {
          chunkId: 'chunk1',
          runbookId: 'rb1',
          serviceName: 'postgres',
          fileName: 'postgres.md',
          headerPath: ['H1'],
          headerContext: 'H1',
          anchor: 'h1',
          chunkText: 'Text',
          cosineSimilarity: 0.85,
          fusedScore: 0.05,
          retrievalSources: ['keyword' as const]
        }
      ];

      const report = await service.synthesize('log', 'sig', fakeRetrieved);
      expect(callCount).toBe(2);
      expect(report.summary).toBe('Recovered summary after retry');
      expect(report.citations.length).toBe(1);
    });
  });
});
