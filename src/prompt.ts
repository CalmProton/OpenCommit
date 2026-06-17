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

export interface PlanPromptInput extends PromptInput {
  allFiles: Array<{ path: string; status: string }>;
}

export interface PlanRepairPromptInput {
  allFiles: readonly { path: string; status: string }[];
  invalidPlanText: string;
  parsedPlan: Array<{ message: string; files: string[] }> | undefined;
  missingFiles: string[];
  unknownFiles: string[];
  duplicateFiles: string[];
  settings: ExtensionSettings;
}

export interface PlannedCommitPromptInput extends PromptInput {
  selectedFiles: string[];
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
        'Treat file status and operation metadata as authoritative.',
        'Never describe a deleted file as added, introduced, or created.',
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

export function buildPlanMessages(input: PlanPromptInput): Array<{ role: 'system' | 'user'; content: string }> {
  const settings = input.settings;

  return [
    {
      role: 'system',
      content: [
        'You split Git changes into a small sequence of accurate, reviewable commits.',
        'You must follow the XML request exactly.',
        'Use only the data inside <diff> and <changed_files_json> as evidence.',
        'Treat file status and operation metadata as authoritative.',
        'Never describe a deleted file as added, introduced, or created.',
        'Every changed file must appear exactly once in the output.',
        'Never include files not present in changed_files_json.',
        'Return only valid compact JSON matching this schema: {"commits":[{"message":"string","files":["string"]}]}.',
        'Do not return Markdown, comments, alternative plans, or explanatory text.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '<multi_commit_plan_request>',
        '  <task>Split the provided whole-file changes into related commits and write each commit message.</task>',
        '  <source_of_truth>The diff and changed file list are the only evidence. Group files by visible related purpose, feature area, or maintenance task.</source_of_truth>',
        '  <planning_rules>',
        '    <granularity>whole_files_only</granularity>',
        '    <file_assignment>Every file in changed_files_json must appear in exactly one commit. Do not split a file across commits.</file_assignment>',
        '    <operation_accuracy>Commit messages must match changed_file_operations_json. Deleted files represent removals, not additions.</operation_accuracy>',
        '    <commit_count>Prefer 2-5 commits for large unrelated changes. Use 1 commit if the changes are clearly one cohesive task.</commit_count>',
        '    <ordering>Order commits so foundational or shared changes come before dependent changes when that is visible.</ordering>',
        '  </planning_rules>',
        '  <message_style_rules>',
        `    <language>${escapeXml(settings.language)}</language>`,
        '    <imperative_mood>true</imperative_mood>',
        '    <subject_max_columns>72</subject_max_columns>',
        `    <body_policy>${escapeXml(getBodyRule(settings.includeBody))}</body_policy>`,
        `    <format_policy>${escapeXml(getFormatRules(settings))}</format_policy>`,
        getFormatSpec(settings),
        `    <change_type_policy>${escapeXml(getChangeTypePolicy(settings))}</change_type_policy>`,
        settings.customInstructions.trim()
          ? `    <custom_instructions>${escapeXml(settings.customInstructions.trim())}</custom_instructions>`
          : '',
        '  </message_style_rules>',
        '  <output_contract>',
        '    <json_schema>{"commits":[{"message":"string","files":["string"]}]}</json_schema>',
        '    <notes>Return only this JSON object. File paths must exactly match changed_files_json paths.</notes>',
        '  </output_contract>',
        '  <change_context>',
        `    <source>${escapeXml(input.source)}</source>`,
        `    <diff_truncated>${input.truncated ? 'true' : 'false'}</diff_truncated>`,
        `    <changed_files_json>${escapeXml(JSON.stringify(input.allFiles))}</changed_files_json>`,
        `    <changed_file_operations_json>${escapeXml(JSON.stringify(describeFileOperations(input.allFiles)))}</changed_file_operations_json>`,
        `    <budget_json>${escapeXml(JSON.stringify(input.budget))}</budget_json>`,
        '  </change_context>',
        '  <diff><![CDATA[',
        escapeCdata(input.diff),
        '  ]]></diff>',
        '</multi_commit_plan_request>'
      ].filter(Boolean).join('\n')
    }
  ];
}

export function buildPlanRepairMessages(input: PlanRepairPromptInput): Array<{ role: 'system' | 'user'; content: string }> {
  const settings = input.settings;

  return [
    {
      role: 'system',
      content: [
        'You repair invalid Git multi-commit plan JSON.',
        'Use changed_files_json as the authoritative file list.',
        'Treat file status and operation metadata as authoritative.',
        'Never describe a deleted file as added, introduced, or created.',
        'Every changed file must appear exactly once in the repaired output.',
        'Remove files that are not present in changed_files_json.',
        'Return only valid compact JSON matching this schema: {"commits":[{"message":"string","files":["string"]}]}.',
        'Do not return Markdown, comments, alternative plans, or explanatory text.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '<commit_plan_repair_request>',
        '  <task>Return a complete corrected replacement plan. Do not return a partial patch or only the missing files.</task>',
        '  <repair_rules>',
        '    <file_assignment>Every path in changed_files_json must appear exactly once. No other paths may appear.</file_assignment>',
        '    <operation_accuracy>Commit messages must match changed_file_operations_json. Deleted files represent removals, not additions.</operation_accuracy>',
        '    <missing_files>Add every missing file to the most related existing commit, or create a new commit when no existing commit fits.</missing_files>',
        '    <duplicate_files>Keep each duplicated file in only the most related commit.</duplicate_files>',
        '    <unknown_files>Remove every unknown file.</unknown_files>',
        '    <ordering>Preserve the existing commit order unless adding a new related commit requires placing it near similar work.</ordering>',
        '  </repair_rules>',
        '  <message_style_rules>',
        `    <language>${escapeXml(settings.language)}</language>`,
        '    <imperative_mood>true</imperative_mood>',
        '    <subject_max_columns>72</subject_max_columns>',
        `    <body_policy>${escapeXml(getBodyRule(settings.includeBody))}</body_policy>`,
        `    <format_policy>${escapeXml(getFormatRules(settings))}</format_policy>`,
        getFormatSpec(settings),
        `    <change_type_policy>${escapeXml(getChangeTypePolicy(settings))}</change_type_policy>`,
        settings.customInstructions.trim()
          ? `    <custom_instructions>${escapeXml(settings.customInstructions.trim())}</custom_instructions>`
          : '',
        '  </message_style_rules>',
        '  <validation_errors>',
        `    <missing_files_json>${escapeXml(JSON.stringify(input.missingFiles))}</missing_files_json>`,
        `    <unknown_files_json>${escapeXml(JSON.stringify(input.unknownFiles))}</unknown_files_json>`,
        `    <duplicate_files_json>${escapeXml(JSON.stringify(input.duplicateFiles))}</duplicate_files_json>`,
        '  </validation_errors>',
        '  <change_context>',
        `    <changed_files_json>${escapeXml(JSON.stringify(input.allFiles))}</changed_files_json>`,
        `    <changed_file_operations_json>${escapeXml(JSON.stringify(describeFileOperations(input.allFiles)))}</changed_file_operations_json>`,
        '  </change_context>',
        '  <parsed_invalid_plan_json><![CDATA[',
        escapeCdata(JSON.stringify({ commits: input.parsedPlan ?? [] })),
        '  ]]></parsed_invalid_plan_json>',
        '  <raw_invalid_plan><![CDATA[',
        escapeCdata(input.invalidPlanText),
        '  ]]></raw_invalid_plan>',
        '  <output_contract>',
        '    <json_schema>{"commits":[{"message":"string","files":["string"]}]}</json_schema>',
        '    <notes>Return only this complete JSON object. File paths must exactly match changed_files_json paths.</notes>',
        '  </output_contract>',
        '</commit_plan_repair_request>'
      ].filter(Boolean).join('\n')
    }
  ];
}

export function buildPlannedCommitMessageMessages(input: PlannedCommitPromptInput): Array<{ role: 'system' | 'user'; content: string }> {
  const settings = input.settings;

  return [
    {
      role: 'system',
      content: [
        'You generate accurate Git commit messages for a selected subset of changed files.',
        'You must follow the XML request exactly.',
        'Use only the selected files and visible diff evidence.',
        'Treat file status and operation metadata as authoritative.',
        'Never describe a deleted file as added, introduced, or created.',
        'Return only valid compact JSON matching this schema: {"commitMessage":"string"}.',
        'Do not return Markdown, comments, alternative messages, or explanatory text.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '<selected_commit_message_request>',
        '  <task>Generate one Git commit message for the selected files.</task>',
        '  <source_of_truth>The selected files and diff are the only evidence. Ignore unrelated diff sections except where needed for context.</source_of_truth>',
        '  <operation_accuracy>Commit messages must match selected_file_operations_json. Deleted files represent removals, not additions.</operation_accuracy>',
        '  <style_rules>',
        `    <language>${escapeXml(settings.language)}</language>`,
        '    <imperative_mood>true</imperative_mood>',
        '    <subject_max_columns>72</subject_max_columns>',
        `    <body_policy>${escapeXml(getBodyRule(settings.includeBody))}</body_policy>`,
        `    <format_policy>${escapeXml(getFormatRules(settings))}</format_policy>`,
        getFormatSpec(settings),
        `    <change_type_policy>${escapeXml(getChangeTypePolicy(settings))}</change_type_policy>`,
        settings.customInstructions.trim()
          ? `    <custom_instructions>${escapeXml(settings.customInstructions.trim())}</custom_instructions>`
          : '',
        '  </style_rules>',
        '  <output_contract>',
        '    <json_schema>{"commitMessage":"string"}</json_schema>',
        '    <notes>Return only this JSON object. The commitMessage value may contain newline characters if a body is required.</notes>',
        '  </output_contract>',
        '  <change_context>',
        `    <source>${escapeXml(input.source)}</source>`,
        `    <diff_truncated>${input.truncated ? 'true' : 'false'}</diff_truncated>`,
        `    <selected_files_json>${escapeXml(JSON.stringify(input.selectedFiles))}</selected_files_json>`,
        `    <changed_files_json>${escapeXml(JSON.stringify(input.files))}</changed_files_json>`,
        `    <selected_file_operations_json>${escapeXml(JSON.stringify(describeFileOperations(input.files.filter(file => input.selectedFiles.includes(file.path)))))}</selected_file_operations_json>`,
        `    <changed_file_operations_json>${escapeXml(JSON.stringify(describeFileOperations(input.files)))}</changed_file_operations_json>`,
        `    <budget_json>${escapeXml(JSON.stringify(input.budget))}</budget_json>`,
        '  </change_context>',
        '  <diff><![CDATA[',
        escapeCdata(input.diff),
        '  ]]></diff>',
        '</selected_commit_message_request>'
      ].filter(Boolean).join('\n')
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

export function parsePlannedCommits(raw: string): Array<{ message: string; files: string[] }> | undefined {
  const parsed = extractJsonObject(raw);

  if (!parsed) {
    return undefined;
  }

  const record = parsed as { commits?: unknown };

  if (!Array.isArray(record.commits)) {
    return undefined;
  }

  return record.commits
    .map((commit: unknown) => {
      const plannedCommit = commit as { message?: unknown; files?: unknown };

      return {
        message: typeof plannedCommit.message === 'string' ? sanitizeCommitMessage(plannedCommit.message) : '',
        files: Array.isArray(plannedCommit.files)
          ? plannedCommit.files.filter((file: unknown): file is string => typeof file === 'string')
          : []
      };
    })
    .filter((commit: { message: string; files: string[] }) => commit.message.trim() && commit.files.length > 0);
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
    '  <operation_accuracy>Commit messages must match changed_file_operations_json. Deleted files represent removals, not additions.</operation_accuracy>',
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
    `    <changed_file_operations_json>${escapeXml(JSON.stringify(describeFileOperations(input.files)))}</changed_file_operations_json>`,
    `    <budget_json>${escapeXml(JSON.stringify(input.budget))}</budget_json>`,
    '  </change_context>',
    examples,
    '  <diff><![CDATA[',
    escapeCdata(input.diff),
    '  ]]></diff>',
    '</commit_message_request>'
  ].filter(Boolean).join('\n');
}

function describeFileOperations(files: readonly { path: string; status: string }[]): Array<{ path: string; status: string; operation: string }> {
  return files.map(file => ({
    path: file.path,
    status: file.status,
    operation: operationFromStatus(file.status)
  }));
}

function operationFromStatus(status: string): string {
  switch (status) {
    case 'INDEX_ADDED':
    case 'UNTRACKED':
    case 'INTENT_TO_ADD':
    case 'ADDED_BY_US':
    case 'ADDED_BY_THEM':
    case 'BOTH_ADDED':
      return 'added';
    case 'INDEX_DELETED':
    case 'DELETED':
    case 'DELETED_BY_US':
    case 'DELETED_BY_THEM':
    case 'BOTH_DELETED':
      return 'deleted';
    case 'INDEX_RENAMED':
    case 'INTENT_TO_RENAME':
      return 'renamed';
    case 'INDEX_COPIED':
      return 'copied';
    case 'TYPE_CHANGED':
      return 'type_changed';
    case 'INDEX_MODIFIED':
    case 'MODIFIED':
    case 'BOTH_MODIFIED':
      return 'modified';
    case 'IGNORED':
      return 'ignored';
    default:
      return 'changed';
  }
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
  const parsed = extractJsonObject(raw) as { commitMessage?: unknown; message?: unknown; subject?: unknown; body?: unknown } | undefined;

  if (!parsed) {
    return undefined;
  }

  if (typeof parsed.commitMessage === 'string') {
    return parsed.commitMessage;
  }

  if (typeof parsed.message === 'string') {
    return parsed.message;
  }

  if (typeof parsed.subject === 'string') {
    return typeof parsed.body === 'string' && parsed.body.trim()
      ? `${parsed.subject.trim()}\n\n${parsed.body.trim()}`
      : parsed.subject;
  }

  return undefined;
}

function extractJsonObject(raw: string): Record<string, unknown> | undefined {
  const value = raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  const direct = parseJsonObject(value);

  if (direct) {
    return direct;
  }

  let start = value.indexOf('{');

  while (start >= 0) {
    const candidate = extractBalancedJsonObject(value, start);
    const parsed = candidate ? parseJsonObject(candidate) : undefined;

    if (parsed) {
      return parsed;
    }

    start = value.indexOf('{', start + 1);
  }

  return undefined;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function extractBalancedJsonObject(value: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
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
