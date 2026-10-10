import { WorkspaceHead } from '../components/ui';

function ComingSoon({ title, lede }: { title: string; lede: string }) {
  return (
    <div className="page" style={{ maxWidth: 920, gap: 24 }}>
      <WorkspaceHead title={title} lede={lede} ledeWidth={600} />
      <div className="empty" role="status"><span className="soon-tag">Coming soon</span> This page isn't built yet.</div>
    </div>
  );
}

export function RoutinesView() {
  return <ComingSoon title="Routines" lede="Recurring work seats pick up on a schedule." />;
}

export function ArtifactsView() {
  return <ComingSoon title="Artifacts" lede="Files, screenshots, and reports your seats produce, grouped by project." />;
}
