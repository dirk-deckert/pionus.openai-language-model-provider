import type { ProviderConfig } from './config.js';
import { resolveCliExecutable, type CliBridgeCommand } from './cliBridge.js';

export interface ReviewRequest {
  mode: 'working-tree' | 'base' | 'commit';
  target?: string;
  instructions?: string;
}

export function describeReviewRequest(request: ReviewRequest): string {
  return request.target ? `${request.mode}: ${request.target}` : request.mode;
}

export function buildReviewCliCommand(config: ProviderConfig, request: ReviewRequest): CliBridgeCommand {
  const args = [
    'review',
    ...(config.reviewModel ? ['-c', `model=${JSON.stringify(config.reviewModel)}`] : []),
    ...getReviewTargetArgs(request),
    ...(request.instructions?.trim() ? [request.instructions.trim()] : [])
  ];
  return {
    executable: resolveCliExecutable(config),
    args,
    mutates: false
  };
}

function getReviewTargetArgs(request: ReviewRequest): string[] {
  if (request.mode === 'working-tree') {
    return ['--uncommitted'];
  }
  if (request.mode === 'base' && request.target?.trim()) {
    return ['--base', request.target.trim()];
  }
  if (request.mode === 'commit' && request.target?.trim()) {
    return ['--commit', request.target.trim()];
  }
  return [];
}