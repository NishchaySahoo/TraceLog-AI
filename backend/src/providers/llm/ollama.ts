import type { LLMProvider } from '../types';

export class OllamaLLMProvider implements LLMProvider {
  public readonly name = 'ollama';
  public readonly modelName: string;
  private readonly baseUrl: string;

  constructor(baseUrl: string, modelName = 'llama3') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.modelName = modelName;
  }

  public async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages,
        format: 'json',
        stream: false
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama LLM request failed (${response.status}): ${errText}`);
    }

    const json = (await response.json()) as {
      message?: { content: string };
    };

    return json.message?.content || '{}';
  }
}
