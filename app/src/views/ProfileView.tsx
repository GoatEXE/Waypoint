import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { errorText } from '../runtimeHealth';
import { USER_ABOUT_MAX, USER_NAME_MAX, initialsOf, userNameOf, userNameOk } from '../userModel';

export function ProfileView() {
  const { state, saveUser, flash } = useStore();
  const user = state.user.user;
  const [name, setName] = useState(user?.name || '');
  const [about, setAbout] = useState(user?.about || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setName(user?.name || ''); setAbout(user?.about || ''); }, [user?.name, user?.about]);

  const dirty = name.trim() !== (user?.name || '') || about.trim() !== (user?.about || '');
  const save = async () => {
    setBusy(true); setError('');
    try { await saveUser({ name: name.trim(), about: about.trim() }); flash('Profile saved'); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="page stack" style={{ maxWidth: 920, gap: 28 }}>
      <div className="profile-head">
        <div className="profile-avatar">{initialsOf(userNameOf(user))}</div>
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <div className="eyebrow">PROFILE</div>
          <h1 className="h1 ellipsis">{userNameOf(user)}</h1>
          {user?.about && <p className="lede" style={{ fontSize: 13.5 }}>{user.about}</p>}
        </div>
      </div>

      <section className="card stack" style={{ padding: 16, gap: 14 }} aria-label="You">
        <h2 className="section-title" style={{ margin: 0 }}>You</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(240px, 2fr)', gap: 10 }}>
          <label className="field"><span className="field-label">Name</span>
            <input className="input" value={name} maxLength={USER_NAME_MAX} disabled={busy} onChange={e => setName(e.target.value)} />
          </label>
          <label className="field"><span className="field-label">About you</span>
            <input className="input" value={about} maxLength={USER_ABOUT_MAX} disabled={busy} onChange={e => setAbout(e.target.value)} placeholder="One sentence" />
          </label>
        </div>
        {error && <div role="alert" className="form-error">{error}</div>}
        <div><button className="btn btn-primary" disabled={busy || !dirty || !userNameOk(name)} onClick={() => void save()}>Save</button></div>
      </section>
    </div>
  );
}
