import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import type { ProviderConfig } from './config.js';
import type { AgentProfile } from './agentProfiles.js';

export interface ExtraInstructionSections {
  ideContext?: string;
  skillInstructions?: string;
}

export async function buildInstructions(config: ProviderConfig, agentProfile: AgentProfile | undefined, extraSections: ExtraInstructionSections = {}): Promise<string> {
  const parts = [config.instructions.trim()];
  if (config.includeCodexInstructions) {
    const discovered = await discoverCodexInstructions(config);
    if (discovered) {
      parts.push(`Codex discovered instructions:\n${discovered}`);
    }
  }
  if (agentProfile) {
    parts.push(`Active provider agent profile: ${agentProfile.id}\n${agentProfile.instructions}`);
  }
  if (extraSections.ideContext?.trim()) {
    parts.push(`Current IDE context:\n${extraSections.ideContext.trim()}`);
  }
  if (extraSections.skillInstructions?.trim()) {
    parts.push(`Selected skill instructions:\n${extraSections.skillInstructions.trim()}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

export async function discoverCodexInstructions(config: ProviderConfig): Promise<string> {
  const contents: string[] = [];
  const globalInstruction = await readFirstExisting([join(homedir(), '.codex', 'AGENTS.override.md'), join(homedir(), '.codex', 'AGENTS.md')]);
  if (globalInstruction) {
    contents.push(globalInstruction);
  }

  for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
    const chain = getDirectoryChain(workspaceFolder.uri.fsPath);
    for (const directory of chain) {
      const instruction = await readFirstExisting([
        join(directory, 'AGENTS.override.md'),
        join(directory, 'AGENTS.md'),
        ...config.projectDocFallbackFilenames.map((name) => join(directory, name))
      ]);
      if (instruction) {
        contents.push(instruction);
      }
    }
  }

  return truncateByBytes(contents.join('\n\n'), config.projectDocMaxBytes);
}

async function readFirstExisting(paths: string[]): Promise<string | undefined> {
  for (const filePath of paths) {
    try {
      const content = (await readFile(filePath, 'utf8')).trim();
      if (content) {
        return `# ${filePath}\n${content}`;
      }
    } catch {
      // Missing instruction files are normal.
    }
  }
  return undefined;
}

function getDirectoryChain(root: string): string[] {
  const chain = [root];
  let current = root;
  for (;;) {
    const next = dirname(current);
    if (next === current || next === homedir() || chain.length > 24) {
      return chain;
    }
    current = next;
    chain.unshift(current);
  }
}

function truncateByBytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return value;
  }
  return buffer.subarray(0, maxBytes).toString('utf8');
}