import { useEffect, useState } from 'react';
import { api, type FolderListing } from '../api';

function startPath(value: string) {
  const trimmed = value.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return '';
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return cut > 2 ? trimmed.slice(0, cut) : trimmed;
}

export function FolderPicker({ value, onPick, onClose }: { value: string; onPick: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [error, setError] = useState('');

  const open = (target: string) => {
    setError('');
    api.folders(target).then(setListing).catch(e => {
      setError(e instanceof Error ? e.message : String(e));
      if (target) api.folders('').then(setListing).catch(() => undefined);
    });
  };
  useEffect(() => { open(startPath(value)); }, []);

  return (
    <div className="folder-picker">
      <div className="folder-picker-head">
        <button type="button" className="btn btn-ghost sm" disabled={!listing?.path} onClick={() => open(listing?.parent || '')} title="Up one level">↑</button>
        <span className="folder-picker-path mono">{listing?.path || 'Choose a location'}</span>
        <button type="button" className="icon-btn" title="Close" onClick={onClose}>×</button>
      </div>
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--text)', padding: '0 10px' }}>{error}</div>}
      <div className="folder-picker-list">
        {!listing && <div className="folder-row muted">Loading…</div>}
        {listing && !listing.entries.length && <div className="folder-row muted">No folders here.</div>}
        {listing?.entries.map(entry => (
          <button key={entry.path} type="button" className="folder-row" onClick={() => open(entry.path)} onDoubleClick={() => onPick(entry.path)}>
            <span className="folder-icon" aria-hidden="true" />
            <span className="folder-name">{entry.name}</span>
            {entry.isGit && <span className="task-pill">git</span>}
          </button>
        ))}
      </div>
      <div className="folder-picker-foot">
        <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{listing?.isGit ? 'This folder is a git repository.' : 'Open a folder, then select it.'}</span>
        <button type="button" className="btn btn-primary sm" disabled={!listing?.path} onClick={() => listing?.path && onPick(listing.path)}>Select this folder</button>
      </div>
    </div>
  );
}
