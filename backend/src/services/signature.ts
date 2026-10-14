import crypto from 'node:crypto';
import { sanitizeLog } from './logSanitizer';

export interface SignatureResult {
  signature: string;
  signatureHash: string;
  errorTokens: string[];
  techKeywords: string[];
  detectedService?: string;
}

const ERROR_TOKEN_PATTERNS = [
  /\b[A-Z][A-Za-z0-9]*(?:Error|Exception)\b/g,
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EADDRINUSE|ECONNRESET|EPIPE)\b/g,
  /\b(?:SIGSEGV|SIGKILL|SIGTERM|SIGABRT)\b/g,
  /\b(?:OOMKilled|Traceback)\b|\bpanic:/g,
  /\b(?:HTTP\s*5\d{2}|5\d{2}\s+(?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout))\b/gi
];

const KNOWN_TECH_KEYWORDS = [
  'redis',
  'postgres',
  'postgresql',
  'mongo',
  'mongodb',
  'kafka',
  'k8s',
  'kubernetes',
  'rabbitmq',
  'mysql',
  'elasticsearch',
  'nginx',
  'grpc',
  'aws',
  's3',
  'auth',
  'payment',
  'billing'
];

export function extractSignature(rawLog: string): SignatureResult {
  try {
    const lines = rawLog.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      const fallback = 'EmptyLog';
      return {
        signature: fallback,
        signatureHash: crypto.createHash('sha256').update(fallback).digest('hex'),
        errorTokens: [],
        techKeywords: []
      };
    }

    // 1. Detect error tokens
    const errorTokensSet = new Set<string>();
    for (const pattern of ERROR_TOKEN_PATTERNS) {
      const matches = rawLog.match(pattern);
      if (matches) {
        for (const m of matches) {
          errorTokensSet.add(m.trim());
        }
      }
    }
    const errorTokens = Array.from(errorTokensSet);
    const primaryErrorToken = errorTokens[0] || 'UnknownError';

    // 2. Detect first error line
    let firstErrorLine = '';
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (
        lower.includes('error') ||
        lower.includes('exception') ||
        lower.includes('failed') ||
        lower.includes('fatal') ||
        lower.includes('panic') ||
        lower.includes('traceback')
      ) {
        firstErrorLine = line;
        break;
      }
    }
    if (!firstErrorLine) {
      firstErrorLine = lines[0];
    }
    const sanitizedFirstLine = sanitizeLog(firstErrorLine).sanitized.slice(0, 150);

    // 3. Extract top 2-3 stack frame function names
    const stackFrames: string[] = [];
    const stackPatterns = [
      // Node/V8: at FunctionName (path:1:2) or at path:1:2
      /^\s*at\s+([A-Za-z0-9_$.<>]+)\s*(?:\(|$)/,
      // Python: File "...", line 12, in function_name
      /File\s+["'].*?["'],\s+line\s+\d+,\s+in\s+([A-Za-z0-9_]+)/,
      // Go: github.com/user/pkg.FunctionName(...) or goroutine
      /^\s*([a-zA-Z0-9_./-]+\.[A-Za-z0-9_]+)\(.*\)/
    ];

    for (const line of lines) {
      if (stackFrames.length >= 3) break;
      for (const sp of stackPatterns) {
        const match = line.match(sp);
        if (match && match[1]) {
          const fnName = match[1].trim();
          if (!stackFrames.includes(fnName) && !fnName.startsWith('Module.')) {
            stackFrames.push(fnName);
          }
          break;
        }
      }
    }

    const stackSummary = stackFrames.length > 0 ? stackFrames.join(' > ') : 'no_stack_frames';
    const signature = `${primaryErrorToken} | ${sanitizedFirstLine} | ${stackSummary}`;
    const signatureHash = crypto.createHash('sha256').update(signature).digest('hex');

    // 4. Extract tech keywords & detected service
    const techKeywords = KNOWN_TECH_KEYWORDS.filter((kw) => {
      // Match whole word, snake_case (e.g. kafka_consumer), kebab-case, or camelCase (e.g. KafkaMessage)
      const pattern = new RegExp(`(?:^|[^a-zA-Z])${kw}(?:[^a-zA-Z]|$)`, 'i');
      const camelPattern = new RegExp(`[A-Z]${kw.slice(1)}|${kw}[A-Z]`, 'i');
      return pattern.test(rawLog) || camelPattern.test(rawLog);
    });

    // Detect serviceName from explicit markers e.g. [auth-service] or service="payments" or detected keyword
    let detectedService: string | undefined;
    const serviceTagMatch = rawLog.match(/\[([a-z0-9_-]+(?:service|api|worker|job))\]/i);
    const serviceAttrMatch = rawLog.match(/\bservice[=:]\s*["']?([a-z0-9_-]+)["']?/i);

    if (serviceTagMatch && serviceTagMatch[1]) {
      detectedService = serviceTagMatch[1].toLowerCase();
    } else if (serviceAttrMatch && serviceAttrMatch[1]) {
      detectedService = serviceAttrMatch[1].toLowerCase();
    } else if (techKeywords.length > 0) {
      detectedService = techKeywords[0];
    }

    return {
      signature,
      signatureHash,
      errorTokens,
      techKeywords,
      detectedService
    };
  } catch {
    // Fallback guaranteed to never throw
    const fallback = rawLog.split(/\r?\n/).find((l) => l.trim().length > 0) || 'UnknownLog';
    return {
      signature: fallback,
      signatureHash: crypto.createHash('sha256').update(fallback).digest('hex'),
      errorTokens: [],
      techKeywords: []
    };
  }
}
