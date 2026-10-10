import { useStore } from '../store';
import { DRY_RUN_HOW, DRY_RUN_REASON } from '../dryRun';

export function DryRunBadge() {
  const { state, set } = useStore();
  if (!state.config?.dryRun) return null;
  return <button type="button" className="dry-run-badge" title={`${DRY_RUN_REASON} ${DRY_RUN_HOW}`} onClick={() => set({ dryRunDismissed: false })}>Dry run</button>;
}

export function DryRunBanner() {
  const { state, set } = useStore();
  if (!state.config?.dryRun || state.dryRunDismissed) return null;
  return (
    <div className="dry-run-banner" role="status">
      <span><strong>Dry run.</strong> {DRY_RUN_REASON} {DRY_RUN_HOW}</span>
      <button type="button" className="icon-btn" title="Dismiss" onClick={() => set({ dryRunDismissed: true })}>×</button>
    </div>
  );
}
