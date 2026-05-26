# OpenCommit

Free AI commit message copilot for VS Code, powered by OpenRouter and the Conventional Commits specification.

## Features

- Adds a sparkle action to the Source Control toolbar.
- Prefers staged changes when any are present.
- Falls back to unstaged and untracked changes.
- Writes the generated message into the built-in Git commit message input.
- Stores the OpenRouter API key in VS Code SecretStorage.
- Supports workspace settings in `.vscode/settings.json`.
- Writes generation summaries to the `OpenCommit` output channel, with optional verbose diagnostics.
- Generates Conventional Commits messages by default, such as `fix(api): correct pagination offset`.

## Commands

- `OpenCommit: Generate Commit Message`
- `OpenCommit: Set OpenRouter API Key`
- `OpenCommit: Clear OpenRouter API Key`

## Settings

Example `.vscode/settings.json`:

```json
{
  "aiCommitMsg.openRouter.model": "openrouter/auto",
  "aiCommitMsg.format": "conventional",
  "aiCommitMsg.includeBody": "auto",
  "aiCommitMsg.preferStaged": true,
  "aiCommitMsg.modelContextTokens": 200000,
  "aiCommitMsg.maxPromptContextRatio": 0.6,
  "aiCommitMsg.maxPromptTokens": 0,
  "aiCommitMsg.maxDiffChars": 0,
  "aiCommitMsg.maxOutputTokens": 800,
  "aiCommitMsg.debugLogging": false,
  "aiCommitMsg.customInstructions": "Use concise commit messages. Avoid mentioning generated files unless they are the main change."
}
```

Do not store API keys in workspace settings. Run `OpenCommit: Set OpenRouter API Key` instead.

`aiCommitMsg.format` defaults to `conventional`. Set it to `simple` or `custom` only if a workspace needs a different style.

The extension disables reasoning tokens by default because commit messages do not need hidden reasoning budgets. If OpenRouter still returns no message content, try increasing `aiCommitMsg.maxOutputTokens` or choose a concrete non-reasoning model instead of `openrouter/auto`.

## Privacy

OpenCommit reads Git diffs from the selected repository only when you run `OpenCommit: Generate Commit Message`. The diff and prompt are sent to the configured OpenRouter API endpoint to generate the commit message. Your OpenRouter API key is stored in VS Code SecretStorage and is not written to workspace settings.

## Large Changes

The extension does not fetch OpenRouter model metadata. Instead, it assumes a configurable context window:

- `aiCommitMsg.modelContextTokens`: default `200000`
- `aiCommitMsg.maxPromptContextRatio`: default `0.6`
- `aiCommitMsg.maxPromptTokens`: optional direct override; `0` means calculated from the ratio

Diff content is budgeted from this token limit with room reserved for instructions and model output. Large diffs are split by file patch and truncated at patch boundaries where possible. `aiCommitMsg.maxDiffChars` is an optional extra legacy cap; leave it at `0` to use token budgeting.

## Settings UI

After installing or updating the VSIX, reload VS Code. In Settings, search for `OpenCommit`, `aiCommitMsg`, or `@ext:MadElectron.opencommit`.

## Diagnostics

Open the `OpenCommit` output channel when a generated message looks wrong.

By default, each generation logs:

- extension version
- selected repository and change source
- changed files and statuses
- response summary
- final sanitized commit message

Enable verbose diagnostics with:

```json
{
  "aiCommitMsg.debugLogging": true
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
