export type Theme = 'dark' | 'light';
export const THEME_KEY = 'waypoint-theme';

export function cleanTheme(value: unknown): Theme {
  return value === 'light' ? 'light' : 'dark';
}

export function readTheme(storage: Pick<Storage, 'getItem'> | null): Theme {
  try { return cleanTheme(storage?.getItem(THEME_KEY)); } catch { return 'dark'; }
}

export function applyTheme(theme: Theme, root: { dataset: DOMStringMap } = document.documentElement, storage: Pick<Storage, 'setItem'> | null = window.localStorage) {
  root.dataset.theme = theme;
  try { storage?.setItem(THEME_KEY, theme); } catch {   }
}
