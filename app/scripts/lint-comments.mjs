import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directories = ['app/src', 'app/test', 'app/scripts', 'app/server', 'service/src', 'service/test', 'service/scripts'];
const standalone = ['app/index.html', 'app/vite.config.ts', 'service/Dockerfile', 'service/docker/auth-image/Dockerfile', 'service/compose.yaml'];
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.css', '.html']);

export function findComments(source, extension) {
  if (['.js', '.mjs', '.ts', '.tsx'].includes(extension)) {
    const kind = extension === '.tsx' ? ts.ScriptKind.TSX : extension === '.ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const file = ts.createSourceFile(`source${extension}`, source, ts.ScriptTarget.Latest, true, kind);
    const matches = new Set();
    const visit = (node) => {
      for (const range of ts.getLeadingCommentRanges(source, node.pos) || []) matches.add(range.pos);
      for (const range of ts.getTrailingCommentRanges(source, node.end) || []) matches.add(range.pos);
      for (const child of node.getChildren(file)) visit(child);
    };
    visit(file);
    return [...matches].sort((a, b) => a - b);
  }
  if (extension === '.css') return [...source.matchAll(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'))].map((match) => match.index);
  if (extension === '.html') return [...source.matchAll(new RegExp('<!--[\\s\\S]*?-->', 'g'))].map((match) => match.index);
  if (extension === 'Dockerfile' || extension === '.yaml') return [...source.matchAll(new RegExp('^[ \\t]*#.*$', 'gm'))].map((match) => match.index);
  return [];
}

async function filesUnder(relative) {
  const location = path.join(root, relative);
  const entries = await fs.readdir(location, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(child);
  }
  return files;
}

export async function lintComments() {
  const files = [...standalone];
  for (const directory of directories) files.push(...await filesUnder(directory));
  const violations = [];
  for (const relative of files) {
    const source = await fs.readFile(path.join(root, relative), 'utf8');
    const extension = path.basename(relative) === 'Dockerfile' ? 'Dockerfile' : path.extname(relative);
    for (const offset of findComments(source, extension)) {
      const prefix = source.slice(0, offset);
      const line = prefix.split('\n').length;
      violations.push(`${relative.replaceAll('\\', '/')}:${line}`);
    }
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await lintComments();
  if (violations.length) {
    for (const violation of violations.slice(0, 50)) process.stderr.write(`${violation}: code comments are not allowed\n`);
    if (violations.length > 50) process.stderr.write(`... ${violations.length - 50} more\n`);
    process.exitCode = 1;
  } else process.stdout.write('No code comments found.\n');
}
