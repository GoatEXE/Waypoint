import type { UserProfile } from './api';

export const USER_NAME_MAX = 60;
export const USER_ABOUT_MAX = 280;

export function userNameOk(name: string): boolean {
  const text = name.trim();
  return text.length > 0 && text.length <= USER_NAME_MAX;
}

export function userNameOf(user: UserProfile | null | undefined): string {
  return user?.name || 'You';
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
}
