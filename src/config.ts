import * as vscode from 'vscode';

export type CredentialsSource = 'auto' | 'codexAuth' | 'secretStorage';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type ReasoningEffortSetting = 'auto' | ReasoningEffort;
export type ServiceTier = 'default' | 'fast';
export type ServiceTierSetting = 'auto' | ServiceTier;

export interface ProviderConfig {
  baseURL: string;
  clientVersion: string;
  credentialsSource: CredentialsSource;
  model: string;
  instructions: string;
  defaultReasoningEffort?: ReasoningEffort;
  defaultServiceTier?: ServiceTier;
  maxOutputTokens: number;
  enableImageInput: boolean;
  includeIdeContext: boolean;
  ideContextMaxSelectionBytes: number;
  includeCodexInstructions: boolean;
  projectDocFallbackFilenames: string[];
  projectDocMaxBytes: number;
  enableAgentProfiles: boolean;
  activeAgentProfile?: string;
  mirrorCodexConfiguredAgents: boolean;
  agentProfilePaths: string[];
  defaultPlanningProfile: string;
  defaultExecutionProfile: string;
  enableSkillInjection: boolean;
  skillPaths: string[];
  enableCliBridge: boolean;
  cliExecutable?: string;
  reviewModel?: string;
  showUsageInStatusBar: boolean;
  modelPricingUsdPerMTok: Record<string, unknown>;
}

const CONFIG_SECTION = 'pionus.codex';

export function getProviderConfig(): ProviderConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    baseURL: getString(config, 'baseURL', 'https://chatgpt.com/backend-api/codex/responses'),
    clientVersion: getString(config, 'clientVersion', '0.0.0'),
    credentialsSource: getEnum(config, 'credentialsSource', ['auto', 'codexAuth', 'secretStorage'], 'auto'),
    model: getString(config, 'model', 'gpt-5.6-sol'),
    instructions: getString(config, 'instructions', 'You are a helpful coding assistant integrated with VS Code.'),
    defaultReasoningEffort: normalizeReasoningEffort(getString(config, 'defaultReasoningEffort', 'auto')),
    defaultServiceTier: normalizeServiceTier(getEnum(config, 'defaultServiceTier', ['auto', 'default', 'fast'], 'auto')),
    maxOutputTokens: getPositiveNumber(config, 'maxOutputTokens', 8192),
    enableImageInput: config.get<boolean>('enableImageInput', true),
    includeIdeContext: config.get<boolean>('includeIdeContext', true),
    ideContextMaxSelectionBytes: getPositiveNumber(config, 'ideContextMaxSelectionBytes', 12000),
    includeCodexInstructions: config.get<boolean>('includeCodexInstructions', true),
    projectDocFallbackFilenames: getStringArray(config, 'projectDocFallbackFilenames'),
    projectDocMaxBytes: getPositiveNumber(config, 'projectDocMaxBytes', 32768),
    enableAgentProfiles: config.get<boolean>('enableAgentProfiles', true),
    activeAgentProfile: getOptionalString(config, 'activeAgentProfile'),
    mirrorCodexConfiguredAgents: config.get<boolean>('mirrorCodexConfiguredAgents', true),
    agentProfilePaths: getStringArray(config, 'agentProfilePaths'),
    defaultPlanningProfile: getString(config, 'defaultPlanningProfile', 'codex-plan'),
    defaultExecutionProfile: getString(config, 'defaultExecutionProfile', 'codex-execute'),
    enableSkillInjection: config.get<boolean>('enableSkillInjection', true),
    skillPaths: getStringArray(config, 'skillPaths'),
    enableCliBridge: config.get<boolean>('enableCliBridge', false),
    cliExecutable: getOptionalString(config, 'cliExecutable'),
    reviewModel: getOptionalString(config, 'reviewModel'),
    showUsageInStatusBar: config.get<boolean>('showUsageInStatusBar', true),
    modelPricingUsdPerMTok: config.get<Record<string, unknown>>('modelPricingUsdPerMTok', {})
  };
}

export function getConfigurationSection(): string {
  return CONFIG_SECTION;
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  switch (value) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
    case 'ultra':
      return value;
    default:
      return undefined;
  }
}

export function normalizeServiceTier(value: unknown): ServiceTier | undefined {
  return value === 'default' || value === 'fast' ? value : undefined;
}

function getString(config: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = config.get<string>(key, fallback);
  return value.trim() || fallback;
}

function getOptionalString(config: vscode.WorkspaceConfiguration, key: string): string | undefined {
  const value = config.get<string | null>(key, null);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getStringArray(config: vscode.WorkspaceConfiguration, key: string): string[] {
  return config.get<string[]>(key, []).filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function getPositiveNumber(config: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = config.get<number>(key, fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getEnum<T extends string>(config: vscode.WorkspaceConfiguration, key: string, allowed: readonly T[], fallback: T): T {
  const value = config.get<string>(key, fallback);
  return allowed.includes(value as T) ? value as T : fallback;
}
