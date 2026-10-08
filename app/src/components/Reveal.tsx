import { useEffect, useRef, useState, type ReactNode } from 'react';

const EXIT_MS = 220;

export function Reveal({ show, children }: { show: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(show);
  const [open, setOpen] = useState(show);
  const last = useRef<ReactNode>(children);
  if (show) last.current = children;

  useEffect(() => {
    if (show) {
      setMounted(true);
      let second = 0;
      const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setOpen(true)); });
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }
    setOpen(false);
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [show]);

  if (!mounted) return null;
  return (
    <div className={'reveal' + (open ? ' open' : '')} aria-hidden={!show}>
      <div className="reveal-inner">{show ? children : last.current}</div>
    </div>
  );
}
