from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from python.solcontinuity_analytics.evidence import assess_evidence  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python scripts/score-evidence.py <evidence.json>", file=sys.stderr)
        return 2

    artifact_path = Path(sys.argv[1]).expanduser().resolve()
    try:
        artifact: Any = json.loads(artifact_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"Unable to read evidence artifact: {error}", file=sys.stderr)
        return 1

    if not isinstance(artifact, dict):
        print("Evidence artifact must be a JSON object.", file=sys.stderr)
        return 1

    report = asdict(assess_evidence(artifact))
    report["sourcePath"] = str(artifact_path)
    report["truthBoundary"] = (
        "This score evaluates only the supplied application-layer evidence. "
        "It does not prove RPC operator honesty, prevent collusion, or guarantee inclusion."
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
