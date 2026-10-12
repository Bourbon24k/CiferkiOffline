import XCTest
import WebKit
import UIKit

@MainActor
final class OfflineIntegrationTests: XCTestCase {
    private func loadedWebView() async throws -> WKWebView {
        for _ in 0..<200 {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            if let view = scenes.flatMap(\.windows).compactMap({ $0.rootViewController?.view.subviews.compactMap { $0 as? WKWebView }.first }).first {
                if let ready = try? await view.evaluateJavaScript("Boolean(window.offlineGame && document.getElementById('root').innerText.length>20)"), ready as? Bool == true { return view }
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw NSError(domain: "OfflineTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bundled game did not load"])
    }

    func testBundledGameAndPersistentSpin() async throws {
        let web = try await loadedWebView()
        let before = try await web.evaluateJavaScript("window.offlineGame.request('/numbers').total") as! Int
        // Replenish only through the actual in-game promo if this simulator save is new.
        _ = try await web.evaluateJavaScript("try { window.offlineGame.request('/promo','POST',{code:'OFFLINE'}); } catch(e) {}")
        let result = try await web.evaluateJavaScript("JSON.stringify(window.offlineGame.request('/spins','POST',{tier:'standard'}))") as! String
        let json = try JSONSerialization.jsonObject(with: Data(result.utf8)) as! [String: Any]
        XCTAssertNotNil(json["number"])
        let savedBalance = try await web.evaluateJavaScript("window.offlineGame.request('/me').wallet.soft") as! Int
        web.reload()
        let reloaded = try await loadedWebView()
        let count = try await reloaded.evaluateJavaScript("window.offlineGame.request('/numbers').total") as! Int
        let balance = try await reloaded.evaluateJavaScript("window.offlineGame.request('/me').wallet.soft") as! Int
        XCTAssertEqual(count, before + 1)
        XCTAssertEqual(balance, savedBalance)
    }

    func testExternalNetworkIsRejected() async throws {
        let web = try await loadedWebView()
        let result = try await web.callAsyncJavaScript("try { await fetch('https://example.com/'); return 'sent'; } catch(e) { return e.message; }", arguments: [:], in: nil, contentWorld: .page) as! String
        XCTAssertEqual(result, "External network disabled in offline game")
    }

    func testEveryIncludedScreenRenders() async throws {
        let web = try await loadedWebView()
        _ = try await web.evaluateJavaScript("try { window.offlineGame.request('/promo','POST',{code:'OFFLINE'}); } catch(e) {}")
        _ = try await web.evaluateJavaScript("for(let i=0;i<160;i++){if(window.offlineGame.state.balance<1700){try{window.offlineGame.request('/bonus/claim','POST',{});}catch(e){break;}}const r=window.offlineGame.request('/spins','POST',{tier:'standard'});window.offlineGame.request('/numbers/'+r.number.id+'/sell','POST',{});}")
        let paths = ["/", "/collection", "/profile", "/skills", "/rewards", "/phones", "/phones/mine", "/shop", "/pass", "/games", "/games?game=coin", "/games?game=dice", "/games?game=crash", "/games?game=forge", "/games?game=lottery", "/trade", "/trade?tab=auction", "/trade?tab=mine", "/trade?tab=prices", "/buyer", "/salons", "/achievements", "/rating", "/ledger", "/settings", "/rules", "/promo"]
        for path in paths {
            _ = try await web.callAsyncJavaScript("history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); await new Promise(resolve=>setTimeout(resolve,250)); return true;", arguments: ["path": path], in: nil, contentWorld: .page)
            let text = try await web.evaluateJavaScript("document.getElementById('root').innerText") as! String
            XCTAssertGreaterThan(text.count, 20, "Blank screen: \(path)")
            XCTAssertFalse(text.contains("не число"), "Invalid amount: \(path)")
            XCTAssertFalse(text.contains("Эта функция недоступна"), "Unimplemented route: \(path)")
        }
    }
}
