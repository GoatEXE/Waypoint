export type RefPart = string | { ref: string };

export function splitTaskRefs(text: string, key: string | null | undefined): RefPart[] {
  if (!text || !key || !/^[A-Z][A-Z0-9]{1,5}$/.test(key)) return [text];
  const parts: RefPart[] = [];
  const pattern = new RegExp(`(?<![A-Za-z0-9-])${key}-[1-9][0-9]{0,8}(?![A-Za-z0-9])`, 'g');
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ ref: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
