import type { EmbeddingProvider } from '../types';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'openai';
  public readonly modelName: string;
  public readonly dimension: number;
  private readonly apiKey: string;

  constructor(apiKey: string, modelName = 'text-embedding-3-small', dimension = 1536) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAIEmbeddingProvider');
    }
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.dimension = dimension;
  }

  public async embedQuery(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.modelName,
        input: texts,
        dimensions: this.dimension
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI embedding request failed (${response.status}): ${errText}`);
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
