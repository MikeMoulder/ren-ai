#!/usr/bin/env node
// Runs backend + frontend dev servers together with prefixed, colored output.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'backend ', color: '\x1b[36m', cmd: 'npm', args: ['--prefix', 'backend', 'run', 'dev'] },
  { name: 'frontend', color: '\x1b[35m', cmd: 'npm', args: ['--prefix', 'frontend', 'run', 'dev'] },
];

const children = procs.map((p) => {
  const child = spawn(p.cmd, p.args, { shell: process.platform === 'win32' });
  const tag = `${p.color}[${p.name}]\x1b[0m `;
  const pipe = (stream) => stream.on('data', (d) => {
    d.toString().split('\n').filter(Boolean).forEach((line) => process.stdout.write(tag + line + '\n'));
  });
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
});

const shutdown = () => { children.forEach((c) => c.kill('SIGINT')); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
