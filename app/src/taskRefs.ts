export type RefPart = string | { ref: string };

export function splitTaskRefs(text: string, key: string | null | undefined, idRefs: Record<string, string> = {}): RefPart[] {
  if (!text) return [text];
  const keyPattern = key && /^[A-Z][A-Z0-9]{1,5}$/.test(key) ? `${key}-[1-9][0-9]{0,8}` : null;
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])(?:${keyPattern ? `${keyPattern}|` : ''}t_[0-9a-f]{6,32})(?![A-Za-z0-9])`, 'g');
  const parts: RefPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const ref = match[0].startsWith('t_') ? idRefs[match[0]] : match[0];
    if (!ref) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ ref });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : [text];
}

export type LinkPart = string | { url: string; label: string };

const LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"'`]+/g;
const TRAILING = /[.,;:!?)\]}'"]+$/;

export function splitLinks(text: string): LinkPart[] {
  if (!text) return [text];
  const parts: LinkPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    let raw = match[0];
    let url = match[2] || raw;
    const label = match[1];
    if (!label) {
      const trail = raw.match(TRAILING)?.[0] || '';
      const keep = trail.startsWith(')') && raw.includes('(') ? '' : trail;
      raw = raw.slice(0, raw.length - keep.length);
      url = raw;
    }
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ url, label: label || url });
    last = match.index + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : [text];
}
