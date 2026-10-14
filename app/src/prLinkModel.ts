export interface PrNeeded { message: string; repo: string; candidates: string[] }

export function prNeededFrom(error: unknown): PrNeeded | null {
  if (!(error instanceof Error) || (error as { status?: unknown }).status !== 409) return null;
  const record = ((error as { body?: unknown }).body as { error?: { code?: unknown; message?: unknown; details?: { repo?: unknown; candidates?: unknown } } } | null)?.error;
  if (record?.code !== 'pr_missing' || typeof record.details?.repo !== 'string') return null;
  const candidates = Array.isArray(record.details.candidates) ? record.details.candidates.filter((url): url is string => typeof url === 'string') : [];
  return { message: typeof record.message === 'string' ? record.message : error.message, repo: record.details.repo, candidates };
}

export function prUrlFor(value: string, repo: string): string | null {
  const text = value.trim();
  const number = text.match(/^#?([1-9][0-9]*)$/);
  if (number) return `https://github.com/${repo}/pull/${number[1]}`;
  const match = text.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)(?:[/#?].*)?$/);
  if (!match || match[1].toLowerCase() !== repo.toLowerCase()) return null;
  return `https://github.com/${match[1]}/pull/${match[2]}`;
}

export function needsPrLink(task: { status: string; prRepo?: string | null; prLinked?: string | null }): boolean {
  return task.status === 'review' && !!task.prRepo && !task.prLinked;
}
