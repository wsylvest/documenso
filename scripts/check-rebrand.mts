/**
 * Fails when the old product name appears outside the allowlist.
 *
 * Why: this fork rebrands Documenso to SR Sign but keeps upstream's package scope and internal identifiers so
 * upstream merges stay small. Every merge from upstream can bring in new user-visible "Documenso" strings; this
 * check finds them. See `.agents/plans/calm-ruby-forge-rebrand-sr-sign.md`.
 *
 * Usage:
 *   node scripts/check-rebrand.mts            # list violations, exit 1 if any
 *   node scripts/check-rebrand.mts --summary  # also print counts per top-level area
 *   node scripts/check-rebrand.mts --all      # print every violation instead of the first 200
 *
 * Allowlist format (`scripts/rebrand-allowlist.txt`), one rule per line, `#` starts a comment:
 *   <glob>                 every occurrence in matching files is allowed
 *   <glob> :: <regex>      matches of <regex> (case-sensitive) are ignored on lines of matching files; the line still fails
 *                          if "documenso" remains after the matches are removed
 * Globs: `**` any path, `*` within a path segment, `?` one character.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type Rule = { glob: RegExp; source: string; scrub: RegExp | null };

const root = path.resolve(import.meta.dirname, '..');
const allowlistPath = path.join(root, 'scripts', 'rebrand-allowlist.txt');

const globToRegExp = (glob: string) => {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/__GLOBSTAR__/g, '.*');

  return new RegExp(`^${pattern}$`);
};

const rules: Rule[] = readFileSync(allowlistPath, 'utf8')
  .split('\n')
  .map((line) => line.replace(/(^|\s)#.*$/, '').trim())
  .filter(Boolean)
  .map((line) => {
    const [glob, regex] = line.split(/\s+::\s+/);

    return { glob: globToRegExp(glob), source: line, scrub: regex ? new RegExp(regex, 'g') : null };
  });

const output = execFileSync('git', ['grep', '-nIi', '-e', 'documenso', '--', '.'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});

const violations: { file: string; line: number; text: string }[] = [];

for (const row of output.split('\n')) {
  const match = /^([^:]+):(\d+):(.*)$/.exec(row);

  if (!match) {
    continue;
  }

  const [, file, lineNo, text] = match;

  if (file === 'scripts/check-rebrand.mts' || file === 'scripts/rebrand-allowlist.txt') {
    continue;
  }

  const applicable = rules.filter((rule) => rule.glob.test(file));

  if (applicable.some((rule) => rule.scrub === null)) {
    continue;
  }

  let remaining = text;

  for (const rule of applicable) {
    remaining = remaining.replace(rule.scrub as RegExp, '');
  }

  if (/documenso/i.test(remaining)) {
    violations.push({ file, line: Number(lineNo), text: text.trim().slice(0, 140) });
  }
}

if (process.argv.includes('--summary')) {
  const counts = new Map<string, number>();

  for (const v of violations) {
    const parts = v.file.split('/');
    const key = parts[0] === 'apps' || parts[0] === 'packages' ? parts.slice(0, 2).join('/') : parts[0];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(5)}  ${key}`);
  }
}

if (violations.length > 0) {
  const shown = process.argv.includes('--all') ? violations : violations.slice(0, 200);

  for (const v of shown) {
    console.log(`${v.file}:${v.line}: ${v.text}`);
  }

  console.error(
    `\n${violations.length} occurrence(s) of "Documenso" outside the allowlist${violations.length > shown.length ? ` (first ${shown.length} shown)` : ''}.` +
      '\nRename them (run with --all to see every one), or allowlist them in scripts/rebrand-allowlist.txt with a reason.',
  );
  process.exit(1);
}

console.log('check-rebrand: ok');
