# Connections and pull requests, your home PC from your laptop, Claude's own commands in the / menu, and Gemini's usage

**Connections: sign in to tools like Latitude's, for every account, without a terminal.** A tool (MCP server) like Latitude's asks you to sign in once for each account: every Claude account keeps its own sign-in, and so does Codex. Chats here couldn't run Claude Code's own `/mcp` sign-in, which needs a terminal to type in. Now Session Switcher does it, through Claude Code and Codex themselves.

- **In a chat:** when one of its tools needs you, a card says so. **Sign in to latitude** opens its page in your browser; approve it there, and the tools load in that chat right away, no restart. The account's other open chats connect again by themselves.
- **Type /mcp** (or ⋯ → **Tools and sign-ins**) for the chat's tools: which are connected, how many tools each has, and a button to sign in or connect one again.
- **Every account at once:** Ctrl+K → **Connections** lists each tool against each Claude account and Codex: signed in, or a **Sign in** button. **Sign in everywhere it's needed** goes through them one after another; if your browser is signed in already, each is a click. A tool Claude has and Codex doesn't is **Add to Codex** away.
- **From your phone:** the sign-in page opens on the phone. Afterwards the phone's browser lands on a page that won't load (it was meant for the PC): copy its address into **Signing in on another device?** and the PC finishes the sign-in.
- **GitHub, too.** Connections shows who's signed in to GitHub (through `gh`, which Claude and Codex also use to push and make pull requests). **Sign in to GitHub** shows GitHub's one-time code right there, with a button to copy it. With more than one GitHub account, switch between them.

**Pull requests: yours and the ones waiting on you, and Claude or Codex to review, fix and make them.**

- **Ctrl+K → Pull requests,** or the hub's new **Pull requests** section: your open pull requests, the ones waiting on your review and the ones assigned to you, across GitHub, as whoever is signed in to `gh` on this computer.
- **Open one** for its checks (passed, failing, still running), its reviews and who it's waiting on, its open review threads, its preview (Latitude's pull requests), and the chat that made it.
- **Review it…** with Claude (as any of your accounts) or Codex. The pull request's code is fetched into your copy of the repo without touching what you have checked out, and the review follows the repo's own review guide. Nothing is posted to GitHub unless you ask for it in the chat.
- **Fix the comments…** and **Fix the failing checks…** on your own pull requests: the open review threads (or the failing checks, with how to read their logs) go to the chat that made the pull request when there is one, since it knows the work, or to a new chat. It works on the pull request's branch, in a separate worktree if your folder has other changes, and pushes there.
- **Make a pull request from a chat:** type **/pr** (with a ticket or "draft" after it, if you like) or choose ⋯ → **Make a pull request**. The chat commits its work on a branch, pushes it and opens the pull request, following the repo's own PR instructions and template. In Latitude's repo that means a pull request to `internal` with its Linear link and Human Review section.
- **One project's:** right-click a project that's in git → **Pull requests**.

**Your home PC, from your laptop. New, and off until you turn it on.** Take your laptop away and keep working: on your home PC while it's on, and on the laptop's own copy when it isn't. It's all in **Setup → Your home PC**.

- **Nothing is on until you turn it on.** On the computer you leave at home, tick **This is my home PC**. On the laptop, open **This is my laptop** and pair. A computer that does neither is left exactly as it was.
- **Pair once.** On the PC, turn on **Phone access**. On the laptop, **Find my PC** looks for it on Tailscale; then type the code from the PC's **Setup → Phone access**.
- **Your PC in the laptop's window.** Every chat, project and account, run on the PC with its storage. The title says "your home PC", and the tray icon's menu switches between it and the laptop. This works between a Windows PC and a Mac too.
- **When the PC stops answering** (an update restart, a power cut), the window switches to the laptop's own copy by itself and says so. When the PC is back, **Send my work and switch** takes what you did on the laptop back to it.
- **A copy on the laptop.** **Copy everything from my PC** brings your projects, your Claude, Codex and Gemini chats and settings, and Session Switcher's own, into the same folders, so every chat opens there too. The PC only allows it while **This is my home PC** is on, and only someone at the PC can turn that on. Sign-ins stay on each computer: sign in on the laptop once. Copying again only brings what changed. Big files that changed again (Codex's history) wait for a full copy at home.
- **What the copy needs.** Both computers the same kind (two Windows PCs, or two Macs), and the same user name on both: chats are kept under their folder's full name, so with a different user folder the projects still come over but the PC's chats won't open on the laptop. It tells you before the first copy.
- **Nothing is deleted, on either side.** A file changed in both places keeps both versions: the laptop's goes beside the PC's as "name (laptop)".
- **A drive the laptop doesn't have** (the PC's D:, say) is kept in a folder under the same letter, so its paths still work.
- **A home PC left on by itself keeps going.** With **This is my home PC** on, if its server stops again and again it keeps trying, instead of waiting for someone to click OK.

**Type / in a Claude chat to run Claude Code's own commands.**

- **Your skills and commands, and the project's own, are listed first,** each with a line on what it does and what it takes. They come from `~/.claude/skills`, `~/.claude/commands` and the `.claude` folder in the chat's project (those are marked **This folder**). Your prompts follow, as before.
- **Type a few letters to narrow it,** by name or by a word of the description. **Tab** or a click puts `/name ` in the box: add what it takes and send, and Claude Code runs it.
- Claude chats only, and when the message goes to Claude itself.

**Gemini's usage, like Claude's and Codex's.**

- **How much of your Google AI plan is left, with reset times.** Gemini's 5-hour and weekly limits show in the top bar's account menu, on the hub's Gemini card, and in a Gemini chat's usage chip, the same way as Claude's and Codex's. It comes from Antigravity's own `/usage`, which answers without a turn: checking spends nothing and leaves no conversation.
- **Claude and GPT in Antigravity have their own limits,** shown in the Gemini card's details.
- **It stays current by itself:** every few minutes while the app is open, a moment after each Gemini reply, and with **Check usage**.

**From Ryan (pull request #7).**

- **Claude in Chrome in chats.** Claude chats start with Claude Code's `--chrome`, so a chat can use the Claude in Chrome extension when it's installed. To turn it off, set `"chromeInChats": false` under `prefs` in `accounts.json` (in the app's data folder) and restart the app.
- **A model you pick becomes the default across projects,** for each assistant.
- **Gemini through an API key** (`gemini.apiKeyFile` in `accounts.json`), beside Antigravity's sign-in. A key has no plan, so no usage is shown for it.
- **CLAUDE.md in extra accounts links to the main copy** where links can be made, so it isn't loaded twice in every chat.
- **On a Mac or Linux, a restart or update no longer ends your chats:** a small keeper process holds them and hands each to the new copy. Windows starts chats directly, as before.
- **Switcher Lite:** every chat's tokens on a Tokens page, a Quick project for small one-off chores, search inside chats, **Keep it working until…**, a warning when two chats change the same file, videos and music in chats, and phone fixes.

## Earlier in 6.7.0: Companion, ask anything, over anything, with your own subscriptions

**A quick helper for your own questions, over a game or anything else.** Turn it on in **Setup → Companion**.

- **Alt + Q brings up a small, flat panel from anywhere.** Ask, read the answer, and **Esc** puts you straight back in your game. It's usually answering within a few seconds, because its chats carry none of your settings or tools. (On a Mac it's Control + Q.)
- **Alt + Shift + Q does the same with a picture of your screen,** so you can just ask "what is this?" **Look at screen** in the box does it too. It sees your screen only then, and you see the picture before it's sent.
- **Capture just what matters.** The arrow beside **Look at screen → Choose a region** lets you select an area on a frozen screen. Confirm with **Enter** or cancel with **Esc**. You review the crop before sending it.
- **Filed by game, with earlier questions close by.** Click the game name in the panel to find and reopen earlier conversations. Returning tomorrow keeps the conversation; **+** starts a new one. Each chat keeps its own unfinished message and pictures.
- **Notes that follow you across assistants.** Save your build, progress and spoiler preferences in **Game notes**, or your general preferences in **Personal notes**. They go with a conversation's first question, and again whenever you change them, whichever assistant answers. You can inspect, edit or clear them from the panel or Companion's page.
- **A place of its own in the app.** A **Companion** page with your games and General down the side and the whole chat beside them, and a short section on the hub. It's the same conversation in the box and on the page, so you can move between them.
- **Move it, size it, pin it.** Drag its top to move it, drag its edges to resize it, and the pin keeps an answer on screen with clicks going through to your game. **Panel background** in Setup controls transparency; the panel starts solid.
- **Every model, by name, in one click.** The model button opens Claude's Opus and Fable, Codex's newest GPT-6 models and Gemini's, with Sonnet, Haiku and the rest under **More models**, and the effort below. Another of the same assistant's models carries on the same conversation. It starts on Opus at medium effort, remembers what you choose, and Claude uses whichever account has the most left.
- **It can only look things up.** It can search the web and read what you show it. It can't touch your files, run anything or use your tools. A game in true fullscreen may not show the box: borderless windowed works.
- **The keys can be changed,** by pressing the ones you want. If another program has one, Setup says so and offers others.

## Earlier in 6.6.1 and 6.6.2: links to files and folders go to the right place, and Codex's and Gemini's models can be chosen again

- **A chat's links go where they should.** Claude is now told to link every file and folder by its full path. And when a chat only names one ("site-deploy.zip, in Documents\My Site"), clicking it finds it: in the folders that chat pointed to, in the chat's own folder however deep, then in Documents, Desktop and Downloads, OneDrive's included. If there are several, it asks which. It used to look only in the chat's folder and say there was no such file.
- **A partner's model picker opens.** In 6.6.0, pressing Codex's or Gemini's name a second time, or a partner's tab in the picker, said "compEntry is not defined" and showed no models. Each assistant in a chat now has its own working tab, under its own name; the tabs of the others all said the chat's own assistant.
- **A held message comes back in Switcher Lite.** A message interrupted while waiting its turn hit an error instead of returning to the box, with its pictures.
- **Carry on when it's back** says "Your usage is back" if the chat's busy when the time comes; that hit an error too.

## Earlier in 6.6.0: chats that keep working while you sleep, a board for your pictures, chats side by side, and a hub that's easier to get around

**Leaving it to work**

- **Keep it working until a time you choose.** For the long job you leave running: **Keep it working until…**, in a chat's **⋯** menu, and when it goes quiet it's told to carry on. In a crew, each is told by itself, caught up on what the others did, so one on a long job doesn't hold up the rest. It leaves alone anything that needs you. Out of usage, it moves to your account with room, or waits for the reset. It stops at the time, when nobody has anything left to do, or when you press Stop, and the hub says in the morning how it ended.
- **Move a chat to your other account before it runs out.** **Carry on as…** in a chat's **⋯** menu: the same conversation, on the account with more left.
- **Changes, on a project's page:** what each reply changed, in every chat there, by day, with **See the changes** whether the chat's open or not, and a box to narrow it to a file, a chat or one of the crew. It's how to see what happened while you were away. The Commander can ask for it too.
- **"Changed N files" and Undo work in folders that aren't in git.** Most projects had neither. The app now keeps its own copies of their text files, outside the project; pictures and big files aren't covered, and it says so. Very broad or huge folders are skipped, and a slow first look doesn't hold up your message.
- **Two chats changing one file at once** are noticed, whichever assistants they are: a card on the hub, a ⚠ in their headers, and **Side by side** to look. One after the other isn't a warning.
- **Several chats at once:** **Message several chats** sends the same message to each you tick, from `Ctrl+K`, a group or a project, and **Stop what every chat is doing** does what it says.

**Your pictures and documents**

- **The picture board.** A project's **Gallery** is now made for going through what an agent drew, even 20,000 pictures: its folders down the side with how far you've got, small copies that scroll, `K` to keep, `R` to redo with a note, side by side with another version, and **Send the redo list** to a chat. A picture that's made again comes back by itself, showing what you'd asked for, and the hub tells you. **Find a picture by name** looks in every folder, **Put copies of what's kept in a folder** gets them ready to share, and **Copy what's showing as one picture** puts a sheet of them, with their names, on the clipboard.
- **Notes on a document.** Select a passage in a file and press `N`, then hand all your notes to a chat at once, each with what it's about. A long document has **Contents**, its headings a click away, a link to a heading now goes there, and ‹ › (or ← →) steps through a project's documents. `Ctrl+F` finds in the file, **Look inside every file** finds words across the project, and **Open in your editor** opens a file of words in your own program.
- **Memory, on a project's page:** what Claude has noted for itself about the project, which it reads at the start of each chat. You could only see how many there were. Now you can read them, and **Forget** a wrong one (it's set aside, and can come back).
- **Your site beside the chat.** **See it beside the chat** on a `.html` file (nothing to start), in **Run the project**, or on a `localhost` link. It reloads when a reply changes something, and has a phone width.

**Getting around**

- **The hub, with less to scroll through.** One list of projects in the sidebar, with a filter and buttons for each assistant. **Active now** says what each open chat is doing, in words. A row of links under the headline jumps to each section, and every section folds. Accounts are compact, with their details a click away. It's about a third of the height it was. Imperial and Rebel keep their own sidebar and page.
- **New chat, from anywhere.** `N`, or **New chat** in the top bar: any project, any assistant. It remembers who you last started with in each project, **Most room** picks the account with the most left, and **Together with** brings the others in from the start.
- **Chats name themselves.** After a chat's first reply, Claude's smallest model gives it a short name, so your lists say what each is about instead of its first words. A name you've given a chat is never changed. Setup can turn it off, and **Name them** there does the same for your older chats.
- **Two chats side by side.** The ◫ in a chat's header, or `Ctrl`+click in the list, puts another chat beside it in the same window, the whole chat with its own message box. A window at least 1,900 wide has room for three.
- **A chat's ⋯ menu you can see all of.** It was thirty items, taller than the window, with Stop off the bottom. Now it's what you use most, and the rest one click in. `Ctrl+K` still finds everything.
- **A project's page has less above its chats:** its tabs and new-chat buttons share a row, and its top says what's open there and, in git, its branch and what isn't committed. The project's name over a chat's title goes to that page, and **See everything it changed**, in a chat's side panel, puts all of a chat's changes in one place.
- **Search every chat now looks inside Codex's and Gemini's chats too.** It only read Claude's before, and half of a busy list can be Codex's. What a partner said is found under the chat it belongs to. The first search starts reading them in the background, and says how far it's got. The Commander can search the same way. And opening a long chat from a search now loads earlier messages to find the words: **Find** used to look only in what was showing, and said "No matches".
- **Gemini chats are Gemini's everywhere.** A Gemini chat's ⋯ menu offered Claude's accounts and copies that couldn't work, clicking its title said "not found", and its Open button went by Claude's sign-in. Now it has its own menu, **Resume in a terminal** through Antigravity, its details, sub-sessions in Gemini, and it's on **Your day at a glance**. Prompts can run in Gemini too, and a new project can start with it.
- **↑ in an empty message box** brings back what you last sent, as in a terminal.
- **One set of rules and tools for all three.** **Rules and tools** has Gemini in it now: in a project it reads `AGENTS.md`, so a save reaches all three, and for every project it gets its own file. Its tools show beside the others', and **Add to Gemini** copies one across.
- **Easier to read, outside the hub too.** Nothing to read under 11 pixels in chats, menus and dialogs. On light themes Gemini's name was almost invisible; now it isn't. Small buttons are easier to hit, and a checkbox in a dialog shows when the keyboard is on it. Imperial and Rebel stay as they are.

**Under the hood**

- **Long Claude chats open without holding anything up,** and so does searching their history. A saved index makes later starts quicker.
- **Together waits until each reply has saved its record of changes** before passing the work on. Stopping a held request gives you back its words, pictures and who it was for.
- **Undo leaves shared changes alone** when assistants working at once used commands or other tools and their work can't be told apart, and it keeps a file you edited while it was checking.
- **Held messages come back safely.** A message waiting its turn that gets interrupted is saved above the message box, without touching what you've started writing since, with **Back to newer draft** if you swap it in.
- **Gemini in more places.** Switcher Lite offers Gemini's models and modes and "At once" for a crew, and Gemini's file writes count toward same-file warnings and change tracking. Antigravity installed as a `.cmd` starts cleanly on Windows.
- **Routines:** every few minutes or hours, and a time to stop after. Watchers on a command don't stall other routines or fire again on long output, and a Codex routine due at startup waits for its sign-in check. Slack watchers work on Windows and Linux too, and a repeating queued task keeps its mode and **Not before** time.
- **Codex queues recover** from very quick replies, an interrupted start and reconnects, and new chats and tasks use the Codex account you picked.
- **Chats with a lot of pictures keep less in memory,** and long Codex replies let go of finished tool output sooner, without losing approvals still waiting, requests not yet sent, or safe Undo.
- **Assistants sharing a chat see more of each other's work:** where pictures were saved, and every file in an edit of several. Undo tells same-named files in different folders apart.
- **Long Codex chats no longer show a stretch of messages twice** where the older history meets the live part, and no earlier reply goes missing there.
- **Windows commands:** non-English output stays readable when it arrives in pieces, and a command with endless output can't keep growing.
- **Switcher Lite is easier to read and use.** On every page in every look: nothing under 11 pixels, text that stands out, buttons big enough to hit, and a keyboard focus you can see. Attachments you haven't sent stay with their chat when you switch, and its alerts reach the Android app too.
- **Review loops and races:** a very quick reply no longer hangs a review loop, an error names the right round, a race whose copy has gone doesn't error when its changes are read, and a stopped racer reopens with the right assistant.
- **The read-only guard holds.** A run that should only read could still write: a redirect after a pipe, a `$(command)` inside double quotes, creating or deleting a git branch, `--output` on `git log`. All refused now.
- **Copies, partners and Stop.** A copied chat no longer takes its original's partner. Stop reaches a partner that's still starting or waiting its turn, and cancels what was queued for it. A partner that had to restart finishes before the next one is told.
- **Phones.** Removing a phone ends everything it had open straight away, without touching your other devices. A slow or sleeping phone can't pile up memory on the PC; it reconnects and catches up.
- **Restarts.** A new Claude chat has its id from the start, so one left running can be found again, and an older offer to reopen a chat isn't lost when a restart finds nothing open.
- **Rare, and gone:** a message starting with a broken `<other-chat` tag could freeze the app; a repeating error could flood the log and hide a different one; one enormous record in a chat's file could run the search index out of memory (it's skipped now, and the chat's untouched); a damaged Ollama key gave a baffling error instead of saying what was wrong; a home folder written with a Windows short name (`C:\Users\LONGNA~1`) brought the whole app down the moment a chat was saved.
- **One live connection per window.** A browser keeps six connections open to one address, and a chat with two partners took four, so a second window could leave none and every click waited. Now they share one.
- **Pictures load without holding up anything else,** and "Picture copied" shows above the picture viewer instead of under it.
- **One folder, one project.** A folder written two ways (`C:\x` and `C:/x`, depending on what started the chat) showed as two projects. Two different folders with the same name now say which is which in **New chat**.
- **Cleaning up after a race, in the installed app.** Removing a race's copies could fail and leave them behind in the temp folder. In rare cases, if a copy held a folder link, it could go through the link and delete what it pointed at. Both came from how the app's built-in Node deletes folders on Windows, which plain Node doesn't do, and both are fixed.
- **A project with a built Electron app in it** had its `.asar` files read as folders by the installed app: walked into, and impossible to delete. They're files now.
- **The nightly self-check stops crying wolf.** A longer date ("Saturday, October 31") could wrap to a second line and read as a theme that "looks different". A test failing every night was a new problem every night, because its time was part of its name; now it's one. A new version starts with an empty list of problems: what's been fixed goes, and what hasn't comes back. It's also been run the way the installed app runs it, which is how the cleaning-up bug was found.
- **Fixed:** **Mark done** and **Run the project** answered "Not found": neither had ever reached the PC. Pictures in a document, like `![map](../art/map.png)`, came up broken, and links to a heading did nothing. **Ask Claude to fix this** always failed in the installed app; **Make a copy to share** from the installed app left out how to start it; **Pick another port** for phone access had nowhere to pick one. A new chat reopened right away, before the lists had heard of it, said it wasn't found. A long menu could open over its own **⋯**, so pressing **⋯** again pressed whatever was there; it now opens beside it. **Mark done** showed twice in a chat's menu, and a partner's chat opened twice at once could come up outside the chat it belongs to. A Codex chat's menu now has **Open in a new window** and **Open beside this chat** too.

## Also in 6.6.0: file links that open, chats that come back

- **File links open.** Codex links a file as `/C:/Users/…`, and the app read that as `C:\C:\Users\…`, a place that doesn't exist. Now it opens the file. Paths with spaces in their folders (`C:\Users\me\My Site\plan.md`), folders and zips are links too, in Lite as well.
- **Chats on a 1M model come back.** With `opus[1m]` in Claude's settings, a chat couldn't start again after a restart or an update: the app refused the brackets in the name. Choosing such a model in a chat failed the same way.
- **Long chats stay listed.** A chat whose first message was a big picture or paste, or that opens with a summary of an earlier one, could drop out of the list and not reopen.
- **Move to a terminal moves the chat again.** Since 6.5.6 it asked the chat for a handoff instead (spending a reply) and opened no terminal.
- **With three in a chat, each card acts for the one it came from.** Allow, Undo, Stop and Summarize went to whichever partner was in view: Undo under Gemini's reply could put back Codex's files.
- **Opening a chat doesn't redo what's already happened.** A usage limit from hours ago could switch the chat to another account as you opened it, even mid-reply, and a big change could be reviewed by Codex again.
- **Your pictures and last words stay with their chat** when you look at another. A picture you'd pasted used to be dropped, along with whatever you'd typed in the last moment; and a message sent just as you switched could come back as a draft.
- **Taking turns waits for a real answer.** Sent while the first one was mid-reply, the next one started before the first had read your message. Now the round starts once it's done (and says so). One that fails by itself no longer ends the round for the others; Stop still does.
- **Gemini:** can't get stuck on Working after Stop or a crash; Stop ends a round or a plan; **Ask a side question** works in a Gemini chat. **Codex:** a copy's first message can't go to the original chat; Stop works while a reply is starting.
- **Carry on when it's back** works with the window closed: the chat isn't stopped as idle while it waits.
- **Started with Windows, it does its work.** Hidden at login, it had no page running, so no notifications, tray counts or keeping the PC awake until you first opened it.
- **A chat left running over an update isn't cut off mid-step.** A long command writes nothing while it runs; the app now gives that half an hour, rather than 90 seconds, before it counts as finished. A failed look at what's running no longer reads as "nothing is", which could open a chat twice. The Commander comes back with its tools, and chats waiting to come back stay on offer until you reopen them or say Not now.
- **Find and saving reach everything:** searching opens a folded chapter or a reply's folded steps with a match, and Export and Save as a page include folded chapters. **Show earlier** can't load a page twice, and the chat you clicked last is the one that opens.
- **Lighter:** a reply streaming in only draws what's new, and Lite draws a few times a second rather than on every word. The chat list is sent to each window at most every 10 seconds while chats write (added or removed chats at once), Gemini's list reads only the start of each file, and finished chats are let go of memory.

## Also in 6.6.0: the Commander's tools, no more surprise copies, chats that pick up where they were

- **The Commander works in the desktop app.** Its tools (list, read and nudge your chats, answer them, start sub-sessions, set up routines) never connected there: they were started with the desktop app's own program in the wrong way, which opened a second copy of the app instead, and it closed at once. They connect now.
- **Chats left running by an update or a crash pick up where they were.** If Session Switcher is closed without stopping its chats (an installer run by hand, a crash, Task Manager), they carry on by themselves with no way to reach them, and the app then thought they were open somewhere else: it wouldn't open them, only copy them. Now it finds them, shows them as **finishing from before the restart** (read along live), and once each has finished what it was doing, it stops it and opens that same chat here again.
- **Copies only when you mean it.** **Open a copy** now asks first and says what a copy is: a second chat with the same history, working alongside the first. And a copy is named “(copy)” everywhere, not after its first words, so it can't be mistaken for the chat it came from.

## Earlier in 6.5.6: big Codex chats open again, Lite in the desktop app, a self-check that works, and Continue in a fresh chat

- **A Codex chat full of pictures no longer cuts the app off from Codex.** One chat's history (2.4 GB of portraits) came back as more than the app could read at once, and from then on every Codex chat lost its connection: one wouldn't open, one showed no chats, one sat thinking, until a restart. Now such an answer is set aside and only its own request fails; that chat's history comes a few turns at a time (every step still shown, the rest with **Earlier**). Claude and Gemini chats are guarded the same way.
- **Switcher Lite opens in the desktop app.** Its pages were left out of the installer, so `/lite` only showed an error there. They're in now, with the helper commands its tools use.
- **The nightly self-check works on your PC.** It runs the app's own tests on the installed copy, and it couldn't pass there: some of its tests needed parts that only a developer's copy has, and the theme check counted every update as a failure, every night after. Now those tests skip where they can't run, and the theme check starts fresh with each new version (a real change shows once, then becomes the new look to compare with).
- **Continue in a fresh chat:** in a chat's **⋯** menu. The chat writes a handoff (the goal, what's done, where it stands, the files that matter, what's next), and a new chat in the same folder, linked to the old one, opens with it in the message box to read and send. For a chat that's grown long or slow.
- **Recent, in the sidebar:** your six latest chats (any assistant) under Pinned, with their project and how long ago, and **All recent chats** at the foot.
- **A steadier log:** a message repeated thousands of times is written once a minute with a count, so the part that says what went wrong stays in it. And Claude chats start even if Windows' cleanup emptied the temp folder (it held a note Claude Code needs).

## Earlier in 6.5.4 and 6.5.5: Update Codex and Gemini from Setup, a safety fix for links, and a smoother app

- **Update Codex** and **Update Gemini** in Setup, beside **Update Claude Code**. New Codex models (like GPT-6.1-Sol) only show up with a newer Codex, so Setup's Codex part now says which version you have and when a newer one is out. If Codex or Gemini chats are running, it says so: Windows can't update a program that's in use, so stop them and click again.
- **Safer links:** a link or picture with a network path (`\\some-server\share\…`) no longer opens, and isn't even looked up. Looking one up made Windows connect to that server and offer it your sign-in. Folders on your own computer open as before.
- **Together, steadier:** if one of them can't take your message, it says who missed it and the others carry on (no error asking you to send it all again), and taking turns no longer stalls when one in the middle can't start. From Codex's own check of the app.
- **With three in a chat:** "still working, send now?" and the light along the message box notice every one of them, not only the one in view; `@gemini` and `@all` work like `@codex`; a Gemini chat that stops says Gemini (not Claude Code); a Gemini partner's "getting full" note names Gemini.
- **Smoother:** the buttons under the message box aren't redrawn several times a second while a reply streams (a tooltip under your pointer stays put), and while Session Switcher is minimized or in the tray it waits to redraw until you're back; the title and the tray's count stay up to date.
- **Race on a Mac:** a copy's quick edit that kept a file the same size could go unseen; now it's always counted.

## Earlier in 6.5.3: pick who works together, pictures you can zoom and copy, Gemini in the top bar, links to any folder

- **Pictures open fitted to the window.** A tall screenshot used to open at full size with most of it cut off; now it fits whole. Zoom with the mouse wheel (or pinch on a phone, or − and +), drag to look around, and press 0 to fit it again.
- **Copy picture and Save** in the picture viewer (Ctrl+C, Ctrl+S): copy it and paste it anywhere to share it. Pictures opened as files can be copied and viewed full screen too, and a picture you're about to send opens full size when you click it.
- **Gemini in the top bar:** click the account chip and Gemini has its own row, with your Google AI plan. When a model runs out of quota, it says when it's back (Antigravity can't say how much is left, so there's no percentage).
- **Together: pick who works on your message.** One **Together ▾** button under the message box (in place of All and Plan, which hid each other): tick who takes your next message and in what order (Claude and Codex, Gemini then Codex, all three…), and whether they **take turns**, work **at the same time** (Claude on the code while Codex makes the images: say who does what, and each keeps to its part) or **plan first**. The chat's own assistant can sit out.
- **Links to any folder on your computer open,** not just ones in your user folder: a site in `C:\Sites`, a game on `D:\`. **Work here** starts a Claude, Codex or Gemini chat in that folder, **Open in Explorer** opens it, and a web page has **Open in browser**. Sign-in files, key folders like `.ssh`, AppData and other people's user folders stay closed.
- **Lite, from Ryan:** **Later** is a bucket of its own at the end of the sidebar (folded, one click to open) instead of a line under each project; a project with only one stage shows no stage label; and on a phone the page no longer stays pushed down after the keyboard closes.

## Earlier in 6.5: Switcher Lite, groups, the Commander and routines

Mostly from Ryan.

- **Switcher Lite:** a second, calmer way into the same app at `/lite` (on your phone too): what needs you, plans with a use-next order, buckets for your projects, lighter chats with a side chat, and pages for bugs, routines, images and clean-up.
- **Groups:** gather chats you're juggling in the sidebar and on the hub. Right-click a chat → **Move to group…**, or drag it there.
- **Sub-sessions:** start a linked chat from any chat, with a brief.
- **The Commander:** one chat that can see and nudge the others (and, if you let it, answer their requests).
- **Routines:** chats that start on a schedule, or when a Slack channel or a command has something new. Repeating tasks are routines now.
- **New chats start in Auto (Claude) and Full access (Codex),** unless a chat or project remembers another mode. Change it in Setup.
- **A tidier message box:** icon Send and Stop buttons, and a simpler model picker.
- **Codex:** chats pick up on the model they started on, and a **Fast** setting per chat.

## Also in 6.5

- **Long tasks keep going.** When Claude leaves a build, tests or a helper running in the background, its chat is no longer stopped for being idle (that ended the work, and the reply Claude gives when it's done). The chat and the hub say **Working in the background**, and a restart or update waits for it, or says it would end it.
- **Gemini everywhere:** the Commander reads and nudges Gemini chats, routines can run on Gemini, and side chats, sub-sessions and renaming work for Gemini chats. In Lite, **Who answers** offers each assistant you have, or All.
- **Every partner in view:** reopening a chat with Codex and Gemini both in it shows each one's earlier messages, in order.
- **Lighter on your PC:** the check for chats open in terminals asks one PowerShell that stays running instead of starting a new one every 10 seconds (about 90 times less CPU). Lite's background checks wait until you open Lite, and never hold up the app.
- **Lite on Windows:** Clean up shows real sizes and finds every folder it should; Lite's sign-in and model list work without Unix tools. The Bugs page works for any GitHub repo.
- **Out of usage:** choosing **Carry on when it's back** (or handing it over) now calls off the automatic switch to your other account.
