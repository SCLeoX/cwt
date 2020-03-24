import * as vscode from 'vscode';
import { repetitionDetection } from './RepetitionDetector';
import { configOverride } from './ConfigOverrider';

export function activate(context: vscode.ExtensionContext) {
	repetitionDetection(context);
	configOverride(context);
}

export function deactivate() { }
