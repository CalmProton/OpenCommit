import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  assertCleanIndex,
  buildWorkingTreeDiffContext,
  ChangedFile,
  getGitApi,
  getPendingChangedFiles,
  getWorkingTreeFingerprint,
  gitAddPaths,
  gitCommitWithMessage,
  pickRepository,
  Repository
} from './git';
import { createLogger, Logger } from './logger';
import { createOpenRouterCommitMessage, OpenRouterResponseError } from './openrouter';
import {
  buildPlannedCommitMessageMessages,
  buildPlanMessages,
  buildPlanRepairMessages,
  parsePlannedCommits,
  sanitizeCommitMessage
} from './prompt';
import { ExtensionSettings, getSettings } from './settings';

const TREE_ID = 'opencommit.plannedCommits';
const FILE_TRANSFER_MIME = 'application/vnd.opencommit.planned-commit-files';
const PLAN_REPAIR_ATTEMPTS = 2;

interface PlannedCommitGroup {
  id: string;
  message: string;
  files: string[];
  messageStale: boolean;
}

interface PlannedCommitPlan {
  repository: Repository;
  repositoryRoot: string;
  fingerprint: string;
  diffContext: Awaited<ReturnType<typeof buildWorkingTreeDiffContext>>;
  files: ChangedFile[];
  commits: PlannedCommitGroup[];
}

interface PlanValidationIssues {
  unknown: string[];
  duplicate: string[];
  missing: string[];
}

interface PlanValidationResult {
  valid: boolean;
  issues: PlanValidationIssues;
  message: string;
}

type PlanChangedFile = { path: string; status: string };

type PlanItem = CommitTreeItem | FileTreeItem;

let nextGroupId = 1;

export function registerPlannedCommits(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  ensureApiKey: () => Promise<string | undefined>
): void {
  const controller = new PlannedCommitsController(context, output, ensureApiKey);

  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand('opencommit.planCommits', () => controller.planCommits()),
    vscode.commands.registerCommand('opencommit.commitPlannedCommits', () => controller.commitPlannedCommits()),
    vscode.commands.registerCommand('opencommit.regeneratePlan', () => controller.regeneratePlan()),
    vscode.commands.registerCommand('opencommit.editPlannedCommitMessage', (item?: PlanItem) => controller.editCommitMessage(item)),
    vscode.commands.registerCommand('opencommit.regeneratePlannedCommitMessage', (item?: PlanItem) => controller.regenerateCommitMessage(item)),
    vscode.commands.registerCommand('opencommit.movePlannedCommitFile', (item?: PlanItem) => controller.moveFile(item)),
    vscode.commands.registerCommand('opencommit.addPlannedCommit', () => controller.addCommit()),
    vscode.commands.registerCommand('opencommit.removePlannedCommit', (item?: PlanItem) => controller.removeCommit(item))
  );
}

class PlannedCommitsController implements
  vscode.TreeDataProvider<PlanItem>,
  vscode.TreeDragAndDropController<PlanItem>,
  vscode.Disposable {
  readonly dragMimeTypes = [FILE_TRANSFER_MIME];
  readonly dropMimeTypes = [FILE_TRANSFER_MIME];

  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<PlanItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly tree: vscode.TreeView<PlanItem>;
  private planRepositoryChangeDisposable: vscode.Disposable | undefined;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private syncInProgress = false;
  private syncQueued = false;
  private suppressPlanSync = false;
  private plan: PlannedCommitPlan | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly ensureApiKey: () => Promise<string | undefined>
  ) {
    this.tree = vscode.window.createTreeView(TREE_ID, {
      treeDataProvider: this,
      dragAndDropController: this,
      showCollapseAll: true
    });
  }

  dispose(): void {
    this.planRepositoryChangeDisposable?.dispose();
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    this.tree.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  getTreeItem(element: PlanItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PlanItem): vscode.ProviderResult<PlanItem[]> {
    if (!this.plan) {
      return [];
    }

    if (!element) {
      return this.plan.commits.map(commit => new CommitTreeItem(commit));
    }

    if (element instanceof CommitTreeItem) {
      const commit = this.findCommit(element.groupId);
      if (!commit) {
        return [];
      }

      return commit.files.map(filePath => {
        const file = this.findFile(filePath);
        return new FileTreeItem(commit.id, filePath, file?.status ?? 'CHANGED', this.plan?.repository.rootUri);
      });
    }

    return [];
  }

  async handleDrag(source: readonly PlanItem[], dataTransfer: vscode.DataTransfer): Promise<void> {
    const paths = source
      .filter((item): item is FileTreeItem => item instanceof FileTreeItem)
      .map(item => item.filePath);

    if (paths.length > 0) {
      dataTransfer.set(FILE_TRANSFER_MIME, new vscode.DataTransferItem(JSON.stringify(paths)));
    }
  }

  async handleDrop(target: PlanItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    if (!this.plan || !target) {
      return;
    }

    const targetCommit = target instanceof CommitTreeItem
      ? this.findCommit(target.groupId)
      : target instanceof FileTreeItem
        ? this.findCommit(target.groupId)
        : undefined;

    if (!targetCommit) {
      return;
    }

    const transfer = dataTransfer.get(FILE_TRANSFER_MIME);
    const raw = await transfer?.asString();
    const paths = parseStringArray(raw);

    if (paths.length === 0) {
      return;
    }

    this.moveFilesToCommit(paths, targetCommit.id);
  }

  async planCommits(): Promise<void> {
    await this.runWithErrors(async () => {
      const apiKey = await this.ensureApiKey();

      if (!apiKey) {
        return;
      }

      const git = await getGitApi();
      const repository = await pickRepository(git);

      if (!repository) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Planning commits',
          cancellable: true
        },
        async (_progress, token) => {
          const abortController = new AbortController();
          const cancellation = token.onCancellationRequested(() => abortController.abort());

          try {
            const settings = getSettings(repository.rootUri);
            const planSettings = {
              ...settings,
              maxOutputTokens: settings.maxPlanOutputTokens
            };
            const logger = createLogger(this.output);
            const diffContext = await buildWorkingTreeDiffContext(repository, planSettings);
            const fingerprint = await getWorkingTreeFingerprint(repository);
            const files = diffContext.files.map(file => ({
              path: file.path,
              status: file.status,
              uri: vscode.Uri.file(path.join(repository.rootUri.fsPath, file.path))
            }));
            const messages = buildPlanMessages({
              diff: diffContext.diff,
              source: diffContext.source,
              files: diffContext.files,
              allFiles: diffContext.files,
              budget: diffContext.budget,
              truncated: diffContext.truncated,
              settings: planSettings
            });

            logger.section('Multi-commit planning started');
            logger.line(`Extension version: ${this.context.extension.packageJSON.version}`);
            logger.json('Planning summary', {
              provider: settings.provider,
              model: settings.openRouter.model,
              repository: repository.rootUri.fsPath,
              files: diffContext.files,
              diffChars: diffContext.diff.length,
              truncated: diffContext.truncated,
              maxPlanOutputTokens: settings.maxPlanOutputTokens
            });

            if (settings.debugLogging) {
              logger.text('Diff sent to OpenRouter', diffContext.diff);
              logger.json('Messages sent to OpenRouter', messages);
            }

            const result = await createOpenRouterCommitMessage(apiKey, messages, planSettings, abortController.signal);
            const parsed = parsePlannedCommits(result.text);

            if (settings.debugLogging) {
              logger.json('OpenRouter request', result.request);
              logger.json('OpenRouter response summary', result.response.choiceSummary);
              logger.text('OpenRouter raw response body', result.response.bodyText);
              logger.text('Extracted model text', result.text);
            } else {
              logger.json('OpenRouter response summary', result.response.choiceSummary);
            }

            const expectedFiles = diffContext.files.map(file => file.path);
            const commits = await buildValidatedPlan({
              apiKey,
              settings: planSettings,
              allFiles: diffContext.files,
              initialPlanText: result.text,
              initialParsedPlan: parsed,
              expectedFiles,
              logger,
              debugLogging: settings.debugLogging,
              signal: abortController.signal
            });
            this.plan = {
              repository,
              repositoryRoot: repository.rootUri.fsPath,
              fingerprint,
              diffContext,
              files,
              commits
            };
            this.watchPlanRepository(repository);
            this.refresh();
            vscode.window.showInformationMessage(`Planned ${commits.length} commit${commits.length === 1 ? '' : 's'}.`);
          } finally {
            cancellation.dispose();
          }
        }
      );
    });
  }

  async regeneratePlan(): Promise<void> {
    const hadPlan = Boolean(this.plan);

    if (hadPlan) {
      await this.runWithErrors(async () => {
        await this.reconcilePlanWithPendingChanges();

        if (!this.plan) {
          vscode.window.showInformationMessage('Commit plan cleared because its files no longer have pending changes.');
        }
      });

      if (!this.plan) {
        return;
      }
    }

    await this.planCommits();
  }

  async commitPlannedCommits(): Promise<void> {
    await this.runWithErrors(async () => {
      await this.reconcilePlanWithPendingChanges();

      if (!this.plan) {
        throw new Error('No commit plan to commit.');
      }

      const plan = this.plan;
      const emptyCommit = plan.commits.find(commit => commit.files.length === 0);

      if (emptyCommit) {
        throw new Error(`Planned commit "${firstLine(emptyCommit.message)}" has no files.`);
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Committing plan',
          cancellable: false
        },
        async progress => {
          await assertCleanIndex(plan.repository);
          const fingerprint = await getWorkingTreeFingerprint(plan.repository);

          if (fingerprint !== plan.fingerprint) {
            throw new Error('Working tree changed after the plan was generated. Regenerate the plan before committing.');
          }

          const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencommit-'));

          try {
            this.suppressPlanSync = true;
            for (let index = 0; index < plan.commits.length; index += 1) {
              const commit = plan.commits[index];
              const message = sanitizeCommitMessage(commit.message);

              if (!message.trim()) {
                throw new Error(`Planned commit ${index + 1} has an empty message.`);
              }

              progress.report({
                message: `${index + 1}/${plan.commits.length}: ${firstLine(message)}`
              });

              const messagePath = path.join(tempDir, `message-${index + 1}.txt`);
              await fs.writeFile(messagePath, `${message.trim()}\n`, 'utf8');
              await gitAddPaths(plan.repository, commit.files);
              await gitCommitWithMessage(plan.repository, messagePath);
            }
          } catch (error) {
            throw new Error(
              `Failed while committing the plan. Earlier commits may already exist. ${error instanceof Error ? error.message : String(error)}`
            );
          } finally {
            this.suppressPlanSync = false;
            await fs.rm(tempDir, { recursive: true, force: true });
          }
        }
      );

      const count = plan.commits.length;
      this.clearPlan();
      vscode.window.showInformationMessage(`Created ${count} commit${count === 1 ? '' : 's'} from the plan.`);
    });
  }

  async editCommitMessage(item?: PlanItem): Promise<void> {
    await this.runWithErrors(async () => {
      const commit = await this.pickCommit(item, 'Select commit group to edit');

      if (!commit) {
        return;
      }

      const value = await vscode.window.showInputBox({
        title: 'Edit Commit Message',
        prompt: 'Enter the commit message for this commit group.',
        value: commit.message,
        ignoreFocusOut: true,
        validateInput: text => text.trim() ? undefined : 'Commit message is required.'
      });

      if (value === undefined) {
        return;
      }

      commit.message = sanitizeCommitMessage(value);
      commit.messageStale = false;
      this.refresh();
    });
  }

  async regenerateCommitMessage(item?: PlanItem): Promise<void> {
    await this.runWithErrors(async () => {
      await this.reconcilePlanWithPendingChanges();

      if (!this.plan) {
        throw new Error('No commit plan to regenerate.');
      }

      const commit = await this.pickCommit(item, 'Select commit group to regenerate');

      if (!commit) {
        return;
      }

      if (commit.files.length === 0) {
        throw new Error(`Planned commit "${firstLine(commit.message)}" has no files to describe.`);
      }

      const apiKey = await this.ensureApiKey();

      if (!apiKey) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Regenerating commit message',
          cancellable: true
        },
        async (_progress, token) => {
          const abortController = new AbortController();
          const cancellation = token.onCancellationRequested(() => abortController.abort());

          try {
            const settings = getSettings(this.plan!.repository.rootUri);
            const logger = createLogger(this.output);
            const messages = buildPlannedCommitMessageMessages({
              diff: this.plan!.diffContext.diff,
              source: this.plan!.diffContext.source,
              files: this.plan!.diffContext.files,
              selectedFiles: commit.files,
              budget: this.plan!.diffContext.budget,
              truncated: this.plan!.diffContext.truncated,
              settings
            });
            const result = await createOpenRouterCommitMessage(apiKey, messages, settings, abortController.signal);
            const message = sanitizeCommitMessage(result.text);

            if (!message.trim()) {
              throw new Error('Generated commit message was empty after cleanup.');
            }

            logger.section('Planned commit message regenerated');
            logger.json('Selected files', commit.files);
            logger.text('Commit message after cleanup', message);

            commit.message = message;
            commit.messageStale = false;
            this.refresh();
          } finally {
            cancellation.dispose();
          }
        }
      );
    });
  }

  async moveFile(item?: PlanItem): Promise<void> {
    await this.runWithErrors(async () => {
      await this.reconcilePlanWithPendingChanges();

      if (!this.plan) {
        throw new Error('No commit plan to edit.');
      }

      const fileItem = item instanceof FileTreeItem ? item : await this.pickFile();

      if (!fileItem) {
        return;
      }

      const choices = this.plan.commits
        .filter(commit => commit.id !== fileItem.groupId)
        .map(commit => ({
          label: firstLine(commit.message),
          description: `${commit.files.length} file${commit.files.length === 1 ? '' : 's'}`,
          commit
        }));

      if (choices.length === 0) {
        throw new Error('Add another commit group before moving files.');
      }

      const picked = await vscode.window.showQuickPick(choices, {
        title: 'Move File to Commit',
        placeHolder: fileItem.filePath
      });

      if (!picked) {
        return;
      }

      this.moveFilesToCommit([fileItem.filePath], picked.commit.id);
    });
  }

  async addCommit(): Promise<void> {
    await this.runWithErrors(async () => {
      await this.reconcilePlanWithPendingChanges();

      if (!this.plan) {
        throw new Error('Generate a plan before adding a commit group.');
      }

      const message = await vscode.window.showInputBox({
        title: 'Add Commit Group',
        prompt: 'Enter a commit message. Move files into this group afterward.',
        value: 'chore: update related changes',
        ignoreFocusOut: true,
        validateInput: text => text.trim() ? undefined : 'Commit message is required.'
      });

      if (message === undefined) {
        return;
      }

      this.plan.commits.push({
        id: createGroupId(),
        message: sanitizeCommitMessage(message),
        files: [],
        messageStale: false
      });
      this.refresh();
    });
  }

  async removeCommit(item?: PlanItem): Promise<void> {
    await this.runWithErrors(async () => {
      if (!this.plan) {
        throw new Error('No commit plan to remove from.');
      }

      const commit = await this.pickCommit(item, 'Select commit group to remove');

      if (!commit) {
        return;
      }

      if (this.plan.commits.length === 1) {
        this.clearPlan();
        return;
      }

      const target = this.plan.commits.find(candidate => candidate.id !== commit.id);

      if (target && commit.files.length > 0) {
        target.files.push(...commit.files);
        target.files = unique(target.files);
        target.messageStale = true;
      }

      this.plan.commits = this.plan.commits.filter(candidate => candidate.id !== commit.id);
      this.refresh();
    });
  }

  private refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  private clearPlan(): void {
    this.plan = undefined;
    this.planRepositoryChangeDisposable?.dispose();
    this.planRepositoryChangeDisposable = undefined;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }
    this.refresh();
  }

  private watchPlanRepository(repository: Repository): void {
    this.planRepositoryChangeDisposable?.dispose();
    this.planRepositoryChangeDisposable = repository.state.onDidChange?.(() => this.schedulePlanSync());
  }

  private schedulePlanSync(): void {
    if (this.suppressPlanSync) {
      return;
    }

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }

    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined;
      void this.syncPlanWithPendingChanges();
    }, 300);
  }

  private async syncPlanWithPendingChanges(): Promise<void> {
    try {
      await this.reconcilePlanWithPendingChanges();
    } catch (error) {
      createLogger(this.output).error(error);
    }
  }

  private async reconcilePlanWithPendingChanges(): Promise<void> {
    if (!this.plan || this.suppressPlanSync) {
      return;
    }

    if (this.syncInProgress) {
      this.syncQueued = true;
      return;
    }

    this.syncInProgress = true;

    try {
      do {
        this.syncQueued = false;
        await this.applyPendingChangesToPlan();
      } while (this.syncQueued);
    } finally {
      this.syncInProgress = false;
    }
  }

  private async applyPendingChangesToPlan(): Promise<void> {
    const plan = this.plan;

    if (!plan) {
      return;
    }

    const pendingFiles = await getPendingChangedFiles(plan.repository);
    const pendingByPath = new Map(pendingFiles.map(file => [file.path, file]));
    let changed = false;

    const plannedPaths = new Set(plan.commits.flatMap(commit => commit.files));
    plan.files = pendingFiles.filter(file => plannedPaths.has(file.path));

    for (const commit of plan.commits) {
      const previousLength = commit.files.length;
      commit.files = commit.files.filter(filePath => pendingByPath.has(filePath));

      if (commit.files.length !== previousLength) {
        commit.messageStale = commit.files.length > 0;
        changed = true;
      }
    }

    const previousCommitCount = plan.commits.length;
    plan.commits = plan.commits.filter(commit => commit.files.length > 0);

    if (plan.commits.length !== previousCommitCount) {
      changed = true;
    }

    if (plan.commits.length === 0) {
      this.clearPlan();
      return;
    }

    const fingerprint = await getWorkingTreeFingerprint(plan.repository);
    if (fingerprint !== plan.fingerprint) {
      plan.fingerprint = fingerprint;
      changed = true;
    }

    if (pendingFiles.length > 0) {
      try {
        const settings = getSettings(plan.repository.rootUri);
        const diffContext = await buildWorkingTreeDiffContext(plan.repository, settings);
        const fileStatusByPath = new Map(diffContext.files.map(file => [file.path, file.status]));
        plan.diffContext = diffContext;
        plan.files = plan.files.map(file => ({
          ...file,
          status: fileStatusByPath.get(file.path) ?? file.status
        }));
      } catch {
        // Keep the file-level reconciliation when the index is temporarily staged
        // during a manual commit or the remaining pending changes are staged only.
      }
    }

    if (changed) {
      this.refresh();
    }
  }

  private findCommit(id: string): PlannedCommitGroup | undefined {
    return this.plan?.commits.find(commit => commit.id === id);
  }

  private findFile(filePath: string): ChangedFile | undefined {
    return this.plan?.files.find(file => file.path === filePath);
  }

  private moveFilesToCommit(paths: readonly string[], targetCommitId: string): void {
    if (!this.plan) {
      return;
    }

    const target = this.findCommit(targetCommitId);

    if (!target) {
      return;
    }

    const movablePaths = paths.filter(filePath => this.findFile(filePath) && !target.files.includes(filePath));

    if (movablePaths.length === 0) {
      return;
    }

    for (const commit of this.plan.commits) {
      const previousLength = commit.files.length;
      commit.files = commit.files.filter(filePath => !movablePaths.includes(filePath));

      if (commit.files.length !== previousLength) {
        commit.messageStale = true;
      }
    }

    target.files = unique([...target.files, ...movablePaths]);
    target.messageStale = true;
    this.refresh();
  }

  private async pickCommit(item: PlanItem | undefined, title: string): Promise<PlannedCommitGroup | undefined> {
    if (!this.plan) {
      return undefined;
    }

    const groupId = item instanceof CommitTreeItem || item instanceof FileTreeItem ? item.groupId : undefined;
    const commit = groupId ? this.findCommit(groupId) : undefined;

    if (commit) {
      return commit;
    }

    const picked = await vscode.window.showQuickPick(
      this.plan.commits.map(candidate => ({
        label: firstLine(candidate.message),
        description: `${candidate.files.length} file${candidate.files.length === 1 ? '' : 's'}`,
        commit: candidate
      })),
      { title }
    );

    return picked?.commit;
  }

  private async pickFile(): Promise<FileTreeItem | undefined> {
    if (!this.plan) {
      return undefined;
    }

    const items = this.plan.commits.flatMap(commit =>
      commit.files.map(filePath => ({
        label: filePath,
        description: firstLine(commit.message),
        item: new FileTreeItem(commit.id, filePath, this.findFile(filePath)?.status ?? 'CHANGED', this.plan?.repository.rootUri)
      }))
    );
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Select Commit Planner File'
    });

    return picked?.item;
  }

  private async runWithErrors(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const logger = createLogger(this.output);

      if (error instanceof OpenRouterResponseError) {
        logger.section('OpenRouter failure diagnostics');
        logger.json('OpenRouter request', error.request);
        logger.json('OpenRouter response summary', error.response.choiceSummary);
        logger.text('OpenRouter raw response body', error.response.bodyText);
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error(error);
      vscode.window.showErrorMessage(`OpenCommit: ${message}`);
    }
  }
}

class CommitTreeItem extends vscode.TreeItem {
  constructor(readonly commit: PlannedCommitGroup) {
    super(firstLine(commit.message), vscode.TreeItemCollapsibleState.Expanded);

    this.groupId = commit.id;
    this.contextValue = 'opencommit.commit';
    this.description = [
      `${commit.files.length} file${commit.files.length === 1 ? '' : 's'}`,
      commit.messageStale ? 'message needs regeneration' : ''
    ].filter(Boolean).join(' - ');
    this.tooltip = commit.message;
    this.iconPath = new vscode.ThemeIcon(commit.messageStale ? 'warning' : 'git-commit');
  }

  readonly groupId: string;
}

class FileTreeItem extends vscode.TreeItem {
  constructor(
    readonly groupId: string,
    readonly filePath: string,
    status: string,
    repositoryRoot?: vscode.Uri
  ) {
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);

    this.contextValue = 'opencommit.file';
    this.description = path.dirname(filePath) === '.' ? statusLabel(status) : `${path.dirname(filePath)} - ${statusLabel(status)}`;
    this.tooltip = `${filePath}\n${statusLabel(status)}`;
    this.iconPath = new vscode.ThemeIcon(iconForStatus(status));
    this.resourceUri = repositoryRoot ? vscode.Uri.file(path.join(repositoryRoot.fsPath, filePath)) : undefined;
    this.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [this.resourceUri]
    };
  }
}

async function buildValidatedPlan(input: {
  apiKey: string;
  settings: ExtensionSettings;
  allFiles: readonly PlanChangedFile[];
  initialPlanText: string;
  initialParsedPlan: Array<{ message: string; files: string[] }> | undefined;
  expectedFiles: readonly string[];
  logger: Logger;
  debugLogging: boolean;
  signal: AbortSignal;
}): Promise<PlannedCommitGroup[]> {
  let planText = input.initialPlanText;
  let parsedPlan = input.initialParsedPlan;
  let validation = analyzePlan(parsedPlan, input.expectedFiles);

  if (validation.valid && parsedPlan) {
    return toPlannedCommitGroups(parsedPlan);
  }

  input.logger.section('Commit plan validation failed');
  input.logger.json('Validation summary', summarizeValidation(validation));

  for (let attempt = 1; attempt <= PLAN_REPAIR_ATTEMPTS; attempt += 1) {
    const repaired = await requestPlanRepair({
      apiKey: input.apiKey,
      settings: input.settings,
      allFiles: input.allFiles,
      planText,
      parsedPlan,
      validation,
      logger: input.logger,
      debugLogging: input.debugLogging,
      signal: input.signal,
      attempt
    });

    if (!repaired) {
      break;
    }

    planText = repaired.text;
    parsedPlan = parsePlannedCommits(repaired.text);
    validation = analyzePlan(parsedPlan, input.expectedFiles);

    if (validation.valid && parsedPlan) {
      input.logger.line(`Commit plan repair attempt ${attempt} produced a valid plan.`);
      return toPlannedCommitGroups(parsedPlan);
    }

    input.logger.json(`Commit plan repair attempt ${attempt} still invalid`, summarizeValidation(validation));
  }

  input.logger.section('Commit plan repaired locally');
  input.logger.json('Final validation issue before local repair', summarizeValidation(validation));
  return completePlanLocally(parsedPlan, input.expectedFiles);
}

async function requestPlanRepair(input: {
  apiKey: string;
  settings: ExtensionSettings;
  allFiles: readonly PlanChangedFile[];
  planText: string;
  parsedPlan: Array<{ message: string; files: string[] }> | undefined;
  validation: PlanValidationResult;
  logger: Logger;
  debugLogging: boolean;
  signal: AbortSignal;
  attempt: number;
}): Promise<{ text: string } | undefined> {
  const messages = buildPlanRepairMessages({
    allFiles: input.allFiles,
    invalidPlanText: input.planText,
    parsedPlan: input.parsedPlan,
    missingFiles: input.validation.issues.missing,
    unknownFiles: input.validation.issues.unknown,
    duplicateFiles: input.validation.issues.duplicate,
    settings: input.settings
  });

  input.logger.section(`Commit plan repair attempt ${input.attempt}`);
  if (input.debugLogging) {
    input.logger.json('Repair messages sent to OpenRouter', messages);
  }

  try {
    const result = await createOpenRouterCommitMessage(input.apiKey, messages, input.settings, input.signal);

    if (input.debugLogging) {
      input.logger.json('OpenRouter repair request', result.request);
      input.logger.json('OpenRouter repair response summary', result.response.choiceSummary);
      input.logger.text('OpenRouter repair raw response body', result.response.bodyText);
      input.logger.text('Extracted repair model text', result.text);
    } else {
      input.logger.json('OpenRouter repair response summary', result.response.choiceSummary);
    }

    return { text: result.text };
  } catch (error) {
    if (input.signal.aborted) {
      throw error;
    }

    input.logger.error(error);

    if (error instanceof OpenRouterResponseError) {
      input.logger.section('OpenRouter repair failure diagnostics');
      input.logger.json('OpenRouter repair request', error.request);
      input.logger.json('OpenRouter repair response summary', error.response.choiceSummary);
      input.logger.text('OpenRouter repair raw response body', error.response.bodyText);
    }

    return undefined;
  }
}

function analyzePlan(
  parsed: Array<{ message: string; files: string[] }> | undefined,
  expectedFiles: readonly string[]
): PlanValidationResult {
  const issues: PlanValidationIssues = {
    unknown: [],
    duplicate: [],
    missing: []
  };

  if (!parsed || parsed.length === 0) {
    return {
      valid: false,
      issues: {
        ...issues,
        missing: [...expectedFiles]
      },
      message: 'OpenRouter did not return a valid commit plan JSON object.'
    };
  }

  const expected = new Set(expectedFiles);
  const seen = new Set<string>();

  for (const commit of parsed) {
    for (const filePath of commit.files) {
      if (!expected.has(filePath)) {
        issues.unknown.push(filePath);
        continue;
      }

      if (seen.has(filePath)) {
        issues.duplicate.push(filePath);
        continue;
      }

      seen.add(filePath);
    }
  }

  issues.missing = expectedFiles.filter(filePath => !seen.has(filePath));

  const valid = issues.unknown.length === 0 && issues.duplicate.length === 0 && issues.missing.length === 0;

  return {
    valid,
    issues,
    message: valid
      ? 'Commit plan is valid.'
      : [
        'OpenRouter returned an invalid commit plan.',
        issues.unknown.length > 0 ? `Unknown files: ${issues.unknown.length}` : '',
        issues.duplicate.length > 0 ? `Duplicate files: ${issues.duplicate.length}` : '',
        issues.missing.length > 0 ? `Missing files: ${issues.missing.length}` : ''
      ].filter(Boolean).join(' ')
  };
}

function completePlanLocally(
  parsed: Array<{ message: string; files: string[] }> | undefined,
  expectedFiles: readonly string[]
): PlannedCommitGroup[] {
  const expected = new Set(expectedFiles);
  const seen = new Set<string>();
  const commits: PlannedCommitGroup[] = [];

  for (const commit of parsed ?? []) {
    const files = commit.files.filter(filePath => {
      if (!expected.has(filePath) || seen.has(filePath)) {
        return false;
      }

      seen.add(filePath);
      return true;
    });

    if (files.length > 0) {
      commits.push({
        id: createGroupId(),
        message: commit.message,
        files,
        messageStale: false
      });
    }
  }

  const unassigned: string[] = [];
  for (const filePath of expectedFiles) {
    if (!seen.has(filePath) && !assignToRelatedCommit(filePath, commits)) {
      unassigned.push(filePath);
    }
  }

  if (unassigned.length > 0) {
    commits.push({
      id: createGroupId(),
      message: 'chore: update remaining changed files',
      files: unassigned,
      messageStale: true
    });
  }

  return commits.length > 0
    ? commits
    : [{
      id: createGroupId(),
      message: 'chore: update changed files',
      files: [...expectedFiles],
      messageStale: true
    }];
}

function assignToRelatedCommit(filePath: string, commits: PlannedCommitGroup[]): boolean {
  let bestCommit: PlannedCommitGroup | undefined;
  let bestScore = 0;

  for (const commit of commits) {
    for (const existingFile of commit.files) {
      const score = commonPathPrefixLength(filePath, existingFile);

      if (score > bestScore) {
        bestScore = score;
        bestCommit = commit;
      }
    }
  }

  if (!bestCommit || bestScore < 3) {
    return false;
  }

  bestCommit.files.push(filePath);
  bestCommit.messageStale = true;
  return true;
}

function commonPathPrefixLength(left: string, right: string): number {
  const leftParts = left.split(/[\\/]/);
  const rightParts = right.split(/[\\/]/);
  const maxParts = Math.min(leftParts.length, rightParts.length);
  let score = 0;

  for (let index = 0; index < maxParts; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      break;
    }

    score += 1;
  }

  return score;
}

function toPlannedCommitGroups(parsed: Array<{ message: string; files: string[] }>): PlannedCommitGroup[] {
  return parsed.map(commit => ({
    id: createGroupId(),
    message: commit.message,
    files: commit.files,
    messageStale: false
  }));
}

function summarizeValidation(validation: PlanValidationResult): Record<string, unknown> {
  return {
    valid: validation.valid,
    message: validation.message,
    unknownCount: validation.issues.unknown.length,
    duplicateCount: validation.issues.duplicate.length,
    missingCount: validation.issues.missing.length,
    unknownFiles: truncateList(validation.issues.unknown),
    duplicateFiles: truncateList(validation.issues.duplicate),
    missingFiles: truncateList(validation.issues.missing)
  };
}

function truncateList(values: readonly string[], limit = 25): string[] {
  if (values.length <= limit) {
    return [...values];
  }

  return [
    ...values.slice(0, limit),
    `... ${values.length - limit} more`
  ];
}

function parseStringArray(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value: unknown): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function createGroupId(): string {
  const id = `commit-${nextGroupId}`;
  nextGroupId += 1;
  return id;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim() || 'Untitled commit group';
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function statusLabel(status: string): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

function iconForStatus(status: string): string {
  switch (status) {
    case 'UNTRACKED':
      return 'diff-added';
    case 'DELETED':
      return 'diff-removed';
    case 'TYPE_CHANGED':
      return 'diff-renamed';
    case 'MODIFIED':
    default:
      return 'diff-modified';
  }
}
