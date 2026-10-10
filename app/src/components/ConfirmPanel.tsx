import type { ConfirmCopy } from '../taskActionsModel';

export function ConfirmPanel({ copy, busy, error, onConfirm, onCancel }: { copy: ConfirmCopy; busy: boolean; error?: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="alertdialog" aria-label={copy.title} className="stack" style={{ gap: 10, padding: 16, border: '1px solid var(--border-3)', borderRadius: 10, background: 'var(--surface-2)' }}>
      <strong style={{ fontWeight: 500 }}>{copy.title}</strong>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{copy.body}</span>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost sm" type="button" autoFocus onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary sm" type="button" onClick={onConfirm} disabled={busy}>{busy ? copy.busy : copy.cta}</button>
      </div>
      {error && <span role="alert" style={{ fontSize: 12.5 }}>{error}</span>}
    </div>
  );
}
