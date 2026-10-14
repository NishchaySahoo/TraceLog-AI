export interface EmbeddingProvider {
  readonly name: string;
  readonly modelName: string;
  readonly dimension: number;
  embedQuery(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface LLMProvider {
  readonly name: string;
  readonly modelName: string;
  generate(prompt: string, systemPrompt?: string): Promise<string>;
}
