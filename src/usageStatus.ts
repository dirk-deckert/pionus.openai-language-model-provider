import type { ResponseUsage } from 'openai/resources/responses/responses';
import * as vscode from 'vscode';
import { EXTENSION_DISPLAY_NAME } from './branding.js';
import {
  calculateUsageCostUsd,
  formatUsageTokens,
  formatUsd,
  getUsageBreakdown,
  validateModelPricingUsdPerMTok,
  type PricingDiagnostic,
  type PricingTableUsdPerMTok
} from './usage.js';

export interface UsageEvent {
  model: string;
  usage: ResponseUsage;
  completedAt: number;
}

export interface UsageStatusConfiguration {
  showInStatusBar: boolean;
  modelPricingUsdPerMTok: Record<string, unknown>;
}

export class UsageStatusBar implements vscode.Disposable {
  private readonly statusBar: vscode.StatusBarItem;
  private lastUsage?: UsageEvent;
  private showInStatusBar = true;
  private pricing: PricingTableUsdPerMTok = {};

  constructor(
    context: vscode.ExtensionContext,
    configuration?: Partial<UsageStatusConfiguration>,
    private readonly reportDiagnostic?: (diagnostic: PricingDiagnostic) => void
  ) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 88);
    this.statusBar.command = 'pionus.codex.showLastUsage';
    context.subscriptions.push(this.statusBar);
    if (configuration) {
      this.updateConfiguration({
        showInStatusBar: configuration.showInStatusBar ?? true,
        modelPricingUsdPerMTok: configuration.modelPricingUsdPerMTok ?? {}
      });
    }
  }

  record(event: UsageEvent): void {
    this.lastUsage = event;
    this.render();
  }

  updateConfiguration(configuration: UsageStatusConfiguration): readonly PricingDiagnostic[] {
    this.showInStatusBar = configuration.showInStatusBar;
    const validated = validateModelPricingUsdPerMTok(configuration.modelPricingUsdPerMTok);
    this.pricing = validated.pricing;
    for (const diagnostic of validated.diagnostics) {
      this.reportDiagnostic?.(diagnostic);
    }
    this.render();
    return validated.diagnostics;
  }

  async showLastUsage(): Promise<void> {
    if (!this.lastUsage) {
      await vscode.window.showInformationMessage(`${EXTENSION_DISPLAY_NAME}: no usage recorded yet.`);
      return;
    }
    const cost = calculateUsageCostUsd(this.lastUsage.model, this.lastUsage.usage, this.pricing);
    const costText = cost ? ` Estimated cost: ${formatUsd(cost.total)}.` : '';
    await vscode.window.showInformationMessage(`${EXTENSION_DISPLAY_NAME} usage: ${formatUsageTokens(this.lastUsage.usage)}.${costText}`);
  }

  dispose(): void {
    this.statusBar.dispose();
  }

  private render(): void {
    if (!this.lastUsage || !this.showInStatusBar) {
      this.statusBar.hide();
      return;
    }

    const tokens = getUsageBreakdown(this.lastUsage.usage);
    const cost = calculateUsageCostUsd(this.lastUsage.model, this.lastUsage.usage, this.pricing);
    this.statusBar.text = `${EXTENSION_DISPLAY_NAME}: ${tokens.totalTokens} tokens`;
    this.statusBar.tooltip = cost
      ? `${EXTENSION_DISPLAY_NAME} usage for ${this.lastUsage.model}\n${formatUsageTokens(this.lastUsage.usage)}\nEstimated cost: ${formatUsd(cost.total)}`
      : `${EXTENSION_DISPLAY_NAME} usage for ${this.lastUsage.model}`;
    this.statusBar.show();
  }
}
