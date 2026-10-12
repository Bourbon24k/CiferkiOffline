(function () {
  "use strict";
  const engine = CiferkiOffline.createEngine(localStorage);
  window.offlineGame = engine;
  const nop = () => {};
  const events = new Map();
  const app = {
    initData: "offline",
    initDataUnsafe: {
      user: { id: 1, first_name: "Игрок", username: "offline" },
    },
    version: "9.6",
    platform: "ios",
    colorScheme: localStorage.getItem("ciferki.theme") || "light",
    themeParams: {},
    ready: nop,
    expand: nop,
    disableVerticalSwipes: nop,
    enableClosingConfirmation: nop,
    disableClosingConfirmation: nop,
    setHeaderColor: nop,
    setBackgroundColor: nop,
    setBottomBarColor: nop,
    isVersionAtLeast: () => true,
    onEvent: (name, fn) => {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(fn);
    },
    offEvent: (name, fn) => events.get(name)?.delete(fn),
    BackButton: { show: nop, hide: nop, onClick: nop, offClick: nop },
    MainButton: {
      show: nop,
      hide: nop,
      setParams: nop,
      onClick: nop,
      offClick: nop,
    },
    HapticFeedback: {
      impactOccurred: (style) =>
        window.webkit?.messageHandlers.haptic?.postMessage(style),
      notificationOccurred: (style) =>
        window.webkit?.messageHandlers.haptic?.postMessage(style),
      selectionChanged: () =>
        window.webkit?.messageHandlers.haptic?.postMessage("selection"),
    },
    openInvoice: (link, callback) => {
      if (link === "offline:paid") callback?.("paid");
      else callback?.("failed");
    },
    openTelegramLink: () =>
      alert("Эта функция доступна в оригинальной игре через Telegram."),
    openLink: () => alert("Внешние страницы недоступны в офлайн-версии."),
    showPopup: (params, callback) => {
      alert(params.message || params.title || "");
      callback?.();
    },
    showAlert: (message) => alert(message),
    close: nop,
  };
  Object.defineProperties(app, {
    viewportHeight: { get: () => innerHeight },
    viewportStableHeight: { get: () => innerHeight },
    safeAreaInset: { get: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    contentSafeAreaInset: {
      get: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    },
  });
  window.Telegram = { WebApp: app };
  window.addEventListener("resize", () =>
    events.get("viewportChanged")?.forEach((fn) => fn({ isStateStable: true })),
  );
  window.__offlineRequests = [];
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, options = {}) {
    const href = typeof input === "string" ? input : input.url;
    const url = new URL(href, location.href);
    if (url.pathname.startsWith("/v1/")) {
      const method = options.method || "GET";
      let body = {};
      try {
        body = options.body ? JSON.parse(options.body) : {};
      } catch {}
      if (url.pathname === "/v1/events")
        return new Response("{}", {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      try {
        const result = engine.request(url.pathname + url.search, method, body);
        window.__offlineRequests.push({
          path: url.pathname,
          method,
          status: 200,
        });
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        window.__offlineRequests.push({
          path: url.pathname,
          method,
          status: 400,
          error: e.message,
        });
        return new Response(
          JSON.stringify({
            error: {
              code: e.code || "OFFLINE_ERROR",
              message: e.message,
              correlationId: "local",
            },
          }),
          {
            status: e.code === "NOT_FOUND" ? 404 : 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }
    if (url.origin === location.origin) return nativeFetch(input, options);
    throw new Error("External network disabled in offline game");
  };
  // The original payment labels use Stars; these are local game coins here.
  const notice = document.createElement("div");
  notice.className = "offline-notice";
  notice.innerHTML = '<button aria-label="Об офлайн-версии">Офлайн</button>';
  document.body.appendChild(notice);
  notice.querySelector("button").onclick = () =>
    alert(
      "Циферки · Offline\n\nПрогресс хранится на этом iPhone. Рынок и соперники виртуальные. Покупки используют только игровую валюту.\n\nПромокод OFFLINE: 100 000 ₽ и 3 крутки «Премиум». Скрытые серверные алгоритмы восстановлены приблизительно.",
    );
  if (engine.recovered)
    setTimeout(
      () =>
        alert(
          "Сохранение было повреждено. Использована резервная копия, если она доступна.",
        ),
      500,
    );
})();
