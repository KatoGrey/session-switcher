---
name: cross-model-pr-review
description: Review a pull request in one persistent Claude Code chat, then have Codex adjudicate the findings and return fixes and responses to that same chat. Use when the user asks for cross-model, Claude, Fable, or Opus review of a PR.
---

# Cross-Model PR Review

Use one Claude Code chat for the entire review. Do not create a worktree or fork the Claude session.

## Setup

Require a PR URL. Add `--model` and `--effort` only when the user specifies them; otherwise use the Claude CLI defaults. When specified, use the same model and effort on every turn.

## Persistent Codex Instructions

Claude will provide you a review. Now, you are to be the voice of reason in this exchange. Take Claude’s comments adversarially. If there are things that are edge cases that can never be reached, things that are so unrealistic that they will never affect users, requests that drastically exceed scope, comments that violate established principles, require significant new code just to support tests, or something else that would decrease the quality of the PR, push back. Provide your reasoning when you respond to Claude. Often, iterative changes between AI agents leads to overfitting to niche things that can never happen and extremely bloated PRs. We want to avoid this. We’ve also had a real issue with test bloat so avoid adding tests in response to Claude’s review. I trust you to exercise good engineering judgment and be pragmatic. Try to keep the code clean.

## Persistent Claude Code Instructions

I want you to review this PR. First, look for what it does and explain it in plain English. Then, check that the work is in-scope. Look for correctness issues. Check for anything that violates existing paradigms. If it missed using a shared helper or established paradigm, flag it. Focus on real issues, not impossible edge cases or inconsequential items. Don’t suggest improvements to tests unless necessary for CI purposes. I want your review to focus on the things that matter.

## Workflow

Start Claude Code in the current directory with `claude -p`, `--permission-mode plan`, and `--output-format json`. Do not create a worktree. Pass a non-empty prompt to that process via a quoted heredoc; never run bare `claude -p`. Replace the placeholders below with the actual text:

```bash
claude -p --permission-mode plan --output-format json [optional model and effort flags] <<'CLAUDE_PROMPT'
<Persistent Claude Code Instructions exactly as written above>

<PR URL>
CLAUDE_PROMPT
```

The first message must contain only the Persistent Claude Code Instructions followed by the PR URL. Do not add Codex’s instructions, a summary, or any other preamble.

Save the returned `session_id`. Use the Persistent Codex Instructions to verify every finding and decide whether it would materially improve the PR. Make and verify only the changes Codex accepts.

Resume the same chat by passing the follow-up to the process via a quoted heredoc:

```bash
claude -p --resume '<session_id>' --permission-mode plan --output-format json [optional model and effort flags] <<'CLAUDE_PROMPT'
<summary, finding-by-finding responses, and re-review request>
CLAUDE_PROMPT
```

Send a summary of the changes Codex made, a response to every Claude finding including Codex’s reasoning for rejected findings, and a request to re-review the current PR.

Evaluate the new review, make any worthwhile changes, and repeat through the same `session_id`. Never fork the session or start a replacement chat.

Stop when Codex is satisfied that no unresolved finding would materially improve the PR. Give a new rejected finding one response and one opportunity for Claude to provide materially new evidence. Repetition without new evidence, impossible or negligible edge cases, scope expansion, test bloat, and changes made only to obtain reviewer agreement are convergence signals, not reasons to edit.

Do not impose a round limit. Converge based on engineering judgment rather than Claude’s agreement.

On Windows, use Bash's quoted heredoc when available. In PowerShell, the equivalent is a literal single-quoted here-string piped into `claude -p` with the same flags. Preserve the prompt verbatim, provide it on every invocation, and capture stdout and stderr separately. Do not interpolate user text into shell commands.

Read the repository's instructions before editing. Inspect the working tree and branch first; preserve unrelated work. If the PR branch cannot be used safely in the current directory, explain the conflict instead of creating a worktree. Re-review local changes as well as the PR diff; don't push, publish review comments, resolve threads, or merge unless the user has authorized that action.

## Failure handling

Preserve and read Claude’s actual stdout and stderr before diagnosing a failure.

“Input must be provided” means the invocation omitted the prompt. Correct the command and retry; it is not an authentication failure.

A workspace-trust warning is not an authentication failure. Report it as a trust issue only if it actually prevents the review. Do not launch interactive Claude merely to test authentication.

Never infer authentication state from `ANTHROPIC_API_KEY`; Claude subscription OAuth does not require that environment variable.

Before asking the user to log in, run `claude auth status --json`. Ask for `claude auth login` only when it reports `loggedIn: false` or Claude returns an explicit authentication rejection such as a 401 or expired credential.
