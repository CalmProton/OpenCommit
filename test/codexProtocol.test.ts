import { describe, expect, test } from 'bun:test';
import {
  COMMIT_MESSAGE_OUTPUT_SCHEMA,
  COMMIT_PLAN_OUTPUT_SCHEMA,
  extractAgentMessageTexts,
  parseJsonLine
} from '../src/codexProtocol';

describe('Codex protocol helpers', () => {
  test('parses JSONL responses and notifications', () => {
    expect(parseJsonLine('{"id":1,"result":{"ok":true}}')).toEqual({
      id: 1,
      result: { ok: true }
    });
    expect(parseJsonLine('{"method":"turn/completed","params":{"threadId":"thread"}}')).toEqual({
      method: 'turn/completed',
      params: { threadId: 'thread' }
    });
    expect(parseJsonLine('not json')).toBeUndefined();
  });

  test('extracts agent messages from turn item payloads', () => {
    expect(extractAgentMessageTexts({
      items: [
        { type: 'reasoning', id: 'reasoning-1', summary: [] },
        { type: 'agentMessage', id: 'message-1', text: '{"commitMessage":"fix: update"}' }
      ]
    })).toEqual(['{"commitMessage":"fix: update"}']);
  });

  test('keeps output schemas strict and separate for messages and plans', () => {
    expect(COMMIT_MESSAGE_OUTPUT_SCHEMA.required).toEqual(['commitMessage']);
    expect(COMMIT_PLAN_OUTPUT_SCHEMA.required).toEqual(['commits']);
    expect(COMMIT_MESSAGE_OUTPUT_SCHEMA.properties).not.toHaveProperty('commits');
    expect(COMMIT_PLAN_OUTPUT_SCHEMA.properties).not.toHaveProperty('commitMessage');
  });
});
