export type JsonRpcId = number | string;

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcResponse | JsonRpcRequest | JsonRpcNotification;

export const COMMIT_MESSAGE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    commitMessage: { type: 'string' }
  },
  required: ['commitMessage'],
  additionalProperties: false
} as const;

export const COMMIT_PLAN_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    commits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          files: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['message', 'files'],
        additionalProperties: false
      }
    }
  },
  required: ['commits'],
  additionalProperties: false
} as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseJsonLine(line: string): JsonRpcMessage | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value as unknown as JsonRpcMessage : undefined;
  } catch {
    return undefined;
  }
}

export function extractAgentMessageTexts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => extractAgentMessageTexts(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  if (value.type === 'agentMessage' && typeof value.text === 'string') {
    return [value.text];
  }

  if (Array.isArray(value.items)) {
    return extractAgentMessageTexts(value.items);
  }

  if (isRecord(value.item)) {
    return extractAgentMessageTexts(value.item);
  }

  return [];
}

export function getStringProperty(value: unknown, property: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result = value[property];
  return typeof result === 'string' ? result : undefined;
}

export function getBooleanProperty(value: unknown, property: string): boolean | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result = value[property];
  return typeof result === 'boolean' ? result : undefined;
}
