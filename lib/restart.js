'use strict';

const { spawn } = require('child_process');
const READY = 'switcher-restart-ready';

// Keep the current server alive until the replacement has loaded its code. A successful spawn
// alone does not mean that its server can start (a missing module or syntax error can exit next).
function startReplacement({ executable, args, cwd, env, spawnProcess = spawn, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    } catch (err) { reject(err); return; }
    let settled = false;
    const fail = err => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      reject(err);
    };
    const timer = setTimeout(() => {
      fail(new Error('The new copy did not become ready. This copy is still running.'));
      try { child.kill(); } catch { /* the replacement already exited */ }
    }, timeoutMs);
    child.on('error', fail);
    child.once('exit', code => fail(new Error(`The new copy exited before it was ready (code ${code}). This copy is still running.`)));
    child.on('message', message => {
      if (settled || !message || message.type !== READY || message.pid !== child.pid) return;
      settled = true; clearTimeout(timer);
      if (child.connected) child.disconnect();
      child.unref();
      resolve(child);
    });
  });
}

module.exports = { READY, startReplacement };
