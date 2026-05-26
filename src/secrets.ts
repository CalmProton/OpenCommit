import * as vscode from 'vscode';

const OPENROUTER_API_KEY = 'aiCommitMsg.openRouter.apiKey';

export async function getOpenRouterApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(OPENROUTER_API_KEY);
}

export async function promptForOpenRouterApiKey(secrets: vscode.SecretStorage): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    title: 'Set OpenRouter API Key',
    prompt: 'Enter your OpenRouter API key. It will be stored in VS Code SecretStorage.',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim() ? undefined : 'API key is required.'
  });

  if (!apiKey) {
    return;
  }

  await secrets.store(OPENROUTER_API_KEY, apiKey.trim());
  vscode.window.showInformationMessage('OpenRouter API key saved.');
}

export async function clearOpenRouterApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(OPENROUTER_API_KEY);
  vscode.window.showInformationMessage('OpenRouter API key cleared.');
}
