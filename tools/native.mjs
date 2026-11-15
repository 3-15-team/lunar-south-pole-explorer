// Native task orchestration: no shell commands, environment assignments, or POSIX paths.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');
const py = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const env = { ...process.env, PYTHONPATH: join(root, 'services', 'compute') };

function npmCommand(...args) {
  // Running npm's JS entry point avoids npm.cmd shell quoting and execution-policy issues.
  const cli = process.env.npm_execpath ?? join(dirname(process.execPath),
    process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
  if (existsSync(cli)) return [process.execPath, cli, ...args];
  if (process.platform !== 'win32') return ['npm', ...args];
  throw new Error('Cannot locate npm-cli.js alongside Node. Use a standard Node installation.');
}

function run(command, cwd = root) {
  const result = spawnSync(command[0], command.slice(1), { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function science(...args) {
  if (!existsSync(py)) throw new Error('Run just setup-py first, or use just compose-up for the Docker-only workflow.');
  run([py, ...args]);
}

function dev() {
  if (!existsSync(py)) throw new Error('Run just setup-py first, or use just web-dev / just compose-up.');
  const commands = [npmCommand('run', 'dev'),
    [py, '-m', 'uvicorn', 'app.main:app', '--reload', '--port', env.COMPUTE_PORT ?? '8000']];
  const children = commands.map((command, i) => spawn(command[0], command.slice(1), {
    cwd: i === 0 ? web : root, env, stdio: 'inherit',
  }));
  let stopping = false;
  function stop(code) {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else child.kill('SIGTERM');
    }
    process.exitCode = code;
  }
  for (const child of children) {
    child.on('error', (error) => { console.error(error.message); stop(1); });
    child.on('exit', (code) => stop(code ?? 1));
  }
  process.on('SIGINT', () => stop(130));
  process.on('SIGTERM', () => stop(143));
}

try {
  const [task, ...args] = process.argv.slice(2);
  const webTasks = { build: 'build', check: 'check', 'web-dev': 'dev', preview: 'preview' };
  if (task === 'setup') run(npmCommand('ci', '--no-audit', '--no-fund'), web);
  else if (task in webTasks) run(npmCommand('run', webTasks[task]), web);
  else if (task === 'setup-py') {
    if (!existsSync(py)) run(['uv', 'venv', '--python', '3.12', join(root, '.venv')]);
    run(['uv', 'pip', 'install', '--python', py, '-r', 'requirements-dev.txt', '-e', 'libs/lunarcore']);
  } else if (task === 'dev') dev();
  else if (task === 'compute-dev') science('-m', 'uvicorn', 'app.main:app', '--reload', '--port', env.COMPUTE_PORT ?? '8000');
  else if (task === 'bootstrap') science('-m', 'pipeline.bootstrap');
  else if (task === 'serve-dist') {
    if (!existsSync(join(root, 'dist-static/index.html'))) throw new Error('Run just dist first.');
    science('-m', 'http.server', '8081', '--bind', '127.0.0.1', '--directory', join(root, 'dist-static'));
  } else if (['test-py', 'lint', 'data', 'dist', 'doctor', 'validate', 'smoke', 'api-smoke'].includes(task)) {
    science('tools/project.py', task, ...args);
  } else throw new Error(`Unknown task: ${task}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
