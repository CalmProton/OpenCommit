import * as vscode from 'vscode';
import { buildDiffContext, getGitApi, pickRepository } from './git';
import { createOpenRouterCommitMessage } from './openrouter';
import { buildMessages, sanitizeCommitMessage } from './prompt';
import { clearOpenRouterApiKey, getOpenRouterApiKey, promptForOpenRouterApiKey } from './secrets';
import { getSettings } from './settings';

let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('AI Commit Message');

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('aiCommitMsg.generate', () => generateCommitMessage(context)),
    vscode.commands.registerCommand('aiCommitMsg.setOpenRouterApiKey', () => promptForOpenRouterApiKey(context.secrets)),
    vscode.commands.registerCommand('aiCommitMsg.clearOpenRouterApiKey', () => clearOpenRouterApiKey(context.secrets))
  );
}

export function deactivate(): void {
  output?.dispose();
}

async function generateCommitMessage(context: vscode.ExtensionContext): Promise<void> {
  try {
    const settings = getSettings();
    const apiKey = await ensureOpenRouterApiKey(context);

    if (!apiKey) {
      return;
    }

    const git = await getGitApi();
    const repository = await pickRepository(git);

    if (!repository) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Generating commit message',
        cancellable: true
      },
      async (_progress, token) => {
        const abortController = new AbortController();
        const cancellation = token.onCancellationRequested(() => abortController.abort());

        try {
          const diffContext = await buildDiffContext(repository, settings);
          const messages = buildMessages({
            diff: diffContext.diff,
            source: diffContext.source,
            truncated: diffContext.truncated,
            settings
          });

          output.appendLine(`Generating message from ${diffContext.source} changes in ${repository.rootUri.fsPath}`);

          const rawMessage = await createOpenRouterCommitMessage(apiKey, messages, settings, abortController.signal);
          const message = sanitizeCommitMessage(rawMessage);

          if (!message.trim()) {
            throw new Error('Generated commit message was empty after cleanup.');
          }

          repository.inputBox.value = message;
          vscode.window.showInformationMessage('Commit message generated.');
        } finally {
          cancellation.dispose();
        }
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Error: ${message}`);
    vscode.window.showErrorMessage(`AI Commit Message: ${message}`);
  }
}

async function ensureOpenRouterApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const existing = await getOpenRouterApiKey(context.secrets);

  if (existing) {
    return existing;
  }

  const action = await vscode.window.showWarningMessage(
    'OpenRouter API key is not configured.',
    { modal: false },
    'Set API Key'
  );

  if (action !== 'Set API Key') {
    return undefined;
  }

  await promptForOpenRouterApiKey(context.secrets);
  return getOpenRouterApiKey(context.secrets);
}
