export interface ParsedChunk {
  headerPath: string[];
  headerContext: string;
  anchor: string;
  chunkText: string;
  embeddedText: string;
}

export interface ChunkRunbookResult {
  serviceName: string;
  tags: string[];
  chunks: ParsedChunk[];
}

export interface ChunkerOptions {
  serviceName?: string;
  maxTokensPerChunk?: number; // default ~600 tokens (approx 2400 chars)
  minTokensPerChunk?: number; // default ~40 tokens (approx 160 chars)
}

const DEFAULT_MAX_TOKENS = 600;
const DEFAULT_MIN_TOKENS = 40;

export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function parseFrontmatter(markdown: string): {
  service?: string;
  tags: string[];
  content: string;
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { tags: [], content: markdown };
  }

  const rawYaml = match[1];
  const content = match[2];
  let service: string | undefined;
  const tags: string[] = [];

  const serviceMatch = rawYaml.match(/^service:\s*(.+)$/m);
  if (serviceMatch) {
    service = serviceMatch[1].trim().replace(/^['"]|['"]$/g, '');
  }

  const tagsMatch = rawYaml.match(/^tags:\s*\[?(.*?)\]?$/m);
  if (tagsMatch) {
    const rawTags = tagsMatch[1]
      .split(',')
      .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    tags.push(...rawTags);
  }

  return { service, tags, content };
}

interface RawSection {
  h1: string;
  headerPath: string[];
  headerContext: string;
  anchor: string;
  body: string;
}

export function chunkMarkdown(
  rawMarkdown: string,
  options?: ChunkerOptions
): ChunkRunbookResult {
  const { service, tags, content } = parseFrontmatter(rawMarkdown);
  const effectiveService = options?.serviceName || service || 'default';
  const maxChars = (options?.maxTokensPerChunk || DEFAULT_MAX_TOKENS) * 4;
  const minChars = (options?.minTokensPerChunk || DEFAULT_MIN_TOKENS) * 4;

  const lines = content.split(/\r?\n/);
  const rawSections: RawSection[] = [];

  let inCodeFence = false;
  let currentHeaderStack: string[] = [];
  let currentLines: string[] = [];

  function commitCurrentSection(): void {
    const body = currentLines.join('\n').trim();
    if (body.length > 0 || currentHeaderStack.length > 0) {
      const headerPath = currentHeaderStack.length > 0 ? [...currentHeaderStack] : ['General'];
      const headerContext = headerPath.join(' > ');
      const anchor = githubSlug(headerPath[headerPath.length - 1]);
      const h1 = headerPath[0];

      rawSections.push({
        h1,
        headerPath,
        headerContext,
        anchor,
        body
      });
    }
    currentLines = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inCodeFence = !inCodeFence;
      currentLines.push(line);
      continue;
    }

    if (!inCodeFence) {
      const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (headerMatch) {
        commitCurrentSection();
        const level = headerMatch[1].length;
        const headerTitle = headerMatch[2].trim();

        currentHeaderStack = currentHeaderStack.slice(0, level - 1);
        currentHeaderStack[level - 1] = headerTitle;
        continue;
      }
    }

    currentLines.push(line);
  }

  commitCurrentSection();

  // If no sections were produced (e.g. empty document)
  if (rawSections.length === 0) {
    const defaultText = content.trim();
    if (!defaultText) {
      return { serviceName: effectiveService, tags, chunks: [] };
    }
    rawSections.push({
      h1: 'General',
      headerPath: ['General'],
      headerContext: 'General',
      anchor: 'general',
      body: defaultText
    });
  }

  // Merge tiny sections (< minChars) into the next sibling, never crossing H1
  const mergedSections: RawSection[] = [];
  for (let i = 0; i < rawSections.length; i++) {
    const current = rawSections[i];
    if (
      current.body.length < minChars &&
      i + 1 < rawSections.length &&
      rawSections[i + 1].h1 === current.h1
    ) {
      // Merge into next section
      const next = rawSections[i + 1];
      next.body = current.body ? `${current.body}\n\n${next.body}` : next.body;
      continue;
    }
    mergedSections.push(current);
  }

  // Sub-split oversized sections (> maxChars)
  const finalChunks: ParsedChunk[] = [];

  for (const sec of mergedSections) {
    if (sec.body.length <= maxChars) {
      const embeddedText = `[Service: ${effectiveService}] > ${sec.headerContext}\n\n${sec.body}`.trim();
      finalChunks.push({
        headerPath: sec.headerPath,
        headerContext: sec.headerContext,
        anchor: sec.anchor,
        chunkText: sec.body,
        embeddedText
      });
      continue;
    }

    // Split oversized section into atomic blocks (paragraphs, lists, code blocks)
    const blocks = splitIntoAtomicBlocks(sec.body);
    const subChunks = assembleBlocksWithOverlap(blocks, maxChars);

    for (let idx = 0; idx < subChunks.length; idx++) {
      const subBody = subChunks[idx];
      const subAnchor = subChunks.length > 1 ? `${sec.anchor}-part-${idx + 1}` : sec.anchor;
      const embeddedText = `[Service: ${effectiveService}] > ${sec.headerContext}\n\n${subBody}`.trim();
      finalChunks.push({
        headerPath: sec.headerPath,
        headerContext: sec.headerContext,
        anchor: subAnchor,
        chunkText: subBody,
        embeddedText
      });
    }
  }

  return {
    serviceName: effectiveService,
    tags,
    chunks: finalChunks
  };
}

/**
 * Splits markdown text into atomic blocks (paragraphs, code blocks, numbered/bulleted lists)
 * ensuring code blocks and list items are never split in between.
 */
function splitIntoAtomicBlocks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const blocks: string[] = [];
  let currentBlock: string[] = [];
  let inCode = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inCode = !inCode;
      currentBlock.push(line);
      if (!inCode) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      continue;
    }

    if (inCode) {
      currentBlock.push(line);
      continue;
    }

    // Paragraph separation
    if (trimmed === '') {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
    } else {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }

  return blocks.filter((b) => b.trim().length > 0);
}

/**
 * Assembles atomic blocks into chunks up to maxChars with ~10% overlap.
 */
function assembleBlocksWithOverlap(blocks: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLen = 0;

  for (const block of blocks) {
    const blockLen = block.length;
    if (currentLen + blockLen > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));

      // Keep the last block for ~10% overlap if feasible
      const lastBlock = currentChunk[currentChunk.length - 1];
      if (lastBlock && lastBlock.length < maxChars * 0.3) {
        currentChunk = [lastBlock, block];
        currentLen = lastBlock.length + blockLen;
      } else {
        currentChunk = [block];
        currentLen = blockLen;
      }
    } else {
      currentChunk.push(block);
      currentLen += blockLen;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks;
}
