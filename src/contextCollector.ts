import * as vscode from 'vscode';
import type { ProviderConfig } from './config.js';

export interface ContextSnapshot {
  workspaceFolders: string[];
  activeFile?: string;
  selectedText?: string;
  visibleFiles: string[];
}

export function collectContextSnapshot(config: ProviderConfig): ContextSnapshot {
  const activeEditor = vscode.window.activeTextEditor;
  const selectedText = activeEditor && !activeEditor.selection.isEmpty
    ? truncateByBytes(activeEditor.document.getText(activeEditor.selection), config.ideContextMaxSelectionBytes)
    : undefined;

  return {
    workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
    activeFile: activeEditor ? formatUri(activeEditor.document.uri) : undefined,
    selectedText,
    visibleFiles: unique(vscode.window.visibleTextEditors.map((editor) => formatUri(editor.document.uri)))
  };
}

export function formatContextSnapshot(snapshot: ContextSnapshot): string {
  const parts = [
    `Workspace folders: ${snapshot.workspaceFolders.length > 0 ? snapshot.workspaceFolders.join(', ') : 'none'}`,
    `Active file: ${snapshot.activeFile ?? 'none'}`,
    `Visible files: ${snapshot.visibleFiles.length > 0 ? snapshot.visibleFiles.join(', ') : 'none'}`
  ];
  if (snapshot.selectedText?.trim()) {
    parts.push(`Selected text:\n${snapshot.selectedText.trim()}`);
  }
  return parts.join('\n');
}

export function getPrimaryWorkspaceFolder(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function formatUri(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString(true);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function truncateByBytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return value;
  }
  return `${buffer.subarray(0, maxBytes).toString('utf8')}\n[truncated]`;
}