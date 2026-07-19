import * as vscode from 'vscode';
import { CodexModelProvider } from './provider.js';
import { classifyCredentialTarget, clearApiKey, setApiKey } from './secrets.js';
import { getConfigurationSection, getProviderConfig } from './config.js';
import { UsageStatusBar } from './usageStatus.js';
import { loadAgentProfiles } from './agentProfiles.js';
import { collectContextSnapshot, formatContextSnapshot, getPrimaryWorkspaceFolder } from './contextCollector.js';
import { clearActiveSkillIds, discoverSkills, getActiveSkillIds, setActiveSkillIds } from './skills.js';
import { buildReadOnlyCliCommand, toShellCommand } from './cliBridge.js';
import { buildReviewCliCommand, describeReviewRequest, type ReviewRequest } from './review.js';
import { EXTENSION_DISPLAY_NAME } from './branding.js';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(EXTENSION_DISPLAY_NAME, { log: true });
  const initialConfig = getProviderConfig();
  const usageStatusBar = new UsageStatusBar(context, {
    showInStatusBar: initialConfig.showUsageInStatusBar,
    modelPricingUsdPerMTok: initialConfig.modelPricingUsdPerMTok
  }, (diagnostic) => outputChannel.warn('Invalid model pricing configuration', diagnostic));
  const provider = new CodexModelProvider(context, outputChannel, usageStatusBar);

  context.subscriptions.push(
    outputChannel,
    usageStatusBar,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(`${getConfigurationSection()}.showUsageInStatusBar`)
          && !event.affectsConfiguration(`${getConfigurationSection()}.modelPricingUsdPerMTok`)) {
        return;
      }
      const config = getProviderConfig();
      usageStatusBar.updateConfiguration({
        showInStatusBar: config.showUsageInStatusBar,
        modelPricingUsdPerMTok: config.modelPricingUsdPerMTok
      });
    }),
    vscode.lm.registerLanguageModelChatProvider('pionus-codex', provider),
    vscode.commands.registerCommand('pionus.codex.openDebugLogs', () => outputChannel.show(true)),
    vscode.commands.registerCommand('pionus.codex.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', getConfigurationSection())),
    vscode.commands.registerCommand('pionus.codex.setApiKey', async () => {
      const config = getProviderConfig();
      const target = classifyCredentialTarget(config.baseURL);
      if (target.kind === 'custom') {
        const confirmation = await vscode.window.showWarningMessage(
          `Store a separate API key for custom endpoint ${target.baseURL}? Codex and OpenAI credentials will never be sent to this endpoint.`,
          { modal: true },
          'Store API Key'
        );
        if (confirmation !== 'Store API Key') {
          return;
        }
      }
      const apiKey = await vscode.window.showInputBox({ title: `Set ${target.label} API Key`, prompt: `Enter the API key for ${target.baseURL}`, password: true, ignoreFocusOut: true });
      if (apiKey?.trim()) {
        await setApiKey(context, config.baseURL, apiKey.trim());
        provider.refreshModels();
        await vscode.window.showInformationMessage(`${target.label} API key saved.`);
      }
    }),
    vscode.commands.registerCommand('pionus.codex.clearApiKey', async () => {
      const config = getProviderConfig();
      const target = await clearApiKey(context, config.baseURL);
      provider.refreshModels();
      await vscode.window.showInformationMessage(`${target.label} API key cleared.`);
    }),
    vscode.commands.registerCommand('pionus.codex.selectAgentProfile', async () => selectAgentProfile(outputChannel)),
    vscode.commands.registerCommand('pionus.codex.resetAgentProfile', () => setActiveAgentProfile(null)),
    vscode.commands.registerCommand('pionus.codex.copyContextSnapshot', copyContextSnapshot),
    vscode.commands.registerCommand('pionus.codex.selectSkills', async () => selectSkills(context, outputChannel)),
    vscode.commands.registerCommand('pionus.codex.clearSkills', async () => {
      await clearActiveSkillIds(context);
      await vscode.window.showInformationMessage(`${EXTENSION_DISPLAY_NAME}: skills cleared.`);
    }),
    vscode.commands.registerCommand('pionus.codex.runCliExec', runCliExec),
    vscode.commands.registerCommand('pionus.codex.runCliReview', runCliReview),
    vscode.commands.registerCommand('pionus.codex.showStatus', () => provider.showStatus()),
    vscode.commands.registerCommand('pionus.codex.showLastUsage', () => usageStatusBar.showLastUsage()),
    vscode.commands.registerCommand('pionus.codex.manage', async () => {
      const action = await vscode.window.showQuickPick([
        'Show Status',
        'View Last Usage',
        'Select Agent Profile',
        'Reset Agent Profile',
        'Copy IDE Context Snapshot',
        'Select Skills',
        'Clear Skills',
        'Run CLI Exec',
        'Run CLI Review',
        'Open Debug Logs',
        'Set API Key',
        'Clear API Key',
        'Open Settings'
      ], { title: EXTENSION_DISPLAY_NAME });
      if (!action) {
        return;
      }
      const commandMap: Record<string, string> = {
        'Show Status': 'pionus.codex.showStatus',
        'View Last Usage': 'pionus.codex.showLastUsage',
        'Select Agent Profile': 'pionus.codex.selectAgentProfile',
        'Reset Agent Profile': 'pionus.codex.resetAgentProfile',
        'Copy IDE Context Snapshot': 'pionus.codex.copyContextSnapshot',
        'Select Skills': 'pionus.codex.selectSkills',
        'Clear Skills': 'pionus.codex.clearSkills',
        'Run CLI Exec': 'pionus.codex.runCliExec',
        'Run CLI Review': 'pionus.codex.runCliReview',
        'Open Debug Logs': 'pionus.codex.openDebugLogs',
        'Set API Key': 'pionus.codex.setApiKey',
        'Clear API Key': 'pionus.codex.clearApiKey',
        'Open Settings': 'pionus.codex.openSettings'
      };
      await vscode.commands.executeCommand(commandMap[action]);
    })
  );
}

export function deactivate(): void {}

async function selectAgentProfile(outputChannel: vscode.LogOutputChannel): Promise<void> {
  const profiles = await loadAgentProfiles(getProviderConfig(), outputChannel);
  const selected = await vscode.window.showQuickPick(profiles.map((profile) => ({
    label: profile.id,
    description: profile.name,
    detail: profile.description
  })), { title: `${EXTENSION_DISPLAY_NAME}: Select Agent Profile` });
  if (!selected) {
    return;
  }
  await setActiveAgentProfile(selected.label);
}

async function setActiveAgentProfile(value: string | null): Promise<void> {
  await vscode.workspace.getConfiguration(getConfigurationSection()).update('activeAgentProfile', value, vscode.ConfigurationTarget.Global);
  await vscode.window.showInformationMessage(value
    ? `${EXTENSION_DISPLAY_NAME}: agent profile set to ${value}.`
    : `${EXTENSION_DISPLAY_NAME}: agent profile reset to automatic selection.`);
}

async function copyContextSnapshot(): Promise<void> {
  const snapshot = formatContextSnapshot(collectContextSnapshot(getProviderConfig()));
  await vscode.env.clipboard.writeText(snapshot);
  await vscode.window.showInformationMessage(`${EXTENSION_DISPLAY_NAME}: IDE context snapshot copied.`);
}

async function selectSkills(context: vscode.ExtensionContext, outputChannel: vscode.LogOutputChannel): Promise<void> {
  const config = getProviderConfig();
  const skills = await discoverSkills(config, outputChannel);
  if (skills.length === 0) {
    await vscode.window.showInformationMessage(`${EXTENSION_DISPLAY_NAME}: no skills found. Add SKILL.md files to pionus.codex.skillPaths.`);
    return;
  }
  const activeSkillIds = new Set(getActiveSkillIds(context));
  const selected = await vscode.window.showQuickPick(skills.map((skill) => ({
    label: skill.id,
    description: skill.name,
    detail: skill.filePath,
    picked: activeSkillIds.has(skill.id)
  })), { title: `${EXTENSION_DISPLAY_NAME}: Select Skills`, canPickMany: true });
  if (!selected) {
    return;
  }
  await setActiveSkillIds(context, selected.map((item) => item.label));
  await vscode.window.showInformationMessage(`${EXTENSION_DISPLAY_NAME}: ${selected.length} active skills.`);
}

async function runCliExec(): Promise<void> {
  const enabled = await ensureCliBridgeEnabled();
  if (!enabled) {
    return;
  }

  const prompt = await vscode.window.showInputBox({
    title: 'Run Codex CLI Exec',
    prompt: 'Initial instructions for a read-only Codex CLI exec run',
    ignoreFocusOut: true
  });
  if (!prompt?.trim()) {
    return;
  }

  const enableSearch = await vscode.window.showQuickPick(['No web search', 'Enable web search'], { title: 'Codex CLI web search' }) === 'Enable web search';
  const attachImages = await vscode.window.showQuickPick(['No images', 'Attach image files'], { title: 'Codex CLI image input' }) === 'Attach image files';
  const imageUris = attachImages ? await vscode.window.showOpenDialog({ canSelectMany: true, filters: { Images: ['png', 'jpg', 'jpeg', 'webp', 'gif'] } }) : undefined;
  const config = getProviderConfig();
  const command = buildReadOnlyCliCommand(config, {
    prompt: `${prompt.trim()}\n\n${formatContextSnapshot(collectContextSnapshot(config))}`,
    cwd: getPrimaryWorkspaceFolder(),
    model: config.model,
    imagePaths: imageUris?.map((uri) => uri.fsPath),
    enableSearch
  });
  launchTerminal(`${EXTENSION_DISPLAY_NAME}: Codex CLI Exec`, toShellCommand(command), getPrimaryWorkspaceFolder());
}

async function runCliReview(): Promise<void> {
  const enabled = await ensureCliBridgeEnabled();
  if (!enabled) {
    return;
  }

  const mode = await vscode.window.showQuickPick([
    { label: 'Working Tree', requestMode: 'working-tree' as const },
    { label: 'Against Base Branch', requestMode: 'base' as const },
    { label: 'Commit', requestMode: 'commit' as const }
  ], { title: 'Codex CLI Review Target' });
  if (!mode) {
    return;
  }

  const target = mode.requestMode === 'working-tree' ? undefined : await vscode.window.showInputBox({
    title: mode.requestMode === 'base' ? 'Base branch' : 'Commit SHA',
    ignoreFocusOut: true
  });
  if (mode.requestMode !== 'working-tree' && !target?.trim()) {
    return;
  }

  const instructions = await vscode.window.showInputBox({
    title: 'Optional Codex review instructions',
    prompt: 'Leave empty to use Codex defaults',
    ignoreFocusOut: true
  });
  const request: ReviewRequest = { mode: mode.requestMode, target, instructions };
  const command = buildReviewCliCommand(getProviderConfig(), request);
  launchTerminal(`${EXTENSION_DISPLAY_NAME}: Codex CLI Review: ${describeReviewRequest(request)}`, toShellCommand(command), getPrimaryWorkspaceFolder());
}

async function ensureCliBridgeEnabled(): Promise<boolean> {
  const config = getProviderConfig();
  if (config.enableCliBridge) {
    return true;
  }

  const action = await vscode.window.showWarningMessage(`${EXTENSION_DISPLAY_NAME}: Codex CLI bridge is disabled.`, 'Enable and Run', 'Open Settings');
  if (action === 'Enable and Run') {
    await vscode.workspace.getConfiguration(getConfigurationSection()).update('enableCliBridge', true, vscode.ConfigurationTarget.Global);
    return true;
  }
  if (action === 'Open Settings') {
    await vscode.commands.executeCommand('pionus.codex.openSettings');
  }
  return false;
}

function launchTerminal(name: string, command: string, cwd: string | undefined): void {
  const terminal = vscode.window.createTerminal({ name, cwd, isTransient: false });
  terminal.show();
  terminal.sendText(command);
}
