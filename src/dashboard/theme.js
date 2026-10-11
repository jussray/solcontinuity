/* SolContinuity theme preference: presentation only, never changes evidence state. */
(() => {
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");
  const label = document.getElementById("theme-label");
  const icon = document.getElementById("theme-icon");
  if (!toggle || !label || !icon) return;
  function apply(theme) {
    const dark = theme !== "light";
    root.dataset.theme = dark ? "dark" : "light";
    label.textContent = dark ? "Light mode" : "Dark mode";
    icon.textContent = dark ? "☀" : "☾";
    toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    toggle.setAttribute("aria-pressed", String(!dark));
  }
  apply(root.dataset.theme);
  toggle.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem("solcontinuity-theme", next); } catch { /* Preference storage may be disabled. */ }
  });
})();
