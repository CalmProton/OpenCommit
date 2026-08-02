# Git Commit Planner

VS Code extension for generating AI Git commit messages and planning clean multi-commit changes, powered by OpenRouter API.

## Features

- Adds a sparkle action to the Source Control toolbar.
- Prefers staged changes when any are present.
- Falls back to unstaged and untracked changes.
- Writes the generated message into the built-in Git commit message input.
- Stores the OpenRouter API key in VS Code SecretStorage.
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

## Settings

Example `.vscode/settings.json`:

```json
{
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

Do not store API keys in workspace settings. Run `Git Commit Planner: Set OpenRouter API Key` instead.

`gitCommitPlanner.format` defaults to `conventional`. Set it to `simple` or `custom` only if a workspace needs a different style.

The extension disables reasoning tokens by default because commit messages do not need hidden reasoning budgets. If OpenRouter still returns no message content, try increasing `gitCommitPlanner.maxOutputTokens` or choose a concrete non-reasoning model instead of `openrouter/auto`. Commit Planner uses `gitCommitPlanner.maxPlanOutputTokens` because large plans need more room for JSON file lists.

## Conventional Commits

Git Commit Planner follows the [Conventional Commits 1.0.0 specification](https://www.conventionalcommits.org/en/v1.0.0/). The source for the specification is maintained in the [conventional-commits/conventionalcommits.org](https://github.com/conventional-commits/conventionalcommits.org) GitHub repository.

## Privacy

Git Commit Planner reads Git diffs from the selected repository only when you run `Git Commit Planner: Generate`. The diff and prompt are sent to the configured OpenRouter API endpoint to generate the commit message. Your OpenRouter API key is stored in VS Code SecretStorage and is not written to workspace settings.

## Large Changes

The extension does not fetch OpenRouter model metadata. Instead, it assumes a configurable context window:

- `gitCommitPlanner.modelContextTokens`: default `200000`
- `gitCommitPlanner.maxPromptContextRatio`: default `0.6`
- `gitCommitPlanner.maxPromptTokens`: optional direct override; `0` means calculated from the ratio

Diff content is budgeted from this token limit with room reserved for instructions and model output. Large diffs are split by file patch and truncated at patch boundaries where possible. `gitCommitPlanner.maxDiffChars` is an optional extra cap; leave it at `0` to use token budgeting.

## Commit Planner

Use `Git Commit Planner: Plan Commits` or the `Commit Planner` Source Control view to split unstaged and untracked changes into multiple whole-file commits. Git Commit Planner requires a clean index for this workflow; unstage existing staged changes before planning or committing.

The planner requests up to `gitCommitPlanner.maxPlanOutputTokens` output tokens, defaulting to `32000`, so very large plans have room to return complete JSON. This value is also reserved from the prompt budget before diff compaction.

If the model returns an incomplete plan, Git Commit Planner asks it to repair the plan using the exact missing, duplicate, and unknown file lists. If repair still fails, Git Commit Planner completes the plan locally by preserving valid groups and adding any remaining files to related or fallback groups marked as needing message review.

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

- diff sent to OpenRouter
- prompt messages sent to OpenRouter
- redacted OpenRouter request metadata
- raw OpenRouter response body
- extracted model text
- final sanitized commit message

## Development

```bash
bun install
bun run compile
```

Press `F5` in VS Code to launch an Extension Development Host.
