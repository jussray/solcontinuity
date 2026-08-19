from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_DIR = ROOT / "dist" / "dashboard"


def bundled_document() -> str:
    document = (DASHBOARD_DIR / "index.html").read_text(encoding="utf-8")
    styles = (DASHBOARD_DIR / "styles.css").read_text(encoding="utf-8")
    script = (DASHBOARD_DIR / "app.js").read_text(encoding="utf-8")
    document = document.replace('<link rel="stylesheet" href="./styles.css" />', f"<style>{styles}</style>")
    document = document.replace('<script src="./app.js"></script>', f"<script>{script}</script>")
    return document


def run() -> None:
    with sync_playwright() as playwright:
        launch_options: dict[str, object] = {
            "headless": True,
            "args": ["--no-sandbox", "--disable-dev-shm-usage"],
        }
        system_chromium = Path("/usr/bin/chromium")
        if system_chromium.exists():
            launch_options["executable_path"] = str(system_chromium)

        browser = playwright.chromium.launch(**launch_options)
        page = browser.new_page(viewport={"width": 1280, "height": 960})
        page.set_content(bundled_document(), wait_until="load")

        expect(page.get_by_role("heading", name="SolContinuity")).to_be_visible()
        expect(page.get_by_text("Provider-aware quorum")).to_be_visible()
        expect(page.locator("#evidence-mode")).to_contain_text("static artifact")

        page.get_by_role("button", name="Live evidence").click()
        expect(page.get_by_role("heading", name="Live transaction history")).to_be_visible()
        expect(page.locator("#evidence-summary")).to_contain_text("Static recovery mode makes no live-chain claim")

        page.get_by_role("button", name="Audit lab").click()
        expect(page.get_by_role("heading", name="Manifest audit lab")).to_be_visible()
        page.get_by_role("button", name="Run audit").click()
        expect(page.locator("#audit-output")).to_contain_text('"score": 100')
        expect(page.locator("#audit-output")).to_contain_text("offline-browser-model")
        expect(page.locator("#announcement")).to_contain_text("Audit complete")

        page.get_by_role("button", name="Provider lab").click()
        expect(page.get_by_role("heading", name="Provider evidence lab")).to_be_visible()
        page.get_by_role("button", name="Score provider evidence").click()
        expect(page.locator("#provider-output")).to_contain_text('"score":')
        expect(page.locator("#provider-output")).to_contain_text("offline-browser-model")

        page.get_by_role("button", name="Architecture").click()
        expect(page.get_by_text("does not alter Solana consensus", exact=False)).to_be_visible()

        page.get_by_role("button", name="Proof gates").click()
        expect(page.get_by_text("Python analytics tests", exact=False)).to_be_visible()
        expect(page.get_by_text("Live Devnet multi-provider test", exact=False)).to_be_visible()
        expect(page.get_by_text("External developer self-host test", exact=False)).to_be_visible()
        expect(page.locator("#proof-gate-summary")).to_contain_text("8 UNKNOWN")

        static_gate_ids = [
            "strict-typescript-gate",
            "node-tests-gate",
            "python-tests-gate",
            "manifest-risk-gate",
            "playwright-gate",
            "package-self-host-gate",
            "live-devnet-gate",
            "external-self-host-gate",
        ]
        for gate_id in static_gate_ids:
            gate = page.locator(f"#{gate_id}")
            expect(gate).not_to_be_checked()
            assert gate.evaluate("element => element.indeterminate") is True, f"{gate_id} must be UNKNOWN in static mode"
            assert gate.get_attribute("data-state") == "unknown", f"{gate_id} must expose UNKNOWN state"

        for state_id in [
            "strict-typescript-state",
            "node-tests-state",
            "python-tests-state",
            "manifest-risk-state",
            "playwright-state",
            "package-self-host-state",
            "live-devnet-state",
            "external-self-host-state",
        ]:
            expect(page.locator(f"#{state_id}")).to_have_text("UNKNOWN")

        page.wait_for_timeout(300)

        artifact_dir = ROOT / "test-results"
        artifact_dir.mkdir(exist_ok=True)
        page.screenshot(path=str(artifact_dir / "dashboard-proof.png"), full_page=True)
        browser.close()


if __name__ == "__main__":
    try:
        run()
    except Exception as error:  # noqa: BLE001
        print(f"Playwright verification failed: {error}", file=sys.stderr)
        raise
    else:
        print("Playwright verification passed.")
