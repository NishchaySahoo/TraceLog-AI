import { describe, it, expect } from 'vitest';
import { extractSignature } from '../src/services/signature';

describe('Signature Extraction Service (signature.ts)', () => {
  it('extracts signature from Node.js V8 stack trace with error token and tech keywords', () => {
    const nodeLog = `
2026-10-14T09:30:12.000Z [error] [payment-service] ConnectionPoolTimeoutError: Timeout acquiring connection from pool
    at ConnectionPool.acquire (/app/node_modules/pg-pool/index.js:312:19)
    at DatabaseClient.query (/app/src/db/client.ts:45:10)
    at PaymentHandler.process (/app/src/handlers/payment.ts:88:22)
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)
    `;

    const result = extractSignature(nodeLog);

    expect(result.errorTokens).toContain('ConnectionPoolTimeoutError');
    expect(result.signature).toContain('ConnectionPoolTimeoutError');
    expect(result.signature).toContain('ConnectionPool.acquire');
    expect(result.techKeywords).toContain('payment');
    expect(result.detectedService).toBe('payment-service');
    expect(result.signatureHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('extracts signature from Python Traceback', () => {
    const pythonLog = `
Traceback (most recent call last):
  File "/app/workers/tasks.py", line 124, in process_batch
    redis_client.get(cache_key)
  File "/usr/local/lib/python3.11/site-packages/redis/client.py", line 550, in execute_command
    return self.parse_response(conn, command_name, **options)
redis.exceptions.ConnectionError: Error 111 connecting to localhost:6379. ECONNREFUSED.
    `;

    const result = extractSignature(pythonLog);

    expect(result.errorTokens).toContain('ConnectionError');
    expect(result.errorTokens).toContain('ECONNREFUSED');
    expect(result.signature).toContain('ConnectionError');
    expect(result.signature).toContain('process_batch');
    expect(result.techKeywords).toContain('redis');
    expect(result.detectedService).toBe('redis');
    expect(result.signatureHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('extracts signature from Go panic stack trace', () => {
    const goLog = `
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x7fa281]

goroutine 42 [running]:
main.processKafkaMessage(0xc000124000, 0x1f)
\t/go/src/app/kafka_consumer.go:78 +0x3a
main.(*KafkaWorker).Run(0xc0000a2000)
\t/go/src/app/worker.go:45 +0x12b
created by main.main
\t/go/src/app/main.go:30 +0x8a
    `;

    const result = extractSignature(goLog);

    expect(result.errorTokens).toContain('SIGSEGV');
    expect(result.errorTokens).toContain('panic:');
    expect(result.signature).toContain('SIGSEGV');
    expect(result.techKeywords).toContain('kafka');
    expect(result.signatureHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('extracts signature from Kubernetes OOMKilled crash log', () => {
    const k8sLog = `
State:          Terminated
Reason:         OOMKilled
Exit Code:      137
Started:        Wed, 14 Oct 2026 08:00:00 +0000
Finished:       Wed, 14 Oct 2026 09:15:30 +0000
service="auth-service" container="worker" pod="auth-worker-7c9d9-4b2x"
    `;

    const result = extractSignature(k8sLog);

    expect(result.errorTokens).toContain('OOMKilled');
    expect(result.signature).toContain('OOMKilled');
    expect(result.detectedService).toBe('auth-service');
  });

  it('gracefully provides fallback for unstructured or empty log lines without throwing', () => {
    const unstructuredLog = 'Just a normal informational message line without any known errors';
    const result = extractSignature(unstructuredLog);

    expect(result.signature).toContain('UnknownError');
    expect(result.signature).toContain('Just a normal informational message line');
    expect(result.signatureHash).toMatch(/^[0-9a-f]{64}$/);

    const emptyResult = extractSignature('');
    expect(emptyResult.signature).toBe('EmptyLog');
    expect(emptyResult.signatureHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
