# Session Switcher

Session Switcher lists every Claude Code chat on this computer (Windows or Mac), and your Codex chats too. You can resume any Claude chat as whichever of your Claude accounts you choose, and each account is locked to the email and plan it should use. The hub shows which chats are working, which are waiting on you, and how much of each plan's usage is left.

## What you need

- Windows 10 or 11, or macOS.
- Node.js (LTS), from https://nodejs.org (on a Mac, `brew install node` works too).
- Claude Code, signed in at least once. Setup can install or update it for you.
- Optional: Codex (OpenAI's coding agent) and a ChatGPT plan. Setup can install it too.

## Install or update

1. Unzip this folder somewhere permanent, for example `C:\Users\<you>\Apps\Session Switcher`.
   - Updating? Unzip over the old copy. Your `accounts.json`, `history.json`, `chat-names.json`, `projects.json`, `banners.json` and `prompts.json` are kept.
   - You don't need to quit first. When you start it again, it sees that the copy still running is out of date, closes that one, and opens the new one. Chats running in the old window stop; they pick up where they left off when you open them again.
2. Double-click **Claude Switcher.vbs**. It opens as its own window, with no console.
3. Open **Setup** (the gear, top right) and click **Create desktop shortcut**.

`Start Claude Switcher.bat` does the same with a visible log window, which is useful if something goes wrong.

### On a Mac

1. Clone or unzip the folder somewhere permanent, for example `~/Apps/session-switcher`.
2. Double-click **Session Switcher.command**. It opens Session Switcher as its own Chrome window (or in your default browser without Chrome), and its Terminal window shows the log. If macOS says it can't verify the file, right-click it and choose **Open** once.
3. Open **Setup** (the gear) → **App** and click **Add to Applications**. That puts **Session Switcher** in `~/Applications`, so Spotlight and Launchpad find it, and it starts without a Terminal window.

Everything else works as on Windows: terminal chats open in Terminal (or iTerm, chosen in Setup), **Show in Finder** reveals files, and **Browse…** opens the Mac's own folder window. Claude Code keeps Mac sign-ins in the Keychain rather than in a file, and Session Switcher reads them through `claude auth status`, so each account's lock and plan work the same.

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
- **Pick up where you left off:** after Session Switcher restarts, the chats that were open in its window, with **Reopen them** or **Not now**.
- **Races** and **Queued:** Claude and Codex racing on the same task, and tasks waiting to start (see **Race Claude and Codex** and **Queued tasks** below).
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
- **Click it** to open a list of every account you have, Codex included. Each shows its sign-in, its plan, and bars for how much of the 5-hour window and the week is left. Click an account to make new chats open as it (one that isn't signed in starts its sign-in). The bottom row has **Add an account**, **Check usage**, **Open claude.ai** and **All accounts on the hub**.
- It shows that account's 5-hour window and week separately, each with its reset time.

The window title shows the count too, for example "(2) Session Switcher".

The lists stay put while chats work: the sidebar's folders and the chat window's **Active now** keep their order, and a new one joins at the end, so nothing moves out from under your mouse.

The first time it opens, a short tour points out the main parts. **Take the tour** in Setup or `Ctrl+K` shows it again.

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
- **Export…** saves your prompts as a file to give to someone; **Import…** adds the prompts from such a file to yours (one with the same name as one of yours is skipped).
- Closing the editor with unsaved changes (Esc, ✕ or a click outside it) asks first.

A new chat opens on its project: its banner, its name, and your prompts one click away.

## Handing it to someone else

Session Switcher has nothing personal built in, so you can give it to anyone:

1. In **Setup**, click **Make a copy to share**.
   - It saves a zip on your Desktop with the app only.
   - None of your accounts, sign-ins, chats, chat names, projects or banners go in it.
   - Tick **Include my prompts** if you want them to start with yours.
   - If you've built the Android app, it's included as `SessionSwitcher.apk`.
2. Send them the zip. They unzip it, double-click **Claude Switcher.vbs**, and follow **First-time account setup** above with their own accounts.

### On GitHub

The repository is safe to publish as it is. Everything personal the app writes (`accounts.json`, `history.json`, `chat-names.json`, `projects.json`, `banners.json`, `prompts.json`, `chat-prefs.json`, `devices.json`, `tasks.json`, `races.json`, `open-chats.json`, `reopen.json`, `switcher.log`) is listed in `.gitignore`, so it can't be committed by accident. Co-workers clone the repository, double-click **Claude Switcher.vbs**, and set up their own accounts. To give them the Android app too, attach `SessionSwitcher.apk` to a GitHub Release, or let the Actions workflow build it.

Sign-ins never live in the app's folder. Each Claude account signs in through its own folder in your user profile: `.claude`, or `.claude-<name>` for extra accounts. Codex uses `.codex`. So even a plain copy of the app's folder carries no sign-ins. The zip is still the tidy way, because it also leaves out your account list, settings and history.

## The chat window

Click **Open** on any chat, or **New chat** in a folder. The chat runs in Session Switcher's own window, as the account you picked.

- **Active now (left):** every open chat, for one-click switching: working, waiting for you, or ready for your next message. `Alt+↑` and `Alt+↓` move between them.
  - **Drag** a chat up or down to put the list in your order (or `Alt+Shift+↑` / `Alt+Shift+↓` for the chat you're in). The order is remembered.
  - **Right-click → Pin to the sidebar** keeps a chat at the top of the list, under **Pinned**, even after it stops; click it to open it again.
  - **Right-click → Close** takes a chat off the list. One running here stops (open it again and it picks up where it left off; it asks first if the chat is mid-reply). One in a terminal or another app keeps running there, and comes back to the list if it does something new. Closing the chat you're in moves you to the next one.
- **The conversation:**
  - Replies are formatted, with tables and copyable code.
  - Tool steps are compact rows that open to show the command, the edit or the output. Once a reply is done, its steps fold into one line ("Edited songs.lua · ran 2 commands · looked at 4 files"); click it to see them.
  - **What each reply changed** (in a git project): a bar under the reply, like "Changed 3 files".
    - **See the changes** shows them, file by file.
    - **Undo** puts those files back as they were before that reply. A file that's changed since is left alone, and it tells you which. Whoever made the changes hears about the undo with your next message, so it doesn't build on them.
  - Artifacts appear as cards.
  - **Attach** (or paste or drop) any file:
    - Pictures go straight into the message, as before.
    - Videos, PDFs, sound files and documents (up to 2 GB) are saved in the project folder under `attachments/<date>/`, and the message tells Claude or Codex where they are, so they can open them. Claude and Codex can't watch a video directly, but they can work with the file, for example with a tool like ffmpeg.
    - In the conversation, videos and sound play right in the message, and other files show as cards that open in the viewer.
  - The file viewer plays videos and sound, and shows PDFs.
  - Notices are slim banners.
- **@ mentions:** type `@` and a few letters in the message box to pick a file from the project. It goes in as its path, so Claude or Codex reads exactly that file.
- **How full the chat is:** each pill under the message box has a thin meter, and the ledger says how full (for example "62% full · 98k of 160k tokens"). Near the end, the chat suggests **Summarize now**: a chat that's full summarizes itself, maybe in the middle of a task, so summarizing between tasks keeps what matters. **⋯** has **Summarize the conversation now** any time.
- **Never stuck on a limit:** if the account runs out of usage in the middle of a chat, the chat offers **Continue as** another of your accounts (the same conversation), **Hand it to Codex** (Codex is caught up on the conversation first), or **Tell me when it's back**. A new chat skips an account that's out and offers one with room.
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
  - **Stop**, or **Esc twice**, interrupts Claude. The first Esc only shows "Esc again stops Claude" under the message box, so a stray key never cuts a reply short. You can type while it works to queue your next message.
  - **Open in a new window** (in **⋯** and the chat's right-click menu) puts a chat in a window of its own, so two chats can sit side by side.
  - **Save as a web page** makes one `.html` file of the conversation, formatted and readable anywhere, with nothing else needed.
  - **⋯** holds everything the chat's right-click menu has, plus **Move to a terminal** (continues the chat in a terminal as the same account) and **Stop this chat**, which asks first only if Claude is in the middle of a reply.
  - The **Claude** and **Codex** pills open the model picker. It works from the keyboard too: the arrows move, Enter picks, Esc closes.

Behind the scenes this is Claude Code itself, run in its official streaming mode, so your settings, CLAUDE.md, skills, MCP servers and hooks all apply. A few things exist only in the terminal interface, like `/login` or interactive `/rewind`; use **Resume in a terminal** for those.

### Watching chats that run elsewhere

Chats running in a terminal, or recently used in the desktop app, also appear on the hub. Click one to **watch it live**: you can read along as it works, but you reply in its own window. Its menus offer **Watch it live** first, since opening it in two places at once can mix up its history.

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

### More Codex accounts, and Ollama

Codex works with more than one ChatGPT account, and with Ollama:

- **Add another Codex account:** the Codex card's **⋯** menu. Give it a name, then sign in with that ChatGPT account. If your browser is signed in to a different ChatGPT account, switch accounts there first or copy the link into a private window.
- **Add Ollama:** the same menu. Codex then runs through the Ollama app on this computer, with cloud models from your ollama.com account, the way `ollama launch codex` does. It needs the Ollama app running (or `ollama serve`) and `ollama signin`; it has no ChatGPT sign-in. Its card shows your ollama.com plan and cloud models; ollama.com shows its usage limits.
- **Which one new Codex chats use:** the top bar's account list has a row for each. Click one, or use any button on its card, and new Codex chats open as it (its card says **new Codex chats**). A chat you reopen continues as the account that last opened it.
- **One chat list:** every Codex account sees the same chats, history, settings and skills. Each extra account has its own folder, `~/.codex-<name>`, holding only its sign-in and what a running Codex keeps for itself; everything else links to `~/.codex`. Removing an account keeps that folder, so adding it again later keeps its sign-in.
- Each account has its own usage dial, in a Codex shade of its own.
- The Ollama account's settings are a copy of `~/.codex/ollama-launch.config.toml` (what `ollama launch codex` writes), in `~/.codex-ollama/config.toml`. Edit that copy to change its default model, or delete it and Session Switcher makes a fresh copy the next time it starts Codex for Ollama.

## OpenClaw agents (read-only)

If [OpenClaw](https://openclaw.ai) is installed, its agents' sessions (Discord channels, cron runs, subagents, voice rooms and direct chats) are listed with your other chats:

- **Where they show up:** in an **OpenClaw** group in the sidebar, and inside the project that is the agent's workspace (from `~/.openclaw/openclaw.json`). Each one is tagged with its agent's name. Sessions of an agent without a workspace folder are left out.
- **Reading one:** **Read** opens it in the chat window, read-only: your messages and the agent's replies, with no message box. A session that's running keeps updating by itself. Nothing is ever sent to a session from here, and nothing is changed or deleted.
- **Where it comes from:** the list from `openclaw sessions --json --all-agents`, refreshed every 30 seconds while the app is open; a transcript from the agent's own session store, opened read-only for each read. Reading transcripts needs Node.js 22.13 or newer (compressed messages need 22.15 or newer).
- **Without OpenClaw** nothing changes: the list is empty, and the app checks for it again every ten minutes.

## Claude and Codex in one chat

Inside any Claude chat you can bring in Codex as a helper, for example to make images for a project while Claude does the main work. You don't need a second window.

- **The crew, under the message box:** two pills, **Claude** and **Codex**. Each shows its model and effort, and a live dot while it works (crimson for Claude, blue for Codex).
  - Click the other pill, or press `Ctrl+.`, to choose who your next message goes to. The box turns blue when you're writing to Codex.
  - Or start a message with `@codex` (or `@claude`) to send just that one message.
- **One feed:** Codex's replies appear in the same conversation, under its own name in blue. Messages you sent it are tagged **to Codex**. Pictures it makes appear as it makes them.
- **One conversation:** whoever you write to first catches up on what it hasn't seen: what the other one said and changed, and what you said to it. In the feed that's a small fold-out ("Codex was caught up on 3 messages"), not text you wrote. So you can ask Claude for a plan, switch to Codex and say "do the second part", and Codex knows what that is.
- **Both:** the **Both** pill (or `@both`) sends one message to each, and they both answer in the same feed.
- **Codex reviews Claude's work:** **Review with Codex** on a Claude reply (or **⋯** → **Have Codex review the changes**) has Codex look over the changes, read-only.
  - The findings appear as a card, each with its priority, file and lines. **All clear** when there are none.
  - **Ask Claude to fix this** on one finding, or **Fix and recheck until clean**: Claude fixes them all, then Codex reviews again, up to three rounds. **Stop after this** ends it early.
- **Hand-offs:**
  - **Ask Codex** on any Claude reply quotes it to Codex, for example Claude's description of a cover image.
  - **Send to Claude** on a Codex reply quotes it back.
  - **Give to Claude** on a picture Codex made attaches it to your next message to Claude, with where it's saved.
- **It's remembered:** the helper is tied to the chat. Reopen the chat later and Codex's earlier messages appear in place, and your next message to Codex continues the same Codex conversation.
- **What Codex is told:** that it works alongside Claude in the same folder, should keep replies short, and should save a copy of any image it makes inside the project folder.
- **Approvals:** Codex's approval cards are blue and say "Codex wants to…", so you always know who's asking. Esc stops whichever one you're writing to.
- The helper uses your Codex sign-in and its usage, and shows in the ledger and on the hub as "Codex · *chat name*". **Stop this chat** stops both.

## Rules and tools

One set of rules for both assistants. Claude Code reads `CLAUDE.md` and Codex reads `AGENTS.md`, so **Rules and tools** writes the rules once and **Save to both** saves both files. Open it from a project's right-click menu, a chat's **⋯**, Setup, or `Ctrl+K`:

- **Rules:** for this project, or for **Every project** (`CLAUDE.md` in your Claude folder and `AGENTS.md` in your Codex folder). If the two files differ, it says so and you pick which to start from.
- **Tools:** each assistant's MCP servers side by side. A server only one of them has can be added to the other in one click (**Add to Codex**, **Add to Claude**).

## Queued tasks

**Queue a task** (on the hub's **At work** heading, a project's right-click menu, or `Ctrl+K`) saves a prompt for a project, for Claude or Codex, to start as a new chat later:

- **When an account has room:** for example when every account is out of usage. It starts as soon as one is back, as whichever account has room.
- **At a time** you pick.
- **Start now** and **Cancel** are on its card under **Queued**. A started task goes to **At work** like any chat.

Queued tasks start only while Session Switcher is running.

## Race Claude and Codex

Give Claude and Codex the same task and keep the better result. **Race Claude and Codex** is in a project's right-click menu and `Ctrl+K` (it needs a git project and Codex signed in):

1. Each one works in its own copy of the project (a git worktree in your temp folder, with your uncommitted work; ignored folders like `node_modules` aren't copied), so neither touches your project or the other's work.
2. The race's card, under **Races** on the hub, shows what each has changed. **See changes** shows the diff; **Open chat** shows how it got there.
3. **Keep Claude's** or **Keep Codex's** brings that one's changes into your project, all or nothing. **Discard both** throws both away. Either way both copies are deleted.

## Models, effort and modes

- **Switch models any time:** click the highlighted pill under the message box.
  - **Quick picks** at the top set a model and an effort in one tap: **Quick** (Haiku or GPT-6-Luna, low), **Balanced** (Sonnet or GPT-6-Sol, medium), **Deep** (Opus or Codex's default, high) and **Max** (Fable or Codex's default, max). They use whatever models your plan offers.
  - **Claude | Codex** tabs at the top set either one, without leaving the picker.
  - Below are every model that chat's tool offers and an **Effort** row (low to max).
  - The change applies from your next message, without restarting the chat. On a phone, the picker opens as a sheet from the bottom of the screen.
  - Or type `/model sonnet`, `/model opus`, `/model luna` or `/effort high` in the message box and press Enter. Nothing is sent to the chat.
  - Or press `Ctrl+K` in a chat and type a model's name.
- **Remembered:** the mode (what it may do without asking), the model and the effort are remembered:
  - for the chat, so reopening it brings them back
  - as the project's default for new chats, separately for Claude and Codex

  When a chat opens with a remembered mode, a short note says so.
- Claude Code sometimes answers with a different model than the one you picked. For example, in **Plan only** mode it plans with Sonnet even when you picked Haiku. Each reply is labeled with the model that actually wrote it, and the model picker points out the difference.

## Phone access: iPhone and Android

Use Session Switcher from your phone: read your chats, reply to Claude or Codex, approve steps, switch models. Everything still runs on your PC; the phone is a remote.

1. On the PC, open **Setup → Phone access** and turn on **Let my phone use Session Switcher**. Windows may ask to let Node.js through the firewall; allow it on private networks.
2. **Get the app:**
   - **iPhone, no install:** in Safari, open the `http://<your computer>:4788/` address shown in Setup, tap Share → **Add to Home Screen**, and open **Switcher** from the Home Screen. Pair from there, not from Safari: the Home Screen app keeps its own sign-in.
   - **iPhone app:** build `mobile/ios` with Xcode (see `mobile/ios/README.md`), open it, and enter the address shown in Setup.
   - **Android:** on your phone's browser, open the `http://<your PC>:4788/get` address shown in Setup and install `SessionSwitcher.apk`. Android will ask you to allow installs from your browser. Open the app and enter the address shown in Setup.
3. Click **Show a pairing code** in Setup, and type the 8-character code on the phone. The code works once, for 10 minutes.

On the phone:

- **Attach** offers **Photos & videos** (Android's photo picker), **Take a photo**, **Record a video** and **Files**.
- Big photos are shrunk to a sharp JPEG so they reach Claude as a picture. Videos and other files are saved in the project's `attachments` folder.
- Menus and the model picker open as sheets from the bottom of the screen. Back closes whatever is open.
- The **Claude** and **Codex** pills under the message box show each one's model, side by side, so you can see who you're writing to and switch with one tap.
- **Copying works,** even though phone access is plain http, where phones don't let a page use the clipboard: every **Copy** falls back to the browser's own copy command, and if a phone refuses that too, the text opens in a sheet, already selected, to copy by hand.
- A reply's buttons (**Copy**, **Ask Codex**, **Review with Codex**) sit in a row under it, where you finish reading, big enough for a thumb. **Copy** copies the reply as written, in Markdown, so lists, tables and code fences come along.
- **Select all** keeps to what you're in: the code block, else the message. Select all again for the whole conversation; never the buttons and menus around it. Pressing and holding a code block selects all of it.
- On a foldable, the cover screen gets a one-column layout, and the inner screen shows two columns of projects.

To update the phone app, open the same `http://<your PC>:4788/get` page and install again. Your pairing is kept.

How it stays safe:

- Phone access is off until you turn it on. It uses its own port (4788), and the PC's own window keeps using `127.0.0.1` only.
- Only paired phones get in. Each phone gets a long random key; only its hash is stored, in `devices.json`. **Remove** a phone in Setup and its key stops working at once.
- A phone can't quit the app, manage phone access, or open folder pickers on the PC.
- It's plain http on your own network. To use it away from home, install [Tailscale](https://tailscale.com) on both devices; Setup then shows the Tailscale address too, and the connection is encrypted.
- A paired phone can do everything you can do in Session Switcher, including letting Claude run commands on your PC. Pair only your own phones.

To build the app yourself, run `mobile/android/build.cmd` (details in `mobile/android/README.md`). It needs no Android Studio: the first run downloads a JDK and the Android build tools (about 560 MB) into `%LOCALAPPDATA%\SessionSwitcherBuild`. A GitHub Actions workflow (`.github/workflows/android.yml`) builds it in the cloud too.

## Regular Claude chats

Your claude.ai conversations live on Anthropic's servers, not on this PC, so they can't be listed inside this app.

Instead, every account card has a **claude.ai** button. It opens claude.ai in a window of its own for that account, and that window stays signed in separately from your other accounts. You sign in once per account, then both are always one click away.

The Codex card does the same for **chatgpt.com**.

## Appearance

Open **Setup → Appearance** (or type "appearance", "theme" or "light mode" in `Ctrl+K`):

- **Light or dark:** Dark, Light, or Match device (it follows Windows or Android).
- **Themes:** Crimson (the original), Sapphire, Emerald, Amethyst, Amber, Ocean, Rose and Graphite, plus two space saga themes and Malibu (below). Each has a light and a dark version, and its swatch shows a preview before you pick it. Codex keeps its own color in every theme.
- **Text size** (80–150%): messages, documents and the message box.
- **Reading font:** Classic (the serif), Modern (a clean sans for reading), or Clean (sans headings too).
- **Bold text** and **Higher contrast**. Light themes keep small grey text (dates, hints, labels) dark enough to read.
- **Interface size** (80–130%): scales everything at once. On smaller windows the top bar tucks away its smaller labels so nothing overlaps.
- A live preview shows a reply and a message in your choices; **Back to the original look** undoes everything.

Appearance is saved on each device, so your phone and your PC can look different.

### Space saga themes

Two more themes turn the hub into a command deck. Each has a light and a dark version, and Codex keeps its own color in both.

| Theme | Feel | Lettering | In the hero |
|---|---|---|---|
| **Imperial** | A capital ship's bridge: black glass, white light panels, red signal lamps. Clean and exact. | Michroma titles, Inter for everything else | A wall of light panels over a console: readouts for orders, reports and units engaged, and a row of signal lamps (red needs your OK, white has replied, green is at work) |
| **Rebel** | A hard-worn hangar: scuffed metal, flight-suit orange, squadron stripes, yellow deck lines | Barlow Condensed titles and names, Barlow for reading, Barlow Semi Condensed labels | A targeting computer flying down a trench, with readouts for waiting, in flight and standing by |

Beyond colors, a saga theme brings:

- **Its own lettering, all of it readable:** a display face for titles, a reading face for messages and a label face for the small uppercase labels (monospace in the other themes; code stays monospace). **Modern** and **Clean** still swap the reading font (Clean the headings too).
- **A display in the hero** that reads the same live counts as the headline. Imperial's needs-you lamps pulse slowly and Rebel's trench scrolls; both hold still when **Animations** is off or your device asks for less motion.
- **Its own panels and markings:** Imperial cards carry a lit edge in red (needs you) or white (at work), with rectangular signal lamps in place of dots. Rebel cards carry squadron stripes, with hazard stripes when a chat needs you. The default theme's ornaments (fleurons, the turning seal, dial numerals, painted project art) are left out, and project pictures are toned to match. Each theme has its own emblem in place of the seal.
- **A few still stars** behind the hub in place of the petals. The petals switch turns them off, and its label changes with the theme.
- **Its own words,** for example "Awaiting you" becomes "Awaiting orders" (Imperial) or "Waiting on you" (Rebel), and "Accounts and usage" becomes "Fleet reserves". Each theme keeps its words in one `copy` map in `theme.js`, keyed by the app's own text, so they're easy to change. The other themes keep the usual words.
- **Short sound cues** in place of the bell when a chat needs you or replies, plus one when you pick the theme. They follow the chime setting.

Screenshots are in [`docs/themes/`](docs/themes/). They use made-up chats and projects, and the chat window is shown in its read-only watch view. The fonts are under the SIL Open Font License (`fonts/OFL.txt`). The sounds are from Kenney's CC0 packs; `sounds/LICENSE-kenney.txt` lists which pack and file each comes from.

### Glam theme: Malibu

Hot pink and pool blue at a beach house in the sun. Made for light mode; in dark mode the same pinks glow on plum at dusk. It's under **Glam** in **Setup → Appearance**.

- **Lettering:** Pacifico, a bubbly retro script, for the logo, the hero and section titles; Nunito, soft and rounded, for reading and everything else.
- **A sunset in the hero** that reads the live counts: a striped sun setting into the sea between two palms, a heart in the sky for each chat waiting on you (gold when it needs your OK, white when it has replied), a twinkle for each chat at work and a pool float for each one lounging. The waves roll, the hearts bob and the twinkles sparkle; all of it holds still when **Animations** is off or your device asks for less motion.
- **Little hearts** in place of status dots; a working chat's heart beats.
- **Sparkles** behind the hub in place of the petals (four-point sparkles and the odd heart, in pink, sunshine and pool blue), shimmering slowly.
- **Pill buttons, stitched cards and pink speech bubbles,** a heart emblem with a sparkle in place of the seal, and a pink-to-peach rule under each section title.
- **Its own words:** "Hello, gorgeous" over the sidebar, "Fresh gossip" for recent chats, "Your looks" for accounts (the current one is "Today's look"), "Who wore it better" for races, and headlines like "Two chats are ready for you, darling."
- **Sweet chimes,** made on the spot rather than played from files: a rising twinkle when a chat needs you, three bright notes when one replies. They follow the chime setting.

Screenshots: [`malibu-hub-light.jpg`](docs/themes/malibu-hub-light.jpg), [`malibu-hub-dark.jpg`](docs/themes/malibu-hub-dark.jpg), [`malibu-chat-light.jpg`](docs/themes/malibu-chat-light.jpg) and [`malibu-phone-light.jpg`](docs/themes/malibu-phone-light.jpg). Its words are in the theme's `copy` map in `theme.js`, its look in the Malibu section of `styles.css`.

## Alerts

When a chat needs you or replies, Session Switcher can:

- play a soft chime (on by default), except for the chat you're looking at
- show a Windows notification while the window is in the background

Turn these on or off from the **Live** pill at the bottom of the sidebar, or in Setup. The drifting petals can be turned off there too; they stay off if Windows is set to reduce motion.

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
| `Alt+↑` / `Alt+↓` | Switch between open chats in the chat window |
| `Alt+Shift+↑` / `Alt+Shift+↓` | Move the chat you're in up or down that list |
| `Enter` | Send. Use `Shift+Enter` for a new line |
| `Esc` | Close what's open. While Claude or Codex is replying, press it twice to stop |
| `Ctrl+F` | Find in this chat |
| `End` | Jump to the latest message |
| `?` | Keyboard shortcuts |
| `Ctrl+K`, then "light mode" or a theme name | Switch light/dark or theme |
| `Ctrl+.` | In a Claude chat, switch between writing to Claude and to Codex |
| `@codex` … | Send one message to Codex from a Claude chat |
| `/model <name>` · `/effort <level>` | Switch the chat's model or effort without sending anything |

## Right-click

Right-click almost anything for what you can do with it. Shift+right-click still opens the browser's own menu, and text boxes keep their usual cut, copy and paste.

Menus get out of the way: a click anywhere else closes the menu (without also pressing whatever you clicked), and so do Esc, scrolling and switching windows. With one menu open, a click on another ⋯ or menu button opens that one straight away, and a right-click elsewhere opens the menu for that spot. From the keyboard, the Menu key opens the menu for whatever has focus; the arrows, Home and End move, and typing a letter jumps to the item that starts with it.

- **A chat** (in a list, on a hub card, or pinned in the sidebar): open it, close it (an open chat), open a copy, resume in a terminal, rename, pin to the sidebar, copy its ID or terminal command, show its transcript.
- **A project** (its card, or its name in the sidebar): open it, pin it, continue the latest chat, start a new Claude or Codex chat, start with a prompt, show it in Explorer, browse its files, copy its path.
- **An account card:** sign-in checks, usage, rename, sign out.
- **Inside a chat:**
  - **A reply:** copy it (as text or Markdown), quote it in your message, or hand it to Codex or Claude. Its own **Copy** button copies the Markdown.
  - **Your message:** copy it, quote it, or **Edit and send again**.
  - **Selected text:** copy, quote, ask the other assistant about it, find it in this chat, or search every chat for it.
  - **Code:** copy it, as Markdown too, or put it in your message.
  - **A picture:** view full size, copy it, give it to Claude, show it in its folder, or use it as the project's banner.
  - **A file name:** open it, show it in its folder, copy its path, or mention it in your message.
  - **A step** (a command, an edit): show its details, copy the command or its output.
  - **The Claude or Codex pill:** quick picks and the model picker.
  - **The chat itself:** find, jump to the latest message, export as Markdown, pin, rename, copy its ID, stop.
- **Ctrl+A** in a chat selects the message (or code block) you clicked in, not the whole window; press it again for the whole conversation.
- **Empty space:** search, new project, light or dark mode, appearance, setup, keyboard shortcuts.

On a phone, a long press does the same on cards, pictures and controls.

## Pinned and favorites

- Pin projects and chats to the top of the sidebar: right-click them and choose **Pin to the sidebar**, or click the ☆ in a chat's header. Pinned chats also stay at the top of the chat window's list, running or not.
- Pinned chats show a gold dot when they're waiting for you and a pulsing one while they work. Pinned chats also get a ★ in lists.
- Click a sidebar heading (**Pinned**, **Claude Code**, **Codex**) to fold it away. It stays folded.

## In a chat

- **Find (Ctrl+F):** highlights every match. Enter steps to older matches, Shift+Enter to newer ones, and steps inside folded tool output open by themselves.
- **Jump to latest:** when you scroll up, a button counts new messages as they arrive. Click it, or press End.
- **Drafts:** whatever you're typing stays with that chat, even if you switch chats or close the app.
- **Code** is colored by language, in your theme's colors.
- **Times:** hover a reply to see when it came.
- **Export:** right-click the chat, or use `Ctrl+K`, to save it as a Markdown file.
- **From a search:** opening a chat from **Search every chat** opens Find on the words you searched for.

Press `?` anywhere (outside a text box) for the full list of keyboard shortcuts.

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
- Anything hard to undo (signing out, removing an account or a phone, quitting) asks first in the app's own box. Esc or **Cancel** always backs out.

## Speed with long chats

Session Switcher is built to stay quick even with very long chats (hundreds of megabytes):

- Chats open from the end of their transcript and load earlier messages a page at a time, so even a huge chat opens almost instantly.
- The search index is built once, then only reads what was added to each chat since.
- The details drawer reads its counts from the index and its latest messages from the end of the file.
- The list of chats, the project list and the activity board are reused for a moment instead of being rebuilt several times a second, and the check for chats running in terminals is a light query every 10 seconds.
- In the chat window, a reply that's streaming in only re-renders the paragraph being written.

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
- **Approvals can't be clicked by accident:** an approval card only takes the keyboard if you aren't typing, so a keystroke meant for the message box never approves a step.
- **Local only:** the app listens only on 127.0.0.1, and every request needs a per-launch token. Requests from other websites are refused, and the fonts are bundled, so nothing loads from the internet.

## Setup & health

The gear's dot turns gold or red when something needs attention. Setup checks:

- Node.js and the Claude Code version
- your chats folder
- each account's sign-in and lock
- each extra account's shared data
- sign-in overrides set on the PC

Links at the top jump to each section: Health, Alerts, Preferences, Codex, Phone and App. Fixes are one click: update Claude Code, sign in, merge and share, or set the `claude` path. The command boxes save as soon as you click away from them. The preferences there cover:

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
  - `codexhomes.js`: extra Codex accounts and Ollama (their own homes, linked to `~/.codex`).
  - `openclaw.js`: OpenClaw agents' sessions (the list, and transcripts read from their store).
  - `projects.js`: each project's documents, pictures and banner, new and added projects, and the prompts.
  - `sharecopy.js`: **Make a copy to share**.
  - `chatprefs.js`: remembered modes, models and effort, and each Claude chat's Codex helper.
  - `remote.js`: phone access (pairing, paired phones).
  - `files.js`: the file viewer (text, pictures, videos, sound, PDFs).
  - `system.js`: terminals and processes.
  - `health.js`: the Setup checks.
  - `store.js`: safe file writes.
- `index.html`, `styles.css`: the page and its look.
- `ui/`: what runs in the page, loaded in the order `index.html` lists (they share one scope):
  - `base.js`: shared helpers, plan usage, live activity, the data the hub shows.
  - `hub.js`: the top bar, the sidebar, the hub and each project's page.
  - `create.js`: the prompt book, new projects, **Make a copy to share**.
  - `motion.js`: the animations and clocks.
  - `actions.js`: a chat's details drawer, menus, and what buttons and menu items do.
  - `setup.js`: Setup, phone access, Appearance, alerts and the live pill.
  - `palette.js`: the command palette (`Ctrl+K`) and the file viewer.
  - `events.js`: clicks, the account dropdown, live updates, confirmations, right-click, the shortcuts sheet.
  - `chat-feed.js`, `chat-live.js`, `chat-compose.js`, `chat.js`: the chat window (drawing the conversation; live events, permissions and the crew; the message box; opening, closing and the rest).
- `theme.js`: themes, light and dark, text and interface size. Every color in `styles.css` is a variable named after its original value (`--c-a5463f`), and each theme recolors them all from a few seed colors.
- `fonts/`: the bundled typefaces (SIL Open Font License).
- `mobile/android/`: the Android app (a small WebView remote) and its build script.
- `mobile/ios/`: the iPhone app (a small WebView remote), as an XcodeGen project.
- `Session Switcher.command`, `macos/`: the Mac launcher and the icon for the app it makes in Applications.
- `tests/`: the tests (see **Testing changes** below).
- Created as you use it (next to the app, or in the folder `SWITCHER_DATA_DIR` names):
  - `accounts.json`: your accounts and preferences.
  - `history.json`: which account last opened each chat.
  - `chat-names.json`: your chat renames.
  - `projects.json`: projects you created or added here.
  - `banners.json`: the banners you picked.
  - `prompts.json`: your prompts, once you edit them.
  - `chat-prefs.json`: the modes, models and effort you chose, and which Codex helper goes with which chat.
  - `devices.json`: phones you paired (hashed keys only).
  - `switcher.log`: the app's log.

Session Switcher never edits your chat files.

## Testing changes

`npm test` (or `node tests/run.js`) checks everything, with no packages to install. It needs Node.js 22 or newer and Edge or Chrome.

- **Logic checks** (`tests/unit.test.js`): "Make a copy to share" never takes anything personal, the file viewer never opens sign-in files or keys, phone pairing codes work once, and long chats page back without gaps or repeats.
- **Browser checks** (`tests/ui.js`): a headless browser clicks and types through menus, dialogs, the chat window, the model picker, every theme (light and dark, checking the text is readable) and the phone layout. They run against a made-up demo world (`tests/demo.js`), never your own chats.
- The tests start their own copy of the app on a free port with a throwaway data folder, so they never touch the Session Switcher you're using.
- `node tests/run.js chat menus` runs only the named browser checks; `SHOTS=folder` also saves screenshots.

GitHub runs the same tests on Windows and on a Mac for every push and pull request.
