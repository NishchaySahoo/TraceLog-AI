import type { LLMProvider } from '../types';

export class OpenAILLMProvider implements LLMProvider {
  public readonly name = 'openai';
  public readonly modelName: string;
  private readonly apiKey: string;

  constructor(apiKey: string, modelName = 'gpt-4o-mini') {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAILLMProvider');
    }
    this.apiKey = apiKey;
    this.modelName = modelName;
  }

  public async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.modelName,
        response_format: { type: 'json_object' },
        messages
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI LLM request failed (${response.status}): ${errText}`);
    }

    const json = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return json.choices[0]?.message?.content || '{}';
  }
}
