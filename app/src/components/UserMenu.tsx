import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { NavIcon } from './NavIcon';
import { userNameOf } from '../userModel';

export function UserMenu() {
  const { state, setTheme } = useStore();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const org = state.org.organization;
  const name = userNameOf(state.user.user);
  const light = state.theme === 'light';

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const go = (to: string) => { setOpen(false); nav(to); };

  return (
    <div className="user-menu" ref={ref}>
      {open && (
        <div className="user-menu-pop" role="menu">
          <button role="menuitem" className="user-menu-item" onClick={() => go('/profile')}><span className="sb-icon"><NavIcon name="profile" /></span>View profile</button>
          <button role="menuitem" className="user-menu-item" onClick={() => go('/settings')}><span className="sb-icon"><NavIcon name="settings" /></span>Settings</button>
          <button role="menuitem" className="user-menu-item" onClick={() => go('/help')}><span className="sb-icon"><NavIcon name="help" /></span>Help</button>
          <div className="user-menu-sep" />
          <div className="user-menu-theme" role="group" aria-label="Appearance">
            <span>Appearance</span>
            <div className="segmented sm">
              <button role="menuitemradio" aria-checked={!light} className={light ? '' : 'on'} onClick={() => setTheme('dark')}><NavIcon name="moon" />Dark</button>
              <button role="menuitemradio" aria-checked={light} className={light ? 'on' : ''} onClick={() => setTheme('light')}><NavIcon name="sun" />Light</button>
            </div>
          </div>
        </div>
      )}
      <button className={'user-chip' + (open ? ' on' : '')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} title={name}>
        {org?.logo ? <img className="user-chip-logo" src={org.logo} alt="" /> : <span className="user-chip-logo">{(org?.name || 'W').slice(0, 1).toUpperCase()}</span>}
        <span className="user-chip-name ellipsis">{name}</span>
        <span className="user-chip-caret" aria-hidden="true">⌃</span>
      </button>
    </div>
  );
}
