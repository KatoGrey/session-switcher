# Big Codex chats open again, Lite in the desktop app, a self-check that works, and Continue in a fresh chat

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
