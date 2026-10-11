#!/usr/bin/env node
// Hands a task to Codex as a sub-agent, on the ChatGPT plan that's next in Switcher's use-next
// order, so an orchestrating chat (say Opus) can have GPT do the research, the repro or the fix.
// Any chat can run it from its shell:
//
//   node bin/switcher-codex.js --cd ./worktree "Find why X happens; reproduce it; propose a fix"
//
// Options: --model (default gpt-5.6-sol), --effort (default medium), --sandbox (default
// workspace-write; read-only for research), --cd (the folder Codex works in; default here).
// Prints Codex's final message on stdout; its progress goes to stderr. Exit code is Codex's.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const cp = require('child_process');

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const model = opt('model', 'gpt-5.6-sol');
const effort = opt('effort', 'medium');
const sandbox = opt('sandbox', 'workspace-write');
const cwd = path.resolve(opt('cd', '.'));
const port = Number(opt('port', process.env.SWITCHER_PORT || 4777));
let task = args.join(' ').trim();
if (!task && !process.stdin.isTTY) task = fs.readFileSync(0, 'utf8').trim();
if (!task) { console.error('Usage: switcher-codex.js [--cd folder] [--model gpt-5.6-sol] [--effort medium] [--sandbox workspace-write|read-only] "the task"'); process.exit(2); }

// Which ChatGPT plan: the one Switcher says is next (falls back to Codex's own default home).
function useNextHome() {
  return new Promise(resolve => {
    let lock;
    try { lock = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `session-switcher-${port}.json`), 'utf8')); } catch { return resolve(null); }
    const req = http.request({ host: '127.0.0.1', port, path: '/api/lite/plans', headers: { Host: `127.0.0.1:${port}`, 'X-Switcher-Token': lock.token }, timeout: 15000 }, res => {
      let s = ''; res.setEncoding('utf8'); res.on('data', d => { s += d; });
      res.on('end', () => {
        try {
          const j = JSON.parse(s); const id = (j.order && j.order.chatgpt || [])[0];
          const plan = id && j.plans.find(p => p.id === id);
          resolve(id ? { id, label: plan ? plan.label : id, home: id === 'codex' ? (process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) : path.join(os.homedir(), `.${id}`) } : null);
        } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(null)); req.end();
  });
}

(async () => {
  const plan = await useNextHome();
  const env = { ...process.env };
  // Run as the plan, not as whatever chat called this (its own settings would point elsewhere).
  for (const k of Object.keys(env)) if (/^(OPENAI_|CODEX_)/.test(k)) delete env[k];
  if (plan) env.CODEX_HOME = plan.home;
  const out = path.join(os.tmpdir(), `switcher-codex-${process.pid}.txt`);
  process.stderr.write(`[switcher-codex] ${model} (${effort}) on ${plan ? `${plan.label} ChatGPT` : 'Codex’s default plan'}, in ${cwd}, ${sandbox}\n`);
  const p = cp.spawn('codex', ['exec', '--skip-git-repo-check', '-m', model, '-c', `model_reasoning_effort="${effort}"`, '-s', sandbox, '-C', cwd, '-o', out, task], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => process.stderr.write(d));
  p.stderr.on('data', d => process.stderr.write(d));
  p.on('close', code => {
    try { process.stdout.write(`${fs.readFileSync(out, 'utf8').trim()}\n`); fs.unlinkSync(out); } catch { /* nothing to print */ }
    process.exit(code || 0);
  });
})();
