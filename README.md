# OpenCommit

Free Conventional Commits generator for VS Code, powered by OpenRouter.

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

- `OpenCommit: Generate`
- `OpenCommit: Set OpenRouter API Key`
- `OpenCommit: Clear OpenRouter API Key`

## Settings

Example `.vscode/settings.json`:

```json
{
  "opencommit.openRouter.model": "openrouter/auto",
  "opencommit.format": "conventional",
  "opencommit.includeBody": "auto",
  "opencommit.preferStaged": true,
  "opencommit.modelContextTokens": 200000,
  "opencommit.maxPromptContextRatio": 0.6,
  "opencommit.maxPromptTokens": 0,
  "opencommit.maxDiffChars": 0,
  "opencommit.maxOutputTokens": 800,
  "opencommit.debugLogging": false,
  "opencommit.customInstructions": "Use concise commit messages. Avoid mentioning generated files unless they are the main change."
}
```

Do not store API keys in workspace settings. Run `OpenCommit: Set OpenRouter API Key` instead.

`opencommit.format` defaults to `conventional`. Set it to `simple` or `custom` only if a workspace needs a different style.

The extension disables reasoning tokens by default because commit messages do not need hidden reasoning budgets. If OpenRouter still returns no message content, try increasing `opencommit.maxOutputTokens` or choose a concrete non-reasoning model instead of `openrouter/auto`.

## Conventional Commits

OpenCommit follows the [Conventional Commits 1.0.0 specification](https://www.conventionalcommits.org/en/v1.0.0/). The source for the specification is maintained in the [conventional-commits/conventionalcommits.org](https://github.com/conventional-commits/conventionalcommits.org) GitHub repository.

## Privacy

OpenCommit reads Git diffs from the selected repository only when you run `OpenCommit: Generate`. The diff and prompt are sent to the configured OpenRouter API endpoint to generate the commit message. Your OpenRouter API key is stored in VS Code SecretStorage and is not written to workspace settings.

## Large Changes

The extension does not fetch OpenRouter model metadata. Instead, it assumes a configurable context window:

- `opencommit.modelContextTokens`: default `200000`
- `opencommit.maxPromptContextRatio`: default `0.6`
- `opencommit.maxPromptTokens`: optional direct override; `0` means calculated from the ratio

Diff content is budgeted from this token limit with room reserved for instructions and model output. Large diffs are split by file patch and truncated at patch boundaries where possible. `opencommit.maxDiffChars` is an optional extra cap; leave it at `0` to use token budgeting.

## Settings UI

After installing or updating the VSIX, reload VS Code. In Settings, search for `OpenCommit`, `opencommit`, or `@ext:MadElectron.opencommit`.

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
  "opencommit.debugLogging": true
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
