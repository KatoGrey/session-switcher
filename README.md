# Session Switcher

Session Switcher lists every Claude Code chat on this PC, and your Codex chats too. You can resume any Claude chat as whichever of your Claude accounts you choose, and each account is locked to the email and plan it should use. The hub shows which chats are working, which are waiting on you, and how much of each plan's usage is left.

## What you need

- Windows 10 or 11.
- Node.js (LTS), from https://nodejs.org.
- Claude Code, signed in at least once. Setup can install or update it for you.
- Optional: Codex (OpenAI's coding agent) and a ChatGPT plan. Setup can install it too.

## Install or update

1. Unzip this folder somewhere permanent, for example `C:\Users\<you>\Apps\Session Switcher`.
   - Updating? Unzip over the old copy. Your `accounts.json`, `history.json`, `chat-names.json`, `projects.json`, `banners.json` and `prompts.json` are kept.
2. Double-click **Claude Switcher.vbs**. It opens as its own window, with no console.
3. Open **Setup** (the gear, top right) and click **Create desktop shortcut**.

`Start Claude Switcher.bat` does the same with a visible log window, which is useful if something goes wrong.

## First-time account setup

Session Switcher starts with one account, **Main account**: the Claude Code sign-in you already use.

1. **Lock your main account** (optional, recommended):
   - On its card under **Accounts and usage**, check the email shown.
   - If it's wrong, click **Switch sign-in**, enter the right email, and finish in the browser.
   - Click **Lock to this plan**. From then on, chats only open if it's still signed in as that email and organization.
2. **Add another account** (optional):
   - Click **Add another Claude account** and give it a name you'll recognize, like "Work" or "Personal".
   - Enter that account's email and finish in the browser.
   - If the sign-in page asks which organization to use, pick the one whose plan you want this account to use.
   - Click **Lock to this plan**.
   - Tip: if your browser is already signed in to a different Claude account, paste the sign-in link into a private window.

The panel at the top left of the sidebar shows which account new chats open as. Click it to switch.

## The hub

The hub is the main screen. Its sections, from the top:

- **The headline:** a live sentence about right now, such as "Three chats await you. One needs your OK and two have replied." It also says how much of your current account's usage is left, and when it resets.
- **Awaiting you:** every chat where the next move is yours.
  - **Needs your OK:** Claude wants to run a command or edit a file. You can **Allow**, **Always allow** or **Deny** right on the card.
  - **Has a question:** Claude asked a multiple-choice question. **Answer it** opens the chat.
  - **Your turn:** Claude finished and is waiting on you. The card shows its last line.
    - Type a reply right on the card and press Enter. It goes to the chat without opening it.
    - **Mark as read** moves the card out of the list. Opening the chat does the same.
  - **Waiting in its terminal:** a terminal chat that looks stuck on a prompt there.
- **At work:** chats that are thinking, writing or running a tool. Each card shows:
  - the step it's on and its latest line
  - how long the current turn has taken
  - a small activity graph
- **Accounts and usage:** one card per account with a usage dial.
  - The inner ring is the five-hour window; the outer ring is the week.
  - The gold dots show how much of each window has passed. If the ring is ahead of the dot, you're using it faster than time passes.
  - The card also shows:
    - the reset times, with a countdown
    - per-model weekly limits and extra usage, when your plan has them
    - a warning if, at the current pace, a window runs out before it resets
  - When another account has much more room, the hub suggests switching.
- **Your projects:** every folder you work in, as a card with its banner (see below), plus **New project**.
- **Recent chats:** the latest chats from every folder.

The top bar is visible everywhere:

- It shows how many chats are at work and how many await you.
- It names the account in plain words: "New chats open as" on the hub, "This chat runs as" inside a chat.
- It shows that account's 5-hour window and week separately, each with its reset time.

The window title shows the count too, for example "(2) Session Switcher".

Each account has its own color: a ring on its usage dial, the edge of the top bar's account panel, and a line across the top of any chat running as it.

## New project

Click **New project** (on the hub, in the sidebar, or in `Ctrl+K`) to start something new:

1. **Make a new folder**: give it a name and pick where it goes.
   - The location starts where your other projects live, and the buttons under it offer the other folders you use.
   - **Browse…** opens Windows' own folder window, or you can type or paste a path.
   - It shows the full path it will create before you click **Create project**.
   - If that folder already exists, it offers to use it as it is.
2. **Or use a folder you already have**: pick it, and it joins your projects. Nothing in it is moved or changed.
3. **Start a chat in it as** any of your Claude accounts, or Codex, or no one yet. Accounts that aren't signed in, or aren't on their locked plan, can't be picked, and each one shows how much usage it has left.
4. **Start with** a prompt if you like. It waits in the message box so you can adjust it before sending.

A new project with no chats yet appears under **No chats yet** in the sidebar until its first chat. If you change your mind, its page's **⋯** menu has **Remove from the list**. The folder itself is never deleted.

## Your projects

Every folder you've worked in is a project. The hub shows them all under **Your projects**:

- **The banner** is the project's cover picture. Session Switcher picks a picture named like `cover`, `banner`, `key-art`, `hero` or `title`, or else the largest picture near the top of the folder. Projects without pictures get a soft gradient and their initial instead.
- **Today:** how many chats, documents and pictures changed in that project today.
- **Continue** reopens its latest chat. **New chat** starts a Claude or Codex chat there, plain or from a prompt.

Click a banner and it opens into the project's own page, with three tabs:

- **Chats:** every chat in that project, with All / Claude Code / Codex filters when it has both.
- **Documents:** every markdown file in the folder, like notes, reviews, plans and release notes.
  - They're grouped into Today, This week and Earlier.
  - Type in **Filter documents** to narrow them down.
  - Click one to read it formatted, or to copy its markdown.
- **Gallery:** every picture in the folder, newest first.
  - Click one to view it full size. `←` and `→` step through the rest.
  - **Use as banner** makes it the project's banner, from the gallery or from the full-size view. **Use the automatic banner** undoes that.
  - No pictures yet? With Codex signed in, **Make a cover image with Codex** starts a chat that makes one.

Build and dependency folders like `node_modules` are skipped, so big projects stay quick. Your user folder isn't treated as a project: only its top level is shown, and it never gets a banner by itself.

## Prompts

Prompts are reusable starts for the jobs you repeat. These come with the app:

- Get oriented
- Fix a bug
- Plan a change
- Review today's changes
- Write release notes
- Write the README
- Add tests
- Cover image (runs in Codex)

`{project}` becomes the project's folder name and `{date}` today's date. For example, "Write release notes" asks for `RELEASE-NOTES-2026-10-09.md`. Anything else in braces, like `{describe what goes wrong}`, is a blank: the message box selects it so you can type over it.

There are four ways to use a prompt:

- **Start with a prompt** on a project page, or **New chat** on a project card, opens a new chat with the prompt waiting in the message box. Adjust it, then press Enter.
- **Type `/`** in an empty message box, like `/bug` or `/readme`.
  - `Tab` inserts the highlighted prompt. `↑` and `↓` choose another, and then `Enter` inserts it.
  - `Enter` on its own sends what you typed, so Claude Code's own commands like `/compact` still work.
- **Prompts** under the message box lists them all.
- **`Ctrl+K`:** type a prompt and a project, like "readme website".

To change them, choose **Edit prompts…** from any of those menus. You can rename, rewrite, add or remove prompts, and choose whether each runs in Claude or Codex.

- **Add a starter set** adds a ready-made set to yours. **Interactive fiction and games** has a balance pass, playtest and review, patch notes, new NPC, new story start, lore check, faction reputation tiers and key art.
- **Restore the starter prompts** puts the originals back.

A new chat opens on its project: its banner, its name, and your prompts one click away.

## Handing it to someone else

Session Switcher has nothing personal built in, so you can give it to anyone:

1. In **Setup**, click **Make a copy to share**.
   - It saves a zip on your Desktop with the app only.
   - None of your accounts, sign-ins, chats, chat names, projects or banners go in it.
   - Tick **Include my prompts** if you want them to start with yours.
2. Send them the zip. They unzip it, double-click **Claude Switcher.vbs**, and follow **First-time account setup** above with their own accounts.

Sign-ins never live in the app's folder. Each Claude account signs in through its own folder in your user profile: `.claude`, or `.claude-<name>` for extra accounts. Codex uses `.codex`. So even a plain copy of the app's folder carries no sign-ins. The zip is still the tidy way, because it also leaves out your account list, settings and history.

## The chat window

Click **Open** on any chat, or **New chat** in a folder. The chat runs in Session Switcher's own window, as the account you picked.

- **Running now (left):** every running chat, for one-click switching. `Alt+↑` and `Alt+↓` move between them.
- **The conversation:**
  - Replies are formatted, with tables and copyable code.
  - Tool steps are compact rows that open to show the command, the edit or the output.
  - Artifacts appear as cards, and images can be pasted, dropped or attached.
  - Notices are slim banners.
- **Permission requests:** a card above the message box with **Allow**, **Always allow** and **Deny**. Claude's multiple-choice questions show as clickable options.
- **Links to files:** file names Claude mentions, like `PATCH-NOTES.md` or `fb5-playtest/`, are clickable.
  - They open in a viewer inside the app, with the full path, **Copy markdown**, **Copy path** and **Show in folder**.
  - Markdown shows formatted, or switch to **Markdown** to see the source.
  - Folders can be browsed.
- **The ledger (right):** what this chat produced:
  - artifacts
  - files it pointed to
  - files it changed
  - its task list
  - the commands it ran
  - the account's usage
  - Hide or show the ledger with the button at the top right of the chat.
- **Controls:**
  - The selector in the header sets what Claude may do without asking.
  - **Stop** (or Esc) interrupts Claude. You can type while it works to queue your next message.
  - **⋯ → Move to a terminal** continues the chat in a terminal as the same account.

Behind the scenes this is Claude Code itself, run in its official streaming mode, so your settings, CLAUDE.md, skills, MCP servers and hooks all apply. A few things exist only in the terminal interface, like `/login` or interactive `/rewind`; use **Resume in a terminal** for those.

### Watching chats that run elsewhere

Chats running in a terminal, or recently used in the desktop app, also appear on the hub. Click one to **watch it live**: you can read along as it works, but you reply in its own window.

**Open a copy here** branches the chat so you can continue it in the app without touching the original.

## Codex (OpenAI)

If you have Codex, the OpenAI coding agent, and a ChatGPT plan, Session Switcher works with it the same way:

- **Sign in:** on the hub's **Codex** card, click **Sign in with ChatGPT**. A small window shows the sign-in address (always OpenAI's, `auth.openai.com`), with:
  - **Open the ChatGPT sign-in page**, or **Copy link** for a private window if your browser is signed in to a different ChatGPT account.
  - **Use a code instead**: enter a short code on OpenAI's site from any browser or device.
  - The window closes by itself once Codex is signed in.
  - Not installed yet? The card's **Install Codex** button installs it (it needs Node.js, which you already have).
- **Your Codex chats** have their own section in the sidebar, below **Claude Code**. Codex is marked in blue everywhere (its dot, tags and dial), so you can tell it apart from Claude at a glance. Each folder appears in whichever sections have chats in it. **Recent chats** has All / Claude Code / Codex tabs, and Codex rows carry a **Codex** tag everywhere. Chats you started with the Codex CLI in a terminal are included.
- **Open** runs the chat in Session Switcher's window, just like a Claude chat:
  - Replies stream in, steps are shown, and approvals and questions appear as cards.
  - **Pictures Codex makes appear in the chat as it makes them.** Each has **Open**, **Show in folder** and **Copy path**, and they're listed in the ledger under **Images it made**.
  - The mode selector offers Codex's own modes: **Ask before acting**, **Agent**, **Read only** and **Full access**.
- **New Codex chat** is on the Codex card (pick a folder), on every folder page, and in `Ctrl+K` (type “codex” and a folder name). The **⋯** menu can also resume a Codex chat in a terminal (`codex resume`), open a copy, rename it, or copy the command.
- **Usage:** the Codex card has the same dial: the 5-hour window, the week, and any separate limits, like images.

Turn Codex off, or set the path to it, in Setup.

## Regular Claude chats

Your claude.ai conversations live on Anthropic's servers, not on this PC, so they can't be listed inside this app.

Instead, every account card has a **claude.ai** button. It opens claude.ai in a window of its own for that account, and that window stays signed in separately from your other accounts. You sign in once per account, then both are always one click away.

The Codex card does the same for **chatgpt.com**.

## Alerts

When a chat needs you or replies, Session Switcher can:

- play a soft chime (on by default), except for the chat you're looking at
- show a Windows notification while the window is in the background

Turn these on or off from the **Live** pill at the bottom right, or in Setup. The drifting petals can be turned off there too; they stay off if Windows is set to reduce motion.

## Animations

A few things move, to show what changed:

- A project's banner carries over into its page when you open it, and back again.
- The projects rise in the first time you scroll to them.
- The usage dials draw themselves when the hub opens.
- The seal at the top left turns slowly while chats are at work.
- New messages and steps fade in.
- Pictures Codex makes come into focus as they finish.

Turn **Animations** off in Setup to keep everything still. It's also off automatically if Windows is set to reduce motion.

## Shortcuts

| Keys | What it does |
|---|---|
| `Ctrl+K` or `/` | Jump to any chat, project, document, prompt or action, or search inside every message |
| `/` in the message box | Pick a saved prompt |
| `←` / `→` | Step through a project's pictures in the full-size view |
| `Alt+↑` / `Alt+↓` | Switch between running chats in the chat window |
| `Enter` | Send. Use `Shift+Enter` for a new line |
| `Esc` | Stop Claude, or close what's open |

## Everyday use

- Click a chat's title to see its details and latest messages before opening it.
- The **⋯** menu on a chat holds the rest:
  - **Resume as a copy:** branches the chat and leaves the original untouched.
  - **Open in the desktop app**
  - **Watch it live**
  - **Browse this chat's folder**
  - **Rename chat**
  - **Copy terminal command**
  - **Show transcript file**
- The app warns before you open a chat that's already running somewhere.

## What keeps it safe

- **Locks:** a locked account won't open chats unless Claude Code confirms it's signed in as the right email and organization. The check reruns before every launch, and immediately after any sign-in change.
- **Usage checks use no usage:** they ask Claude Code for the same numbers its `/usage` screen shows, without sending a message.
- **API keys are ignored:** an `ANTHROPIC_API_KEY` or similar set on your PC is ignored when opening chats, so the account you pick is always the one used. This can be turned off in Setup.
- **Shared data for extra accounts:** every extra account shares your main account's:
  - chats and checkpoints (`/rewind`)
  - task lists and plans
  - skills, agents, commands, rules, output styles and plugins
- **Synced settings:**
  - Settings, CLAUDE.md and keybindings are copied over whenever the main copy is newer.
  - MCP servers, approved tools and trusted folders are added if the account lacks them, never overwritten.
- **The file viewer only reads:**
  - It opens files inside the chat's folder or your user folder, never anything else.
  - Hidden folders like `.ssh` stay closed, and sign-in files never open.
- **Nothing is deleted:**
  - "Merge and share" moves files into your main folder and keeps the account's old folder aside.
  - Removing an account keeps its sign-in folder.
- **Crash-safe settings:** `accounts.json` is written atomically, with a backup, and restored automatically if it's ever damaged.
- **Local only:** the app listens only on 127.0.0.1, and every request needs a per-launch token. Requests from other websites are refused, and the fonts are bundled, so nothing loads from the internet.

## Setup & health

The gear's dot turns gold or red when something needs attention. Setup checks:

- Node.js and the Claude Code version
- your chats folder
- each account's sign-in and lock
- each extra account's shared data
- sign-in overrides set on the PC

Fixes are one click: update Claude Code, sign in, merge and share, or set the `claude` path. The preferences there cover:

- alerts, petals and animations
- where chats open
- your terminal
- the sync options
- the app window

## Files

- `server.js`: the local server.
- `lib/`:
  - `accounts.js`: sign-ins, locks, sharing.
  - `sessions.js`: the chat list, previews, search.
  - `chat.js`: the chat window's engine and live activity.
  - `usage.js`: plan usage per account.
  - `codex.js`: Codex chats, sign-in and usage.
  - `projects.js`: each project's documents, pictures and banner, new and added projects, and the prompts.
  - `sharecopy.js`: **Make a copy to share**.
  - `files.js`: the file viewer.
  - `system.js`: terminals and processes.
  - `health.js`: the Setup checks.
  - `store.js`: safe file writes.
- `index.html`, `styles.css`, `app.js`: the hub.
- `chat-ui.js`: the chat window.
- `fonts/`: the bundled typefaces (SIL Open Font License).
- Created as you use it:
  - `accounts.json`: your accounts and preferences.
  - `history.json`: which account last opened each chat.
  - `chat-names.json`: your chat renames.
  - `projects.json`: projects you created or added here.
  - `banners.json`: the banners you picked.
  - `prompts.json`: your prompts, once you edit them.
  - `switcher.log`: the app's log.

Session Switcher never edits your chat files.
