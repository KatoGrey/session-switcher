#!/usr/bin/env node
'use strict';
// The keeper (lib/keeper.js): holds the chats' processes so a Switcher restart doesn't end them.
// Started by Switcher: node bin/keeper.js <socket> <token file> <log file>
const fs = require('fs');
const net = require('net');
const path = require('path');
const { runKeeper } = require(path.join(__dirname, '..', 'lib', 'keeper.js'));

const [sock, tokenFile, logFile] = process.argv.slice(2);
if (!sock || !tokenFile) { console.error('usage: keeper.js <socket> <token file> [log file]'); process.exit(2); }
// Another keeper already on this socket: leave it be.
const probe = net.createConnection(sock);
probe.on('connect', () => { probe.destroy(); process.exit(0); });
probe.on('error', () => {
  try { fs.unlinkSync(sock); } catch { /* none */ }
  runKeeper({ sock, tokenFile, logFile: logFile || path.join(path.dirname(tokenFile), 'keeper.log') });
});
