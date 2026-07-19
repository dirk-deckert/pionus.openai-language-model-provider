export interface ManagementAction {
  label: string;
  command: string;
}

export const MANAGEMENT_ACTIONS: readonly ManagementAction[] = [
  { label: 'Show Status', command: 'pionus.codex.showStatus' },
  { label: 'View Last Usage', command: 'pionus.codex.showLastUsage' },
  { label: 'Select Agent Profile', command: 'pionus.codex.selectAgentProfile' },
  { label: 'Reset Agent Profile', command: 'pionus.codex.resetAgentProfile' },
  { label: 'Copy IDE Context Snapshot', command: 'pionus.codex.copyContextSnapshot' },
  { label: 'Select Skills', command: 'pionus.codex.selectSkills' },
  { label: 'Clear Skills', command: 'pionus.codex.clearSkills' },
  { label: 'Run CLI Exec', command: 'pionus.codex.runCliExec' },
  { label: 'Run CLI Review', command: 'pionus.codex.runCliReview' },
  { label: 'Open Debug Logs', command: 'pionus.codex.openDebugLogs' },
  { label: 'Set API Key', command: 'pionus.codex.setApiKey' },
  { label: 'Clear API Key', command: 'pionus.codex.clearApiKey' },
  { label: 'Open Settings', command: 'pionus.codex.openSettings' }
];
