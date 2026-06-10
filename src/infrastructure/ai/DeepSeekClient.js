// src/infrastructure/ai/DeepSeekClient.js
// Minimal LLM adapter for in-app AI features (coach notes, misconception spotting).
// Deliberately tiny: one chat() method, returns null on any failure so callers
// degrade gracefully — the bot must never break because the AI is down.
import axios from 'axios';

export class DeepSeekClient {
  constructor({ apiKey, baseUrl, model } = {}) {
    this.apiKey = apiKey || null;
    this.model = model || 'deepseek-v4-flash';
    this.client = apiKey
      ? axios.create({
          baseURL: baseUrl || 'https://api.deepseek.com',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 90000,
        })
      : null;
  }

  get enabled() {
    return !!this.client;
  }

  async chat(messages, { temperature = 0.6, maxTokens = 400 } = {}) {
    if (!this.client) return null;
    try {
      const { data } = await this.client.post('/chat/completions', {
        model: this.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      });
      return data?.choices?.[0]?.message?.content?.trim() || null;
    } catch (err) {
      console.warn('DeepSeekClient: chat failed:', err.response?.data?.error?.message || err.message);
      return null;
    }
  }
}
