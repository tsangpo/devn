const root = Bun.fileURLToPath(new URL('../', import.meta.url));
function git(args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error('Cannot inspect local Git files/history.');
  return result.stdout.toString();
}
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bnpm_[A-Za-z0-9]{30,}\b/,
  /\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{32,}\b/,
];
const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
const matches: string[] = [];
for (const file of files) {
  const source = Bun.file(root + '/' + file);
  if (!await source.exists()) continue; // Deleted tracked files are still covered by history.
  const data = await source.text();
  if (patterns.some(pattern => pattern.test(data))) matches.push('working file: ' + file);
}
const commits = git(['rev-list', '--all']).trim().split('\n').filter(Boolean);
for (const commit of commits) {
  const patch = git(['show', '--format=', '--no-ext-diff', '--root', commit]);
  if (patterns.some(pattern => pattern.test(patch))) matches.push('history commit: ' + commit);
}
if (matches.length) {
  console.error('Possible credentials found (values are intentionally omitted):\n' + matches.join('\n'));
  process.exitCode = 1;
} else {
  console.log('No known credential patterns found in ' + files.length + ' working files and ' + commits.length + ' reachable commits.');
  console.log('This check does not detect every custom key or confidential customer detail.');
}
