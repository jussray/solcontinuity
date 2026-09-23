from __future__ import annotations

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


def wait_http(url: str, process: subprocess.Popen[str], timeout_seconds: float = 10.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"Static dashboard server exited early:\n{output}")
        try:
            with urlopen(url, timeout=1.0) as response:  # noqa: S310 - loopback test service only
                if 200 <= response.status < 300:
                    return
        except (URLError, TimeoutError, ConnectionError):
            time.sleep(0.1)
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
    port = free_port()
    base_url = f"http://127.0.0.1:{port}/"
    dashboard_root = ROOT / "dist" / "dashboard"
    server = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "http.server",
            str(port),
            "--bind",
            "127.0.0.1",
            "--directory",
            str(dashboard_root),
        ],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        wait_http(base_url, server)
        with sync_playwright() as playwright:
            launch_options: dict[str, object] = {
                "headless": True,
                "args": ["--no-sandbox", "--disable-dev-shm-usage"],
            }
            system_chromium = Path("/usr/bin/chromium")
            if system_chromium.exists():
                launch_options["executable_path"] = str(system_chromium)

            browser = playwright.chromium.launch(**launch_options)
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.goto(base_url, wait_until="domcontentloaded")

            tablist = page.get_by_role("tablist", name="Dashboard sections")
            expect(tablist).to_be_visible()
            expect(tablist.get_by_role("tab")).to_have_count(6)

            overview_tab = page.get_by_role("tab", name="Overview")
            evidence_tab = page.get_by_role("tab", name="Live evidence")
            proof_tab = page.get_by_role("tab", name="Proof gates")

            expect(overview_tab).to_have_attribute("aria-selected", "true")
            assert overview_tab.get_attribute("tabindex") == "0"
            assert evidence_tab.get_attribute("tabindex") == "-1"
            assert evidence_tab.get_attribute("aria-controls") == "panel-evidence"
            expect(page.get_by_role("tabpanel", name="Overview")).to_be_visible()

            overview_tab.focus()
            page.keyboard.press("ArrowRight")
            expect(evidence_tab).to_be_focused()
            expect(evidence_tab).to_have_attribute("aria-selected", "true")
            expect(overview_tab).to_have_attribute("aria-selected", "false")
            expect(page.get_by_role("tabpanel", name="Live evidence")).to_be_visible()

            page.keyboard.press("End")
            expect(proof_tab).to_be_focused()
            expect(proof_tab).to_have_attribute("aria-selected", "true")
            expect(page.get_by_role("tabpanel", name="Proof gates")).to_be_visible()

            page.keyboard.press("Home")
            expect(overview_tab).to_be_focused()
            expect(overview_tab).to_have_attribute("aria-selected", "true")

            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth") is True
            page.set_viewport_size({"width": 320, "height": 800})
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth") is True

            page.set_viewport_size({"width": 390, "height": 844})
            artifact_dir = ROOT / "test-results"
            artifact_dir.mkdir(exist_ok=True)
            page.screenshot(path=str(artifact_dir / "dashboard-mobile-accessibility-proof.png"), full_page=True)
            browser.close()
    finally:
        stop_process(server)


if __name__ == "__main__":
    try:
        run()
    except Exception as error:  # noqa: BLE001
        print(f"Playwright mobile/accessibility verification failed: {error}", file=sys.stderr)
        raise
    else:
        print("Playwright mobile/accessibility verification passed.")
