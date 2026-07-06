import type { ResponseUsage } from 'openai/resources/responses/responses';
import * as vscode from 'vscode';

export interface UsageEvent {
  model: string;
  usage: ResponseUsage;
  completedAt: number;
}

export class UsageStatusBar implements vscode.Disposable {
  private readonly statusBar: vscode.StatusBarItem;
  private lastUsage?: UsageEvent;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 88);
    this.statusBar.command = 'pionus.codex.showLastUsage';
    context.subscriptions.push(this.statusBar);
  }

  record(event: UsageEvent): void {
    this.lastUsage = event;
    this.statusBar.text = `Codex ${event.usage.total_tokens ?? 0} tokens`;
    this.statusBar.tooltip = `Pionus Codex usage for ${event.model}`;
    this.statusBar.show();
  }

  async showLastUsage(): Promise<void> {
    if (!this.lastUsage) {
      await vscode.window.showInformationMessage('No Codex usage recorded yet.');
      return;
    }
    const usage = this.lastUsage.usage;
    await vscode.window.showInformationMessage(`Codex usage: input ${usage.input_tokens ?? 0}, output ${usage.output_tokens ?? 0}, total ${usage.total_tokens ?? 0}.`);
  }

  dispose(): void {
    this.statusBar.dispose();
  }
}