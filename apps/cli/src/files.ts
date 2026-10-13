import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { MAX_CONTEXT_BYTES, MAX_FILE_BYTES, MAX_FILES, validateProjectPath, type ProjectFile } from '@claude-hackathon/shared';

export const hash = (content: string) => createHash('sha256').update(content).digest('hex');

export function safePath(root: string, relative: string): string {
  validateProjectPath(relative);
  const canonical = fs.realpathSync(root);
  const target = path.resolve(canonical, relative);
  const within = path.relative(canonical, target);
  if (!within || within.startsWith(`..${path.sep}`) || within === '..' || path.isAbsolute(within)) throw new Error('Path escapes project');
  let current = canonical;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw new Error(`Links cannot be read or edited: ${relative}`);
      if (current !== target && !stat.isDirectory()) throw new Error(`Invalid parent directory: ${relative}`);
      if (current === target && !stat.isFile()) throw new Error(`Not a regular file: ${relative}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}

export function readProjectFile(root: string, relative: string): ProjectFile {
  const target = safePath(root, relative);
  const stat = fs.statSync(target);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`File is too large: ${relative}`);
  const bytes = fs.readFileSync(target);
  const content = bytes.toString('utf8');
  if (content.includes('\0') || !Buffer.from(content).equals(bytes)) throw new Error(`Not a UTF-8 text file: ${relative}`);
  return { path: relative, content, sha256: hash(content) };
}

export function listProjectFiles(root: string): string[] {
  const files: string[] = [];
  let visited = 0;
  function visit(relative: string, depth: number) {
    if (depth > 8 || visited > 5000 || files.length >= 200) return;
    const directory = relative ? path.join(root, relative) : root;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      visited++;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      try { validateProjectPath(name); } catch { continue; }
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(name, depth + 1);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|json|md|css|html|py|rs|go|java|sql|yaml|yml|toml|txt|prisma)$/.test(name)) {
        try { readProjectFile(root, name); files.push(name); } catch { /* Unsafe or oversized candidates are omitted. */ }
      }
      if (visited > 5000 || files.length >= 200) break;
    }
  }
  visit('', 0);
  return files.sort();
}

export function collectContext(root: string, paths: string[]): ProjectFile[] {
  if (paths.length > MAX_FILES) throw new Error(`Select at most ${MAX_FILES} files`);
  const files = paths.map(relative => readProjectFile(root, relative));
  if (files.reduce((total, file) => total + Buffer.byteLength(file.content), 0) > MAX_CONTEXT_BYTES) throw new Error('Selected context exceeds 128 KiB');
  return files;
}

export type FileEdit = { path: string; content: string };
export function parseFileEdits(response: string): FileEdit[] {
  const edits: FileEdit[] = [];
  const pattern = /^<<<FILE: ([^\r\n]+)>>>\r?\n([\s\S]*?)^<<<ENDFILE>>>[ \t]*(?:\r?\n|$)/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(response))) {
    edits.push({ path: validateProjectPath(match[1]), content: match[2] });
  }
  if ((response.match(/<<<FILE:/g) || []).length !== edits.length ||
      (response.match(/<<<ENDFILE>>>/g) || []).length !== edits.length) throw new Error('Incomplete or malformed generated file markers');
  if (new Set(edits.map(edit => edit.path.toLowerCase())).size !== edits.length) throw new Error('Duplicate generated file paths');
  const paths = edits.map(edit => edit.path.toLowerCase());
  if (paths.some(parent => paths.some(child => child.startsWith(`${parent}/`)))) throw new Error('Conflicting generated file paths');
  if (edits.length > MAX_FILES) throw new Error('Too many generated files');
  return edits;
}

export function validateEdits(root: string, edits: FileEdit[], context: ProjectFile[]) {
  for (const edit of edits) {
    const target = safePath(root, edit.path);
    if (fs.existsSync(target)) {
      const original = context.find(file => file.path === edit.path);
      if (!original) throw new Error(`Refusing to overwrite a file that was not shared: ${edit.path}`);
      if (hash(fs.readFileSync(target, 'utf8')) !== original.sha256) throw new Error(`File changed locally since it was shared: ${edit.path}`);
    } else if (context.some(file => file.path === edit.path)) throw new Error(`Shared file was removed locally: ${edit.path}`);
  }
}

export function applyEdits(root: string, edits: FileEdit[], context: ProjectFile[]): string[] {
  validateEdits(root, edits, context);
  const staged: { target: string; temporary: string; backup?: string; installed: boolean }[] = [];
  const suffix = randomUUID();
  try {
    for (const edit of edits) {
      const target = safePath(root, edit.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      safePath(root, edit.path);
      const temporary = `${target}.hackathon-tmp-${suffix}`;
      const entry = { target, temporary, backup: undefined as string | undefined, installed: false };
      staged.push(entry);
      const mode = fs.existsSync(target) ? fs.statSync(target).mode : 0o600;
      fs.writeFileSync(temporary, edit.content, { flag: 'wx', mode });
      if (fs.existsSync(target)) {
        entry.backup = `${target}.hackathon-backup-${suffix}`;
        fs.copyFileSync(target, entry.backup, fs.constants.COPYFILE_EXCL);
      }
    }
    // Recheck every original after staging and before replacing any file.
    validateEdits(root, edits, context);
    for (const entry of staged) { fs.renameSync(entry.temporary, entry.target); entry.installed = true; }
    return staged.flatMap(entry => entry.backup ? [entry.backup] : []);
  } catch (error) {
    for (const entry of staged.reverse()) {
      if (entry.installed) {
        if (entry.backup) fs.copyFileSync(entry.backup, entry.target);
        else fs.unlinkSync(entry.target);
      }
    }
    throw error;
  } finally {
    for (const entry of staged) if (fs.existsSync(entry.temporary)) fs.unlinkSync(entry.temporary);
  }
}
