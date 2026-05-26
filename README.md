# AI Commit Message

Generate VS Code Git commit messages from staged or unstaged changes using OpenRouter.

## Features

- Adds a sparkle action to the Source Control toolbar.
- Prefers staged changes when any are present.
- Falls back to unstaged and untracked changes.
- Writes the generated message into the built-in Git commit message input.
- Stores the OpenRouter API key in VS Code SecretStorage.
- Supports workspace settings in `.vscode/settings.json`.

## Commands

- `AI Commit Message: Generate Commit Message`
- `AI Commit Message: Set OpenRouter API Key`
- `AI Commit Message: Clear OpenRouter API Key`

## Settings

Example `.vscode/settings.json`:

```json
{
  "aiCommitMsg.openRouter.model": "openrouter/auto",
  "aiCommitMsg.format": "conventional",
  "aiCommitMsg.includeBody": "auto",
  "aiCommitMsg.preferStaged": true,
  "aiCommitMsg.maxDiffChars": 20000,
  "aiCommitMsg.customInstructions": "Use concise commit messages. Avoid mentioning generated files unless they are the main change."
}
```

Do not store API keys in workspace settings. Run `AI Commit Message: Set OpenRouter API Key` instead.

## Development

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.
