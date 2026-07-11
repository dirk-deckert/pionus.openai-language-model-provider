import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import * as toml from 'toml';
import * as vscode from 'vscode';
import type { ProviderConfig, ReasoningEffort } from './config.js';

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sandboxMode?: string;
  source: 'builtin' | 'codexAgent';
}

export async function resolveAgentProfile(config: ProviderConfig, options: { hasTools: boolean; outputChannel?: vscode.LogOutputChannel }): Promise<AgentProfile | undefined> {
  if (!config.enableAgentProfiles) {
    return undefined;
  }
  const profiles = await loadAgentProfiles(config, options.outputChannel);
  const profileId = config.activeAgentProfile ?? (options.hasTools ? config.defaultExecutionProfile : config.defaultPlanningProfile);
  return profiles.find((profile) => profile.id === profileId) ?? profiles.find((profile) => profile.id === 'codex-execute');
}

export async function loadAgentProfiles(config: ProviderConfig, outputChannel?: vscode.LogOutputChannel): Promise<AgentProfile[]> {
  const profiles = [...getBuiltinProfiles()];
  if (!config.mirrorCodexConfiguredAgents) {
    return profiles;
  }

  const directories = [join(homedir(), '.codex', 'agents'), ...getWorkspaceAgentDirectories(), ...config.agentProfilePaths.map(expandHome)];
  for (const directory of directories) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.toml')) {
          continue;
        }
        const profile = await readAgentProfile(join(directory, entry.name), outputChannel);
        if (profile && !profiles.some((existing) => existing.id === profile.id)) {
          profiles.push(profile);
        }
      }
    } catch {
      // Missing agent directories are normal.
    }
  }
  return profiles;
}

export function getBuiltinProfiles(): AgentProfile[] {
  return [
    {
      id: 'codex-plan',
      name: 'Codex Plan',
      description: 'Read-only Codex-like planning behavior.',
      source: 'builtin',
      instructions: [
        'Use Codex-like planning behavior.',
        'Stay read-only unless the user explicitly asks for implementation.',
        'Gather just enough local evidence to form a falsifiable plan.',
        'Prefer concrete files, commands, and validation checks over broad speculation.',
        'Do not claim to have changed files while using this profile.'
      ].join('\n')
    },
    {
      id: 'codex-execute',
      name: 'Codex Execute',
      description: 'Codex-like implementation behavior for tool-enabled chat.',
      source: 'builtin',
      instructions: [
        'Use Codex-like execution behavior.',
        'Start from the nearest concrete anchor: file, symbol, failure, command, test, or call site.',
        'Before editing, gather only enough evidence for a falsifiable local hypothesis and a cheap check.',
        'Make small grounded changes, preserve unrelated user changes, and validate after substantive edits.',
        'Prefer existing project patterns and minimal diffs. Surface limitations when host tools restrict behavior.'
      ].join('\n')
    },
    {
      id: 'codex-review',
      name: 'Codex Review',
      description: 'Read-only Codex-like code review behavior.',
      source: 'builtin',
      instructions: [
        'Use Codex-like review behavior.',
        'Stay read-only and prioritize correctness, behavior regressions, security, and missing tests.',
        'Lead with concrete findings grounded in changed code.',
        'Avoid style-only feedback unless it hides a real risk.'
      ].join('\n')
    }
  ];
}

async function readAgentProfile(filePath: string, outputChannel?: vscode.LogOutputChannel): Promise<AgentProfile | undefined> {
  try {
    const parsed = toml.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
    const name = getString(parsed.name) ?? basename(filePath, '.toml');
    const instructions = getString(parsed.developer_instructions);
    if (!instructions) {
      return undefined;
    }
    return {
      id: `codex-${slugify(name)}`,
      name,
      description: getString(parsed.description) ?? `Mirrored Codex agent from ${filePath}`,
      instructions,
      model: getString(parsed.model),
      reasoningEffort: normalizeReasoningEffort(parsed.model_reasoning_effort),
      sandboxMode: getString(parsed.sandbox_mode),
      source: 'codexAgent'
    };
  } catch (error) {
    outputChannel?.warn('Failed to read Codex agent profile', { filePath, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

function getWorkspaceAgentDirectories(): string[] {
  return vscode.workspace.workspaceFolders?.map((folder) => join(folder.uri.fsPath, '.codex', 'agents')) ?? [];
}

function expandHome(value: string): string {
  return value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
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
