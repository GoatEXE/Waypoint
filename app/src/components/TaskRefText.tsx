import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { splitTaskRefs } from '../taskRefs';

export function TaskRefText({ text }: { text: string }) {
  const nav = useNavigate();
  const { state } = useStore();
  const idRefs = useMemo(() => Object.fromEntries(state.board.filter(t => t.ref).map(t => [t.id, t.ref!])), [state.board]);
  return (
    <>
      {splitTaskRefs(text, state.org.organization?.key, idRefs).map((part, index) => typeof part === 'string'
        ? part
        : <button key={index} type="button" className="ref-link" title={`Open ${part.ref}`} onClick={() => nav('/tasks/' + encodeURIComponent(part.ref))}>{part.ref}</button>)}
    </>
  );
}
