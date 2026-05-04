#!/usr/bin/env python3
"""
Provider Pressure + Business Metrics Backend Test Suite
Tests all endpoints for BIBI Cars CRM Provider Pressure feature
"""

import requests
import sys
import json
from datetime import datetime
from typing import Dict, Any, Optional

class ProviderPressureTester:
    def __init__(self, base_url: str = "https://full-project-2.preview.emergentagent.com"):
        self.base_url = base_url.rstrip("/")
        self.token: Optional[str] = None
        self.tests_run = 0
        self.tests_passed = 0
        self.tests_failed = 0
        self.failed_tests = []
        
    def log(self, message: str, level: str = "INFO"):
        """Log test messages"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
    
    def run_test(
        self,
        name: str,
        method: str,
        endpoint: str,
        expected_status: int,
        data: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        check_response: Optional[callable] = None,
    ) -> tuple[bool, Any]:
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        
        if headers is None:
            headers = {}
        
        headers.setdefault("Content-Type", "application/json")
        
        if self.token and "Authorization" not in headers:
            headers["Authorization"] = f"Bearer {self.token}"
        
        self.tests_run += 1
        self.log(f"Testing: {name}", "TEST")
        self.log(f"  → {method} {url}")
        
        try:
            if method == "GET":
                response = requests.get(url, headers=headers, timeout=30)
            elif method == "POST":
                response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == "PUT":
                response = requests.put(url, json=data, headers=headers, timeout=30)
            elif method == "DELETE":
                response = requests.delete(url, headers=headers, timeout=30)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            # Check status code
            status_match = response.status_code == expected_status
            
            # Try to parse JSON response
            try:
                response_data = response.json()
            except Exception:
                response_data = {"raw": response.text[:500]}
            
            # Run custom response checks if provided
            custom_check_passed = True
            custom_check_msg = ""
            if check_response and status_match:
                try:
                    custom_check_passed, custom_check_msg = check_response(response_data)
                except Exception as e:
                    custom_check_passed = False
                    custom_check_msg = f"Check function error: {str(e)}"
            
            success = status_match and custom_check_passed
            
            if success:
                self.tests_passed += 1
                self.log(f"  ✅ PASSED - Status: {response.status_code}", "PASS")
                if custom_check_msg:
                    self.log(f"     {custom_check_msg}")
            else:
                self.tests_failed += 1
                self.failed_tests.append(name)
                self.log(f"  ❌ FAILED", "FAIL")
                if not status_match:
                    self.log(f"     Expected status {expected_status}, got {response.status_code}")
                if not custom_check_passed:
                    self.log(f"     {custom_check_msg}")
                self.log(f"     Response: {json.dumps(response_data, indent=2)[:500]}")
            
            return success, response_data
            
        except Exception as e:
            self.tests_failed += 1
            self.failed_tests.append(name)
            self.log(f"  ❌ FAILED - Exception: {str(e)}", "FAIL")
            return False, {"error": str(e)}
    
    def test_login(self, email: str, password: str) -> bool:
        """Test login and store token"""
        self.log("=" * 60)
        self.log("AUTHENTICATION", "SECTION")
        self.log("=" * 60)
        
        success, response = self.run_test(
            name="Admin Login",
            method="POST",
            endpoint="/api/auth/login",
            expected_status=200,
            data={"email": email, "password": password},
            check_response=lambda r: (
                "access_token" in r or "token" in r,
                f"Token present: {'access_token' in r or 'token' in r}"
            )
        )
        
        # Handle both 'access_token' and 'token' field names
        token = response.get("access_token") or response.get("token")
        if success and token:
            self.token = token
            self.log(f"  Token acquired: {self.token[:20]}...")
            return True
        
        return False
    
    def test_system_health(self) -> bool:
        """Test GET /api/system/health"""
        self.log("=" * 60)
        self.log("SYSTEM HEALTH", "SECTION")
        self.log("=" * 60)
        
        def check_health(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("status" in r, "status field present"))
            checks.append((r.get("status") == "healthy", f"status is 'healthy': {r.get('status')}"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="System Health Check",
            method="GET",
            endpoint="/api/system/health",
            expected_status=200,
            check_response=check_health
        )
        
        return success
    
    def test_admin_metrics(self) -> bool:
        """Test GET /api/admin/metrics - 3 business metrics"""
        self.log("=" * 60)
        self.log("ADMIN BUSINESS METRICS", "SECTION")
        self.log("=" * 60)
        
        def check_metrics(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("metrics" in r, "metrics object present"))
            
            m = r.get("metrics", {})
            
            # Check conversion metric
            checks.append(("conversion" in m, "conversion metric present"))
            if "conversion" in m:
                conv = m["conversion"]
                checks.append(("value" in conv, "conversion.value present"))
                checks.append(("paid" in conv, "conversion.paid present"))
                checks.append(("sent" in conv, "conversion.sent present"))
            
            # Check avg_order_time metric
            checks.append(("avg_order_time" in m, "avg_order_time metric present"))
            if "avg_order_time" in m:
                aot = m["avg_order_time"]
                checks.append(("value_hours" in aot, "avg_order_time.value_hours present"))
                checks.append(("completed_orders" in aot, "avg_order_time.completed_orders present"))
            
            # Check repeat_rate metric
            checks.append(("repeat_rate" in m, "repeat_rate metric present"))
            if "repeat_rate" in m:
                rr = m["repeat_rate"]
                checks.append(("value" in rr, "repeat_rate.value present"))
                checks.append(("repeat_customers" in rr, "repeat_rate.repeat_customers present"))
                checks.append(("total_customers" in rr, "repeat_rate.total_customers present"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            # Add metric values to message
            if "metrics" in r:
                m = r["metrics"]
                if "conversion" in m:
                    conv_val = m["conversion"].get("value")
                    if conv_val is not None:
                        msg += f"\n     Conversion: {conv_val*100:.1f}% ({m['conversion'].get('paid')}/{m['conversion'].get('sent')})"
                if "avg_order_time" in m:
                    aot_val = m["avg_order_time"].get("value_hours")
                    if aot_val is not None:
                        msg += f"\n     Avg Order Time: {aot_val:.1f}h ({m['avg_order_time'].get('completed_orders')} orders)"
                if "repeat_rate" in m:
                    rr_val = m["repeat_rate"].get("value")
                    if rr_val is not None:
                        msg += f"\n     Repeat Rate: {rr_val*100:.1f}% ({m['repeat_rate'].get('repeat_customers')}/{m['repeat_rate'].get('total_customers')})"
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Admin Business Metrics (3 KPIs)",
            method="GET",
            endpoint="/api/admin/metrics",
            expected_status=200,
            check_response=check_metrics
        )
        
        return success
    
    def test_providers_me_stats(self) -> bool:
        """Test GET /api/providers/me/stats - current user's stats"""
        self.log("=" * 60)
        self.log("PROVIDER ME STATS", "SECTION")
        self.log("=" * 60)
        
        def check_me_stats(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("stats" in r, "stats object present"))
            
            if "stats" in r:
                s = r["stats"]
                checks.append(("providerId" in s, "providerId present"))
                checks.append(("score" in s, "score present"))
                checks.append(("tier" in s, "tier present"))
                checks.append(("metrics" in s, "metrics present"))
                
                # Check tier is valid
                valid_tiers = ["high", "normal", "warning", "penalized", "hidden"]
                tier = s.get("tier")
                checks.append((tier in valid_tiers, f"tier is valid: {tier}"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            if "stats" in r:
                s = r["stats"]
                msg += f"\n     Provider: {s.get('providerId')}"
                msg += f"\n     Score: {s.get('score')}"
                msg += f"\n     Tier: {s.get('tier')}"
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Provider Me Stats (current user)",
            method="GET",
            endpoint="/api/providers/me/stats",
            expected_status=200,
            check_response=check_me_stats
        )
        
        return success
    
    def test_admin_providers_stats(self) -> bool:
        """Test GET /api/admin/providers/stats - all providers sorted by score"""
        self.log("=" * 60)
        self.log("ADMIN PROVIDERS STATS", "SECTION")
        self.log("=" * 60)
        
        def check_providers_stats(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("items" in r, "items array present"))
            checks.append((isinstance(r.get("items"), list), "items is array"))
            
            items = r.get("items", [])
            msg_parts = [f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks]
            msg_parts.append(f"Found {len(items)} providers")
            
            # Check first item structure if exists
            if items:
                first = items[0]
                checks.append(("providerId" in first, "providerId present in first item"))
                checks.append(("score" in first, "score present in first item"))
                checks.append(("tier" in first, "tier present in first item"))
                checks.append(("providerName" in first or "providerEmail" in first, "provider name/email present"))
                
                msg_parts.append(f"First provider: {first.get('providerName') or first.get('providerEmail') or first.get('providerId')}")
                msg_parts.append(f"  Score: {first.get('score')}, Tier: {first.get('tier')}")
                
                # Check if sorted by score desc
                if len(items) > 1:
                    scores = [item.get("score", 0) for item in items]
                    is_sorted = all(scores[i] >= scores[i+1] for i in range(len(scores)-1))
                    checks.append((is_sorted, f"sorted by score desc: {is_sorted}"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join(msg_parts)
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Admin Providers Stats (all providers)",
            method="GET",
            endpoint="/api/admin/providers/stats",
            expected_status=200,
            check_response=check_providers_stats
        )
        
        return success
    
    def test_admin_providers_recompute_all(self) -> bool:
        """Test POST /api/admin/providers/stats/recompute - recompute all"""
        self.log("=" * 60)
        self.log("ADMIN PROVIDERS RECOMPUTE ALL", "SECTION")
        self.log("=" * 60)
        
        def check_recompute(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("count" in r, "count field present"))
            checks.append(("providers" in r, "providers array present"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            msg += f"\n     Recomputed {r.get('count', 0)} providers"
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Admin Providers Recompute All",
            method="POST",
            endpoint="/api/admin/providers/stats/recompute",
            expected_status=200,
            data={},
            check_response=check_recompute
        )
        
        return success
    
    def test_admin_providers_recompute_one(self, provider_id: str) -> bool:
        """Test POST /api/admin/providers/stats/recompute?provider_id=xxx"""
        self.log("=" * 60)
        self.log("ADMIN PROVIDERS RECOMPUTE ONE", "SECTION")
        self.log("=" * 60)
        
        def check_recompute_one(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("count" in r, "count field present"))
            checks.append((r.get("count") == 1, f"count is 1: {r.get('count')}"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name=f"Admin Providers Recompute One ({provider_id})",
            method="POST",
            endpoint=f"/api/admin/providers/stats/recompute?provider_id={provider_id}",
            expected_status=200,
            data={},
            check_response=check_recompute_one
        )
        
        return success
    
    def test_provider_specific_stats(self, provider_id: str) -> bool:
        """Test GET /api/providers/{provider_id}/stats"""
        self.log("=" * 60)
        self.log("PROVIDER SPECIFIC STATS", "SECTION")
        self.log("=" * 60)
        
        def check_specific_stats(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("stats" in r, "stats object present"))
            
            if "stats" in r:
                s = r["stats"]
                checks.append(("providerId" in s, "providerId present"))
                checks.append((s.get("providerId") == provider_id, f"providerId matches: {s.get('providerId')} == {provider_id}"))
                checks.append(("score" in s, "score present"))
                checks.append(("tier" in s, "tier present"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name=f"Provider Specific Stats ({provider_id})",
            method="GET",
            endpoint=f"/api/providers/{provider_id}/stats",
            expected_status=200,
            check_response=check_specific_stats
        )
        
        return success
    
    def print_summary(self):
        """Print test summary"""
        self.log("=" * 60)
        self.log("TEST SUMMARY", "SUMMARY")
        self.log("=" * 60)
        self.log(f"Total Tests: {self.tests_run}")
        self.log(f"Passed: {self.tests_passed} ✅")
        self.log(f"Failed: {self.tests_failed} ❌")
        
        if self.tests_failed > 0:
            self.log("\nFailed Tests:")
            for test_name in self.failed_tests:
                self.log(f"  - {test_name}")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        self.log(f"\nSuccess Rate: {success_rate:.1f}%")
        self.log("=" * 60)
        
        return self.tests_failed == 0


def main():
    """Main test execution"""
    print("\n" + "=" * 60)
    print("BIBI Cars CRM - Provider Pressure + Business Metrics Test Suite")
    print("=" * 60 + "\n")
    
    tester = ProviderPressureTester()
    
    # 1. System Health
    tester.test_system_health()
    
    # 2. Login
    if not tester.test_login("admin@bibi.cars", "Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu"):
        print("\n❌ Login failed - cannot proceed with authenticated tests")
        return 1
    
    # 3. Test admin business metrics (3 KPIs)
    tester.test_admin_metrics()
    
    # 4. Test providers/me/stats
    tester.test_providers_me_stats()
    
    # 5. Test admin/providers/stats (all providers)
    success, response = tester.run_test(
        name="Admin Providers Stats (all providers)",
        method="GET",
        endpoint="/api/admin/providers/stats",
        expected_status=200,
        check_response=lambda r: (
            "items" in r and isinstance(r.get("items"), list),
            f"items array present, found {len(r.get('items', []))} providers"
        )
    )
    
    # Get a provider ID for testing specific endpoints
    provider_id = None
    if success and response.get("items"):
        items = response.get("items", [])
        if items:
            provider_id = items[0].get("providerId")
            tester.log(f"  Found provider ID for testing: {provider_id}")
    
    # 6. Test recompute all
    tester.test_admin_providers_recompute_all()
    
    # 7. Test recompute one (if we have a provider ID)
    if provider_id:
        tester.test_admin_providers_recompute_one(provider_id)
        # 8. Test provider specific stats
        tester.test_provider_specific_stats(provider_id)
    else:
        tester.log("⚠️  Skipping provider-specific tests - no providers in database", "WARN")
    
    # Print summary
    all_passed = tester.print_summary()
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
