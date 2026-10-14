import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import * as dbModule from '../src/config/db';

describe('Health & App Middleware Integration (/api/v1/health)', () => {
  const app = createApp();

  it('GET /api/v1/health should return 200 OK when DB is connected', async () => {
    vi.spyOn(dbModule, 'isDBConnected').mockReturnValue(true);

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      mongo: 'connected',
      retrievalMode: 'memory',
      embeddingProvider: 'mock',
      llmProvider: 'mock'
    });
    expect(res.body).toHaveProperty('timestamp');
    expect(res.headers).toHaveProperty('x-request-id');
  });

  it('GET /api/v1/health should return 503 degraded when DB is disconnected', async () => {
    vi.spyOn(dbModule, 'isDBConnected').mockReturnValue(false);

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'degraded',
      mongo: 'disconnected'
    });
  });

  it('GET /api/v1/non-existent-route should return 404 with structured error shape', async () => {
    const res = await request(app).get('/api/v1/non-existent-route');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Route GET /api/v1/non-existent-route not found',
      details: []
    });
    expect(res.body.error).toHaveProperty('requestId');
    expect(res.headers).toHaveProperty('x-request-id');
  });

  it('should propagate client provided x-request-id header', async () => {
    const customRequestId = 'test-client-req-12345';
    const res = await request(app)
      .get('/api/v1/health')
      .set('x-request-id', customRequestId);

    expect(res.headers['x-request-id']).toBe(customRequestId);
  });
});
