import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { splitLinks, splitTaskRefs } from '../taskRefs';

export function TaskRefText({ text }: { text: string }) {
  const nav = useNavigate();
  const { state } = useStore();
  const idRefs = useMemo(() => Object.fromEntries(state.board.filter(t => t.ref).map(t => [t.id, t.ref!])), [state.board]);
  return (
    <>
      {splitLinks(text).map((link, linkIndex) => typeof link === 'string'
        ? splitTaskRefs(link, state.org.organization?.key, idRefs).map((part, index) => typeof part === 'string'
          ? part
          : <button key={`${linkIndex}-${index}`} type="button" className="ref-link" title={`Open ${part.ref}`} onClick={() => nav('/tasks/' + encodeURIComponent(part.ref))}>{part.ref}</button>)
        : <a key={linkIndex} className="text-link" href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}
    </>
  );
}
