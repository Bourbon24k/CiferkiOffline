import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Game", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = GameViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

final class GameViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var server: LocalWebServer?
    private let loading = UILabel()
    override var preferredStatusBarStyle: UIStatusBarStyle { overrideUserInterfaceStyle == .dark ? .lightContent : .darkContent }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override func viewDidLoad() {
        super.viewDidLoad()
        let light = UserDefaults.standard.string(forKey: "appearance") == "light"
        overrideUserInterfaceStyle = light ? .light : .dark
        view.backgroundColor = light ? UIColor(red: 0.949, green: 0.949, blue: 0.969, alpha: 1) : .black
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(self, name: "haptic")
        configuration.userContentController.add(self, name: "theme")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        loading.text = "Циферки · Offline"
        loading.textAlignment = .center
        loading.font = .systemFont(ofSize: 22, weight: .semibold)
        loading.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(loading)
        NSLayoutConstraint.activate([loading.centerXAnchor.constraint(equalTo: view.centerXAnchor), loading.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
        guard let root = Bundle.main.url(forResource: "Web", withExtension: nil) else { loading.text = "Не найдены ресурсы игры"; return }
        let server = LocalWebServer(root: root)
        self.server = server
        server.start { [weak self] result in
            switch result {
            case .success(let url): self?.webView.load(URLRequest(url: url))
            case .failure: self?.loading.text = "Не удалось открыть игру. Перезапустите приложение."
            }
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading.isHidden = true }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { loading.isHidden = false; loading.text = "Не удалось загрузить игру" }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let local = url.scheme == "http" && url.host == "127.0.0.1" && url.port == Int(LocalWebServer.port)
        decisionHandler(local || url.absoluteString == "about:blank" ? .allow : .cancel)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "theme", let data = message.body as? [String: String] {
            let light = data["scheme"] == "light"
            UserDefaults.standard.set(light ? "light" : "dark", forKey: "appearance")
            overrideUserInterfaceStyle = light ? .light : .dark
            let background = light ? UIColor(red: 0.949, green: 0.949, blue: 0.969, alpha: 1) : UIColor.black
            view.backgroundColor = background
            webView.backgroundColor = background
            webView.scrollView.backgroundColor = background
            setNeedsStatusBarAppearanceUpdate()
            return
        }
        guard message.name == "haptic" else { return }
        let style = message.body as? String ?? "light"
        if style == "selection" { UISelectionFeedbackGenerator().selectionChanged() }
        else if style == "success" || style == "error" { UINotificationFeedbackGenerator().notificationOccurred(style == "success" ? .success : .error) }
        else { UIImpactFeedbackGenerator(style: style == "heavy" ? .heavy : .light).impactOccurred() }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "Циферки · Offline", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "Циферки · Offline", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
    deinit { for name in ["haptic", "theme"] { webView?.configuration.userContentController.removeScriptMessageHandler(forName: name) } }
}
