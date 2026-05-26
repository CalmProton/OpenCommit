import * as vscode from 'vscode';

export interface Logger {
  section(title: string): void;
  line(message: string): void;
  json(title: string, value: unknown): void;
  text(title: string, value: string): void;
  error(error: unknown): void;
}

export function createLogger(output: vscode.OutputChannel): Logger {
  return {
    section(title: string) {
      output.appendLine('');
      output.appendLine(`=== ${timestamp()} ${title} ===`);
    },
    line(message: string) {
      output.appendLine(message);
    },
    json(title: string, value: unknown) {
      output.appendLine(`${title}:`);
      output.appendLine(redactSecrets(JSON.stringify(value, null, 2)));
    },
    text(title: string, value: string) {
      output.appendLine(`${title}:`);
      output.appendLine(value || '[empty]');
    },
    error(error: unknown) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      output.appendLine(`Error: ${redactSecrets(message)}`);
    }
  };
}

function timestamp(): string {
  return new Date().toISOString();
}

function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+sk-or-[A-Za-z0-9._-]+/g, 'Bearer [REDACTED_OPENROUTER_KEY]')
    .replace(/sk-or-[A-Za-z0-9._-]+/g, '[REDACTED_OPENROUTER_KEY]');
}
