import {workspace, commands, window} from 'vscode';
import * as vscode from 'vscode';

const config = workspace.getConfiguration();
const configOverriders: Array<ConfigOverrider<any>> = [];
export class ConfigOverrider<T> {
  public constructor(
    /** The config key that is being overriden by this overrider. */
    private overrideTargetKey: string,
    /** The config key that controls whether this is enabled. */
    private enableKey: string,
    /** The config key that is used to store the original value without override. */
    private originalValueKey: string,
  ) {}
  private isEnabled() {
    return config.get<boolean>(this.enableKey)!;
  }
  public override(value: T) {
    if (!this.isEnabled()) {
      return;
    }
    const targetCurrentValue = config.get<T>(this.overrideTargetKey);
    if (config.get<T | null>(this.originalValueKey) === null) {
      config.update(this.originalValueKey, targetCurrentValue, true);
    }
    config.update(this.overrideTargetKey, value, true);
  }
  public restore() {
    if (!this.isEnabled()) {
      return;
    }
    const originalValue = config.get<T | null>(this.originalValueKey);
    if (originalValue === null) {
      return;
    }
    config.update(this.overrideTargetKey, originalValue, true);
  }
  public disable() {
    this.restore();
    config.update(this.enableKey, false, true);
  }
  public enable() {
    config.update(this.originalValueKey, null, true);
    config.update(this.enableKey, true, true);
  }
  public register() {
    configOverriders.push(this);
    return this;
  }
}

export function configOverride(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('cwt.disableConfigOverrides', () => {
      configOverriders.forEach(overrider => overrider.disable());
      window.showInformationMessage('已恢复被覆写的配置项并禁用之后的覆写行为。');
    }),
    commands.registerCommand('cwt.enableConfigOverrides', () => {
      configOverriders.forEach(overrider => overrider.enable());
      window.showInformationMessage('已重新启用配置项覆写。');
    }),
  );
}
