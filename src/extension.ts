import * as vscode from 'vscode';
import { buildDiffContext, getGitApi, pickRepository } from './git';
import { createLogger } from './logger';
import { createOpenRouterCommitMessage, OpenRouterResponseError } from './openrouter';
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
          const logger = createLogger(output);
          const diffContext = await buildDiffContext(repository, settings);
          const messages = buildMessages({
            diff: diffContext.diff,
            source: diffContext.source,
            files: diffContext.files,
            budget: diffContext.budget,
            truncated: diffContext.truncated,
            settings
          });

          logger.section('Generation started');
          logger.line(`Extension version: ${context.extension.packageJSON.version}`);
          logger.line(`Debug logging: ${settings.debugLogging ? 'enabled' : 'disabled'}`);
          logger.json('Generation summary', {
            provider: settings.provider,
            model: settings.openRouter.model,
            format: settings.format,
            includeBody: settings.includeBody,
            diffChars: diffContext.diff.length,
            estimatedDiffTokens: diffContext.budget.estimatedDiffTokens,
            maxPromptTokens: diffContext.budget.maxPromptTokens,
            maxDiffTokens: diffContext.budget.maxDiffTokens,
            truncated: diffContext.truncated,
            source: diffContext.source,
            repository: repository.rootUri.fsPath,
            files: diffContext.files
          });

          if (settings.debugLogging) {
            logger.json('Settings', {
              provider: settings.provider,
              model: settings.openRouter.model,
              baseUrl: settings.openRouter.baseUrl,
              format: settings.format,
              includeBody: settings.includeBody,
              preferStaged: settings.preferStaged,
              maxDiffChars: settings.maxDiffChars,
              modelContextTokens: settings.modelContextTokens,
              maxPromptContextRatio: settings.maxPromptContextRatio,
              maxPromptTokens: settings.maxPromptTokens,
              calculatedMaxPromptTokens: diffContext.budget.maxPromptTokens,
              calculatedMaxDiffTokens: diffContext.budget.maxDiffTokens,
              calculatedMaxDiffChars: diffContext.budget.maxDiffChars,
              diffChars: diffContext.diff.length,
              originalDiffChars: diffContext.budget.originalChars,
              omittedFilePatches: diffContext.budget.omittedFilePatches,
              language: settings.language,
              temperature: settings.temperature,
              maxOutputTokens: settings.maxOutputTokens,
              customInstructionsConfigured: Boolean(settings.customInstructions.trim())
            });
            logger.json('Git context', {
              repository: repository.rootUri.fsPath,
              source: diffContext.source,
              files: diffContext.files,
              truncated: diffContext.truncated,
              stagedChanges: repository.state.indexChanges.length,
              workingTreeChanges: repository.state.workingTreeChanges.length,
              untrackedChanges: repository.state.untrackedChanges.length
            });
            logger.text('Diff sent to OpenRouter', diffContext.diff);
            logger.json('Messages sent to OpenRouter', messages);
          } else {
            logger.line('Enable aiCommitMsg.debugLogging for full diff, prompt, request, and response diagnostics.');
          }

          const result = await createOpenRouterCommitMessage(apiKey, messages, settings, abortController.signal);

          if (settings.debugLogging) {
            logger.json('OpenRouter request', result.request);
            logger.json('OpenRouter response summary', result.response.choiceSummary);
            logger.text('OpenRouter raw response body', result.response.bodyText);
            logger.text('Extracted model text', result.text);
          } else {
            logger.json('OpenRouter response summary', result.response.choiceSummary);
          }

          const message = sanitizeCommitMessage(result.text);
          logger.text('Commit message after cleanup', message);

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
    const logger = createLogger(output);
    if (error instanceof OpenRouterResponseError) {
      logger.section('OpenRouter failure diagnostics');
      logger.json('OpenRouter request', error.request);
      logger.json('OpenRouter response summary', error.response.choiceSummary);
      logger.text('OpenRouter raw response body', error.response.bodyText);
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error(error);
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
