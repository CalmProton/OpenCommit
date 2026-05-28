# Changelog

## 1.1.0

- Add a `Planned Commits` Source Control view for splitting unstaged changes into multiple AI-planned commits.
- Support moving files between planned commits, editing messages, regenerating messages, and adding or removing planned commit groups.
- Commit planned groups sequentially with clean-index and stale-working-tree checks.

## 1.0.2

- Rename the public settings namespace to `opencommit`.
- Update README and Marketplace text to use OpenCommit and Conventional Commits wording.
- Add a local release skill for future release automation.

## 1.0.1

- Generate Conventional Commits messages by default.
- Attach the Conventional Commits 1.0.0 specification to the model prompt for `opencommit.format: conventional`.
- Keep simple and custom formats available for workspace override.

## 1.0.0

- Publish the first stable release.
- License the project under MIT.
- Remove redundant command activation events from the extension manifest.
- Explicitly include Node and VS Code typings in the TypeScript project configuration.
- Add Marketplace metadata for the public repository, issue tracker, and homepage.
- Document OpenRouter diff processing and API key storage.

## 0.0.6

- Use structured XML prompts with a strict JSON output contract.
- Add configurable context-window budgeting with `modelContextTokens`, `maxPromptContextRatio`, and `maxPromptTokens`.
- Use Git CLI diffs as the primary tracked-diff source and keep VS Code Git API as a fallback.
- Make extension settings resource-scoped for workspace and folder configuration.

## 0.0.5

- Normalize VS Code Git API diff objects into usable patch text instead of `[object Object]`.
- Add debug logging to control verbose request/response diagnostics.
- Keep concise generation summaries enabled by default.

## 0.0.4

- Add verbose generation logs for settings, Git context, diff, prompt messages, OpenRouter request/response, raw model text, and final commit message.
- Tighten prompt instructions to avoid over-inference from small diffs.
- Preserve OpenRouter request/response diagnostics when provider calls fail.

## 0.0.3

- Disable OpenRouter reasoning by default for commit-message generation.

## 0.0.2

- Improve OpenRouter empty-response diagnostics.
- Request low reasoning effort and exclude reasoning output.
- Raise default output token budget for reasoning-model compatibility.

## 0.0.1

- Initial local version.
- Generate commit messages from Git changes through OpenRouter.
- Add Source Control toolbar commands and workspace settings.
