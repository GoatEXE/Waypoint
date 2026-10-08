import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import * as D from './data';
import { parseRoute } from './routes';
import { useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { RightPane } from './components/RightPane';
import { Modal } from './components/Modal';
import { MissionView } from './views/MissionView';
import { ProjectView } from './views/ProjectView';
import { TaskView } from './views/TaskView';
import { RunView } from './views/RunView';
import { PodView } from './views/PodView';
import { ReviewView } from './views/ReviewView';
import { ArtifactsView, RoutinesView } from './views/WorkspaceViews';
import { MessageInboxView } from './views/MessageInboxView';
import { SkillsView } from './views/SkillsView';
import { ConnectorsView } from './views/ConnectorsView';
import { SettingsView } from './views/SettingsView';
import { TasksView } from './views/TasksView';
import { OrgChartView } from './views/OrgChartView';
import { OrgSetupView } from './views/OrgSetupView';

function View() {
  const r = parseRoute(useLocation().pathname);
  switch (r.v) {
    case 'mission': return <MissionView />;
    case 'project': return <ProjectView id={r.id as D.ProjectId} />;
    case 'tasks': return <TasksView />;
    case 'org': return <OrgChartView />;
    case 'task': return <TaskView id={r.id!} />;
    case 'run': return <RunView id={r.id!} />;
    case 'pod': return <PodView name={r.id!} />;
    case 'review': return <ReviewView />;
    case 'inbox': return <MessageInboxView />;
    case 'routines': return <RoutinesView />;
    case 'artifacts': return <ArtifactsView />;
    case 'skills': return <SkillsView />;
    case 'connectors': return <ConnectorsView />;
    case 'settings': return <SettingsView />;
    default: return (
      <div className="page" style={{ maxWidth: 920, gap: 12 }}>
        <div className="eyebrow">NOT FOUND</div>
        <h1 className="h1">Nothing lives at this address</h1>
      </div>
    );
  }
}

export function App() {
  const { state } = useStore();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [pathname]);

  if (!state.org.loaded) return null;
  if (!state.org.configured && !state.org.error) return <OrgSetupView />;

  return (
    <div className="app">
      <Sidebar />
      <div className="main-col">
        <Header />
        <main ref={mainRef} className="main-scroll">

          <div key={pathname} className="route-enter"><View /></div>
        </main>
      </div>
      {state.pane.open && <RightPane />}
      {state.modal && <Modal kind={state.modal} />}
      {state.toast && (
        <div className="toast" role="status"><div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--acc)' }} />{state.toast}</div>
      )}
    </div>
  );
}
