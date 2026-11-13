'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'skills', 'cross-model-pr-review', 'SKILL.md');
const bad = message => Object.assign(new Error(message), { status: 400 });
function parseUrl(value) {
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d{0,8})(?:[/?#].*)?$/i.exec(String(value || '').trim());
  if (!m) throw bad('Paste a GitHub pull request URL, like https://github.com/latitudegames/latitude/pull/123.');
  return { repo: m[1], n: Number(m[2]), url: `https://github.com/${m[1]}/pull/${m[2]}` };
}
function prompt(url, { instructions = '', model = '', effort = '' } = {}) {
  const pr = parseUrl(url);
  for (const [name, v] of Object.entries({ instructions, model, effort })) if (typeof v !== 'string' || v.length > (name === 'instructions' ? 6000 : 100)) throw bad(`${name} is too long or isn't text.`);
  return ['Run the bundled cross-model-pr-review skill below. You are Codex, adjudicating the review.',
    `PR URL: ${pr.url}`,
    model.trim() ? `User-selected Claude model (literal CLI argument): ${JSON.stringify(model.trim())}` : 'Claude model: use the CLI default; omit --model.',
    effort.trim() ? `User-selected Claude effort (literal CLI argument): ${JSON.stringify(effort.trim())}` : 'Claude effort: use the CLI default; omit --effort.',
    instructions.trim() ? `Additional user instructions for Codex (keep Claude’s first message exactly as the skill specifies):\n${instructions.trim()}` : '',
    '', fs.readFileSync(file, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')].filter(Boolean).join('\n\n');
}
module.exports = { parseUrl, prompt };
