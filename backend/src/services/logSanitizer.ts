export interface SanitizeResult {
  sanitized: string;
  redactionCount: number;
}

export interface SanitizeOptions {
  maxBytes?: number;
}

const DEFAULT_MAX_LOG_BYTES = 200000;

export function sanitizeLog(rawLog: string, options?: SanitizeOptions): SanitizeResult {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
  let text = rawLog;

  // Truncation rule: if input > maxBytes, retain head and tail with [...truncated N bytes...]
  const totalBytes = Buffer.byteLength(text, 'utf8');
  if (totalBytes > maxBytes) {
    const headBytes = Math.floor(maxBytes / 2);
    const tailBytes = maxBytes - headBytes;
    const buf = Buffer.from(text, 'utf8');
    const truncatedCount = totalBytes - maxBytes;

    const headStr = buf.subarray(0, headBytes).toString('utf8');
    const tailStr = buf.subarray(buf.length - tailBytes).toString('utf8');
    text = `${headStr}\n[...truncated ${truncatedCount} bytes...]\n${tailStr}`;
  }

  let redactionCount = 0;

  function replaceAll(pattern: RegExp, replacer: string | ((...args: string[]) => string)): void {
    const matches = text.match(pattern);
    if (matches) {
      redactionCount += matches.length;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      text = text.replace(pattern, replacer as any);
    }
  }

  // 1. Secrets (redact before anything else)
  // AWS Access Keys
  replaceAll(/\bAKIA[0-9A-Z]{16}\b/g, '<REDACTED>');

  // JWT Tokens (eyJ...)
  replaceAll(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<REDACTED>');

  // Authorization: Bearer / Basic headers
  replaceAll(/Authorization:\s*(?:Bearer|Basic)\s+\S+/gi, 'Authorization: <REDACTED>');

  // Standalone Bearer tokens (long token strings)
  replaceAll(/\bBearer\s+[A-Za-z0-9._~+/-]{15,}=*/gi, '<REDACTED>');

  // URL credentials (e.g., postgres://user:pass@host)
  replaceAll(/(:\/\/)([^:\s\/@]+):([^@\s\/]+)@/g, '$1<REDACTED>@');

  // Key/value pairs with optional quotes around keys/values
  replaceAll(
    /(['"]?)(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|token|secret|password|passwd)\1(\s*[:=]\s*)(['"]?)([^'"\s,;{}]+)(['"]?)/gi,
    '$1$2$1$3$4<REDACTED>$6'
  );

  // Email addresses
  replaceAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<REDACTED>');

  // 2. Timestamps
  // ISO-8601 with optional milliseconds and timezone offset
  replaceAll(
    /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    '<TIMESTAMP>'
  );

  // Syslog timestamps (e.g., Oct 14 09:30:12)
  replaceAll(
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/g,
    '<TIMESTAMP>'
  );

  // Epoch ms (13-digit timestamp)
  replaceAll(/\b1\d{12}\b/g, '<TIMESTAMP>');

  // 3. UUIDs (case-insensitive 8-4-4-4-12 hex)
  replaceAll(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, '<UUID>');

  // 4. IPs & Ports
  // IPv6
  replaceAll(
    /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:)+::(?:[0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}\b|::1\b/g,
    '<IP>'
  );

  // IPv4 with optional port
  replaceAll(
    /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?::\d{1,5})?\b/g,
    (match: string) => {
      return match.includes(':') ? '<IP>:<PORT>' : '<IP>';
    }
  );

  // Standalone ports after host:port (exclude file line/col numbers like server.ts:142:25)
  replaceAll(
    /(?<=\b[a-zA-Z0-9_.-]+)(?<!:\d+)(?<!\.(?:ts|js|jsx|tsx|py|go|java|rs|cpp|c|rb|php|cjs|mjs|html|css|json|log|md)):(\d{2,5})\b(?!\s*:\d+)/g,
    ':<PORT>'
  );

  // 5. Memory addresses & long hex hashes
  replaceAll(/\b0x[0-9a-fA-F]{6,}\b/g, '<HEX>');
  replaceAll(/\b[0-9a-fA-F]{16,}\b/g, '<HEX>');

  // 6. Request & Trace IDs
  replaceAll(
    /\b(request|trace|span|correlation)[_-]?id(\s*[:=]\s*|\s+)[^\s,;&]+/gi,
    '$1_id$2<ID>'
  );

  // 7. Bare numbers in stack frame line/column numbers (:123:45 -> :<L>:<C>, :123 -> :<L>)
  replaceAll(/(?<=\.[a-zA-Z0-9]+):(\d+):(\d+)\b/g, ':<L>:<C>');
  replaceAll(/(?<=\.[a-zA-Z0-9]+):(\d+)(?=[)\s,]|$)/g, ':<L>');

  return {
    sanitized: text,
    redactionCount
  };
}
