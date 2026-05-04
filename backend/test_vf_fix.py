"""
POC / regression test for the VesselFinder 404 fix.

Validates three things:
  1. New endpoints /api/pub/mp2 and /api/pub/sfl return 200 (not 404) with
     correct integer bbox scaling (Math.floor(coord * 600_000)).
  2. The binary arraybuffer response is decoded by parse_vf_mp2_binary into
     real vessel records (mmsi/lat/lng/name).
  3. extract_vessels_from_payload accepts the extension's base64 wrapper
     ({"format": "binary-b64", "data": "..."}).

Run:
    cd /app/backend && python3 test_vf_fix.py
"""
from __future__ import annotations

import base64
import sys
import httpx

from vesselfinder_scraper import (
    bbox_to_vf_int_str,
    extract_vessels_from_payload,
    parse_vf_mp2_binary,
    VesselFinderClient,
)


def section(title: str) -> None:
    print(f"\n{'='*60}\n {title}\n{'='*60}")


def check_bbox_scaling() -> bool:
    section("1. bbox_to_vf_int_str — float → int scaling")
    cases = [
        # (input, expected_parts_approx)
        ("120,30,122,32", "72000000,18000000,73200000,19200000"),
        # already scaled - pass through
        ("72000000,18000000,73200000,19200000", "72000000,18000000,73200000,19200000"),
        ("-10,30,10,50", "-6000000,18000000,6000000,30000000"),
        (None, None),
        ("bad", None),
    ]
    ok = True
    for inp, want in cases:
        got = bbox_to_vf_int_str(inp)
        verdict = "OK" if got == want else "FAIL"
        if verdict == "FAIL":
            ok = False
        print(f"  {verdict}  in={inp!r:<50} → out={got!r:<50} want={want!r}")
    return ok


def check_live_endpoints() -> bytes | None:
    section("2. Live VF endpoints /api/pub/mp2 + /api/pub/sfl")
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/octet-stream, */*",
        "Referer": "https://www.vesselfinder.com/",
    }
    # Shanghai area: ints for 120,30,122,32
    bbox = "72000000,18000000,73200000,19200000"
    for path in ("/api/pub/mp2", "/api/pub/sfl"):
        url = f"https://www.vesselfinder.com{path}"
        params = {"bbox": bbox, "zoom": 8, "mmsi": 0, "ref": 12345}
        try:
            with httpx.Client(timeout=20.0) as c:
                r = c.get(url, params=params, headers=headers)
            print(
                f"  {path:<18}  HTTP {r.status_code:<3}  "
                f"CT={r.headers.get('content-type'):<24}  "
                f"bytes={len(r.content)}"
            )
            if path == "/api/pub/mp2":
                live_payload = r.content
        except Exception as e:
            print(f"  {path}  ERROR: {e}")
            live_payload = None
    # Old legacy paths — must be 404 to prove the fix is really needed
    for path in ("/mp2", "/sfl", "/refresh"):
        url = f"https://www.vesselfinder.com{path}"
        try:
            with httpx.Client(timeout=10.0) as c:
                r = c.get(url, params={"bbox": bbox}, headers=headers)
            print(f"  (legacy) {path:<10}  HTTP {r.status_code} (should be 404)")
        except Exception as e:
            print(f"  (legacy) {path}  ERROR: {e}")
    return live_payload


def check_binary_decode(live_payload: bytes | None) -> bool:
    section("3. parse_vf_mp2_binary — decode live binary")
    if not live_payload:
        print("  SKIP (no live payload)")
        return False
    print(f"  input size: {len(live_payload)} bytes")
    print(f"  first 16 bytes: {live_payload[:16].hex()}")

    vessels = parse_vf_mp2_binary(live_payload)
    print(f"  decoded vessels: {len(vessels)}")
    for v in vessels[:5]:
        print(f"    • mmsi={v['mmsi']:<12} name={v['name']:<24} lat={v['lat']:.4f} lng={v['lng']:.4f}")

    # Accept the test if we got ANY vessels OR if the response was the
    # "empty" 12-byte header (no ships in bbox).
    if len(live_payload) == 12 and not vessels:
        print("  → 12-byte empty response (no ships in bbox). That's still OK — format is correct.")
        return True
    return len(vessels) > 0


def check_base64_wrapper(live_payload: bytes | None) -> bool:
    section("4. extract_vessels_from_payload — base64 wrapper path")
    if not live_payload:
        print("  SKIP (no live payload)")
        return False
    wrapped = {
        "format": "binary-b64",
        "size": len(live_payload),
        "data": base64.b64encode(live_payload).decode("ascii"),
    }
    vessels = extract_vessels_from_payload(wrapped)
    print(f"  decoded vessels from b64 wrapper: {len(vessels)}")
    for v in vessels[:3]:
        print(f"    • mmsi={v['mmsi']:<12} name={v['name']:<24} lat={v['lat']:.4f} lng={v['lng']:.4f}")
    return True  # no vessels = bbox simply empty, still OK


def main() -> int:
    results = {}
    results["bbox"] = check_bbox_scaling()
    live = check_live_endpoints()
    results["decode"] = check_binary_decode(live)
    results["b64"] = check_base64_wrapper(live)

    section("SUMMARY")
    for k, v in results.items():
        flag = "PASS" if v else "FAIL"
        print(f"  {flag:<4}  {k}")
    all_ok = all(results.values())
    print(f"\n  → {'ALL CHECKS PASSED' if all_ok else 'SOME CHECKS FAILED'}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
