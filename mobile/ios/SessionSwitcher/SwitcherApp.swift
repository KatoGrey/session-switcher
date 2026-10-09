// Session Switcher for iPhone: a remote for the Session Switcher running on your computer.
// Everything runs on the computer; this shows its pages full screen. Pairing happens on the
// computer's own "Pair this phone" page, and the pairing key is a cookie kept by the web view.

import SwiftUI
import WebKit

@main
struct SwitcherApp: App {
    var body: some Scene {
        WindowGroup { RootView().preferredColorScheme(.dark) }
    }
}

enum Palette {
    static let bg = Color(red: 0.039, green: 0.035, blue: 0.047)
    static let panel = Color(red: 0.129, green: 0.090, blue: 0.078)
    static let line = Color(red: 0.227, green: 0.165, blue: 0.145)
    static let text = Color(red: 0.929, green: 0.902, blue: 0.851)
    static let muted = Color(red: 0.702, green: 0.655, blue: 0.592)
    static let accent = Color(red: 0.647, green: 0.275, blue: 0.247)
}

struct RootView: View {
    @AppStorage("server") private var server = ""
    @State private var editing = false

    var body: some View {
        ZStack {
            Palette.bg.ignoresSafeArea()
            if server.isEmpty || editing {
                ConnectView(initial: server) { url in server = url; editing = false }
            } else {
                RemoteView(server: server) { editing = true }
            }
        }
    }
}

// MARK: - Connect

/// "192.168.1.20:4788", "my-mac:4788" or a full URL → "http://host:port". nil if it can't be one.
func normalizeServer(_ raw: String) -> String? {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.isEmpty { return nil }
    if !s.contains("://") { s = "http://" + s }
    guard var c = URLComponents(string: s), let host = c.host, !host.isEmpty,
          c.scheme == "http" || c.scheme == "https" else { return nil }
    if c.port == nil && c.scheme == "http" { c.port = 4788 }
    c.path = ""; c.query = nil; c.fragment = nil
    return c.url?.absoluteString
}

struct ConnectView: View {
    let initial: String
    let done: (String) -> Void
    @State private var address = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Image(systemName: "sparkle").font(.system(size: 30)).foregroundStyle(Palette.accent)
                    Text("Session Switcher").font(.custom("Georgia", size: 28)).foregroundStyle(Palette.text)
                }.padding(.bottom, 6)

                VStack(alignment: .leading, spacing: 8) {
                    Text("On your computer").font(.custom("Georgia", size: 19)).foregroundStyle(Palette.text)
                    Text("Open Session Switcher → Setup → **Phone access**, turn on **Let my phone use Session Switcher**, and note the address it shows.")
                        .foregroundStyle(Palette.muted)
                }
                .padding(18).frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.panel, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Palette.line))

                Text("Computer address").font(.subheadline).foregroundStyle(Palette.muted)
                TextField("", text: $address, prompt: Text("192.168.1.20:4788").foregroundColor(Palette.muted.opacity(0.6)))
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(.system(size: 18, design: .monospaced)).foregroundStyle(Palette.text)
                    .padding(14).background(Palette.bg, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.line))
                    .submitLabel(.go).onSubmit(connect)
                Text("Away from home? Use the Tailscale address (100.x.x.x) shown in Setup.")
                    .font(.footnote).foregroundStyle(Palette.muted)

                Button(action: connect) {
                    HStack { if busy { ProgressView().tint(Palette.text) }; Text(busy ? "Connecting…" : "Connect") }
                        .font(.headline).frame(maxWidth: .infinity, minHeight: 54)
                        .foregroundStyle(Palette.text).background(Palette.accent, in: RoundedRectangle(cornerRadius: 12))
                }.disabled(busy)

                if let error {
                    Text(error).foregroundStyle(Color(red: 0.878, green: 0.522, blue: 0.486))
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Palette.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))
                }
                Text("After connecting, enter the pairing code from Setup → Phone access → Show a pairing code.")
                    .font(.footnote).foregroundStyle(Palette.muted).padding(.top, 4)
            }
            .padding(.horizontal, 20).padding(.vertical, 28).frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .onAppear { if address.isEmpty { address = initial.replacingOccurrences(of: "http://", with: "") } }
    }

    private func connect() {
        guard let base = normalizeServer(address), let hello = URL(string: base + "/hello") else {
            error = "Enter the address shown in Setup, like 192.168.1.20:4788."; return
        }
        busy = true; error = nil
        var req = URLRequest(url: hello); req.timeoutInterval = 8
        URLSession.shared.dataTask(with: req) { data, _, err in
            DispatchQueue.main.async {
                busy = false
                if let data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], j["app"] as? String == "session-switcher" {
                    done(base)
                } else if let err {
                    error = "Couldn’t reach \(base). Check that the phone and computer are on the same Wi-Fi (or both on Tailscale) and phone access is on.\n\n\(err.localizedDescription)"
                } else {
                    error = "Something answered at \(base), but it isn’t Session Switcher."
                }
            }
        }.resume()
    }
}

// MARK: - Remote

struct RemoteView: View {
    let server: String
    let changeServer: () -> Void
    @State private var failure: String?
    @State private var reloadToken = 0

    var body: some View {
        ZStack {
            WebView(url: URL(string: server)!, reloadToken: reloadToken, failure: $failure)
                .ignoresSafeArea(.container, edges: .bottom)
            if let failure {
                VStack(spacing: 14) {
                    Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundStyle(Palette.accent)
                    Text("Can’t reach your computer").font(.custom("Georgia", size: 22)).foregroundStyle(Palette.text)
                    Text(failure).multilineTextAlignment(.center).foregroundStyle(Palette.muted).font(.subheadline)
                    Button("Try again") { self.failure = nil; reloadToken += 1 }
                        .font(.headline).frame(maxWidth: 260, minHeight: 50).foregroundStyle(Palette.text)
                        .background(Palette.accent, in: RoundedRectangle(cornerRadius: 12))
                    Button("Use another address", action: changeServer).foregroundStyle(Palette.muted)
                }
                .padding(28).frame(maxWidth: .infinity, maxHeight: .infinity).background(Palette.bg)
            }
        }
    }
}

struct WebView: UIViewRepresentable {
    let url: URL
    let reloadToken: Int
    @Binding var failure: String?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // keeps the pairing cookie between launches
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "SessionSwitcheriOS/5.4"
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = UIColor(Palette.bg)
        web.scrollView.backgroundColor = UIColor(Palette.bg)
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = true
        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.pulled(_:)), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        context.coordinator.lastToken = reloadToken
        web.load(URLRequest(url: url))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.lastToken != reloadToken {
            context.coordinator.lastToken = reloadToken
            web.load(URLRequest(url: url))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: WebView
        var lastToken = 0
        init(_ parent: WebView) { self.parent = parent }

        @objc func pulled(_ sender: UIRefreshControl) {
            (sender.superview?.superview as? WKWebView)?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { sender.endRefreshing() }
        }

        // Links to other sites (claude.ai, chatgpt.com, docs) open in Safari; the computer's pages stay here.
        func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = action.request.url else { return decisionHandler(.allow) }
            let sameHost = target.host == parent.url.host && target.port == parent.url.port
            if sameHost || target.scheme == "about" || target.scheme == "blob" || target.scheme == "data" { return decisionHandler(.allow) }
            if ["http", "https", "mailto", "tel"].contains(target.scheme ?? "") { UIApplication.shared.open(target) }
            decisionHandler(.cancel)
        }

        // target=_blank links.
        func webView(_ web: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let target = action.request.url { UIApplication.shared.open(target) }
            return nil
        }

        func webView(_ web: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) { fail(error) }
        func webView(_ web: WKWebView, didFail nav: WKNavigation!, withError error: Error) { fail(error) }
        private func fail(_ error: Error) {
            let e = error as NSError
            if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
            parent.failure = "\(parent.url.absoluteString)\n\(e.localizedDescription)"
        }

        // The web app's own confirm()/alert() fall back to these if it ever uses them.
        func webView(_ web: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            present(UIAlertController(title: nil, message: message, preferredStyle: .alert), actions: [("OK", .default, completionHandler)])
        }
        func webView(_ web: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            present(UIAlertController(title: nil, message: message, preferredStyle: .alert),
                    actions: [("Cancel", .cancel, { completionHandler(false) }), ("OK", .default, { completionHandler(true) })])
        }
        private func present(_ alert: UIAlertController, actions: [(String, UIAlertAction.Style, () -> Void)]) {
            for (title, style, run) in actions { alert.addAction(UIAlertAction(title: title, style: style) { _ in run() }) }
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            var top = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
            while let next = top?.presentedViewController { top = next }
            top?.present(alert, animated: true)
        }
    }
}
