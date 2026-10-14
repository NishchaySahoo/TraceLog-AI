import type { EmbeddingProvider } from '../types';

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'ollama';
  public readonly modelName: string;
  public readonly dimension: number;
  private readonly baseUrl: string;

  constructor(baseUrl: string, modelName = 'nomic-embed-text', dimension = 768) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.modelName = modelName;
    this.dimension = dimension;
  }

  public async embedQuery(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        prompt: text
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama embedding request failed (${response.status}): ${errText}`);
    }

    const json = (await response.json()) as { embedding: number[] };
    return json.embedding;
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embedQuery(text));
    }
    return results;
  }
}
