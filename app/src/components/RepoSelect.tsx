import type { GitHubStatus } from '../api';

export function installedRepos(github: GitHubStatus | null) {
  return [...new Set(github?.installations.flatMap(i => i.repos) || [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function RepoSelect({ value, onChange, github, disabled }: { value: string; onChange: (repo: string) => void; github: GitHubStatus | null; disabled?: boolean }) {
  const repos = installedRepos(github);
  const known = !value || repos.some(r => r.toLowerCase() === value.toLowerCase());
  const selected = known ? repos.find(r => r.toLowerCase() === value.toLowerCase()) || '' : value;
  if (github && !github.connected) {
    return (
      <>
        <select className="input" disabled value={value}><option value={value}>{value || 'GitHub is not connected'}</option></select>
      </>
    );
  }
  return (
    <>
      <select className="input mono" value={selected} disabled={disabled || !github} onChange={e => onChange(e.target.value)}>
        <option value="">{github ? 'No repository' : 'Loading repositories…'}</option>
        {!known && <option value={value}>{value} (app not installed)</option>}
        {repos.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
    </>
  );
}
