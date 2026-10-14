'use strict';
// Windows Firewall and phone access. The phone reaches this PC on the phone port, through the
// program that serves it (node.exe for a folder copy, Session Switcher.exe for the installed app).
// Windows asks the first time; if that was answered Cancel, or the Wi-Fi is set as a public network,
// the phone never connects and nothing says why. This finds out, and fixes it with your OK (an
// administrator prompt): one rule letting this program in on private networks.
const RULE = 'Session Switcher (phone access)';
const q = s => `'${String(s).replace(/'/g, "''")}'`;

// { known, allowed, blocked, network: 'Private' | 'Public' | 'DomainAuthenticated' | null, program }
async function status(sys, { program, port }) {
  if (!sys.IS_WIN) return { known: false, program };
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$p = ${q(program)}`,
    '$rules = @(Get-NetFirewallApplicationFilter -Program $p | Get-NetFirewallRule | Where-Object { $_.Enabled -eq "True" -and $_.Direction -eq "Inbound" })',
    `$named = @(Get-NetFirewallRule -DisplayName ${q(RULE)} | Where-Object { $_.Enabled -eq "True" })`,
    '$allow = @($rules + $named | Where-Object { $_.Action -eq "Allow" -and ($_.Profile -match "Private|Any" -or $_.Profile -eq 0) }).Count',
    '$block = @($rules | Where-Object { $_.Action -eq "Block" }).Count',
    '$net = (Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne "Disconnected" } | Select-Object -First 1).NetworkCategory',
    "[Console]::Out.Write((ConvertTo-Json -Compress @{ allow = $allow; block = $block; net = [string]$net; on = [bool]((Get-NetFirewallProfile -Profile Private).Enabled) }))",
  ].join('\n');
  const r = await sys.runPowerShell(ps, { timeoutMs: 20000 });
  try {
    const j = JSON.parse(String(r.stdout).trim());
    return { known: true, program, port, firewallOn: !!j.on, allowed: j.allow > 0, blocked: j.block > 0, network: j.net || null };
  } catch { return { known: false, program, port }; }
}

// Asks Windows (an administrator prompt) to let this program in on private networks, and removes
// the block an earlier Cancel left. `alsoPrivate`: set the current Wi-Fi as a private network too.
async function fix(sys, { program, port, alsoPrivate = false, log = () => {} }) {
  if (!sys.IS_WIN) return { ok: false, error: 'Only on Windows.' };
  const inner = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$p = ${q(program)}`,
    'Get-NetFirewallApplicationFilter -Program $p | Get-NetFirewallRule | Where-Object { $_.Direction -eq "Inbound" -and $_.Action -eq "Block" } | Remove-NetFirewallRule',
    `Get-NetFirewallRule -DisplayName ${q(RULE)} | Remove-NetFirewallRule`,
    `New-NetFirewallRule -DisplayName ${q(RULE)} -Direction Inbound -Program $p -Protocol TCP -LocalPort ${Number(port)} -Action Allow -Profile Private,Domain | Out-Null`,
    ...(alsoPrivate ? ['Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq "Public" -and $_.IPv4Connectivity -ne "Disconnected" } | Set-NetConnectionProfile -NetworkCategory Private'] : []),
  ].join('; ');
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  // The prompt is Windows' own; saying No leaves everything as it was.
  const outer = `try { $x = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'; [Console]::Out.Write("done:" + $x.ExitCode) } catch { [Console]::Out.Write("declined") }`;
  const r = await sys.runPowerShell(outer, { timeoutMs: 120000 });
  const out = String(r.stdout || '').trim();
  if (/declined/.test(out)) return { ok: false, declined: true };
  log(`Firewall: let ${program} in on private networks (port ${port})${alsoPrivate ? ', and set this network as private' : ''}.`);
  return { ok: /done:/.test(out) };
}

module.exports = { status, fix, RULE };
