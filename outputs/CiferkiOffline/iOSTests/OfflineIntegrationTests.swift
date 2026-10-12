import XCTest
import WebKit
import UIKit

@MainActor
final class OfflineIntegrationTests: XCTestCase {
    private func loadedWebView() async throws -> WKWebView {
        for _ in 0..<200 {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            if let view = scenes.flatMap(\.windows).compactMap({ $0.rootViewController?.view.subviews.compactMap { $0 as? WKWebView }.first }).first {
                if !view.isLoading, let ready = try? await view.evaluateJavaScript("Boolean(window.offlineGame && document.getElementById('root').innerText.length>20)"), ready as? Bool == true { return view }
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw NSError(domain: "OfflineTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bundled game did not load"])
    }

    func testBundledGameAndPersistentSpin() async throws {
        var web = try await loadedWebView()
        // A repeatable local simulator fixture; never touches a physical device or the original service.
        _ = try await web.evaluateJavaScript("(()=>{const map=new Map();CiferkiOffline.createEngine({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)});for(const [k,v] of map)localStorage.setItem(k,v);})()")
        web.reload()
        web = try await loadedWebView()
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
        for theme in ["dark", "light"] {
        _ = try await web.callAsyncJavaScript("window.CiferkiMobile.setTheme(theme); return true;", arguments:["theme":theme], in:nil,contentWorld:.page)
        for path in paths {
            _ = try await web.callAsyncJavaScript("history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); return true;", arguments: ["path": path], in: nil, contentWorld: .page)
            try await Task.sleep(nanoseconds: 350_000_000)
            let text = try await web.evaluateJavaScript("document.getElementById('root').innerText") as! String
            XCTAssertGreaterThan(text.count, 20, "Blank screen: \(path)")
            XCTAssertFalse(text.contains("не число"), "Invalid amount: \(path)")
            XCTAssertFalse(text.contains("Эта функция недоступна"), "Unimplemented route: \(path)")
        }
        }
    }
    func testMobileNavigationAndBothThemes() async throws {
        let web = try await loadedWebView()
        let controls = try await web.evaluateJavaScript("document.querySelectorAll('.mobile-chrome button').length") as! Int
        XCTAssertEqual(controls, 2)
        for theme in ["dark", "light"] {
            _ = try await web.callAsyncJavaScript("window.CiferkiMobile.setTheme(theme); return true;", arguments: ["theme":theme], in:nil, contentWorld:.page)
            let actual = try await web.evaluateJavaScript("document.documentElement.dataset.theme") as! String
            XCTAssertEqual(actual, theme)
            let saved = try await web.evaluateJavaScript("localStorage.getItem('ciferki.theme')") as! String
            XCTAssertEqual(saved, theme)
            let sizes = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('.mobile-chrome button')).every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44;})") as! Bool
            XCTAssertTrue(sizes)
            let overflow = try await web.evaluateJavaScript("document.documentElement.scrollWidth > innerWidth + 1") as! Bool
            XCTAssertFalse(overflow)
            let reachable = try await web.evaluateJavaScript("(()=>{const r=document.querySelector('.spin-controls .sim-cta').getBoundingClientRect();return r.bottom<=innerHeight+1&&r.top>=52;})()") as! Bool
            XCTAssertTrue(reachable,"Primary spin button must remain within the phone viewport")
            try await Task.sleep(nanoseconds:150_000_000)
            let shot: UIImage = try await withCheckedThrowingContinuation { continuation in
                web.takeSnapshot(with:nil) { image, error in
                    if let image { continuation.resume(returning:image) }
                    else { continuation.resume(throwing:error ?? NSError(domain:"Snapshot",code:1)) }
                }
            }
            let attachment = XCTAttachment(image:shot)
            attachment.name = "Ciferki-" + theme
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        web.reload()
        let reloaded = try await loadedWebView()
        let persistedTheme = try await reloaded.evaluateJavaScript("document.documentElement.dataset.theme") as! String
        XCTAssertEqual(persistedTheme,"light")
        _ = try await web.evaluateJavaScript("history.replaceState({},'', '/collection'); window.dispatchEvent(new PopStateEvent('popstate'));")
        try await Task.sleep(nanoseconds:200_000_000)
        _ = try await web.evaluateJavaScript("document.querySelector('[data-mobile-back]').click()")
        try await Task.sleep(nanoseconds:200_000_000)
        let path = try await web.evaluateJavaScript("location.pathname") as! String
        XCTAssertEqual(path, "/")
        // Leave the screen in the default theme for visual verification.
        _ = try await web.evaluateJavaScript("window.CiferkiMobile.setTheme('dark')")
    }

    func testLightCollectionFilterContrast() async throws {
        let web = try await loadedWebView()
        _ = try await web.evaluateJavaScript("window.CiferkiMobile.setTheme('light');history.pushState({},'', '/collection');window.dispatchEvent(new PopStateEvent('popstate'));")
        try await Task.sleep(nanoseconds:300_000_000)
        let readable = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('.coll-rarities button')).filter(b=>!b.disabled).every(b=>{const s=getComputedStyle(b);return s.color!==s.backgroundColor;})") as! Bool
        XCTAssertTrue(readable, "Light collection filters must not use black text on black backgrounds")
        _ = try await web.evaluateJavaScript("window.CiferkiMobile.setTheme('dark');history.replaceState({idx:0,key:'default'},'', '/');window.dispatchEvent(new PopStateEvent('popstate'));")
    }

    func testThemeAwareTariffDialog() async throws {
        let web = try await loadedWebView()
        _ = try await web.evaluateJavaScript("history.replaceState({idx:0,key:'default'},'', '/');window.dispatchEvent(new PopStateEvent('popstate'));")
        try await Task.sleep(nanoseconds:200_000_000)
        for theme in ["dark", "light"] {
            _ = try await web.callAsyncJavaScript("window.CiferkiMobile.setTheme(theme);Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('Тариф')).click();return true;", arguments:["theme":theme], in:nil,contentWorld:.page)
            try await Task.sleep(nanoseconds:300_000_000)
            let color = try await web.evaluateJavaScript("getComputedStyle(document.querySelector('.scene')).color") as! String
            XCTAssertEqual(color, theme == "light" ? "rgb(17, 17, 19)" : "rgb(255, 255, 255)")
            if theme == "light" {
                let percent = try await web.evaluateJavaScript("getComputedStyle(document.querySelector('.scene-slide[data-on=true] .scene-stat b')).color") as! String
                XCTAssertEqual(percent,"rgb(17, 17, 19)")
            }
            _ = try await web.evaluateJavaScript("document.querySelector('.scene-close').click()")
            try await Task.sleep(nanoseconds:150_000_000)
            let closed = try await web.evaluateJavaScript("document.querySelector('.scene')===null") as! Bool
            XCTAssertTrue(closed)
        }
        _ = try await web.evaluateJavaScript("window.CiferkiMobile.setTheme('dark')")
    }

}
