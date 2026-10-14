import { describe, it, expect } from 'vitest';
import { chunkMarkdown, githubSlug } from '../src/services/chunker.service';

describe('Runbook Chunker Service (chunker.service.ts)', () => {
  describe('githubSlug', () => {
    it('creates github compatible anchor slugs', () => {
      expect(githubSlug('Resolution Steps (Postgres)')).toBe('resolution-steps-postgres');
      expect(githubSlug('1. Immediate Actions: Restart Redis!')).toBe('1-immediate-actions-restart-redis');
      expect(githubSlug('High Memory Usage (OOMKilled)')).toBe('high-memory-usage-oomkilled');
    });
  });

  describe('chunkMarkdown', () => {
    it('extracts YAML frontmatter and parses nested headers', () => {
      const doc = `---
service: postgres
tags: [database, pgbouncer, pool]
---

# PostgreSQL Operations

## Connection Pooling Issues

### Resolution Steps
When the connection pool is exhausted, run:
\`\`\`bash
SELECT * FROM pg_stat_activity WHERE state = 'active';
\`\`\`
Terminate idle transactions and verify pool limits.
`;

      const result = chunkMarkdown(doc);

      expect(result.serviceName).toBe('postgres');
      expect(result.tags).toEqual(['database', 'pgbouncer', 'pool']);
      expect(result.chunks.length).toBeGreaterThan(0);

      const chunk = result.chunks.find((c) => c.anchor.includes('resolution-steps'));
      expect(chunk).toBeDefined();
      expect(chunk?.headerPath).toEqual(['PostgreSQL Operations', 'Connection Pooling Issues', 'Resolution Steps']);
      expect(chunk?.headerContext).toBe('PostgreSQL Operations > Connection Pooling Issues > Resolution Steps');
      expect(chunk?.embeddedText).toContain('[Service: postgres] > PostgreSQL Operations > Connection Pooling Issues > Resolution Steps');
      expect(chunk?.embeddedText).toContain('SELECT * FROM pg_stat_activity');
    });

    it('ignores # characters inside fenced code blocks', () => {
      const doc = `# Redis Operations

## Cache Troubleshooting
Here is the script to check redis keys:

\`\`\`bash
# This is a comment inside code fence, not a header
# Another comment
redis-cli -h localhost -p 6379 info memory
## This is also inside code block
\`\`\`

Verify if peak memory matches maxmemory.
`;

      const result = chunkMarkdown(doc, { minTokensPerChunk: 1 });

      // There should only be headers for "Redis Operations" and "Cache Troubleshooting", NOT for the bash comments
      const headers = result.chunks.map((c) => c.headerContext);
      expect(headers.some((h) => h.includes('This is a comment'))).toBe(false);
      expect(headers.some((h) => h.includes('Another comment'))).toBe(false);
      expect(headers.some((h) => h.includes('This is also inside'))).toBe(false);
    });

    it('merges tiny sections (< 40 tokens) into next sibling, but never across top-level H1', () => {
      const doc = `# Service Troubleshooting

## Brief Overview
Tiny note.

## Detailed Diagnostic Procedure
This is a comprehensive procedure detailing all triage steps for engineers to diagnose anomalies.

# Second Top Level Header
Tiny isolated note under H2.
`;

      const result = chunkMarkdown(doc, { minTokensPerChunk: 40 });

      // "Brief Overview" is tiny (under 160 chars) and under "Service Troubleshooting", so it should merge into "Detailed Diagnostic Procedure"
      const detailedChunk = result.chunks.find((c) => c.headerContext.includes('Detailed Diagnostic Procedure'));
      expect(detailedChunk?.chunkText).toContain('Tiny note.');

      // The section under "Second Top Level Header" must NOT be merged into a previous H1
      const secondH1Chunks = result.chunks.filter((c) => c.headerPath[0] === 'Second Top Level Header');
      expect(secondH1Chunks.length).toBe(1);
    });

    it('sub-splits oversized sections (> 600 tokens) at paragraph boundaries preserving code fences', () => {
      const longParagraph1 = 'Diagnostic analysis line: ' + 'A'.repeat(1500) + '\n\n';
      const codeFence = '```python\n' + 'def solve():\n    return True\n' + '```\n\n';
      const longParagraph2 = 'Remediation step details: ' + 'B'.repeat(1500);

      const doc = `# Runbook

## Massive Section
${longParagraph1}
${codeFence}
${longParagraph2}
`;

      // Set max tokens to 300 (approx 1200 chars)
      const result = chunkMarkdown(doc, { maxTokensPerChunk: 300 });

      expect(result.chunks.length).toBeGreaterThan(1);
      for (const chunk of result.chunks) {
        // Full header hierarchy should be preserved
        expect(chunk.headerPath).toEqual(['Runbook', 'Massive Section']);
        expect(chunk.headerContext).toBe('Runbook > Massive Section');
      }

      // Check that the code fence is intact inside one of the chunks
      const hasCodeFence = result.chunks.some((c) => c.chunkText.includes('def solve():\n    return True'));
      expect(hasCodeFence).toBe(true);
    });

    it('handles documents with no headers at all by creating a single General chunk', () => {
      const plainDoc = 'This is a raw unstructured runbook guide without any markdown headers.\nFollow standard operating procedure.';
      const result = chunkMarkdown(plainDoc, { serviceName: 'payment-svc' });

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].headerPath).toEqual(['General']);
      expect(result.chunks[0].headerContext).toBe('General');
      expect(result.chunks[0].anchor).toBe('general');
      expect(result.chunks[0].embeddedText).toContain('[Service: payment-svc] > General');
    });
  });
});
