'use strict';
// What's in front right now: the program, where it's installed, its window's title, and whether it has the
// whole screen. Companion asks the moment its key is pressed, to put a question under the right game.
//
// Windows: one small PowerShell kept running, since starting one for each press would take most of a second.
// Mac: lsappinfo, which needs no permission. Either way it only reads, and if it can't say, the answer is
// "nothing known" and the question goes in General.
const { spawn, execFile } = require('child_process');

const WIN_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class SsFront {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int cb; public RECT mon; public RECT work; public int flags; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfoW(IntPtr m, ref MI i);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint a, bool i, uint p);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageNameW(IntPtr h, uint f, StringBuilder s, ref uint n);
  public static string Esc(string s) { var b = new StringBuilder(); foreach (char c in s ?? "") { if (c == '"' || c == '\\') b.Append('\\').Append(c); else if (c < 32) b.Append(' '); else if (c > 126) b.Append("\\u" + ((int)c).ToString("x4")); else b.Append(c); } return b.ToString(); }
  public static string Now() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "{}";
    var t = new StringBuilder(512); GetWindowTextW(h, t, 512);
    uint pid; GetWindowThreadProcessId(h, out pid);
    string path = ""; IntPtr p = OpenProcess(0x1000, false, pid);
    if (p != IntPtr.Zero) { var s = new StringBuilder(1024); uint n = 1024; if (QueryFullProcessImageNameW(p, 0, s, ref n)) path = s.ToString(); CloseHandle(p); }
    RECT r; GetWindowRect(h, out r);
    var m = new MI(); m.cb = Marshal.SizeOf(typeof(MI)); GetMonitorInfoW(MonitorFromWindow(h, 2), ref m);
    bool full = r.L <= m.mon.L && r.T <= m.mon.T && r.R >= m.mon.R && r.B >= m.mon.B;
    return "{\"hwnd\":" + h.ToInt64() + ",\"title\":\"" + Esc(t.ToString()) + "\",\"path\":\"" + Esc(path) + "\",\"fullscreen\":" + (full ? "true" : "false") + ",\"x\":" + ((r.L + r.R) / 2) + ",\"y\":" + ((r.T + r.B) / 2) + "}";
  }
}
'@
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line -eq 'now') { [Console]::Out.WriteLine([SsFront]::Now()) }
  elseif ($line -match '^focus (\d+)$') { [void][SsFront]::SetForegroundWindow([IntPtr][long]$Matches[1]); [Console]::Out.WriteLine('{}') }
  elseif ($line -eq 'bye') { break }
  [Console]::Out.Flush()
}
`;

const baseName = p => String(p || '').split(/[\\/]/).pop().replace(/\.exe$/i, '');

function createWindowsFront({ log = () => {} } = {}) {
  let proc = null, buf = '', ready = false;
  const waiting = [];
  function start() {
    if (proc) return;
    try {
      proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WIN_SCRIPT, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) { log(`Companion couldn’t watch what’s in front: ${err.message}`); proc = null; return; }
    ready = false; buf = '';
    proc.on('error', () => { proc = null; });
    proc.on('exit', () => { proc = null; ready = false; while (waiting.length) waiting.shift()(null); });
    proc.stdin.on('error', () => {});
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        if (line === 'ready') { ready = true; continue; }
        if (waiting.length) { let v = null; try { v = JSON.parse(line); } catch { /* not ours */ } waiting.shift()(v); }
      }
    });
  }
  const ask = (cmd, ms) => new Promise(res => {
    if (!proc) start();
    if (!proc) return res(null);
    let done = false;
    const answer = v => { if (done) return; done = true; clearTimeout(t); res(v); };
    const t = setTimeout(() => { const i = waiting.indexOf(answer); if (i >= 0) waiting.splice(i, 1); answer(null); }, ms);
    waiting.push(answer);
    try { proc.stdin.write(`${cmd}\n`); } catch { answer(null); }
    return undefined;
  });
  return {
    start,
    isReady: () => ready,
    async now(ms = 400) { const v = await ask('now', ms); return v && v.path !== undefined ? { ...v, process: baseName(v.path) } : null; },
    focus(hwnd) { if (hwnd) ask(`focus ${Number(hwnd)}`, 300); },
    stop() { if (proc) { try { proc.stdin.write('bye\n'); proc.stdin.end(); } catch { /* gone */ } const p = proc; setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 500).unref(); proc = null; } },
  };
}

function createMacFront() {
  const run = (args, ms) => new Promise(res => execFile('lsappinfo', args, { timeout: ms }, (err, out) => res(err ? '' : String(out))));
  return {
    start() {}, isReady: () => true, focus() {}, stop() {},
    async now(ms = 400) {
      const asn = (await run(['front'], ms)).trim();
      if (!asn) return null;
      const info = await run(['info', '-only', 'name,executablepath', asn], ms);
      const name = (info.match(/"?LSDisplayName"?="([^"]*)"/) || [])[1] || '';
      const file = (info.match(/"?(?:CFBundleExecutablePath|executablepath)"?="([^"]*)"/i) || [])[1] || '';
      return { title: name, process: name, path: file, fullscreen: false };
    },
  };
}
const createFront = opts => (process.platform === 'win32' ? createWindowsFront(opts) : process.platform === 'darwin' ? createMacFront(opts) : { start() {}, isReady: () => false, focus() {}, stop() {}, now: async () => null });

module.exports = { createFront, baseName };
