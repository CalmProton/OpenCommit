import type { ExtensionSettings } from './settings';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export async function createOpenRouterCommitMessage(
  apiKey: string,
  messages: ChatMessage[],
  settings: ExtensionSettings,
  signal?: AbortSignal
): Promise<string> {
  const baseUrl = settings.openRouter.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  if (settings.openRouter.siteUrl.trim()) {
    headers['HTTP-Referer'] = settings.openRouter.siteUrl.trim();
  }

  if (settings.openRouter.appTitle.trim()) {
    headers['X-Title'] = settings.openRouter.appTitle.trim();
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: settings.openRouter.model,
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxOutputTokens
    })
  });

  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    const message = extractErrorMessage(payload) ?? text;
    throw new Error(`OpenRouter request failed (${response.status}): ${message}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  const result = normalizeContent(content);

  if (!result.trim()) {
    throw new Error('OpenRouter returned an empty commit message.');
  }

  return result;
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractErrorMessage(payload: any): string | undefined {
  if (typeof payload?.error?.message === 'string') {
    return payload.error.message;
  }

  if (typeof payload?.message === 'string') {
    return payload.message;
  }

  return undefined;
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') {
          return part;
        }

        if (typeof part?.text === 'string') {
          return part.text;
        }

        return '';
      })
      .join('');
  }

  return '';
}
