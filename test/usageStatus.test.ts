import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

interface StubStatusBarItem {
  command?: string;
  text?: string;
  tooltip?: string;
  hideCount: number;
  showCount: number;
  disposeCount: number;
  hide(): void;
  show(): void;
  dispose(): void;
}

interface UsageVscodeStub {
  items: StubStatusBarItem[];
  messages: string[];
  createStatusBarItem(alignment: number, priority: number): StubStatusBarItem;
  showInformationMessage(message: string): Promise<undefined>;
}

test('UsageStatusBar retains usage while hidden and reacts immediately to configuration', async () => {
  const runtime: UsageVscodeStub = {
    items: [],
    messages: [],
    createStatusBarItem(alignment, priority) {
      assert.equal(alignment, 2);
      assert.equal(priority, 88);
      const item: StubStatusBarItem = {
        hideCount: 0,
        showCount: 0,
        disposeCount: 0,
        hide() { this.hideCount += 1; },
        show() { this.showCount += 1; },
        dispose() { this.disposeCount += 1; }
      };
      this.items.push(item);
      return item;
    },
    async showInformationMessage(message) {
      this.messages.push(message);
      return undefined;
    }
  };

  const globalWithStub = globalThis as typeof globalThis & { __pionusUsageVscodeStub?: UsageVscodeStub };
  globalWithStub.__pionusUsageVscodeStub = runtime;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'vscode') {
        return { url: 'pionus-vscode-usage-stub:', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === 'pionus-vscode-usage-stub:') {
        return {
          format: 'commonjs',
          shortCircuit: true,
          source: `
            const runtime = globalThis.__pionusUsageVscodeStub;
            module.exports = {
              StatusBarAlignment: { Right: 2 },
              window: {
                createStatusBarItem: (...args) => runtime.createStatusBarItem(...args),
                showInformationMessage: (...args) => runtime.showInformationMessage(...args)
              }
            };
          `
        };
      }
      return nextLoad(url, context);
    }
  });

  try {
    const { UsageStatusBar } = await import('../src/usageStatus.js');
    const diagnostics: Array<{ model?: string; message: string }> = [];
    const context = { subscriptions: [] as Array<{ dispose(): void }> };
    const usageStatus = new UsageStatusBar(context as never, {
      showInStatusBar: false,
      modelPricingUsdPerMTok: {
        'gpt-5.6-sol': { input: 5, cachedInput: 0.5, output: 30 }
      }
    }, (diagnostic) => diagnostics.push(diagnostic));
    const item = runtime.items[0];
    assert.ok(item);
    assert.equal(item.command, 'pionus.codex.showLastUsage');
    assert.equal(context.subscriptions.includes(item), true);

    usageStatus.record({
      model: 'gpt-5.6-sol',
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 25 },
        output_tokens: 10,
        total_tokens: 110
      } as never,
      completedAt: 1234
    });
    assert.equal(item.showCount, 0, 'recording usage must not override the hidden configuration');

    usageStatus.updateConfiguration({
      showInStatusBar: true,
      modelPricingUsdPerMTok: {
        'gpt-5.6-sol': { input: 5, cachedInput: 0.5, output: 30 }
      }
    });
    assert.equal(item.showCount, 1, 'showing must happen immediately without recording another response');
    assert.equal(item.text, 'Codex 110 tokens');
    assert.match(String(item.tooltip), /input 100, output 10, total 110/);
    assert.match(String(item.tooltip), /Estimated cost: \$0\.000687/);

    await usageStatus.showLastUsage();
    assert.equal(
      runtime.messages.at(-1),
      'Codex usage: input 100, output 10, total 110. Estimated cost: $0.000687.'
    );

    usageStatus.updateConfiguration({
      showInStatusBar: false,
      modelPricingUsdPerMTok: {
        'gpt-5.6-sol': { input: 5, cachedInput: 0.5, output: 30 }
      }
    });
    assert.ok(item.hideCount >= 1, 'hiding must happen immediately');

    const invalid = usageStatus.updateConfiguration({
      showInStatusBar: true,
      modelPricingUsdPerMTok: {
        'gpt-5.6-sol': { input: -1, output: 30 }
      }
    });
    assert.equal(invalid.length, 1);
    assert.equal(diagnostics.length, 1);
    assert.doesNotMatch(String(item.tooltip), /Estimated cost/);

    const emptyStatus = new UsageStatusBar(context as never, {
      showInStatusBar: true,
      modelPricingUsdPerMTok: {}
    });
    await emptyStatus.showLastUsage();
    assert.equal(runtime.messages.at(-1), 'No Codex usage recorded yet.');

    usageStatus.dispose();
    assert.equal(item.disposeCount, 1);
  } finally {
    hooks.deregister();
    delete globalWithStub.__pionusUsageVscodeStub;
  }
});
