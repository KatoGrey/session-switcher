import SwiftUI
import WebKit

// Switcher Lite in a thin native shell: the page still comes live from your Mac (over Tailscale), so
// every change to Lite shows up on a reload, exactly as in Safari. What the shell adds:
//  - no Safari form bar (the ˄ ˅ ✓ strip) above the keyboard,
//  - the keyboard and page move together natively,
//  - its own cookie store: pair it once (Setup → Phone access on the Mac).

// The Mac's Lite over Tailscale (tailnet only). If the Mac's name changes, change it here.
let defaultAddress = "https://macbook-pro-6.tail7b90aa.ts.net/lite"

@main
struct SwitcherLiteApp: App {
    var body: some Scene {
        WindowGroup {
            LiteView()
                .ignoresSafeArea(.container, edges: .all)
                .background(Color(red: 0.055, green: 0.059, blue: 0.067))
                .preferredColorScheme(.dark)
        }
    }
}

struct LiteView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.defaultWebpagePreferences.preferredContentMode = .mobile
        let web = NoFormBarWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.055, green: 0.059, blue: 0.067, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.allowsBackForwardNavigationGestures = true
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        if #available(iOS 16.4, *) { web.isInspectable = true }
        context.coordinator.web = web
        context.coordinator.load()
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var web: WKWebView?
        private var leftAt: Date?

        override init() {
            super.init()
            let nc = NotificationCenter.default
            nc.addObserver(self, selector: #selector(left), name: UIApplication.didEnterBackgroundNotification, object: nil)
            nc.addObserver(self, selector: #selector(back), name: UIApplication.willEnterForegroundNotification, object: nil)
        }

        var address: URL {
            let s = UserDefaults.standard.string(forKey: "address")?.trimmingCharacters(in: .whitespaces)
            return URL(string: (s?.isEmpty == false ? s! : defaultAddress)) ?? URL(string: defaultAddress)!
        }

        func load() { web?.load(URLRequest(url: address)) }

        @objc private func left() { leftAt = Date() }
        // Back after a while: reload, so you get the newest Lite (a quick switch away keeps your place).
        @objc private func back() {
            if let t = leftAt, Date().timeIntervalSince(t) > 600 { web?.reload() }
            leftAt = nil
        }

        // Links to other sites open in Safari; Lite's own pages stay here.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            let home = address.host
            if action.targetFrame?.isMainFrame == false || url.host == home || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
                return decisionHandler(.allow)
            }
            if action.navigationType == .linkActivated || action.targetFrame == nil {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        // target="_blank" links and window.open: to Safari for other sites, here for Lite's own.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if url.host == address.host { webView.load(URLRequest(url: url)) } else { UIApplication.shared.open(url) }
            }
            return nil
        }

        // The Mac can't be reached (Tailscale off, Mac asleep): say so, with a way to try again.
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let msg = (error as NSError).localizedDescription.replacingOccurrences(of: "<", with: "&lt;")
            webView.loadHTMLString("""
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="margin:0;height:100vh;display:grid;place-items:center;background:#0e0f11;color:#e8e2d6;font:17px -apple-system,sans-serif;text-align:center;padding:24px;box-sizing:border-box">
            <div><p style="font-size:20px;margin:0 0 8px">Can’t reach your Mac</p><p style="color:#9a958c;margin:0 0 20px">\(msg)<br>Is Tailscale on, and the Mac awake?</p>
            <a href="\(address.absoluteString)" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#d6343a;color:#fff;text-decoration:none">Try again</a></div></body></html>
            """, baseURL: nil)
        }

        // Lite's alert/confirm/prompt dialogs, natively.
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            present(UIAlertController(title: nil, message: message, preferredStyle: .alert), actions: [UIAlertAction(title: "OK", style: .default) { _ in completionHandler() }])
        }
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            present(UIAlertController(title: nil, message: message, preferredStyle: .alert), actions: [
                UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) },
                UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) }])
        }
        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            a.addTextField { $0.text = defaultText }
            present(a, actions: [
                UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) },
                UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) }])
        }
        private func present(_ a: UIAlertController, actions: [UIAlertAction]) {
            actions.forEach(a.addAction)
            let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
            root?.present(a, animated: true)
        }
    }
}

// A WKWebView without Safari's form bar above the keyboard. The bar is the web content view's
// inputAccessoryView; this gives that view a subclass whose accessory view is nil (done once, when
// the content view exists).
final class NoFormBarWebView: WKWebView {
    override func didMoveToWindow() {
        super.didMoveToWindow()
        hideFormBar()
    }
    private func hideFormBar() {
        if UserDefaults.standard.bool(forKey: "keepFormBar") { return } // for the test's comparison run
        guard let content = scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }),
              let base = object_getClass(content) else { return }
        let name = "\(NSStringFromClass(base))_NoFormBar"
        if NSStringFromClass(base) == name { return }
        var sub: AnyClass? = NSClassFromString(name)
        if sub == nil, let made = objc_allocateClassPair(base, name, 0) {
            let none: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
            class_addMethod(made, #selector(getter: UIResponder.inputAccessoryView), imp_implementationWithBlock(none), "@@:")
            objc_registerClassPair(made)
            sub = made
        }
        if let sub { object_setClass(content, sub) }
    }
}
