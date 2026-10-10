import type { ReactNode } from 'react';
import { seatRole, type SeatRole } from '../seatRoles';

const PATHS: Record<SeatRole, ReactNode> = {
  engineer: <><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></>,
  designer: <><circle cx="13.5" cy="6.5" r="1" /><circle cx="17.5" cy="10.5" r="1" /><circle cx="8.5" cy="7.5" r="1" /><circle cx="6.5" cy="12.5" r="1" /><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z" /></>,
  reviewer: <><path d="M9 12l2 2 4-4" /><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>,
  researcher: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  writer: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  ops: <><rect x="2" y="3" width="20" height="7" rx="2" /><rect x="2" y="14" width="20" height="7" rx="2" /><path d="M6 6.5h.01M6 17.5h.01" /></>,
  data: <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>,
  manager: <><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></>,
  generalist: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
};

export function SeatIcon({ id, description, size = 15 }: { id: string; description?: string; size?: number }) {
  const role = seatRole(id, description);
  return (
    <svg className="seat-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={role}>
      <title>{role}</title>
      {PATHS[role]}
    </svg>
  );
}
