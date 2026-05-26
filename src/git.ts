import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionSettings } from './settings';

export const enum Status {
  INDEX_MODIFIED,
  INDEX_ADDED,
  INDEX_DELETED,
  INDEX_RENAMED,
  INDEX_COPIED,
  MODIFIED,
  DELETED,
  UNTRACKED,
  IGNORED,
  INTENT_TO_ADD,
  INTENT_TO_RENAME,
  TYPE_CHANGED,
  ADDED_BY_US,
  ADDED_BY_THEM,
  DELETED_BY_US,
  DELETED_BY_THEM,
  BOTH_ADDED,
  BOTH_DELETED,
  BOTH_MODIFIED
}

export interface Change {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
  readonly status: Status;
}

export interface Repository {
  readonly rootUri: vscode.Uri;
  readonly inputBox: { value: string };
  readonly state: {
    readonly indexChanges: Change[];
    readonly workingTreeChanges: Change[];
    readonly untrackedChanges: Change[];
  };
  readonly ui: {
    readonly selected: boolean;
  };
  diffWithHEAD(): Promise<string>;
  diffIndexWithHEAD(): Promise<string>;
}

interface GitApi {
  readonly repositories: Repository[];
  getRepository(uri: vscode.Uri): Repository | null;
}

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

export interface DiffContext {
  repository: Repository;
  diff: string;
  source: 'staged' | 'unstaged';
  truncated: boolean;
}

export async function getGitApi(): Promise<GitApi> {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');

  if (!extension) {
    throw new Error('The built-in VS Code Git extension is not available.');
  }

  const gitExtension = extension.isActive ? extension.exports : await extension.activate();

  if (!gitExtension.enabled) {
    throw new Error('The built-in VS Code Git extension is disabled.');
  }

  return gitExtension.getAPI(1);
}

export async function pickRepository(git: GitApi): Promise<Repository | undefined> {
  if (git.repositories.length === 0) {
    throw new Error('No Git repositories are open in this workspace.');
  }

  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorUri) {
    const activeRepository = git.getRepository(activeEditorUri);
    if (activeRepository) {
      return activeRepository;
    }
  }

  const selectedRepository = git.repositories.find(repository => repository.ui.selected);
  if (selectedRepository) {
    return selectedRepository;
  }

  if (git.repositories.length === 1) {
    return git.repositories[0];
  }

  const items = git.repositories.map(repository => ({
    label: path.basename(repository.rootUri.fsPath),
    description: repository.rootUri.fsPath,
    repository
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Select Git Repository',
    placeHolder: 'Choose which repository to generate a commit message for'
  });

  return picked?.repository;
}

export async function buildDiffContext(repository: Repository, settings: ExtensionSettings): Promise<DiffContext> {
  const hasStagedChanges = repository.state.indexChanges.length > 0;
  const hasWorkingTreeChanges = repository.state.workingTreeChanges.length > 0 || repository.state.untrackedChanges.length > 0;

  if (!hasStagedChanges && !hasWorkingTreeChanges) {
    throw new Error('No staged or unstaged changes found.');
  }

  if (settings.preferStaged && hasStagedChanges) {
    const rawDiff = await repository.diffIndexWithHEAD();
    const clipped = clipDiff(rawDiff, settings.maxDiffChars);

    return {
      repository,
      diff: clipped.diff,
      source: 'staged',
      truncated: clipped.truncated
    };
  }

  const trackedDiff = hasWorkingTreeChanges ? await repository.diffWithHEAD() : '';
  const untrackedDiff = await buildUntrackedDiff(repository, settings.maxDiffChars);
  const rawDiff = [trackedDiff, untrackedDiff].filter(Boolean).join('\n\n');
  const clipped = clipDiff(rawDiff, settings.maxDiffChars);

  if (!clipped.diff.trim()) {
    throw new Error('No text changes found to describe.');
  }

  return {
    repository,
    diff: clipped.diff,
    source: 'unstaged',
    truncated: clipped.truncated
  };
}

function clipDiff(diff: string, maxChars: number): { diff: string; truncated: boolean } {
  if (diff.length <= maxChars) {
    return { diff, truncated: false };
  }

  return {
    diff: `${diff.slice(0, maxChars)}\n\n[Diff truncated because it exceeded ${maxChars} characters.]`,
    truncated: true
  };
}

async function buildUntrackedDiff(repository: Repository, maxChars: number): Promise<string> {
  const chunks: string[] = [];
  let remainingChars = Math.max(1000, maxChars);

  for (const change of repository.state.untrackedChanges) {
    if (remainingChars <= 0) {
      chunks.push('[Additional untracked files omitted because the diff is too large.]');
      break;
    }

    const relativePath = toRelativePath(repository.rootUri, change.uri);
    const chunk = await readUntrackedFileAsPatch(change.uri, relativePath, remainingChars);
    chunks.push(chunk);
    remainingChars -= chunk.length;
  }

  return chunks.join('\n\n');
}

async function readUntrackedFileAsPatch(uri: vscode.Uri, relativePath: string, maxChars: number): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);

    if (looksBinary(bytes)) {
      return `Untracked binary file: ${relativePath}`;
    }

    const text = new TextDecoder('utf-8').decode(bytes);
    const lines = text.split(/\r?\n/).map(line => `+${line}`).join('\n');
    const patch = [
      `diff --git a/${relativePath} b/${relativePath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${relativePath}`,
      '@@',
      lines
    ].join('\n');

    return patch.length > maxChars
      ? `${patch.slice(0, maxChars)}\n[Untracked file truncated.]`
      : patch;
  } catch (error) {
    return `Untracked file: ${relativePath}\n[Could not read file: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function toRelativePath(rootUri: vscode.Uri, uri: vscode.Uri): string {
  return path.relative(rootUri.fsPath, uri.fsPath).replace(/\\/g, '/');
}

function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, Math.min(bytes.length, 8000));
  return sample.includes(0);
}
