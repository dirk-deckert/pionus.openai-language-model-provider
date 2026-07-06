import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import type { ProviderConfig } from './config.js';

const ACTIVE_SKILLS_KEY = 'pionus.codex.activeSkills';

export interface SkillDefinition {
  id: string;
  name: string;
  filePath: string;
  content: string;
}

export async function discoverSkills(config: ProviderConfig, outputChannel?: vscode.LogOutputChannel): Promise<SkillDefinition[]> {
  const skills = new Map<string, SkillDefinition>();
  for (const configuredPath of config.skillPaths) {
    for (const skill of await discoverSkillsFromPath(expandHome(configuredPath), outputChannel)) {
      skills.set(skill.id, skill);
    }
  }
  return [...skills.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export async function buildActiveSkillInstructions(context: vscode.ExtensionContext, config: ProviderConfig, outputChannel?: vscode.LogOutputChannel): Promise<string | undefined> {
  if (!config.enableSkillInjection) {
    return undefined;
  }
  const activeIds = getActiveSkillIds(context);
  if (activeIds.length === 0) {
    return undefined;
  }
  const skills = await discoverSkills(config, outputChannel);
  const selected = skills.filter((skill) => activeIds.includes(skill.id));
  return selected.length > 0 ? selected.map((skill) => `# Skill: ${skill.name}\n${skill.content.trim()}`).join('\n\n') : undefined;
}

export function getActiveSkillIds(context: vscode.ExtensionContext): string[] {
  const ids = context.globalState.get<string[]>(ACTIVE_SKILLS_KEY, []);
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id.trim()) : [];
}

export async function setActiveSkillIds(context: vscode.ExtensionContext, ids: string[]): Promise<void> {
  await context.globalState.update(ACTIVE_SKILLS_KEY, [...new Set(ids.filter((id) => id.trim()))]);
}

export async function clearActiveSkillIds(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(ACTIVE_SKILLS_KEY, undefined);
}

async function discoverSkillsFromPath(filePath: string, outputChannel?: vscode.LogOutputChannel): Promise<SkillDefinition[]> {
  try {
    const metadata = await stat(filePath);
    if (metadata.isFile()) {
      return [await readSkillFile(filePath)];
    }
    if (!metadata.isDirectory()) {
      return [];
    }

    const directSkill = await tryReadSkillFile(join(filePath, 'SKILL.md'));
    if (directSkill) {
      return [directSkill];
    }

    const entries = await readdir(filePath, { withFileTypes: true });
    const skills: SkillDefinition[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const nested = await tryReadSkillFile(join(filePath, entry.name, 'SKILL.md'));
      if (nested) {
        skills.push(nested);
      }
    }
    return skills;
  } catch (error) {
    outputChannel?.warn('Failed to discover Codex skills', { filePath, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

async function tryReadSkillFile(filePath: string): Promise<SkillDefinition | undefined> {
  try {
    return await readSkillFile(filePath);
  } catch {
    return undefined;
  }
}

async function readSkillFile(filePath: string): Promise<SkillDefinition> {
  const content = await readFile(filePath, 'utf8');
  const name = basename(dirname(filePath)) || basename(filePath, '.md');
  return {
    id: slugify(name),
    name,
    filePath,
    content
  };
}

function expandHome(value: string): string {
  return value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}