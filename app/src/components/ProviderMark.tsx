export type MarkKind = 'claude' | 'codex';

export function markForProvider(provider: string | null | undefined): MarkKind | null {
  if (provider === 'anthropic') return 'claude';
  if (provider === 'openai-codex' || provider === 'openai-api' || provider === 'openai') return 'codex';
  return null;
}

export function ProviderMark({ kind, size = 26 }: { kind: MarkKind; size?: number }) {
  if (kind === 'claude') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
        {Array.from({ length: 12 }, (_, i) => <line key={i} x1="12" y1="12" x2="12" y2={i % 2 ? 4.5 : 2} stroke="#D97757" strokeWidth="2" strokeLinecap="round" transform={`rotate(${i * 30} 12 12)`} />)}
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <polygon points="12,2.5 20.2,7.25 20.2,16.75 12,21.5 3.8,16.75 3.8,7.25" fill="none" stroke="var(--text)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8.5 10l2.5 2-2.5 2M13 14.5h3" fill="none" stroke="var(--text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SeatMark({ provider, size = 13 }: { provider: string | null | undefined; size?: number }) {
  const kind = markForProvider(provider);
  return kind ? <span title={provider || ''} style={{ display: 'inline-flex' }}><ProviderMark kind={kind} size={size} /></span> : null;
}
