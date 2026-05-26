import type { ExtensionSettings } from './settings';

export interface PromptInput {
  diff: string;
  source: string;
  truncated: boolean;
  settings: ExtensionSettings;
}

export function buildMessages(input: PromptInput): Array<{ role: 'system' | 'user'; content: string }> {
  const { settings } = input;
  const formatRules = getFormatRules(settings);
  const bodyRule = getBodyRule(settings.includeBody);
  const truncationNote = input.truncated
    ? '\nThe diff was truncated. Base the message only on the visible changes and avoid over-specific claims.'
    : '';

  return [
    {
      role: 'system',
      content: [
        'You write high-quality Git commit messages.',
        'Return only the final commit message, with no Markdown fence, explanation, alternatives, or surrounding quotes.',
        'Use imperative mood and present tense.',
        'Keep the subject line at 72 characters or fewer.',
        bodyRule,
        formatRules,
        `Write the message in language: ${settings.language}.`,
        settings.customInstructions.trim()
          ? `Additional user instructions:\n${settings.customInstructions.trim()}`
          : ''
      ].filter(Boolean).join('\n')
    },
    {
      role: 'user',
      content: [
        `Generate a commit message for these ${input.source} changes.`,
        truncationNote,
        '',
        'Diff:',
        input.diff
      ].join('\n')
    }
  ];
}

export function sanitizeCommitMessage(raw: string): string {
  let value = raw.trim();

  value = value.replace(/^```(?:text|gitcommit|markdown)?\s*/i, '');
  value = value.replace(/\s*```$/i, '');
  value = value.trim();

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }

  return value.replace(/\r\n/g, '\n');
}

function getFormatRules(settings: ExtensionSettings): string {
  switch (settings.format) {
    case 'simple':
      return 'Use a concise plain commit subject without a Conventional Commit prefix.';
    case 'custom':
      return 'Follow the user custom instructions for the commit message format.';
    case 'conventional':
    default:
      return [
        'Use Conventional Commits format when a clear type applies.',
        'Use one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore.',
        'Include a short scope only when it is obvious from the diff.'
      ].join('\n');
  }
}

function getBodyRule(includeBody: ExtensionSettings['includeBody']): string {
  switch (includeBody) {
    case 'never':
      return 'Return a single subject line only.';
    case 'always':
      return 'Return a subject line, a blank line, and a concise body explaining the main change.';
    case 'auto':
    default:
      return 'Return a body only when it adds useful context beyond the subject.';
  }
}
