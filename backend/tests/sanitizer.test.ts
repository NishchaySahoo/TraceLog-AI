import { describe, it, expect } from 'vitest';
import { sanitizeLog } from '../src/services/logSanitizer';

describe('Log Sanitizer Service (logSanitizer.ts)', () => {
  describe('Rule 1: Secrets Redaction', () => {
    const cases = [
      {
        name: 'redacts AWS Access Keys',
        input: 'Configured AWS credentials with AKIAIOSFODNN7EXAMPLE for S3',
        expected: 'Configured AWS credentials with <REDACTED> for S3',
        redacted: true
      },
      {
        name: 'does not redact invalid short AWS key (negative test)',
        input: 'Identifier AKIASHORT is not an access key',
        expected: 'Identifier AKIASHORT is not an access key',
        redacted: false
      },
      {
        name: 'redacts JWT tokens',
        input: 'Token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c in headers',
        expected: 'Token <REDACTED> in headers',
        redacted: true
      },
      {
        name: 'does not redact short dotted strings (negative test)',
        input: 'Version string foo.bar.baz is not a JWT',
        expected: 'Version string foo.bar.baz is not a JWT',
        redacted: false
      },
      {
        name: 'redacts Authorization Bearer token',
        input: 'Authorization: Bearer eyJhbGciOiJIUzI1Ni.secret_payload.signature',
        expected: 'Authorization: <REDACTED>',
        redacted: true
      },
      {
        name: 'redacts Basic auth header',
        input: 'Authorization: Basic YWRtaW46cGFzc3dvcmQxMjM=',
        expected: 'Authorization: <REDACTED>',
        redacted: true
      },
      {
        name: 'does not redact ordinary usage of bearer word (negative test)',
        input: 'The bearer of bad news arrived today',
        expected: 'The bearer of bad news arrived today',
        redacted: false
      },
      {
        name: 'redacts URL credentials in database connection string',
        input: 'Connecting to postgres://admin:SuperSecretPass123@db.prod.internal:5432/main',
        expected: 'Connecting to postgres://<REDACTED>@db.prod.internal:<PORT>/main',
        redacted: true
      },
      {
        name: 'does not redact URLs without credentials (negative test)',
        input: 'Connecting to https://api.example.com/v1/health',
        expected: 'Connecting to https://api.example.com/v1/health',
        redacted: false
      },
      {
        name: 'redacts password and api_key key-value pairs',
        input: 'payload: {"api_key": "sk-live-12345", "password": "hunter2", "user": "alice"}',
        expected: 'payload: {"api_key": "<REDACTED>", "password": "<REDACTED>", "user": "alice"}',
        redacted: true
      },
      {
        name: 'redacts email addresses',
        input: 'Crash report sent by alerts-ops@company.co.uk regarding incident',
        expected: 'Crash report sent by <REDACTED> regarding incident',
        redacted: true
      }
    ];

    for (const c of cases) {
      it(c.name, () => {
        const result = sanitizeLog(c.input);
        expect(result.sanitized).toBe(c.expected);
        if (c.redacted) {
          expect(result.redactionCount).toBeGreaterThan(0);
        } else {
          expect(result.redactionCount).toBe(0);
        }
      });
    }
  });

  describe('Rule 2: Timestamp Normalization', () => {
    const cases = [
      {
        name: 'normalizes ISO-8601 with timezone offset',
        input: '2026-10-14T09:30:12.123+05:30 [INFO] System initialized',
        expected: '<TIMESTAMP> [INFO] System initialized'
      },
      {
        name: 'normalizes ISO-8601 UTC with Z',
        input: '2026-10-14T04:00:12Z Worker booted',
        expected: '<TIMESTAMP> Worker booted'
      },
      {
        name: 'normalizes Syslog timestamp format',
        input: 'Oct 14 09:30:12 server-1 kernel: [Hardware Error]',
        expected: '<TIMESTAMP> server-1 kernel: [Hardware Error]'
      },
      {
        name: 'normalizes 13-digit epoch milliseconds',
        input: 'event_time=1728900000000 status=error',
        expected: 'event_time=<TIMESTAMP> status=error'
      },
      {
        name: 'does not normalize short numbers or version numbers (negative test)',
        input: 'Package version 1.2.3 released with 450 items',
        expected: 'Package version 1.2.3 released with 450 items'
      }
    ];

    for (const c of cases) {
      it(c.name, () => {
        const result = sanitizeLog(c.input);
        expect(result.sanitized).toBe(c.expected);
      });
    }
  });

  describe('Rule 3: UUID Normalization', () => {
    const cases = [
      {
        name: 'normalizes lowercase UUID',
        input: 'Session failed for user a3bb189e-8bf9-3888-9912-ace4e6543002 on pod',
        expected: 'Session failed for user <UUID> on pod'
      },
      {
        name: 'normalizes uppercase UUID',
        input: 'Device ID 123E4567-E89B-12D3-A456-426614174000 disconnected',
        expected: 'Device ID <UUID> disconnected'
      },
      {
        name: 'does not match 36-char string with incorrect hyphens (negative test)',
        input: 'custom-hash-1234567890-abcdef-12345678-xyz should not match',
        expected: 'custom-hash-1234567890-abcdef-12345678-xyz should not match'
      },
      {
        name: 'does not match 36-char string with non-hex characters (negative test)',
        input: 'g3bb189e-8bf9-3888-9912-ace4e654300z is non-hex',
        expected: 'g3bb189e-8bf9-3888-9912-ace4e654300z is non-hex'
      }
    ];

    for (const c of cases) {
      it(c.name, () => {
        const result = sanitizeLog(c.input);
        expect(result.sanitized).toBe(c.expected);
      });
    }
  });

  describe('Rule 4: IPs and Ports', () => {
    const cases = [
      {
        name: 'normalizes IPv4 address with port',
        input: 'Connection failed to 192.168.1.100:8080 after 30s',
        expected: 'Connection failed to <IP>:<PORT> after 30s'
      },
      {
        name: 'normalizes IPv4 address without port',
        input: 'Packet dropped from 10.0.0.1 by firewall',
        expected: 'Packet dropped from <IP> by firewall'
      },
      {
        name: 'normalizes IPv6 loopback and full addresses',
        input: 'Listening on ::1 and 2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        expected: 'Listening on <IP> and <IP>'
      },
      {
        name: 'normalizes standalone ports after hostname',
        input: 'Upstream redis-primary:6379 is unreachable',
        expected: 'Upstream redis-primary:<PORT> is unreachable'
      },
      {
        name: 'does not treat ordinary numbers as IPs (negative test)',
        input: 'Error code 999.888.777.666 is invalid IP',
        expected: 'Error code 999.888.777.666 is invalid IP'
      }
    ];

    for (const c of cases) {
      it(c.name, () => {
        const result = sanitizeLog(c.input);
        expect(result.sanitized).toBe(c.expected);
      });
    }
  });

  describe('Rule 5: Memory Addresses and Long Hex', () => {
    const cases = [
      {
        name: 'normalizes hexadecimal memory address',
        input: 'SIGSEGV fault at 0x7ffee3b45a60 during pointer dereference',
        expected: 'SIGSEGV fault at <HEX> during pointer dereference'
      },
      {
        name: 'normalizes long sha256 / commit hex string',
        input: 'Build commit 5f4dcc3b5aa765d61d8327deb882cf99 built successfully',
        expected: 'Build commit <HEX> built successfully'
      },
      {
        name: 'does not match short hex numbers (negative test)',
        input: 'Color code 0xff or 0x12 is too short',
        expected: 'Color code 0xff or 0x12 is too short'
      }
    ];

    for (const c of cases) {
      it(c.name, () => {
        const result = sanitizeLog(c.input);
        expect(result.sanitized).toBe(c.expected);
      });
    }
  });

  describe('Rule 6: Request and Trace IDs', () => {
    const cases = [
      {
        name: 'normalizes request-id key value',
        input: 'Error processing request-id: req-abc-123-xyz',
        expected: 'Error processing request_id: <ID>'
      },
      {
        name: 'normalizes trace_id key value',
        input: 'Context attached trace_id=trace-999-prod',
        expected: 'Context attached trace_id=<ID>'
      },
      {
        name: 'normalizes span-id key value',
        input: 'Span info span_id: span-456 active',
        expected: 'Span info span_id: <ID> active'
      }
    ];

    for (const c of cases) {
      it(c.name, () => {
        const result = sanitizeLog(c.input);
        expect(result.sanitized).toBe(c.expected);
      });
    }
  });

  describe('Rule 7: Stack frame line and column numbers', () => {
    it('normalizes line and column numbers in stack frames', () => {
      const input = '    at handleRequest (/app/src/server.ts:142:25)\n    at processTicks (node:internal/process/task_queues.js:95)';
      const result = sanitizeLog(input);
      expect(result.sanitized).toContain('server.ts:<L>:<C>');
      expect(result.sanitized).toContain('task_queues.js:<L>');
    });
  });

  describe('Truncation Rule', () => {
    it('truncates logs exceeding maxBytes retaining head and tail with marker', () => {
      const rawLog = 'Header log information line '.repeat(20) + 'CRITICAL_MIDDLE_LOG' + ' Tail log information line '.repeat(20);
      const result = sanitizeLog(rawLog, { maxBytes: 200 });

      expect(result.sanitized).toContain('[...truncated');
      expect(result.sanitized.startsWith('Header log information line')).toBe(true);
      expect(result.sanitized.endsWith('Tail log information line ')).toBe(true);
      expect(result.sanitized).not.toContain('CRITICAL_MIDDLE_LOG');
    });
  });
});
