from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_http(url: str, process: subprocess.Popen[str], timeout_seconds: float = 15.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"Service exited before becoming ready: {url}\n{output}")
        try:
            with urlopen(url, timeout=1.0) as response:  # noqa: S310 - loopback test service only
                if 200 <= response.status < 300:
                    return
        except (URLError, TimeoutError, ConnectionError):
            time.sleep(0.15)
    raise TimeoutError(f"Timed out waiting for {url}")


def stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def run() -> None:
    analytics_port = free_port()
    api_port = free_port()
    analytics_url = f"http://127.0.0.1:{analytics_port}"
    base_url = f"http://127.0.0.1:{api_port}"

    analytics_process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "python.solcontinuity_analytics.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(analytics_port),
            "--log-level",
            "warning",
        ],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    server_process: subprocess.Popen[str] | None = None

    try:
        wait_http(f"{analytics_url}/health", analytics_process)

        server_env = os.environ.copy()
        server_env.update(
            {
                "PORT": str(api_port),
                "SOLCONTINUITY_ANALYTICS_URL": analytics_url,
                "SOLCONTINUITY_EVIDENCE_PATHS": "examples/evidence/live-devnet-evidence.sample.json",
            }
        )
        server_process = subprocess.Popen(
            ["node", "dist/src/api/server.js"],
            cwd=ROOT,
            env=server_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        wait_http(f"{base_url}/api/health", server_process)

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
            browser_errors: list[str] = []
            page.on("pageerror", lambda error: browser_errors.append(str(error)))
            page.on(
                "console",
                lambda message: browser_errors.append(message.text) if message.type == "error" else None,
            )
            page.goto(base_url, wait_until="networkidle")

            expect(page.get_by_role("heading", name="SolContinuity")).to_be_visible()
            expect(page.get_by_text("Provider-aware quorum")).to_be_visible()
            expect(page.locator("#api-status")).to_have_text("Connected")
            expect(page.locator("#analytics-status")).to_have_text("Configured")
            expect(page.locator("#evidence-mode")).to_contain_text("backend connected")
            expect(page.locator("#overview-evidence")).to_contain_text("application-layer continuity")
            expect(page.locator("#overview-evidence")).to_contain_text("not currently loaded")

            page.get_by_role("button", name="Live evidence").click()
            expect(page.get_by_role("heading", name="Live transaction history")).to_be_visible()
            expect(page.locator("#evidence-summary")).to_contain_text("1 sanitized evidence record")
            expect(page.locator("#evidence-history")).to_contain_text("Signed Memo transaction")

            page.get_by_role("button", name="Audit lab").click()
            expect(page.get_by_role("heading", name="Manifest audit lab")).to_be_visible()
            page.get_by_role("button", name="Run audit").click()
            expect(page.locator("#audit-output")).to_contain_text('"score": 100')
            expect(page.locator("#audit-output")).to_contain_text("solcontinuity-node-api")
            expect(page.locator("#audit-output")).not_to_contain_text("offline-browser-model")
            expect(page.locator("#announcement")).to_contain_text("Audit complete")

            page.get_by_role("button", name="Provider lab").click()
            expect(page.get_by_role("heading", name="Provider evidence lab")).to_be_visible()
            page.get_by_role("button", name="Score provider evidence").click()
            expect(page.locator("#provider-output")).to_contain_text('"score":')
            expect(page.locator("#provider-output")).to_contain_text("solcontinuity-python-analytics")
            expect(page.locator("#provider-output")).not_to_contain_text("offline-browser-model")

            page.get_by_role("button", name="Architecture").click()
            expect(page.get_by_text("does not alter Solana consensus", exact=False)).to_be_visible()

            page.get_by_role("button", name="Proof gates").click()
            expect(page.get_by_text("Python analytics tests", exact=False)).to_be_visible()
            expect(page.get_by_text("Live Devnet multi-provider test", exact=False)).to_be_visible()
            expect(page.get_by_text("External developer self-host test", exact=False)).to_be_visible()
            expect(page.locator("#proof-gate-summary")).to_contain_text("8 UNKNOWN")

            for gate_id in [
                "strict-typescript-gate",
                "node-tests-gate",
                "python-tests-gate",
                "manifest-risk-gate",
                "playwright-gate",
                "package-self-host-gate",
                "live-devnet-gate",
                "external-self-host-gate",
            ]:
                gate = page.locator(f"#{gate_id}")
                expect(gate).not_to_be_checked()
                assert gate.evaluate("element => element.indeterminate") is True, f"{gate_id} must be UNKNOWN"
                assert gate.get_attribute("data-state") == "unknown", f"{gate_id} must expose UNKNOWN state"

            artifact_dir = ROOT / "test-results"
            artifact_dir.mkdir(exist_ok=True)
            page.screenshot(path=str(artifact_dir / "dashboard-proof.png"), full_page=True)

            stop_process(analytics_process)
            page.get_by_role("button", name="Provider lab").click()
            page.get_by_role("button", name="Score provider evidence").click()
            expect(page.locator("#provider-output")).to_contain_text("BACKEND ERROR")
            expect(page.locator("#provider-output")).not_to_contain_text("offline-browser-model")
            expect(page.locator("#announcement")).to_contain_text("no offline score was substituted")

            stop_process(server_process)
            page.get_by_role("button", name="Audit lab").click()
            page.get_by_role("button", name="Run audit").click()
            expect(page.locator("#audit-output")).to_contain_text("BACKEND ERROR")
            expect(page.locator("#audit-output")).not_to_contain_text("offline-browser-model")
            expect(page.locator("#announcement")).to_contain_text("no offline result was substituted")

            assert browser_errors == [], f"Browser runtime errors: {browser_errors}"
            browser.close()
    finally:
        if server_process is not None:
            stop_process(server_process)
        stop_process(analytics_process)


if __name__ == "__main__":
    try:
        run()
    except Exception as error:  # noqa: BLE001
        print(f"Playwright verification failed: {error}", file=sys.stderr)
        raise
    else:
        print("Playwright real-runtime verification passed.")
