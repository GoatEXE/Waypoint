import { useEffect, useRef, useState } from 'react';
import * as D from '../data';
import { chatContextFor, useRoute } from '../routes';
import { useStore, type ModalKind } from '../store';

interface Form { text: string; title: string; date: string; scope: string; hire: string; repos: string[]; tpl: string; proj: string; role: string; pod: string; ident: string; secrets: string[] }

const BLANK: Form = { text: '', title: '', date: '', scope: '', hire: '', repos: [], tpl: '', proj: '', role: '', pod: '', ident: '', secrets: [] };
const DEFAULTS: Record<ModalKind, Partial<Form>> = {
  assignment: { scope: 'workspace', hire: 'ask' },
  mission: {},
  pod: {},
  seat: { ident: 'new' },
};
const ROLE_NAMES: Record<string, string> = { frontend: 'frontend', backend: 'backend', qa: 'qa', ocr: 'ocr-specialist', compliance: 'compliance' };

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

export function Modal({ kind }: { kind: ModalKind }) {
  const { closeModal, sendCeoMessage, createMission, flash } = useStore();
  const ctx = chatContextFor(useRoute());
  const [form, setForm] = useState<Form>({ ...BLANK, ...DEFAULTS[kind] });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const f = <K extends keyof Form>(k: K, v: Form[K]) => setForm(s => ({ ...s, [k]: v }));
  const toggle = (k: 'repos' | 'secrets', v: string) => setForm(s => ({ ...s, [k]: s[k].includes(v) ? s[k].filter(x => x !== v) : [...s[k], v] }));

  useEffect(() => { const t = setTimeout(() => focusRef.current?.focus(), 60); return () => clearTimeout(t); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeModal, submitting]);

  const meta = {
    assignment: { eyebrow: 'NEW ASSIGNMENT · TO CEO', title: 'What needs doing?', cta: 'Send to CEO', note: 'Context: ' + ctx, ok: form.text.trim() },
    mission: { eyebrow: 'NEW MISSION', title: 'Set a mission', cta: 'Save mission', note: 'Saves the mission. Nothing starts until the CEO assigns a pod.', ok: form.title.trim() },
    pod: { eyebrow: 'NEW POD', title: 'Start a pod from a template', cta: 'Not connected', note: 'Pod creation is not connected in this view.', ok: '' },
    seat: { eyebrow: 'NEW SEAT', title: 'Add a seat', cta: 'Not connected', note: 'Seat creation is not connected in this view.', ok: '' },
  }[kind];

  const submit = async () => {
    if (!meta.ok || submitting) return;
    if (kind === 'assignment') {
      setSubmitting(true);
      setError(null);
      const result = await sendCeoMessage(form.text.trim(), true);
      setSubmitting(false);
      if (result.ok) closeModal();
      else setError(result.error || 'Message was not accepted.');
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
            <Field label="Advances"><Chips opts={[[D.mission ? 'mission' : 'workspace', D.mission ? 'Whole mission' : 'Workspace'], ...D.projects.map(p => p.name)]} value={form.scope} onPick={v => f('scope', v)} /></Field>
            <Field label="Hiring"><Chips opts={[['ask', 'Ask me before hiring'], ['auto', 'CEO may hire from templates']]} value={form.hire} onPick={v => f('hire', v)} /></Field>
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

          {kind === 'pod' && <>
            <Field label="Template">
              {!D.podTemplates.length && <div className="empty">No pod templates yet.</div>}
              {!!D.podTemplates.length && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
                {D.podTemplates.map(t => (
                  <div key={t.name} className={'tpl' + (form.tpl === t.name ? ' on' : '')} onClick={() => setForm(s => ({ ...s, tpl: t.name }))}>
                    <span style={{ font: '500 12.5px var(--mono)' }}>{t.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.seats}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--fainter)' }}>{t.limits}</span>
                  </div>
                ))}
              </div>}
            </Field>
            <Field label="Attach to project"><Chips mono opts={D.projects.map(p => p.name)} value={form.proj} onPick={v => f('proj', v)} /></Field>
            <Field label="Pod name"><input ref={focusRef} className="input mono" value={form.title} onChange={e => f('title', e.target.value)} /></Field>
            <Hint>Creating pods through the service is separate from this visual draft.</Hint>
          </>}

          {kind === 'seat' && <>
            <Field label="Role">
              <Chips opts={['frontend', 'backend', 'qa', ['ocr', 'ocr-specialist'], 'compliance']} value={form.role} onPick={v => setForm(s => ({ ...s, role: v, title: ROLE_NAMES[v] }))} />
            </Field>
            <Field label="Join pod"><Chips mono opts={D.pods.map(p => p.name)} value={form.pod} onPick={v => f('pod', v)} /></Field>
            <Field label="Identity"><Chips opts={[['new', 'New Hermes profile'], ['reuse', 'Reuse a retired profile']]} value={form.ident} onPick={v => f('ident', v)} /></Field>
            <Field label="Secrets"><Chips opts={[]} value={form.secrets} onPick={v => toggle('secrets', v)} /></Field>
            <Field label="Seat name"><input ref={focusRef} className="input mono" value={form.title} onChange={e => f('title', e.target.value)} /></Field>
          </>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 22px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: error ? 'var(--faint)' : 'var(--fainter)' }} role={error ? 'alert' : undefined}>{error || meta.note}</span>
          <button className="btn lg btn-ghost" style={{ marginLeft: 'auto' }} onClick={closeIfIdle} disabled={submitting}>Cancel</button>
          <button className="btn lg btn-primary" style={{ opacity: meta.ok && !submitting ? 1 : 0.45 }} disabled={!meta.ok || submitting} onClick={submit}>{submitting ? (kind === 'mission' ? 'Saving…' : 'Sending…') : meta.cta}</button>
        </div>
      </div>
    </div>
  );
}
