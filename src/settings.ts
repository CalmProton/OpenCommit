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
  language: string;
  temperature: number;
  maxOutputTokens: number;
}

export function getSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration('aiCommitMsg');

  return {
    provider: config.get<'openrouter'>('provider', 'openrouter'),
    openRouter: {
      baseUrl: config.get<string>('openRouter.baseUrl', 'https://openrouter.ai/api/v1'),
      model: config.get<string>('openRouter.model', 'openrouter/auto'),
      siteUrl: config.get<string>('openRouter.siteUrl', ''),
      appTitle: config.get<string>('openRouter.appTitle', 'AI Commit Message VS Code Extension')
    },
    format: config.get<CommitFormat>('format', 'conventional'),
    includeBody: config.get<IncludeBody>('includeBody', 'auto'),
    customInstructions: config.get<string>('customInstructions', ''),
    preferStaged: config.get<boolean>('preferStaged', true),
    maxDiffChars: config.get<number>('maxDiffChars', 20000),
    language: config.get<string>('language', 'en'),
    temperature: config.get<number>('temperature', 0.2),
    maxOutputTokens: config.get<number>('maxOutputTokens', 220)
  };
}
