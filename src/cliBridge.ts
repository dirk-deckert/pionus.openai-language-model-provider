import type { ProviderConfig } from './config.js';

export interface CliBridgeCommand {
  executable: string;
  args: string[];
  mutates: boolean;
}

export interface ExecBridgeOptions {
  prompt: string;
  cwd?: string;
  model?: string;
  profile?: string;
  imagePaths?: string[];
  enableSearch?: boolean;
}

export function buildReadOnlyCliCommand(config: ProviderConfig, options: ExecBridgeOptions): CliBridgeCommand {
  const executable = resolveCliExecutable(config);
  const args = [
    ...(options.enableSearch ? ['--search'] : []),
    'exec',
    '--sandbox', 'read-only',
    '--ask-for-approval', 'never',
    ...(options.cwd ? ['--cd', options.cwd] : []),
    ...(options.model ? ['--model', options.model] : []),
    ...(options.profile ? ['--profile', options.profile] : []),
    ...flatMap(options.imagePaths ?? [], (imagePath) => ['--image', imagePath]),
    options.prompt
  ];
  return { executable, args, mutates: false };
}

export function resolveCliExecutable(config: ProviderConfig): string {
  return config.cliExecutable?.trim() || 'codex';
}

export function toShellCommand(command: CliBridgeCommand): string {
  return [command.executable, ...command.args].map(quoteShellArg).join(' ');
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function flatMap<T, U>(values: T[], mapper: (value: T) => U[]): U[] {
  return values.reduce<U[]>((result, value) => [...result, ...mapper(value)], []);
}