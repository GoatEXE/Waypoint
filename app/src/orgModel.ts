import type { Organization } from './api';

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const LOGO_MAX_BYTES = 256 * 1024;
export const KEY_RE = /^[A-Z][A-Z0-9]{1,5}$/;

export function deriveOrgKey(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^[0-9]+/, '');
  return letters.length >= 2 ? letters.slice(0, 3) : 'WP';
}

export function cleanKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function logoProblem(file: { type: string; size: number }): string | null {
  if (!LOGO_TYPES.includes(file.type)) return 'Use a PNG, JPEG, WebP, or GIF image.';
  if (file.size > LOGO_MAX_BYTES) return `Image must be ${LOGO_MAX_BYTES / 1024} KB or smaller.`;
  return null;
}

export function readLogo(file: File): Promise<string> {
  const problem = logoProblem(file);
  if (problem) return Promise.reject(new Error(problem));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

export function ceoNameOf(org: Organization | null | undefined): string {
  return org?.ceoName || 'CEO';
}
