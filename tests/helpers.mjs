/**
 * Shared harness for the test suites: spawns real `next start` production servers
 * on free ports and waits for readiness.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_MARKER = path.join(ROOT, '.next', 'BUILD_ID');
export const BUILD_EXISTS = fs.existsSync(BUILD_MARKER);
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

export const BROKEN_PACK = path.join(os.tmpdir(), 'breachloop-test-broken-pack');

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** A pack with one unparseable file and one structurally invalid file. */
export function writeBrokenPack() {
  fs.mkdirSync(BROKEN_PACK, { recursive: true });
  fs.writeFileSync(path.join(BROKEN_PACK, 'unparseable.json'), '{ this is not json');
  fs.writeFileSync(
    path.join(BROKEN_PACK, 'malformed.json'),
    JSON.stringify({
      id: 'malformed',
      name: 'Malformed Pack',
      scenario_type: 'attack',
      events: [],
      principals: [{ note: 'no arn' }],
      roles: 'not-an-array',
      candidate_remediations: [
        { id: 'x', title: 'x', remediation_type: 'nonsense', target_arn: 'a', description: 'd' },
      ],
    })
  );
}

/**
 * `next start` directly (not via npx) and detached, so teardown can kill the
 * whole process group — otherwise the server outlives the test run and
 * `node --test` never exits.
 */
export function startServer(port, env = {}) {
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  child.log = () => log;
  return child;
}

export async function waitForReady(base, child, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return true;
    } catch {
      /* not listening yet */
    }
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode}):\n${child.log()}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server never became ready:\n${child.log()}`);
}

export function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

export async function get(base, pathname, init) {
  const response = await fetch(`${base}${pathname}`, { ...init, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON bodies are asserted on directly */
  }
  return { status: response.status, json, text, headers: response.headers };
}

export function postBody(body) {
  return {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body),
  };
}
