#!/usr/bin/env python3
"""
BIBI Cars CRM - Services → Invoices → Orders Flow Backend Test
Tests the complete payment and order workflow without Stripe integration
"""

import requests
import sys
import json
import uuid
from datetime import datetime
from typing import Dict, Any, Optional

class PaymentFlowTester:
    def __init__(self, base_url: str = "https://code-complete-44.preview.emergentagent.com"):
        self.base_url = base_url.rstrip("/")
        self.token: Optional[str] = None
        self.tests_run = 0
        self.tests_passed = 0
        self.tests_failed = 0
        self.failed_tests = []
        self.service_id = None
        self.invoice_id = None
        self.order_id = None
        self.customer_id = None
        
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
            elif method == "PATCH":
                response = requests.patch(url, json=data, headers=headers, timeout=30)
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
        self.log("1. AUTHENTICATION", "SECTION")
        self.log("=" * 60)
        
        success, response = self.run_test(
            name="Master Admin Login",
            method="POST",
            endpoint="/api/auth/login",
            expected_status=200,
            data={"email": email, "password": password},
            check_response=lambda r: (
                "access_token" in r or "token" in r,
                f"Token present: {'access_token' in r or 'token' in r}"
            )
        )
        
        token = response.get("access_token") or response.get("token")
        if success and token:
            self.token = token
            self.log(f"  Token acquired: {self.token[:20]}...")
            return True
        
        return False
    
    def test_create_service(self) -> bool:
        """Test POST /api/admin/services"""
        self.log("=" * 60)
        self.log("2. CREATE SERVICE (master_admin)", "SECTION")
        self.log("=" * 60)
        
        service_code = f"test_{uuid.uuid4().hex[:8]}"
        
        def check_service(r: Dict) -> tuple[bool, str]:
            checks = []
            service = r.get("service", {})
            checks.append(("service" in r, "service object present"))
            checks.append(("id" in service, "service.id present"))
            checks.append(("workflow" in service and len(service.get("workflow", [])) == 3, "workflow has 3 steps"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Create Service",
            method="POST",
            endpoint="/api/admin/services",
            expected_status=200,
            data={
                "code": service_code,
                "name": "Test Service - Inspection",
                "name_en": "Test Service - Inspection",
                "description": "E2E test service",
                "category": "import",
                "default_price": 200,
                "currency": "USD",
                "default_qty": 1,
                "workflow": [
                    {"key": "pending", "label": "Очікує"},
                    {"key": "in_progress", "label": "В роботі"},
                    {"key": "done", "label": "Готово"}
                ],
                "is_active": True
            },
            check_response=check_service
        )
        
        if success:
            self.service_id = response.get("service", {}).get("id")
            self.log(f"  Service ID: {self.service_id}")
        
        return success
    
    def test_list_services(self) -> bool:
        """Test GET /api/services (public)"""
        self.log("=" * 60)
        self.log("3. LIST SERVICES (public)", "SECTION")
        self.log("=" * 60)
        
        def check_list(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("items" in r and isinstance(r.get("items"), list), "items is array"))
            
            # Check if our service is in the list
            items = r.get("items", [])
            found = any(s.get("id") == self.service_id for s in items)
            checks.append((found, f"Created service found in list: {found}"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            msg += f"\n     Total services: {len(items)}"
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="List Services",
            method="GET",
            endpoint="/api/services",
            expected_status=200,
            check_response=check_list
        )
        
        return success
    
    def test_get_customers(self) -> bool:
        """Test GET /api/customers to get a customer ID"""
        self.log("=" * 60)
        self.log("4. GET CUSTOMER", "SECTION")
        self.log("=" * 60)
        
        success, response = self.run_test(
            name="Get Customers",
            method="GET",
            endpoint="/api/customers?limit=5",
            expected_status=200
        )
        
        if success:
            # Try different response formats
            body = response
            arr = body if isinstance(body, list) else body.get("data") or body.get("items") or body.get("customers") or []
            
            if arr:
                self.customer_id = arr[0].get("id")
            else:
                # Create a test customer ID
                self.customer_id = f"cus_test_{uuid.uuid4().hex[:8]}"
            
            self.log(f"  Customer ID: {self.customer_id}")
        
        return success
    
    def test_create_invoice(self) -> bool:
        """Test POST /api/manager/invoices with multi-line items"""
        self.log("=" * 60)
        self.log("5. CREATE MULTI-LINE INVOICE", "SECTION")
        self.log("=" * 60)
        
        def check_invoice(r: Dict) -> tuple[bool, str]:
            checks = []
            invoice = r.get("invoice", {})
            checks.append(("invoice" in r, "invoice object present"))
            checks.append(("id" in invoice, "invoice.id present"))
            checks.append(("items" in invoice and len(invoice.get("items", [])) == 2, "invoice has 2 items"))
            checks.append(("total" in invoice, "invoice.total present"))
            
            # Check total calculation: 200 (service) + 350*2 (custom) = 900
            expected_total = 200 + 350 * 2
            actual_total = invoice.get("total", 0)
            checks.append((actual_total == expected_total, f"total correct: {actual_total} == {expected_total}"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Create Multi-line Invoice",
            method="POST",
            endpoint="/api/manager/invoices",
            expected_status=200,
            data={
                "customerId": self.customer_id,
                "currency": "USD",
                "items": [
                    {"service_id": self.service_id, "qty": 1},
                    {"name": "Custom delivery line", "price": 350, "qty": 2}
                ],
                "notes": "E2E test invoice"
            },
            check_response=check_invoice
        )
        
        if success:
            self.invoice_id = response.get("invoice", {}).get("id")
            self.log(f"  Invoice ID: {self.invoice_id}")
            self.log(f"  Total: {response.get('invoice', {}).get('total')} USD")
        
        return success
    
    def test_list_manager_invoices(self) -> bool:
        """Test GET /api/manager/invoices/my"""
        self.log("=" * 60)
        self.log("6. LIST MANAGER INVOICES", "SECTION")
        self.log("=" * 60)
        
        def check_list(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("items" in r and isinstance(r.get("items"), list), "items is array"))
            
            # Check if our invoice is in the list
            items = r.get("items", [])
            found = any(inv.get("id") == self.invoice_id for inv in items)
            checks.append((found, f"Created invoice found in list: {found}"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            msg += f"\n     Total invoices: {len(items)}"
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="List Manager Invoices",
            method="GET",
            endpoint="/api/manager/invoices/my?limit=200",
            expected_status=200,
            check_response=check_list
        )
        
        return success
    
    def test_mark_invoice_paid(self) -> bool:
        """Test PATCH /api/invoices/{id}/mark-paid"""
        self.log("=" * 60)
        self.log("7. MARK INVOICE PAID (auto-creates order)", "SECTION")
        self.log("=" * 60)
        
        success, response = self.run_test(
            name="Mark Invoice Paid",
            method="PATCH",
            endpoint=f"/api/invoices/{self.invoice_id}/mark-paid",
            expected_status=200
        )
        
        return success
    
    def test_get_manager_orders(self) -> bool:
        """Test GET /api/manager/orders"""
        self.log("=" * 60)
        self.log("8. GET MANAGER ORDERS (verify auto-created)", "SECTION")
        self.log("=" * 60)
        
        def check_orders(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("items" in r and isinstance(r.get("items"), list), "items is array"))
            
            # Find order linked to our invoice
            items = r.get("items", [])
            order = next((o for o in items if o.get("invoiceId") == self.invoice_id), None)
            
            checks.append((order is not None, f"Order for invoice {self.invoice_id} found"))
            
            if order:
                checks.append(("steps" in order and len(order.get("steps", [])) >= 3, "Order has workflow steps"))
                checks.append(("status" in order, "Order has status"))
                self.order_id = order.get("id")
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            if order:
                msg += f"\n     Order ID: {order.get('id')}"
                msg += f"\n     Steps: {len(order.get('steps', []))}"
                msg += f"\n     Status: {order.get('status')}"
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Get Manager Orders",
            method="GET",
            endpoint="/api/manager/orders?limit=200",
            expected_status=200,
            check_response=check_orders
        )
        
        return success
    
    def test_update_order_step(self) -> bool:
        """Test PATCH /api/orders/{id}/steps/{stepId}"""
        self.log("=" * 60)
        self.log("9. UPDATE ORDER STEP", "SECTION")
        self.log("=" * 60)
        
        if not self.order_id:
            self.log("  ⚠️  No order ID available, skipping", "WARN")
            return True
        
        # First get the order to find a step ID
        success, order_response = self.run_test(
            name="Get Order Details",
            method="GET",
            endpoint=f"/api/orders/{self.order_id}",
            expected_status=200
        )
        
        if not success:
            return False
        
        order = order_response.get("order", {})
        steps = order.get("steps", [])
        
        if not steps:
            self.log("  ⚠️  No steps in order, skipping", "WARN")
            return True
        
        step_id = steps[0].get("id")
        
        def check_update(r: Dict) -> tuple[bool, str]:
            checks = []
            order = r.get("order", {})
            checks.append(("order" in r, "order object present"))
            checks.append(("status" in order, "order.status present"))
            
            # Check if step was updated
            updated_steps = order.get("steps", [])
            updated_step = next((s for s in updated_steps if s.get("id") == step_id), None)
            
            if updated_step:
                checks.append((updated_step.get("status") == "done", f"Step status updated to 'done'"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            msg += f"\n     New order status: {order.get('status')}"
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Update Order Step to Done",
            method="PATCH",
            endpoint=f"/api/orders/{self.order_id}/steps/{step_id}",
            expected_status=200,
            data={"status": "done", "note": "E2E test completion"},
            check_response=check_update
        )
        
        return success
    
    def test_add_order_note(self) -> bool:
        """Test POST /api/orders/{id}/notes"""
        self.log("=" * 60)
        self.log("10. ADD ORDER NOTE", "SECTION")
        self.log("=" * 60)
        
        if not self.order_id:
            self.log("  ⚠️  No order ID available, skipping", "WARN")
            return True
        
        success, response = self.run_test(
            name="Add Order Note",
            method="POST",
            endpoint=f"/api/orders/{self.order_id}/notes",
            expected_status=200,
            data={"body": "E2E test note"}
        )
        
        return success
    
    def test_team_orders(self) -> bool:
        """Test GET /api/team/orders"""
        self.log("=" * 60)
        self.log("11. TEAM LEAD ORDERS VIEW", "SECTION")
        self.log("=" * 60)
        
        def check_team_orders(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("items" in r and isinstance(r.get("items"), list), "items is array"))
            
            # Check if our order is visible
            items = r.get("items", [])
            found = any(o.get("id") == self.order_id for o in items)
            checks.append((found, f"Order {self.order_id} visible to team lead"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            msg += f"\n     Total orders: {len(items)}"
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Team Lead Orders",
            method="GET",
            endpoint="/api/team/orders",
            expected_status=200,
            check_response=check_team_orders
        )
        
        return success
    
    def test_customer_cabinet_orders(self) -> bool:
        """Test GET /api/customer-cabinet/{customerId}/orders"""
        self.log("=" * 60)
        self.log("12. CUSTOMER CABINET ORDERS (unauthenticated)", "SECTION")
        self.log("=" * 60)
        
        if not self.customer_id:
            self.log("  ⚠️  No customer ID available, skipping", "WARN")
            return True
        
        def check_cabinet_orders(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("items" in r and isinstance(r.get("items"), list), "items is array"))
            
            # Check if our order is visible
            items = r.get("items", [])
            found = any(o.get("id") == self.order_id for o in items)
            checks.append((found, f"Order {self.order_id} visible to customer"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            msg += f"\n     Total orders: {len(items)}"
            
            return all_passed, msg
        
        # Test without auth (customer cabinet is public)
        success, response = self.run_test(
            name="Customer Cabinet Orders",
            method="GET",
            endpoint=f"/api/customer-cabinet/{self.customer_id}/orders",
            expected_status=200,
            headers={"Authorization": ""},  # No auth
            check_response=check_cabinet_orders
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
    print("BIBI Cars CRM - Payment Flow E2E Backend Test")
    print("Services → Invoices → Orders → Customer Cabinet")
    print("=" * 60 + "\n")
    
    tester = PaymentFlowTester()
    
    # Run all tests in sequence
    if not tester.test_login("admin@bibi.cars", "Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu"):
        print("\n❌ Login failed - cannot proceed")
        return 1
    
    tester.test_create_service()
    tester.test_list_services()
    tester.test_get_customers()
    tester.test_create_invoice()
    tester.test_list_manager_invoices()
    tester.test_mark_invoice_paid()
    tester.test_get_manager_orders()
    tester.test_update_order_step()
    tester.test_add_order_note()
    tester.test_team_orders()
    tester.test_customer_cabinet_orders()
    
    # Print summary
    all_passed = tester.print_summary()
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
