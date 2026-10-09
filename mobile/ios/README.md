# Session Switcher for iPhone

A small remote for the Session Switcher running on your computer, like the Android app: a connect
screen, then the computer's own pages full screen. Everything runs on the computer.

You don't need this to use Session Switcher on an iPhone. Safari's **Add to Home Screen** gives
you the same thing with no build (see "Phone access" in the main README). Build this if you
want a real app: no Safari bars, pull to refresh, links to claude.ai open in Safari.

## Run it on your iPhone

1. Xcode → Settings → **Accounts** → add your Apple ID. A free Apple ID works; the app then has to
   be re-installed every 7 days. A paid developer account lasts a year.
2. Open `SessionSwitcher.xcodeproj`, select the **SessionSwitcher** target → **Signing & Capabilities**,
   and pick your team. If Xcode says the bundle ID is taken, change it to something of your own,
   like `com.<you>.switcher`.
3. Plug in the iPhone (or pair it over Wi-Fi in Window → Devices and Simulators), turn on
   Settings → Privacy & Security → **Developer Mode** on the phone, pick it as the run destination,
   and press Run.
4. First launch with a free Apple ID: Settings → General → VPN & Device Management → trust your
   developer profile.
5. In the app, enter the address from Setup → Phone access on your computer (the `100.x.x.x`
   Tailscale one works away from home), then the pairing code.

## Editing the project

The project is generated from `project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
brew install xcodegen
cd mobile/ios && xcodegen
```

Session Switcher serves plain http on your own network, so the app allows http
(`NSAllowsArbitraryLoads`). Don't add narrower App Transport Security keys next to it: iOS then
ignores it and blocks plain http to IP addresses, including Tailscale's.
