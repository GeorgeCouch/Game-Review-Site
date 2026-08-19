(function () {
  const btn = document.getElementById("enable-push");
  const statusEl = document.getElementById("push-status");
  if (!btn) return;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function ensureSw() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      throw new Error("Push not supported in this browser");
    }
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function refreshButtonState() {
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("Push is not supported in this browser.");
        btn.disabled = true;
        return;
      }
      const perm = Notification.permission;
      const reg = await navigator.serviceWorker.getRegistration("/sw.js") || await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (perm === "granted" && sub) {
        btn.textContent = "Push enabled";
        btn.disabled = true;
        setStatus("Push notifications are on for this device.");
      } else if (perm === "denied") {
        btn.textContent = "Push blocked";
        btn.disabled = true;
        setStatus("Notifications are blocked. Enable them in the browser site settings.");
      } else {
        btn.textContent = "Enable push alerts";
        btn.disabled = false;
        setStatus("");
      }
    } catch (e) {}
  }

  refreshButtonState();

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    setStatus("Enabling…");
    try {
      const reg = await ensureSw();
      const keyRes = await fetch("/api/push/vapid-public-key");
      if (!keyRes.ok) {
        throw new Error("Push is not configured on the server (missing VAPID keys)");
      }
      const { publicKey } = await keyRes.json();

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission denied");
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Subscribe failed");

      setStatus("Push enabled on this device.");
      btn.textContent = "Push enabled";
    } catch (err) {
      setStatus(err.message || "Could not enable push");
      btn.disabled = false;
    }
  });
})();
