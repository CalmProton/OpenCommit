# Git Commit Planner

VS Code extension for generating AI Git commit messages and planning clean multi-commit changes, powered by OpenRouter or Codex.

## Features

- Adds a sparkle action to the Source Control toolbar.
- Prefers staged changes when any are present.
- Falls back to unstaged and untracked changes.
- Writes the generated message into the built-in Git commit message input.
- Supports OpenRouter API keys and ChatGPT sign-in through the local Codex App Server.
- Does not store ChatGPT or Codex tokens in the extension.
- Supports workspace settings in `.vscode/settings.json`.
- Writes generation summaries to the `Git Commit Planner` output channel, with optional verbose diagnostics.
- Generates Conventional Commits messages by default, such as `fix(api): correct pagination offset`.
- Adds a `Commit Planner` Source Control view for splitting unstaged changes into multiple AI-generated commits.

## Commands

- `Git Commit Planner: Generate`
- `Git Commit Planner: Plan Commits`
- `Git Commit Planner: Commit Plan`
- `Git Commit Planner: Regenerate Plan`
- `Git Commit Planner: Edit Commit Message`
- `Git Commit Planner: Regenerate Commit Message`
- `Git Commit Planner: Move File to Commit`
- `Git Commit Planner: Add Commit Group`
- `Git Commit Planner: Remove Commit Group`
- `Git Commit Planner: Set OpenRouter API Key`
- `Git Commit Planner: Clear OpenRouter API Key`
- `Git Commit Planner: Sign in to Codex with ChatGPT`
- `Git Commit Planner: Sign out of Codex`
- `Git Commit Planner: Show Codex Account Status`
- `Git Commit Planner: Select Codex Model`
- `Git Commit Planner: Select Codex Reasoning Effort`

## Settings

Example `.vscode/settings.json`:

```json
{
  "gitCommitPlanner.provider": "codex",
  "gitCommitPlanner.codex.model": "",
  "gitCommitPlanner.codex.reasoningEffort": "",
  "gitCommitPlanner.openRouter.model": "openrouter/auto",
  "gitCommitPlanner.format": "conventional",
  "gitCommitPlanner.includeBody": "auto",
  "gitCommitPlanner.preferStaged": true,
  "gitCommitPlanner.modelContextTokens": 200000,
  "gitCommitPlanner.maxPromptContextRatio": 0.6,
  "gitCommitPlanner.maxPromptTokens": 0,
  "gitCommitPlanner.maxDiffChars": 0,
  "gitCommitPlanner.maxOutputTokens": 800,
  "gitCommitPlanner.maxPlanOutputTokens": 32000,
  "gitCommitPlanner.debugLogging": false,
  "gitCommitPlanner.customInstructions": "Use concise commit messages. Avoid mentioning generated files unless they are the main change."
}
```

Do not store API keys in workspace settings. Run `Git Commit Planner: Set OpenRouter API Key` instead. For Codex, install the Codex CLI, select `codex` as the provider, and run `Git Commit Planner: Sign in to Codex with ChatGPT`.

When `gitCommitPlanner.provider` is `codex`, leave `gitCommitPlanner.codex.model` empty to use the Codex default. Run `Git Commit Planner: Select Codex Model` to read the current model list from Codex and save a model for the selected workspace. Model availability depends on the signed-in account. Run `Git Commit Planner: Select Codex Reasoning Effort` to choose a reasoning effort supported by the selected model. Leave it empty to use the model default.

`gitCommitPlanner.format` defaults to `conventional`. Set it to `simple` or `custom` only if a workspace needs a different style.

For OpenRouter, the extension disables reasoning tokens by default because commit messages do not need hidden reasoning budgets. If OpenRouter still returns no message content, try increasing `gitCommitPlanner.maxOutputTokens` or choose a concrete non-reasoning model instead of `openrouter/auto`. For Codex, leave `gitCommitPlanner.codex.reasoningEffort` empty to use the selected model default. Commit Planner uses `gitCommitPlanner.maxPlanOutputTokens` because large plans need more room for JSON file lists.

## Conventional Commits

Git Commit Planner follows the [Conventional Commits 1.0.0 specification](https://www.conventionalcommits.org/en/v1.0.0/). The source for the specification is maintained in the [conventional-commits/conventionalcommits.org](https://github.com/conventional-commits/conventionalcommits.org) GitHub repository.

## Privacy

Git Commit Planner reads Git diffs from the selected repository only when you run a generation command. With OpenRouter, the diff and prompt are sent to the configured OpenRouter API endpoint. Your OpenRouter API key is stored in VS Code SecretStorage and is not written to workspace settings. With Codex, the extension sends the prompt through the local Codex App Server. Codex handles ChatGPT authentication and account tokens; the extension does not read or store them. Codex turns use read-only sandbox access and are ephemeral.

## Large Changes

The extension does not fetch OpenRouter model metadata. For OpenRouter, it assumes a configurable context window:

- `gitCommitPlanner.modelContextTokens`: default `200000`
- `gitCommitPlanner.maxPromptContextRatio`: default `0.6`
- `gitCommitPlanner.maxPromptTokens`: optional direct override; `0` means calculated from the ratio

Diff content is budgeted from this token limit with room reserved for instructions and model output. Large diffs are split by file patch and truncated at patch boundaries where possible. `gitCommitPlanner.maxDiffChars` is an optional extra cap; leave it at `0` to use token budgeting.

## Commit Planner

Use `Git Commit Planner: Plan Commits` or the `Commit Planner` Source Control view to split unstaged and untracked changes into multiple whole-file commits. Git Commit Planner requires a clean index for this workflow; unstage existing staged changes before planning or committing.

The planner requests up to `gitCommitPlanner.maxPlanOutputTokens` output tokens, defaulting to `32000`, so very large plans have room to return complete JSON. This value is also reserved from the prompt budget before diff compaction.

If the provider returns an incomplete plan, Git Commit Planner asks it to repair the plan using the exact missing, duplicate, and unknown file lists. If repair still fails, Git Commit Planner completes the plan locally by preserving valid groups and adding any remaining files to related or fallback groups marked as needing message review.

After a plan is generated, you can move files between commit groups with drag and drop or `Git Commit Planner: Move File to Commit`, edit commit messages, regenerate individual messages, add empty commit groups, or remove commit groups. `Git Commit Planner: Commit Plan` rechecks that the index is clean and the working tree has not changed since planning, then stages and commits each group in order.

## Settings UI

After installing or updating the VSIX, reload VS Code. In Settings, search for `Git Commit Planner`, `gitCommitPlanner`, or `@ext:MadElectron.git-commit-planner`.

## Diagnostics

Open the `Git Commit Planner` output channel when a generated message looks wrong.

By default, each generation logs:

- extension version
- selected repository and change source
- changed files and statuses
- response summary
- final sanitized commit message

Enable verbose diagnostics with:

```json
{
  "gitCommitPlanner.debugLogging": true
}
```

Debug logging additionally includes:

- diff sent to the selected provider
- prompt messages sent to the selected provider
- redacted provider request metadata
- provider response details
- extracted model text
- final sanitized commit message

## Development

```bash
bun install
bun run compile
bun test
```

Codex support requires a working `codex` command. Set `gitCommitPlanner.codex.command` to the full executable path when `codex` is not available on PATH.

Press `F5` in VS Code to launch an Extension Development Host.
