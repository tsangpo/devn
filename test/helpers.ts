const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devn-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'cli');
  const home = path.join(dir, 'home');
  const project = path.join(dir, 'project with spaces');
  const bin = path.join(dir, 'bin');
  for (const folder of [repo, home, project, bin]) fs.mkdirSync(folder, { recursive: true });
  for (const folder of ['src', 'bin']) fs.cpSync(path.join(root, folder), path.join(repo, folder), { recursive: true });
  fs.cpSync(path.join(root, 'package.json'), path.join(repo, 'package.json'));
  fs.cpSync(path.join(root, 'profiles'), path.join(repo, 'profiles'), { recursive: true });
  const original = JSON.parse(fs.readFileSync(path.join(root, 'profiles/example.json')));
  function addProfile(id) {
    const profile = structuredClone(original);
    Object.assign(profile, { id, name: id, example: false, baseUrl: `https://${id}.example.test` });
    for (const tool of ['codex', 'claude']) {
      const first = profile[tool].models[0];
      first.id = `${id}/${tool}-one`;
      profile[tool].defaultModel = first.id;
      profile[tool].models.push({ ...structuredClone(first), id: `${id}/${tool}-two`, name: 'Second model' });
    }
    write(path.join(home, 'devn/profiles', id, 'profile.json'), profile);
    return profile;
  }
  const a = addProfile('a');
  const b = addProfile('b');
  const capture = path.join(dir, 'capture.json');
  const env = { ...process.env, XDG_CONFIG_HOME: home, PATH: `${bin}:${process.env.PATH}`, TEST_CAPTURE: capture };
  // Spawn actual standalone CLIs, not nested node:test/npm lifecycle workers.
  for (const name of Object.keys(env)) {
    if (name.startsWith('npm_') || name.startsWith('NODE_TEST_') || name.startsWith('NODE_CHANNEL_')) delete env[name];
  }
  for (const tool of ['codex', 'claude']) {
    fs.writeFileSync(path.join(bin, tool), `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path');
fs.writeFileSync(process.env.TEST_CAPTURE, JSON.stringify({
  tool:${JSON.stringify(tool)}, args:process.argv.slice(2), cwd:process.cwd(),
  codex:process.env.CODEX_HOME, claude:process.env.CLAUDE_CONFIG_DIR,
  oldOpenai:process.env.OPENAI_API_KEY, oldAnthropic:process.env.ANTHROPIC_AUTH_TOKEN,
  oldBedrock:process.env.CLAUDE_CODE_USE_BEDROCK,
  config:fs.readFileSync(path.join(process.env.${tool === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'},${JSON.stringify(tool === 'codex' ? 'config.toml' : 'settings.json')}),'utf8')
}));
if(process.env.TEST_WAIT){process.on('SIGINT',()=>process.exit(130));console.log('READY');setInterval(()=>{},1000);}
else {console.log('TOOL OUTPUT');process.exit(Number(process.env.TEST_EXIT||0));}
`, { mode: 0o755 });
  }
  function init(id, key = `secret-${id}`) {
    const file = path.join(home, 'devn/config.toml');
    const config = fs.existsSync(file) ? Bun.TOML.parse(fs.readFileSync(file, 'utf8')) : { version: 1, profiles: {} };
    const profile = read(path.join(home, 'devn/profiles', id, 'profile.json'));
    config.profiles[id] = { url: 'http://127.0.0.1:1/profile.json', key, origins: {
      codex: new URL(profile.codex.baseUrl || profile.baseUrl).origin,
      claude: new URL(profile.claude.baseUrl || profile.baseUrl).origin,
    } };
    fs.writeFileSync(file, Bun.TOML.stringify(config), { mode: 0o600 });
  }
  function run(args, options = {}) {
    return spawnSync(process.execPath, [path.join(repo, 'bin/devn'), ...args], {
      cwd: project, env, encoding: 'utf8', timeout: 15000, ...options,
    });
  }
  function start(args, options = {}) {
    return spawn(process.execPath, [path.join(repo, 'bin/devn'), ...args], { cwd: project, env, ...options });
  }
  return { dir, repo, home, project, bin, capture, env, a, b, init, run, start, addProfile };
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
module.exports = { fixture, write, read, root };
