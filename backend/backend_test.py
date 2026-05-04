#!/usr/bin/env python3
"""
Comprehensive Stripe Payment Integration Backend Test Suite
Tests all Stripe endpoints for BIBI Cars CRM
"""

import requests
import sys
import json
from datetime import datetime
from typing import Dict, Any, Optional

class StripeBackendTester:
    def __init__(self, base_url: str = "https://full-stack-ready-12.preview.emergentagent.com"):
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
    
    def test_stripe_public_config(self) -> bool:
        """Test GET /api/stripe/public-config"""
        self.log("=" * 60)
        self.log("STRIPE PUBLIC CONFIG", "SECTION")
        self.log("=" * 60)
        
        def check_config(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("enabled" in r, "enabled field present"))
            checks.append(("displayMethods" in r and isinstance(r.get("displayMethods"), list), "displayMethods is array"))
            checks.append(("automaticPaymentMethods" in r, "automaticPaymentMethods present"))
            checks.append(("currency" in r, "currency present"))
            checks.append(("publishableKey" in r, "publishableKey present"))
            
            # Check for specific payment methods
            display_methods = r.get("displayMethods", [])
            method_keys = [m.get("key") for m in display_methods if isinstance(m, dict)]
            
            has_card = "card" in method_keys
            has_apple = "apple_pay" in method_keys
            has_google = "google_pay" in method_keys
            has_link = "link" in method_keys
            
            checks.append((has_card, f"card method present: {has_card}"))
            checks.append((has_apple, f"apple_pay method present: {has_apple}"))
            checks.append((has_google, f"google_pay method present: {has_google}"))
            checks.append((has_link, f"link method present: {has_link}"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Stripe Public Config",
            method="GET",
            endpoint="/api/stripe/public-config",
            expected_status=200,
            check_response=check_config
        )
        
        return success
    
    def test_create_checkout_session(self) -> Optional[str]:
        """Test POST /api/stripe/create-checkout-session"""
        self.log("=" * 60)
        self.log("CREATE CHECKOUT SESSION", "SECTION")
        self.log("=" * 60)
        
        def check_session(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("sessionId" in r, "sessionId present"))
            checks.append(("url" in r or "clientSecret" in r, "url or clientSecret present"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Create Checkout Session",
            method="POST",
            endpoint="/api/stripe/create-checkout-session",
            expected_status=200,
            data={
                "amount": 100,
                "description": "Test Payment",
                "customerEmail": "test@example.com",
                "originUrl": self.base_url
            },
            check_response=check_session
        )
        
        if success:
            session_id = response.get("sessionId")
            self.log(f"  Session ID: {session_id}")
            return session_id
        
        return None
    
    def test_stripe_webhook(self) -> bool:
        """Test POST /api/stripe/webhook with payment_intent.succeeded event"""
        self.log("=" * 60)
        self.log("STRIPE WEBHOOK", "SECTION")
        self.log("=" * 60)
        
        # Create a mock payment_intent.succeeded event
        webhook_payload = {
            "id": "evt_test_webhook_" + datetime.now().strftime("%Y%m%d%H%M%S"),
            "type": "payment_intent.succeeded",
            "data": {
                "object": {
                    "id": "pi_test_" + datetime.now().strftime("%Y%m%d%H%M%S"),
                    "object": "payment_intent",
                    "amount": 10000,
                    "currency": "usd",
                    "status": "succeeded",
                    "metadata": {
                        "invoiceId": "inv_test_123",
                        "customerId": "cust_test_456",
                        "source": "bibi-crm"
                    },
                    "charges": {
                        "data": [{
                            "id": "ch_test_789",
                            "payment_method_details": {
                                "type": "card",
                                "card": {
                                    "brand": "visa",
                                    "last4": "4242"
                                }
                            },
                            "receipt_url": "https://stripe.com/receipt/test"
                        }]
                    },
                    "receipt_email": "test@example.com"
                }
            }
        }
        
        def check_webhook(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("received" in r and r.get("received") == True, "received=true"))
            checks.append(("type" in r, "type field present"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Stripe Webhook (payment_intent.succeeded)",
            method="POST",
            endpoint="/api/stripe/webhook",
            expected_status=200,
            data=webhook_payload,
            headers={"Content-Type": "application/json"},
            check_response=check_webhook
        )
        
        return success
    
    def test_admin_list_payments(self) -> bool:
        """Test GET /api/admin/payments?days=30"""
        self.log("=" * 60)
        self.log("ADMIN LIST PAYMENTS", "SECTION")
        self.log("=" * 60)
        
        def check_list(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("total" in r, "total field present"))
            checks.append(("items" in r and isinstance(r.get("items"), list), "items is array"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            msg += f"\n     Found {len(r.get('items', []))} payments"
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Admin List Payments (30 days)",
            method="GET",
            endpoint="/api/admin/payments?days=30",
            expected_status=200,
            check_response=check_list
        )
        
        return success
    
    def test_admin_payments_stats(self) -> bool:
        """Test GET /api/admin/payments/stats?days=30"""
        self.log("=" * 60)
        self.log("ADMIN PAYMENTS STATS", "SECTION")
        self.log("=" * 60)
        
        def check_stats(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("totalAmount" in r, "totalAmount present"))
            checks.append(("succeeded" in r, "succeeded count present"))
            checks.append(("failed" in r, "failed count present"))
            checks.append(("pending" in r, "pending count present"))
            checks.append(("refunded" in r, "refunded count present"))
            checks.append(("byMethod" in r and isinstance(r.get("byMethod"), list), "byMethod is array"))
            checks.append(("byCurrency" in r and isinstance(r.get("byCurrency"), list), "byCurrency is array"))
            checks.append(("daily" in r and isinstance(r.get("daily"), list), "daily is array"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Admin Payments Stats (30 days)",
            method="GET",
            endpoint="/api/admin/payments/stats?days=30",
            expected_status=200,
            check_response=check_stats
        )
        
        return success
    
    def test_admin_payment_detail(self, payment_id: str) -> bool:
        """Test GET /api/admin/payments/{paymentIntentId}"""
        self.log("=" * 60)
        self.log("ADMIN PAYMENT DETAIL", "SECTION")
        self.log("=" * 60)
        
        def check_detail(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("payment" in r, "payment object present"))
            checks.append(("stripe" in r, "stripe object present"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name=f"Admin Payment Detail ({payment_id})",
            method="GET",
            endpoint=f"/api/admin/payments/{payment_id}",
            expected_status=200,
            check_response=check_detail
        )
        
        return success
    
    def test_admin_payments_sync(self) -> bool:
        """Test POST /api/admin/payments/sync"""
        self.log("=" * 60)
        self.log("ADMIN PAYMENTS SYNC", "SECTION")
        self.log("=" * 60)
        
        def check_sync(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("success" in r, "success field present"))
            checks.append(("synced" in r, "synced count present"))
            checks.append(("total" in r, "total count present"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            msg += f"\n     Synced {r.get('synced', 0)} of {r.get('total', 0)} payments"
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Admin Payments Sync",
            method="POST",
            endpoint="/api/admin/payments/sync",
            expected_status=200,
            check_response=check_sync
        )
        
        return success
    
    def test_admin_recent_events(self) -> bool:
        """Test GET /api/admin/payments/recent-events"""
        self.log("=" * 60)
        self.log("ADMIN RECENT EVENTS", "SECTION")
        self.log("=" * 60)
        
        def check_events(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("success" in r, "success field present"))
            checks.append(("items" in r and isinstance(r.get("items"), list), "items is array"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            msg += f"\n     Found {len(r.get('items', []))} events"
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Admin Recent Stripe Events",
            method="GET",
            endpoint="/api/admin/payments/recent-events",
            expected_status=200,
            check_response=check_events
        )
        
        return success
    
    def test_admin_refund_payment(self, payment_id: str) -> bool:
        """Test POST /api/admin/payments/{id}/refund"""
        self.log("=" * 60)
        self.log("ADMIN REFUND PAYMENT", "SECTION")
        self.log("=" * 60)
        
        # Note: This will fail with 404 for a fake payment ID (expected behavior)
        # The system checks DB first before calling Stripe API
        success, response = self.run_test(
            name=f"Admin Refund Payment ({payment_id})",
            method="POST",
            endpoint=f"/api/admin/payments/{payment_id}/refund",
            expected_status=404,  # Expect 404 for fake payment ID (DB check first)
            data={"amount": 10, "reason": "requested_by_customer"}
        )
        
        # For this test, we expect a 404 error with "Payment not found"
        # This proves the route is wired and validates payment existence
        if success or (not success and response.get("detail", "").lower().find("payment not found") >= 0):
            self.log("  ✅ Route correctly wired (expected 404 for fake PI)", "INFO")
            return True
        
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
    print("BIBI Cars CRM - Stripe Payment Integration Test Suite")
    print("=" * 60 + "\n")
    
    tester = StripeBackendTester()
    
    # 1. Login
    if not tester.test_login("admin@bibi.cars", "Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu"):
        print("\n❌ Login failed - cannot proceed with authenticated tests")
        return 1
    
    # 2. Test public config
    tester.test_stripe_public_config()
    
    # 3. Test create checkout session
    session_id = tester.test_create_checkout_session()
    
    # 4. Test webhook
    tester.test_stripe_webhook()
    
    # 5. Test admin list payments
    list_success, list_response = tester.run_test(
        name="Admin List Payments (30 days)",
        method="GET",
        endpoint="/api/admin/payments?days=30",
        expected_status=200,
        check_response=lambda r: (
            "total" in r and "items" in r and isinstance(r.get("items"), list),
            f"total and items present, found {len(r.get('items', []))} payments"
        )
    )
    
    # Get a real payment ID for testing detail endpoint
    real_payment_id = None
    if list_success and list_response.get("items"):
        items = list_response.get("items", [])
        if items:
            real_payment_id = items[0].get("paymentIntentId") or items[0].get("id")
            tester.log(f"  Found real payment ID for testing: {real_payment_id}")
    
    # 6. Test admin payments stats
    tester.test_admin_payments_stats()
    
    # 7. Test admin payment detail with real ID if available
    if real_payment_id:
        tester.test_admin_payment_detail(real_payment_id)
    else:
        tester.log("⚠️  Skipping payment detail test - no payments in database", "WARN")
    
    # 8. Test admin payments sync
    tester.test_admin_payments_sync()
    
    # 9. Test admin recent events
    # NOTE: This endpoint has a route ordering bug - it's defined AFTER /{payment_id}
    # so FastAPI matches it as payment_id="recent-events" instead
    tester.log("=" * 60)
    tester.log("ADMIN RECENT EVENTS", "SECTION")
    tester.log("=" * 60)
    tester.log("⚠️  KNOWN BUG: /recent-events route defined after /{payment_id} route", "WARN")
    tester.log("   FastAPI matches 'recent-events' as a payment_id parameter", "WARN")
    tester.log("   FIX: Move line 12682 BEFORE line 12584 in server.py", "WARN")
    # Still try to test it to document the failure
    tester.test_admin_recent_events()
    
    # 10. Test admin refund (use fake ID - expect 404 since DB check happens first)
    tester.test_admin_refund_payment("pi_fake_test_refund")
    
    # Print summary
    all_passed = tester.print_summary()
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
