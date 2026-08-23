import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ensureWorkspaceDependencies,
  workspaceDependenciesReady,
  type WorkspaceCommandRunner,
} from '../src/build/dependencies.js';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`✅ ${label}`);
  else { failures++; console.error(`❌ ${label}`, detail ?? ''); }
}

const root = await mkdtemp(path.join(tmpdir(), 'factory-deps-'));
try {
  await writeFile(path.join(root, 'package.json'), '{"name":"fixture","private":true}');
  check('fresh workspace has no usable Next install', !workspaceDependenciesReady(root));

  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const install: WorkspaceCommandRunner = async (command, args, cwd) => {
    calls.push({ command, args, cwd });
    await mkdir(path.join(cwd, 'node_modules', '.bin'), { recursive: true });
    await writeFile(path.join(cwd, 'node_modules', '.bin', 'next'), 'fixture');
    return { code: 0, output: 'installed' };
  };

  const first = await ensureWorkspaceDependencies(root, install);
  check('missing dependencies are installed before the builder runs', first.installed);
  check(
    'dependency bootstrap uses the frozen workspace lockfile',
    calls.length === 1
      && calls[0]?.command === 'pnpm'
      && calls[0]?.args.join(' ') === 'install --frozen-lockfile'
      && calls[0]?.cwd === root,
    calls,
  );
  check('workspace is ready after bootstrap', workspaceDependenciesReady(root));

  const second = await ensureWorkspaceDependencies(root, install);
  check('an already installed workspace is not installed twice', !second.installed && calls.length === 1);

  const broken = await mkdtemp(path.join(tmpdir(), 'factory-deps-broken-'));
  try {
    await writeFile(path.join(broken, 'package.json'), '{"name":"broken","private":true}');
    let message = '';
    try {
      await ensureWorkspaceDependencies(broken, async () => ({ code: 1, output: 'registry unavailable' }));
    } catch (error) {
      message = String((error as Error).message);
    }
    check('install failure is explicit and keeps the useful command output',
      message.includes('registry unavailable'), message);
  } finally {
    await rm(broken, { recursive: true, force: true });
  }

  const falseSuccess = await mkdtemp(path.join(tmpdir(), 'factory-deps-false-success-'));
  try {
    await writeFile(path.join(falseSuccess, 'package.json'), '{"name":"false-success","private":true}');
    let message = '';
    try {
      await ensureWorkspaceDependencies(falseSuccess, async () => ({ code: 0, output: 'done' }));
    } catch (error) {
      message = String((error as Error).message);
    }
    check(
      'a successful install exit still requires the Next binary',
      message.includes('node_modules/.bin/next is missing'),
      message,
    );
  } finally {
    await rm(falseSuccess, { recursive: true, force: true });
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n🧪 WORKSPACE DEPENDENCY TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
