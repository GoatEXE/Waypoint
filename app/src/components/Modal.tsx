import { useEffect, useRef, useState } from 'react';
import * as D from '../data';
import { clock } from '../model';
import { chatContextFor, useRoute } from '../routes';
import { useStore, type ModalKind } from '../store';

interface Form { text: string; title: string; date: string; scope: string; hire: string; repos: string[]; tpl: string; proj: string; role: string; pod: string; ident: string; secrets: string[] }

const BLANK: Form = { text: '', title: '', date: '', scope: '', hire: '', repos: [], tpl: '', proj: '', role: '', pod: '', ident: '', secrets: [] };
const DEFAULTS: Record<ModalKind, Partial<Form>> = {
  assignment: { scope: 'mission', hire: 'ask' },
  mission: { date: '2026-12-15' },
  pod: { tpl: 'web-squad v3', proj: 'intake-web', title: 'web-squad-02' },
  seat: { role: 'frontend', pod: 'web-squad-01', ident: 'new', secrets: ['intake-web'], title: 'frontend-3' },
};
const ROLE_NAMES: Record<string, string> = { frontend: 'frontend-3', backend: 'backend-3', qa: 'qa-2', ocr: 'ocr-specialist-1', compliance: 'compliance-2' };

type Opt = string | [string, string];
const optVal = (o: Opt) => (Array.isArray(o) ? o[0] : o);
const optLabel = (o: Opt) => (Array.isArray(o) ? o[1] : o);

function Chips({ opts, value, onPick, mono }: { opts: Opt[]; value: string | string[]; onPick: (v: string) => void; mono?: boolean }) {
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
  const { closeModal, set, flash, askCeo } = useStore();
  const ctx = chatContextFor(useRoute());
  const [form, setForm] = useState<Form>({ ...BLANK, ...DEFAULTS[kind] });
  const focusRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const f = <K extends keyof Form>(k: K, v: Form[K]) => setForm(s => ({ ...s, [k]: v }));
  const toggle = (k: 'repos' | 'secrets', v: string) => setForm(s => ({ ...s, [k]: s[k].includes(v) ? s[k].filter(x => x !== v) : [...s[k], v] }));

  useEffect(() => { const t = setTimeout(() => focusRef.current?.focus(), 60); return () => clearTimeout(t); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeModal]);

  const meta = {
    assignment: { eyebrow: 'NEW ASSIGNMENT · TO CEO', title: 'What needs doing?', cta: 'Send to CEO', note: 'Context: ' + ctx, ok: form.text.trim() },
    mission: { eyebrow: 'NEW MISSION', title: 'Set a mission', cta: 'Create & hand to CEO', note: 'The CEO proposes projects and pods.', ok: form.title.trim() },
    pod: { eyebrow: 'NEW POD', title: 'Start a pod from a template', cta: 'Start pod', note: form.tpl, ok: form.title.trim() },
    seat: { eyebrow: 'NEW SEAT', title: 'Add a seat', cta: 'Add seat', note: 'Hermes profile · ~/.waypoint/profiles/' + form.title, ok: form.title.trim() },
  }[kind];

  const submit = () => {
    if (!meta.ok) return;
    if (kind === 'assignment') {
      const scopeLabel = form.scope === 'mission' ? 'the mission' : form.scope;
      const time = clock();
      closeModal();
      askCeo(form.text.trim(), () => [
        { tool: 'tasks.draft scope=' + form.scope + (form.hire === 'auto' ? ' · seats.request allowed' : '') },
        { who: 'ceo', time, text: `On it. I'll break this down against ${scopeLabel} and post the plan here. ` + (form.hire === 'auto' ? "I'll hire from existing templates if needed and tell you after." : "If it needs a new seat, I'll ask you first.") },
      ], true);
    } else if (kind === 'mission') {
      set(s => ({ modal: null, chatExtra: [...s.chatExtra, { tool: `missions.create "${form.title.trim()}"` + (form.repos.length ? ' · projects.link ×' + form.repos.length : '') }] }));
      flash('Mission created · CEO is drafting projects');
    } else if (kind === 'pod') {
      closeModal(); flash(`${form.title.trim()} starting from ${form.tpl}`);
    } else {
      closeModal(); flash(form.title.trim() + ' added' + (form.pod !== 'none' ? ' to ' + form.pod : ''));
    }
  };

  return (
    <div className="scrim" onClick={closeModal}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={meta.title} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '20px 22px 0' }}>
          <div className="stack" style={{ gap: 4 }}>
            <div className="sb-label" style={{ color: 'var(--dim)' }}>{meta.eyebrow}</div>
            <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.015em' }}>{meta.title}</div>
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} title="Close" onClick={closeModal}>×</button>
        </div>

        <div className="stack" style={{ padding: '20px 22px', gap: 18 }}>
          {kind === 'assignment' && <>
            <Field label="What should the CEO do?">
              <textarea ref={focusRef} className="input" rows={4} value={form.text} onChange={e => f('text', e.target.value)} placeholder="e.g. Add Spanish to every intake step before launch" />
            </Field>
            <Field label="Advances"><Chips opts={[['mission', 'Whole mission'], ...D.projects.map(p => p.name)]} value={form.scope} onPick={v => f('scope', v)} /></Field>
            <Field label="Hiring"><Chips opts={[['ask', 'Ask me before hiring'], ['auto', 'CEO may hire from templates']]} value={form.hire} onPick={v => f('hire', v)} /></Field>
            <Hint>The CEO plans first and posts the breakdown in chat. Anything needing a new seat, a secret, or a merge comes to your Inbox.</Hint>
          </>}

          {kind === 'mission' && <>
            <Field label="Mission">
              <input ref={focusRef} className="input" value={form.title} onChange={e => f('title', e.target.value)} placeholder="e.g. Cut no-show rate in half" />
            </Field>
            <Field label="Outcome — how will we know it worked?">
              <textarea className="input" rows={3} value={form.text} onChange={e => f('text', e.target.value)} placeholder="One or two sentences the CEO can measure progress against" />
            </Field>
            <Field label="Target">
              <input type="date" className="input" style={{ width: 200, colorScheme: 'dark' }} value={form.date} onChange={e => f('date', e.target.value)} />
            </Field>
            <Field label="Projects">
              <Chips mono opts={[...D.projects.map(p => p.repo), ['new', '+ Link a repository']]} value={form.repos} onPick={v => toggle('repos', v)} />
            </Field>
          </>}

          {kind === 'pod' && <>
            <Field label="Template">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
                {D.podTemplates.map(t => (
                  <div key={t.name} className={'tpl' + (form.tpl === t.name ? ' on' : '')} onClick={() => setForm(s => ({ ...s, tpl: t.name, title: t.name.split(' ')[0] + '-02' }))}>
                    <span style={{ font: '500 12.5px var(--mono)' }}>{t.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.seats}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--fainter)' }}>{t.limits}</span>
                  </div>
                ))}
              </div>
            </Field>
            <Field label="Attach to project"><Chips mono opts={D.projects.map(p => p.name)} value={form.proj} onPick={v => f('proj', v)} /></Field>
            <Field label="Pod name"><input ref={focusRef} className="input mono" value={form.title} onChange={e => f('title', e.target.value)} /></Field>
            <Hint>Each seat gets its own Hermes profile, stored outside the container. Learnings are reviewed when the pod stops.</Hint>
          </>}

          {kind === 'seat' && <>
            <Field label="Role">
              <Chips opts={['frontend', 'backend', 'qa', ['ocr', 'ocr-specialist'], 'compliance']} value={form.role} onPick={v => setForm(s => ({ ...s, role: v, title: ROLE_NAMES[v] }))} />
            </Field>
            <Field label="Join pod"><Chips mono opts={[...D.pods.map(p => p.name), ['none', 'No pod yet']]} value={form.pod} onPick={v => f('pod', v)} /></Field>
            <Field label="Identity"><Chips opts={[['new', 'New Hermes profile'], ['reuse', 'Reuse a retired profile']]} value={form.ident} onPick={v => f('ident', v)} /></Field>
            <Field label="Secrets"><Chips opts={[['intake-web', 'intake-web · read'], ['intake-api', 'intake-api · read'], ['clearinghouse', 'clearinghouse key']]} value={form.secrets} onPick={v => toggle('secrets', v)} /></Field>
            <Field label="Seat name"><input ref={focusRef} className="input mono" value={form.title} onChange={e => f('title', e.target.value)} /></Field>
          </>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 22px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: 'var(--fainter)' }}>{meta.note}</span>
          <button className="btn lg btn-ghost" style={{ marginLeft: 'auto' }} onClick={closeModal}>Cancel</button>
          <button className="btn lg btn-primary" style={{ opacity: meta.ok ? 1 : 0.45 }} disabled={!meta.ok} onClick={submit}>{meta.cta}</button>
        </div>
      </div>
    </div>
  );
}
