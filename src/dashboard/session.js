/* The server owns authentication. This UI never reads cookies or stores tokens. */
(() => {
  const form = document.getElementById("session-form");
  const token = document.getElementById("console-token");
  const login = document.getElementById("session-login");
  const logout = document.getElementById("session-logout");
  const status = document.getElementById("session-status");
  let busy = false;
  let generation = 0;

  function show(signedIn, message) {
    generation += 1;
    form.hidden = signedIn;
    logout.hidden = !signedIn;
    status.textContent = message;
  }

  document.addEventListener("sol-session-required", () => {
    show(false, "Sign in to access this Console's protected data and tools.");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !token.value) return;
    generation += 1;
    busy = true;
    login.disabled = true;
    status.textContent = "Signing in.";
    const supplied = token.value;
    token.value = "";
    try {
      const response = await fetch("/api/session/login", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ token: supplied })
      });
      if (!response.ok) {
        show(false, response.status === 401 ? "Access token was not accepted." : response.status === 429 ? "Too many attempts. Wait before trying again." : "Sign-in unavailable. Ask the Console operator to check the server.");
        return;
      }
      show(true, "Signed in to this Console.");
      document.dispatchEvent(new Event("sol-session-changed"));
    } catch {
      show(false, "Could not reach this Console. Check the connection and try again.");
    } finally {
      busy = false;
      login.disabled = false;
    }
  });

  logout.addEventListener("click", async () => {
    if (busy) return;
    generation += 1;
    busy = true;
    logout.disabled = true;
    try {
      const response = await fetch("/api/session/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        status.textContent = "Sign-out was not confirmed. Try again before leaving this device.";
        return;
      }
      show(false, "Signed out. Sign in to access protected data and tools.");
      document.dispatchEvent(new Event("sol-session-changed"));
    } catch {
      status.textContent = "Sign-out was not confirmed. Check the connection and try again.";
    } finally {
      busy = false;
      logout.disabled = false;
    }
  });

  async function inspectAccess() {
    const requestedGeneration = generation;
    if (!["http:", "https:"].includes(location.protocol)) {
      status.textContent = "Static recovery mode. Sign-in requires a self-hosted Console server.";
      return;
    }
    try {
      const health = await fetch("/api/health", { credentials: "same-origin", cache: "no-store" });
      if (requestedGeneration !== generation) return;
      if (!health.ok) throw new Error("ACCESS_CHECK_FAILED");
      const payload = await health.json();
      if (requestedGeneration !== generation) return;
      if (payload.authRequired !== true) {
        if (payload.authRequired !== false) throw new Error("ACCESS_CHECK_FAILED");
        status.textContent = "Access protection is not configured on this Console. Ask the operator to enable it before exposing private data.";
        return;
      }
      const overview = await fetch("/api/overview", { credentials: "same-origin", cache: "no-store" });
      if (requestedGeneration !== generation) return;
      if (overview.ok) show(true, "Signed in to this Console.");
      else if (overview.status === 401) show(false, "Sign in to access this Console's protected data and tools.");
      else throw new Error("ACCESS_CHECK_FAILED");
    } catch {
      if (requestedGeneration !== generation) return;
      status.textContent = "Access check unavailable. No signed-in state has been confirmed.";
    }
  }
  void inspectAccess();
})();
