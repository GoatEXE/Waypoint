import { useState } from 'react';
import { prUrlFor, type PrNeeded } from '../prLinkModel';

export function PrPicker({ need, busy, onApprove, onCancel }: { need: PrNeeded; busy: boolean; onApprove: (url: string) => void; onCancel: () => void }) {
  const [choice, setChoice] = useState(need.candidates[0] || '');
  const [pasted, setPasted] = useState('');
  const typed = pasted.trim();
  const url = typed ? prUrlFor(typed, need.repo) : choice;
  return (
    <div role="alertdialog" aria-label="Link the pull request" className="stack" style={{ gap: 10, padding: 16, border: '1px solid var(--border-3)', borderRadius: 10, background: 'var(--surface-2)' }}>
      <strong style={{ fontWeight: 500 }}>Link the pull request</strong>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{need.message} Approval checks that PR's CI on GitHub.</span>
      {need.candidates.length > 0 && (
        <div className="stack" style={{ gap: 4, fontSize: 13 }}>
          {need.candidates.map(candidate => (
            <label key={candidate} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="radio" name="pr-choice" checked={!typed && choice === candidate} disabled={busy} onChange={() => { setChoice(candidate); setPasted(''); }} />
              <a href={candidate} target="_blank" rel="noreferrer" className="mono">{candidate.replace('https://github.com/', '')}</a>
            </label>
          ))}
        </div>
      )}
      <input className="input" value={pasted} disabled={busy} aria-label="Pull request URL or number" placeholder={`PR URL or number in ${need.repo}`} onChange={e => setPasted(e.target.value)} />
      {typed && !url && <span role="alert" style={{ fontSize: 12.5 }}>Use a pull request in {need.repo}, like https://github.com/{need.repo}/pull/12 or 12.</span>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost sm" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary sm" type="button" disabled={busy || !url} onClick={() => url && onApprove(url)}>{busy ? 'Approving…' : 'Approve with this PR'}</button>
      </div>
    </div>
  );
}
