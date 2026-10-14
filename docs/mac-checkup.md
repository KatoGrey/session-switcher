# Mac checkup (about 10 minutes)

The Mac app is built on GitHub, not on a Mac, so someone with a Mac checks each new kind of change.
Note what you see next to each step and send it back (a GitHub issue is fine).

**Which file:** Apple silicon (M1 or later) → `SessionSwitcher-<version>-mac-arm64.dmg`. Intel → `-mac-x64.dmg`.
Not sure? Apple menu → About This Mac: "Chip: Apple M…" is Apple silicon.

## 1. Install and first open
- [ ] Open the .dmg and drag **Session Switcher** into **Applications**.
- [ ] Open it from Applications. macOS refuses the first time ("can't be opened" / "not verified").
- [ ] **System Settings → Privacy & Security**, scroll down: **Open Anyway** next to Session Switcher. Open it again and confirm.
- [ ] If it says the app **"is damaged"** instead: that's the problem this checkup is for. Note it, then in Terminal run
      `xattr -cr "/Applications/Session Switcher.app"` and open it again.
- [ ] It opens a window, and an icon appears in the menu bar (top right).

## 2. It finds your tools
- [ ] Setup (the gear) → Health: **Claude Code** shows a version, not "Couldn't run".
- [ ] If you use Codex: Setup → Codex → Use Codex too. It finds and signs in to Codex.
- [ ] Open a chat in a project and send "say hi". The reply comes back.

## 3. Desktop parts
- [ ] Closing the window keeps it in the menu bar. Clicking the menu-bar icon shows the menu, with **Open Session Switcher**.
- [ ] While a chat replies, switch to another app: a notification comes. Clicking it opens that chat.
- [ ] A chat that needs your OK shows a number on the Dock icon.
- [ ] ⌘ Shift Space brings Session Switcher up from another app.
- [ ] Ctrl+K → "Open the mini window": a small card that stays on top of other apps.
- [ ] Right-click in the message box: spelling suggestions, Cut, Copy, Paste.

## 4. Updates (when a newer version is out)
- [ ] Setup → **Desktop app** → Check for updates. It downloads and says **Restart to update**.
- [ ] Restart to update: it closes, comes back as the new version (Setup shows the number), **without** asking for Open Anyway again.
- [ ] Your chats that were open come back.

## 5. Phone (optional)
- [ ] Setup → Phone access → turn it on. macOS asks to let Session Switcher accept incoming connections: Allow.
- [ ] Pair your phone and open a chat from it.
