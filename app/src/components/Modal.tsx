import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { activeProject, useRoute } from '../routes';
import { currentMission } from '../missionsModel';
import { useStore, type ModalKind } from '../store';
import { api, type OrgSeat } from '../api';
import { ceoNameOf } from '../orgModel';
import { DRY_RUN_REASON } from '../dryRun';
import { errorText } from '../runtimeHealth';

interface Form { text: string; title: string; date: string; scope: string; hire: string; role: string; clone: string }

const BLANK: Form = { text: '', title: '', date: '', scope: '', hire: '', role: '', clone: '' };
type FormKind = Exclude<ModalKind, 'project' | 'pod'>;

const DEFAULTS: Record<FormKind, Partial<Form>> = {
  assignment: { scope: 'workspace', hire: 'ask' },
  mission: {},
  seat: {},
};

type Opt = string | [string, string];
const optVal = (o: Opt) => (Array.isArray(o) ? o[0] : o);
const optLabel = (o: Opt) => (Array.isArray(o) ? o[1] : o);

function Chips({ opts, value, onPick, mono }: { opts: Opt[]; value: string | string[]; onPick: (v: string) => void; mono?: boolean }) {
  if (!opts.length) return <div className="empty">No options yet.</div>;
  return (
    <div className="chips">
      {opts.map(o => {
        const v = optVal(o);
        const on = Array.isArray(value) ? value.includes(v) : value === v;
        return <button key={v} type="button" className={'chip' + (on ? ' on' : '') + (mono ? ' mono' : '')} aria-pressed={on} onClick={() => onPick(v)}>{optLabel(o)}</button>;
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><div className="field-label">{label}</div>{children}</div>;
}

const Hint = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 12, color: 'var(--faint)' }}>{children}</div>;

export function Modal({ kind }: { kind: FormKind }) {
  const { state, closeModal, sendCeoMessage, createMission, flash } = useStore();
  const nav = useNavigate();
  const routeProject = activeProject(useRoute());
  const mission = currentMission(state.missions);
  const missionProjects = mission ? state.projects.filter(p => p.missionId === mission.id) : [];
  const scopes: [string, string][] = [
    mission ? ['mission', `Whole mission · ${mission.title}`] : ['workspace', 'Workspace'],
    ...missionProjects.map((p): [string, string] => ['project:' + p.id, p.name]),
  ];
  const initialScope = routeProject && missionProjects.some(p => p.id === routeProject) ? 'project:' + routeProject : scopes[0][0];
  const [form, setForm] = useState<Form>({ ...BLANK, ...DEFAULTS[kind], ...(kind === 'assignment' ? { scope: initialScope } : {}) });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const f = <K extends keyof Form>(k: K, v: Form[K]) => setForm(s => ({ ...s, [k]: v }));
  const [seats, setSeats] = useState<OrgSeat[] | null>(null);
  useEffect(() => {
    if (kind !== 'seat') return;
    api.orgSeats().then(result => setSeats(result.seats)).catch(() => setSeats([]));
  }, [kind]);

  useEffect(() => { const t = setTimeout(() => focusRef.current?.focus(), 60); return () => clearTimeout(t); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeModal, submitting]);

  const ceoName = ceoNameOf(state.org.organization);
  const meta = {
    assignment: { eyebrow: `ASK ${ceoName.toUpperCase()}`, title: 'What needs doing?', cta: `Send to ${ceoName}`, note: `${ceoName} replies in the side pane and plans the work onto the board.`, ok: form.text.trim() },
    mission: { eyebrow: 'NEW MISSION', title: 'Set a mission', cta: 'Save mission', note: 'Saves the mission. Nothing starts until the CEO puts work on the board.', ok: form.title.trim() },
    seat: { eyebrow: 'NEW SEAT', title: 'Hire a seat', cta: 'Hire seat', note: state.config?.dryRun ? DRY_RUN_REASON : 'Adds a Hermes profile to the organization.', ok: form.title.trim() && form.role.trim() && !state.config?.dryRun },
  }[kind];

  const submit = async () => {
    if (!meta.ok || submitting) return;
    if (kind === 'assignment') {
      if (state.ceo.sending) { setError('The CEO is still working on the previous message. Send this when it finishes.'); return; }
      closeModal();
      const hiring = form.hire === 'auto' ? 'Hiring: you may hire seats for this without asking.' : 'Hiring: ask me before hiring any seat.';
      const project = missionProjects.find(p => 'project:' + p.id === form.scope);
      const advances = project
        ? `Advances: project "${project.name}"${project.repo ? ` (repo ${project.repo})` : ''}${mission ? ` in mission "${mission.title}"` : ''}.`
        : mission && form.scope === 'mission' ? `Advances: mission "${mission.title}".` : '';
      void sendCeoMessage([form.text.trim(), advances, hiring].filter(Boolean).join('\n\n'), true, ref => nav('/tasks/' + encodeURIComponent(ref)));
    }
    if (kind === 'seat') {
      setSubmitting(true);
      setError(null);
      try {
        const id = form.title.trim();
        await api.hireSeat({ id, description: form.role.trim(), ...(form.clone ? { cloneFrom: form.clone } : {}) });
        closeModal();
        flash(`Hired ${id}`);
        nav('/org');
      } catch (err) {
        setError(errorText(err));
      } finally { setSubmitting(false); }
    }
    if (kind === 'mission') {
      setSubmitting(true);
      setError(null);
      const result = await createMission({ title: form.title.trim(), outcome: form.text.trim(), target: form.date });
      setSubmitting(false);
      if (result.ok) { closeModal(); flash('Mission saved'); }
      else setError(result.error || 'Mission was not saved.');
    }
  };

  const closeIfIdle = () => { if (!submitting) closeModal(); };

  return (
    <div className="scrim" onClick={closeIfIdle}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={meta.title} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '20px 22px 0' }}>
          <div className="stack" style={{ gap: 4 }}>
            <div className="sb-label" style={{ color: 'var(--dim)' }}>{meta.eyebrow}</div>
            <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.015em' }}>{meta.title}</div>
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} title="Close" onClick={closeIfIdle} disabled={submitting}>×</button>
        </div>

        <div className="stack" style={{ padding: '20px 22px', gap: 18 }}>
          {kind === 'assignment' && <>
            <Field label="What should the CEO do?">
              <textarea ref={focusRef} className="input" rows={4} value={form.text} onChange={e => f('text', e.target.value)} placeholder="Describe the real work you want to hand off" />
            </Field>
            <Field label="Advances"><Chips opts={scopes} value={form.scope} onPick={v => f('scope', v)} /></Field>
            <Field label="Hiring"><Chips opts={[['ask', 'Ask me before hiring'], ['auto', 'CEO may hire seats']]} value={form.hire} onPick={v => f('hire', v)} /></Field>
            <Hint>This sends the assignment to the CEO conversation.</Hint>
          </>}

          {kind === 'mission' && <>
            <Field label="Mission">
              <input ref={focusRef} className="input" value={form.title} onChange={e => f('title', e.target.value)} placeholder="Mission name" />
            </Field>
            <Field label="Outcome — how will we know it worked?">
              <textarea className="input" rows={3} value={form.text} onChange={e => f('text', e.target.value)} placeholder="One or two sentences the CEO can measure progress against" />
            </Field>
            <Field label="Target (optional)">
              <input type="date" className="input" style={{ width: 200, colorScheme: 'dark' }} value={form.date} onChange={e => f('date', e.target.value)} />
            </Field>
          </>}

          {kind === 'seat' && <>
            <Field label="Seat id"><input ref={focusRef} className="input mono" value={form.title} placeholder="designer" maxLength={31} onChange={e => f('title', e.target.value.toLowerCase())} /></Field>
            <Field label="What this seat does"><input className="input" value={form.role} placeholder="UI and UX design" maxLength={200} onChange={e => f('role', e.target.value)} /></Field>
            <Field label="Copy skills from (optional)">
              {seats === null ? <Hint>Loading seats…</Hint> : seats.length ? <Chips mono opts={seats.map(seat => seat.id)} value={form.clone} onPick={v => f('clone', form.clone === v ? '' : v)} /> : <Hint>No seats yet; this one starts fresh.</Hint>}
            </Field>
          </>}
        </div>

        {error && <div role="alert" className="form-error" style={{ margin: '0 22px 14px' }}>{error}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 22px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: 'var(--fainter)' }}>{meta.note}</span>
          <button className="btn lg btn-ghost" style={{ marginLeft: 'auto' }} onClick={closeIfIdle} disabled={submitting}>Cancel</button>
          <button className="btn lg btn-primary" disabled={!meta.ok || submitting} onClick={submit}>{submitting ? (kind === 'mission' ? 'Saving…' : kind === 'seat' ? 'Hiring…' : 'Sending…') : meta.cta}</button>
        </div>
      </div>
    </div>
  );
}
