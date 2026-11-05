from __future__ import annotations

import os
import select
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
            expected_http_failures: set[tuple[int, str]] = set()
            observed_expected_http_failures: set[tuple[int, str]] = set()

            def record_response(response) -> None:
                if response.status < 400 or response.url.endswith("/favicon.ico"):
                    return
                receipt = (response.status, response.url)
                if receipt in expected_http_failures:
                    observed_expected_http_failures.add(receipt)
                    return
                browser_errors.append(f"http {response.status}: {response.url}")

            page.on("pageerror", lambda error: browser_errors.append(f"pageerror: {error}"))
            page.on("response", record_response)
            page.goto(base_url, wait_until="domcontentloaded")

            expect(page.get_by_role("heading", name="SolContinuity")).to_be_visible()
            expect(page.get_by_text("Provider-aware quorum")).to_be_visible()

            # The page starts its overview request asynchronously. Actions in HTTP mode
            # must still use the real backend before that request has settled rather than
            # silently falling through to the static browser model.
            page.get_by_role("tab", name="Audit lab").click()
            page.get_by_role("button", name="Run audit").click()
            expect(page.locator("#audit-output")).to_contain_text("solcontinuity-node-api")
            expect(page.locator("#audit-output")).not_to_contain_text("offline-browser-model")

            expect(page.locator("#api-status")).to_have_text("Connected")
            expect(page.locator("#analytics-status")).to_have_text("Configured")
            expect(page.locator("#evidence-mode")).to_contain_text("backend connected")
            expect(page.locator("#overview-evidence")).to_contain_text("application-layer continuity")
            expect(page.locator("#overview-evidence")).to_contain_text("not currently loaded")

            page.get_by_role("tab", name="Live evidence").click()
            expect(page.get_by_role("heading", name="Live transaction history")).to_be_visible()
            expect(page.locator("#evidence-summary")).to_contain_text("1 sanitized evidence record")
            expect(page.locator("#evidence-summary")).to_contain_text("1 STALE")
            expect(page.locator("#evidence-history")).to_contain_text("Signed Memo transaction")
            expect(page.locator("#evidence-history")).to_contain_text("Freshness")
            expect(page.locator("#evidence-history")).to_contain_text("historical receipt only")
            assert page.locator("#evidence-history .evidence-card").first.get_attribute("data-freshness") == "stale"

            page.get_by_role("tab", name="Audit lab").click()
            expect(page.get_by_role("heading", name="Manifest audit lab")).to_be_visible()
            page.get_by_role("button", name="Run audit").click()
            expect(page.locator("#audit-output")).to_contain_text('"score": 100')
            expect(page.locator("#audit-output")).to_contain_text("solcontinuity-node-api")
            expect(page.locator("#audit-output")).not_to_contain_text("offline-browser-model")
            expect(page.locator("#announcement")).to_contain_text("Audit complete")

            page.get_by_role("tab", name="Provider lab").click()
            expect(page.get_by_role("heading", name="Provider evidence lab")).to_be_visible()
            page.get_by_role("button", name="Score provider evidence").click()
            expect(page.locator("#provider-output")).to_contain_text('"score":')
            expect(page.locator("#provider-output")).to_contain_text("solcontinuity-python-analytics")
            expect(page.locator("#provider-output")).not_to_contain_text("offline-browser-model")

            page.get_by_role("tab", name="Architecture").click()
            expect(page.get_by_text("does not alter Solana consensus", exact=False)).to_be_visible()

            page.get_by_role("tab", name="Proof gates").click()
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

            expected_provider_failure = (500, f"{base_url}/api/provider-score")
            expected_http_failures.add(expected_provider_failure)
            stop_process(analytics_process)
            page.get_by_role("tab", name="Provider lab").click()
            page.get_by_role("button", name="Score provider evidence").click()
            expect(page.locator("#provider-output")).to_contain_text("BACKEND ERROR")
            expect(page.locator("#provider-output")).not_to_contain_text("offline-browser-model")
            expect(page.locator("#announcement")).to_contain_text("no offline score was substituted")
            assert expected_provider_failure in observed_expected_http_failures, (
                "provider fail-closed path must preserve the expected HTTP 500 receipt"
            )
            expected_http_failures.remove(expected_provider_failure)

            stop_process(server_process)
            page.get_by_role("tab", name="Audit lab").click()
            page.get_by_role("button", name="Run audit").click()
            expect(page.locator("#audit-output")).to_contain_text("BACKEND ERROR")
            expect(page.locator("#audit-output")).not_to_contain_text("offline-browser-model")
            expect(page.locator("#announcement")).to_contain_text("no offline result was substituted")

            assert expected_http_failures == set(), f"Unconsumed expected HTTP failures: {expected_http_failures}"
            assert browser_errors == [], f"Unexpected browser runtime errors: {browser_errors}"
            browser.close()
    finally:
        if server_process is not None:
            stop_process(server_process)
        stop_process(analytics_process)


def run_protected_console() -> None:
    """Exercise real signed server sessions without reading or editing cookies."""
    api_port = free_port()
    base_url = f"http://127.0.0.1:{api_port}"
    server_script = """
import { createSolContinuityServer } from './dist/src/api/server.js';
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
process.stdin.setEncoding('utf8');
process.stdin.on('data', command => {
  if (command.trim() === 'expire-session') {
    offset += 13 * 60 * 60 * 1000;
    process.stdout.write('SESSION_TIME_ADVANCED\\n');
  }
});
createSolContinuityServer({
  consoleToken: 'synthetic-browser-test-only',
  cookieSecret: 'synthetic-browser-cookie-secret-only',
  rateLimit: { capacity: 1000, refillPerSecond: 1000 },
  networkRateLimit: { capacity: 1000, refillPerSecond: 1000 }
}).listen(Number(process.env.PORT), '127.0.0.1');
"""
    server_env = os.environ.copy()
    server_env["PORT"] = str(api_port)
    server_process = subprocess.Popen(
        ["node", "--input-type=module", "-e", server_script],
        cwd=ROOT, env=server_env, stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        wait_http(f"{base_url}/api/health", server_process)
        with sync_playwright() as playwright:
            launch_options: dict[str, object] = {
                "headless": True,
                "args": ["--no-sandbox", "--disable-dev-shm-usage"],
            }
            if Path("/usr/bin/chromium").exists():
                launch_options["executable_path"] = "/usr/bin/chromium"
            browser = playwright.chromium.launch(**launch_options)
            page = browser.new_page(viewport={"width": 1280, "height": 960})
            browser_errors: list[str] = []
            page.on("pageerror", lambda error: browser_errors.append(str(error)))
            page.goto(base_url, wait_until="domcontentloaded")
            expect(page.locator("#session-form")).to_be_visible()
            expect(page.locator("#api-status")).to_have_text("Unavailable")

            page.locator("#console-token").fill("invalid-synthetic-token")
            with page.expect_response(f"{base_url}/api/session/login") as invalid:
                page.locator("#session-login").click()
            assert invalid.value.status == 401
            expect(page.locator("#session-status")).to_have_text("Access token was not accepted.")
            expect(page.locator("#console-token")).to_have_value("")

            def sign_in() -> None:
                page.locator("#console-token").fill("synthetic-browser-test-only")
                with page.expect_response(f"{base_url}/api/session/login") as authenticated:
                    page.locator("#session-login").click()
                assert authenticated.value.status == 204
                expect(page.locator("#session-logout")).to_be_visible()
                expect(page.locator("#api-status")).to_have_text("Connected")
                expect(page.locator("#console-token")).to_have_value("")

            sign_in()
            page.get_by_role("tab", name="Audit lab").click()
            original_manifest = page.locator("#manifest-editor").input_value()
            page.get_by_role("button", name="Run audit").click()
            expect(page.locator("#audit-output")).to_contain_text("solcontinuity-node-api")

            # Hold a genuine successful protected response until after server logout.
            # This proves late completion cannot restore data from the old session.
            held_responses = []

            def hold_audit(route) -> None:
                response = route.fetch()
                assert response.status == 200
                held_responses.append((route, response))

            page.route("**/api/audit", hold_audit)
            page.get_by_role("button", name="Run audit").click()
            deadline = time.monotonic() + 5
            while not held_responses and time.monotonic() < deadline:
                page.wait_for_timeout(25)
            assert held_responses, "Protected audit response was not observed"
            with page.expect_response(f"{base_url}/api/session/logout") as signed_out:
                page.locator("#session-logout").click()
            assert signed_out.value.status == 204
            expect(page.locator("#session-form")).to_be_visible()
            expect(page.locator("#api-status")).to_have_text("Unavailable")
            route, response = held_responses.pop()
            route.fulfill(response=response)
            page.wait_for_timeout(200)  # Allow the held response to reach the stale-request handler.
            expect(page.locator("#audit-output")).to_have_text("Ready to audit.")
            expect(page.locator("#audit-output")).not_to_contain_text("solcontinuity-node-api")
            expect(page.locator("#manifest-editor")).to_have_value(original_manifest)
            page.unroute("**/api/audit", hold_audit)

            sign_in()
            # Advance only this synthetic test server's clock past its actual
            # twelve-hour session expiry. The browser's signed cookie is untouched.
            page.route("**/api/audit", hold_audit)
            page.get_by_role("button", name="Run audit").click()
            deadline = time.monotonic() + 5
            while not held_responses and time.monotonic() < deadline:
                page.wait_for_timeout(25)
            assert held_responses, "Pre-expiry protected audit response was not observed"
            assert server_process.stdin is not None and server_process.stdout is not None
            server_process.stdin.write("expire-session\n")
            server_process.stdin.flush()
            ready, _, _ = select.select([server_process.stdout], [], [], 5)
            assert ready and server_process.stdout.readline().strip() == "SESSION_TIME_ADVANCED"
            page.get_by_role("tab", name="Overview", exact=True).click()
            page.get_by_role("button", name="Refresh evidence", exact=True).click()
            expect(page.locator("#session-form")).to_be_visible()
            expect(page.locator("#api-status")).to_have_text("Unavailable")
            expect(page.locator("#proof-gate-summary")).to_contain_text("8 UNKNOWN")
            page.get_by_role("tab", name="Audit lab").click()
            route, response = held_responses.pop()
            route.fulfill(response=response)
            page.wait_for_timeout(200)  # Allow the held response to reach the stale-request handler.
            expect(page.locator("#audit-output")).to_have_text("Ready to audit.")
            expect(page.locator("#audit-output")).not_to_contain_text("solcontinuity-node-api")
            page.unroute("**/api/audit", hold_audit)
            with page.expect_response(f"{base_url}/api/audit") as expired:
                page.get_by_role("button", name="Run audit").click()
            assert expired.value.status == 401
            expect(page.locator("#audit-output")).to_contain_text("AUTHENTICATION_REQUIRED")
            expect(page.locator("#audit-output")).not_to_contain_text("offline-browser-model")
            assert browser_errors == [], f"Protected Console browser errors: {browser_errors}"
            browser.close()
    finally:
        stop_process(server_process)


if __name__ == "__main__":
    try:
        run()
        run_protected_console()
    except Exception as error:  # noqa: BLE001
        print(f"Playwright verification failed: {error}", file=sys.stderr)
        raise
    else:
        print("Playwright real-runtime verification passed.")
