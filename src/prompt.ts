import type { ExtensionSettings } from './settings';
import { CONVENTIONAL_COMMITS_SPEC } from './conventionalCommits';

export interface PromptInput {
  diff: string;
  source: string;
  files: Array<{ path: string; status: string }>;
  budget: unknown;
  truncated: boolean;
  settings: ExtensionSettings;
}

export function buildMessages(input: PromptInput): Array<{ role: 'system' | 'user'; content: string }> {
  const { settings } = input;
  const formatRules = getFormatRules(settings);
  const formatSpec = getFormatSpec(settings);
  const changeTypePolicy = getChangeTypePolicy(settings);
  const bodyRule = getBodyRule(settings.includeBody);
  const request = buildStructuredRequest(input, formatRules, formatSpec, changeTypePolicy, bodyRule);

  return [
    {
      role: 'system',
      content: [
        'You generate accurate Git commit messages.',
        'You must follow the XML request exactly.',
        'Use only the data inside <diff> and <changed_files_json> as evidence.',
        'Never infer hidden runtime behavior, bugs, features, validation, APIs, or user intent that is not visible in the diff.',
        'Return only valid compact JSON matching this schema: {"commitMessage":"string"}.',
        'Do not return Markdown, comments, alternative messages, or explanatory text.'
      ].filter(Boolean).join('\n')
    },
    {
      role: 'user',
      content: request
    }
  ];
}

export function sanitizeCommitMessage(raw: string): string {
  let value = extractMessageFromJson(raw) ?? raw.trim();

  value = value.replace(/^```(?:text|gitcommit|markdown)?\s*/i, '');
  value = value.replace(/^```json\s*/i, '');
  value = value.replace(/\s*```$/i, '');
  value = value.trim();

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }

  return value.replace(/\r\n/g, '\n');
}

function buildStructuredRequest(
  input: PromptInput,
  formatRules: string,
  formatSpec: string,
  changeTypePolicy: string,
  bodyRule: string
): string {
  const settings = input.settings;
  const customInstructions = settings.customInstructions.trim();
  const examples = getExamples(settings);

  return [
    '<commit_message_request>',
    '  <task>Generate one Git commit message for the provided changes.</task>',
    '  <source_of_truth>The diff and changed file list are the only evidence. If a change is small or ambiguous, produce a conservative message.</source_of_truth>',
    '  <style_rules>',
    `    <language>${escapeXml(settings.language)}</language>`,
    '    <imperative_mood>true</imperative_mood>',
    '    <subject_max_columns>72</subject_max_columns>',
    `    <body_policy>${escapeXml(bodyRule)}</body_policy>`,
    `    <format_policy>${escapeXml(formatRules)}</format_policy>`,
    formatSpec,
    `    <change_type_policy>${escapeXml(changeTypePolicy)}</change_type_policy>`,
    customInstructions ? `    <custom_instructions>${escapeXml(customInstructions)}</custom_instructions>` : '',
    '  </style_rules>',
    '  <output_contract>',
    '    <json_schema>{"commitMessage":"string"}</json_schema>',
    '    <notes>Return only this JSON object. The commitMessage value may contain newline characters if a body is required.</notes>',
    '  </output_contract>',
    '  <change_context>',
    `    <source>${escapeXml(input.source)}</source>`,
    `    <diff_truncated>${input.truncated ? 'true' : 'false'}</diff_truncated>`,
    `    <changed_files_json>${escapeXml(JSON.stringify(input.files))}</changed_files_json>`,
    `    <budget_json>${escapeXml(JSON.stringify(input.budget))}</budget_json>`,
    '  </change_context>',
    examples,
    '  <diff><![CDATA[',
    escapeCdata(input.diff),
    '  ]]></diff>',
    '</commit_message_request>'
  ].filter(Boolean).join('\n');
}

function getExamples(settings: ExtensionSettings): string {
  if (settings.format === 'conventional') {
    return [
      '  <examples>',
      '    <example>',
      '      <visible_change>Markdown heading changed from "Overview" to "Overviews".</visible_change>',
      '      <good_output>{"commitMessage":"docs: update architecture heading"}</good_output>',
      '      <bad_output>{"commitMessage":"fix: handle null values in architecture parser"}</bad_output>',
      '    </example>',
      '    <example>',
      '      <visible_change>Only generated lockfile dependency versions changed.</visible_change>',
      '      <good_output>{"commitMessage":"chore: update dependency lockfile"}</good_output>',
      '    </example>',
      '  </examples>'
    ].join('\n');
  }

  if (settings.format === 'simple' || settings.format === 'custom') {
    return [
      '  <examples>',
      '    <example>',
      '      <visible_change>Markdown heading changed from "Overview" to "Overviews".</visible_change>',
      '      <good_output>{"commitMessage":"update architecture heading"}</good_output>',
      '      <bad_output>{"commitMessage":"handle null values in architecture parser"}</bad_output>',
      '    </example>',
      '  </examples>'
    ].join('\n');
  }

  return '';
}

function extractMessageFromJson(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

  try {
    const parsed = JSON.parse(trimmed);

    if (typeof parsed?.commitMessage === 'string') {
      return parsed.commitMessage;
    }

    if (typeof parsed?.message === 'string') {
      return parsed.message;
    }

    if (typeof parsed?.subject === 'string') {
      return typeof parsed?.body === 'string' && parsed.body.trim()
        ? `${parsed.subject.trim()}\n\n${parsed.body.trim()}`
        : parsed.subject;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeCdata(value: string): string {
  return value.replace(/\]\]>/g, ']]]]><![CDATA[>');
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
        'Generate a Conventional Commits 1.0.0 commit message.',
        'The subject line must follow: <type>[optional scope][optional !]: <description>.',
        'Use feat for new features and fix for bug fixes.',
        'Use common additional types when they fit the diff: build, chore, ci, docs, style, refactor, perf, test.',
        'Include a short noun scope in parentheses only when it is obvious and useful from the diff.',
        'If a breaking change is visible in the diff, append ! before the colon or include a BREAKING CHANGE footer.',
        'Apply the full Conventional Commits 1.0.0 specification attached in <conventional_commits_spec>.'
      ].join('\n');
  }
}

function getFormatSpec(settings: ExtensionSettings): string {
  if (settings.format !== 'conventional') {
    return '';
  }

  return [
    '    <conventional_commits_spec><![CDATA[',
    escapeCdata(CONVENTIONAL_COMMITS_SPEC),
    '    ]]></conventional_commits_spec>'
  ].join('\n');
}

function getChangeTypePolicy(settings: ExtensionSettings): string {
  switch (settings.format) {
    case 'conventional':
      return [
        'For tiny text-only edits, use docs or chore and name the visible edited area. Do not invent behavior.',
        'If only documentation, headings, comments, wording, spelling, punctuation, or instructions changed, use docs or chore rather than fix, feat, or refactor.'
      ].join('\n');
    default:
      return 'For tiny or text-only edits, name the visible edited area and do not invent behavior.';
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
