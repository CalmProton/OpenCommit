import * as vscode from 'vscode';

export type CommitFormat = 'conventional' | 'simple' | 'custom';
export type IncludeBody = 'never' | 'auto' | 'always';

export interface ExtensionSettings {
  provider: 'openrouter';
  openRouter: {
    baseUrl: string;
    model: string;
    siteUrl: string;
    appTitle: string;
  };
  format: CommitFormat;
  includeBody: IncludeBody;
  customInstructions: string;
  preferStaged: boolean;
  maxDiffChars: number;
  modelContextTokens: number;
  maxPromptContextRatio: number;
  maxPromptTokens: number;
  language: string;
  temperature: number;
  maxOutputTokens: number;
  debugLogging: boolean;
}

export function getSettings(resource?: vscode.Uri): ExtensionSettings {
  const config = vscode.workspace.getConfiguration('opencommit', resource);

  return {
    provider: config.get<'openrouter'>('provider', 'openrouter'),
    openRouter: {
      baseUrl: config.get<string>('openRouter.baseUrl', 'https://openrouter.ai/api/v1'),
      model: config.get<string>('openRouter.model', 'openrouter/auto'),
      siteUrl: config.get<string>('openRouter.siteUrl', ''),
      appTitle: config.get<string>('openRouter.appTitle', 'OpenCommit VS Code Extension')
    },
    format: config.get<CommitFormat>('format', 'conventional'),
    includeBody: config.get<IncludeBody>('includeBody', 'auto'),
    customInstructions: config.get<string>('customInstructions', ''),
    preferStaged: config.get<boolean>('preferStaged', true),
    maxDiffChars: config.get<number>('maxDiffChars', 0),
    modelContextTokens: config.get<number>('modelContextTokens', 200000),
    maxPromptContextRatio: config.get<number>('maxPromptContextRatio', 0.6),
    maxPromptTokens: config.get<number>('maxPromptTokens', 0),
    language: config.get<string>('language', 'en'),
    temperature: config.get<number>('temperature', 0.2),
    maxOutputTokens: config.get<number>('maxOutputTokens', 800),
    debugLogging: config.get<boolean>('debugLogging', false)
  };
}
