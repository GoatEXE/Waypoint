import { useNavigate } from 'react-router-dom';
import { WorkspaceHead } from '../components/ui';
import { useStore } from '../store';
import { ceoNameOf } from '../orgModel';
import { ONBOARDING_KICKOFF } from './OrgSetupView';

export function HelpView() {
  const { state, setCeoThread, sendCeoMessage } = useStore();
  const nav = useNavigate();
  const ceoName = ceoNameOf(state.org.organization);
  return (
    <div className="page" style={{ maxWidth: 820, gap: 24 }}>
      <WorkspaceHead title="Help" lede="How Waypoint works, and where to start." />

      <section className="card stack" style={{ padding: 16, gap: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>Onboard with {ceoName}</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{ceoName} interviews you about what you're working on, then proposes a mission and the seats to hire. Run it again any time your goals change.</p>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={state.ceo.sending} onClick={() => { setCeoThread('general'); void sendCeoMessage(ONBOARDING_KICKOFF, true); }}>Start onboarding</button>
      </section>

      <section className="card stack" style={{ padding: 16, gap: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>How work moves</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
          <li><strong>Ask {ceoName}</strong> (sidebar) to plan work. {ceoName} breaks it into tasks on the board and assigns seats.</li>
          <li><strong>Add task</strong> (Tasks page) puts a task straight on the board for a seat you pick.</li>
          <li>Seats hand finished work in for review. It waits in your <strong>Inbox</strong> until you approve or ask for changes.</li>
          <li>Open a task and use <strong>Give feedback</strong> to talk to the seat that did it. It saves what it learns.</li>
        </ul>
      </section>

      <section className="card stack" style={{ padding: 16, gap: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>Advanced</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Each agent's native Hermes UI opens from Settings (for {ceoName}) or from a seat's page.</p>
        <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/settings')}>Open Settings</button>
      </section>
    </div>
  );
}
