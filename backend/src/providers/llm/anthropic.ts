import type { LLMProvider } from '../types';

export class AnthropicLLMProvider implements LLMProvider {
  public readonly name = 'anthropic';
  public readonly modelName: string;
  private readonly apiKey: string;

  constructor(apiKey: string, modelName = 'claude-3-5-haiku-latest') {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for AnthropicLLMProvider');
    }
    this.apiKey = apiKey;
    this.modelName = modelName;
  }

  public async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const effectiveSystem = `${systemPrompt || ''}\n\nIMPORTANT: Respond with pure, valid JSON only. Do not wrap in markdown code blocks.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: 4096,
        system: effectiveSystem,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic LLM request failed (${response.status}): ${errText}`);
    }

    const json = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const textContent = json.content.find((c) => c.type === 'text')?.text || '{}';
    return textContent.trim();
  }
}
