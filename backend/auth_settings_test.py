#!/usr/bin/env python3
"""
BIBI Cars CRM - Auth Settings & Password Reset Backend Test Suite
Tests dynamic auth configuration and customer password reset flow
"""

import requests
import sys
import json
import time
from datetime import datetime
from typing import Dict, Any, Optional

class AuthSettingsBackendTester:
    def __init__(self, base_url: str = "https://clone-deploy-23.preview.emergentagent.com"):
        self.base_url = base_url.rstrip("/")
        self.admin_token: Optional[str] = None
        self.customer_token: Optional[str] = None
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
        params: Optional[Dict[str, str]] = None,
        headers: Optional[Dict[str, str]] = None,
        check_response: Optional[callable] = None,
        use_admin_token: bool = False,
    ) -> tuple[bool, Any]:
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        
        if headers is None:
            headers = {}
        
        headers.setdefault("Content-Type", "application/json")
        
        if use_admin_token and self.admin_token:
            headers["Authorization"] = f"Bearer {self.admin_token}"
        
        self.tests_run += 1
        self.log(f"Testing: {name}", "TEST")
        self.log(f"  → {method} {url}")
        
        try:
            if method == "GET":
                response = requests.get(url, headers=headers, params=params, timeout=30)
            elif method == "POST":
                response = requests.post(url, json=data, headers=headers, params=params, timeout=30)
            elif method == "PATCH":
                response = requests.patch(url, json=data, headers=headers, timeout=30)
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
    
    def test_admin_login(self) -> bool:
        """Test admin login and store token"""
        self.log("=" * 70)
        self.log("ADMIN AUTHENTICATION", "SECTION")
        self.log("=" * 70)
        
        success, response = self.run_test(
            name="Admin Login",
            method="POST",
            endpoint="/api/auth/login",
            expected_status=200,
            data={"email": "admin@bibi.cars", "password": "Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu"},
            check_response=lambda r: (
                "access_token" in r or "token" in r,
                f"Token present: {'access_token' in r or 'token' in r}"
            )
        )
        
        token = response.get("access_token") or response.get("token")
        if success and token:
            self.admin_token = token
            self.log(f"  Admin token acquired: {self.admin_token[:20]}...")
            return True
        
        return False
    
    def test_public_settings(self) -> bool:
        """Test GET /api/settings/public (no auth required)"""
        self.log("=" * 70)
        self.log("PUBLIC SETTINGS ENDPOINT", "SECTION")
        self.log("=" * 70)
        
        def check_public(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("baseUrl" in r, "baseUrl present"))
            checks.append(("frontendUrl" in r, "frontendUrl present"))
            checks.append(("google" in r and isinstance(r.get("google"), dict), "google object present"))
            checks.append(("features" in r and isinstance(r.get("features"), dict), "features object present"))
            checks.append(("password" in r and isinstance(r.get("password"), dict), "password object present"))
            
            # Security checks - should NOT expose secrets
            checks.append(("jwt" not in r or "secret" not in r.get("jwt", {}), "jwt.secret NOT exposed"))
            checks.append(("email" not in r or "mode" not in r.get("email", {}), "email config NOT exposed"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Public Settings (safe subset)",
            method="GET",
            endpoint="/api/settings/public",
            expected_status=200,
            check_response=check_public
        )
        
        return success
    
    def test_admin_get_auth_settings(self) -> bool:
        """Test GET /api/admin/settings/auth (admin only)"""
        self.log("=" * 70)
        self.log("ADMIN GET AUTH SETTINGS", "SECTION")
        self.log("=" * 70)
        
        def check_admin_get(r: Dict) -> tuple[bool, str]:
            checks = []
            checks.append(("baseUrl" in r, "baseUrl present"))
            checks.append(("frontendUrl" in r, "frontendUrl present"))
            checks.append(("google" in r, "google present"))
            checks.append(("jwt" in r, "jwt present"))
            checks.append(("features" in r, "features present"))
            checks.append(("password" in r, "password present"))
            checks.append(("email" in r, "email present"))
            checks.append(("_resolved" in r, "_resolved panel present"))
            
            # JWT secret should be masked
            jwt_secret = r.get("jwt", {}).get("secret", "")
            checks.append((jwt_secret == "********" or jwt_secret == "", "jwt.secret masked"))
            
            # Resolved panel should have effective values
            resolved = r.get("_resolved", {})
            checks.append(("baseUrl" in resolved, "_resolved.baseUrl present"))
            checks.append(("frontendUrl" in resolved, "_resolved.frontendUrl present"))
            checks.append(("googleClientId" in resolved, "_resolved.googleClientId present"))
            
            all_passed = all(c[0] for c in checks)
            msg = "\n     ".join([f"{'✓' if c[0] else '✗'} {c[1]}" for c in checks])
            
            return all_passed, msg
        
        success, response = self.run_test(
            name="Admin Get Auth Settings",
            method="GET",
            endpoint="/api/admin/settings/auth",
            expected_status=200,
            use_admin_token=True,
            check_response=check_admin_get
        )
        
        return success
    
    def test_admin_patch_auth_settings(self) -> bool:
        """Test PATCH /api/admin/settings/auth (admin only)"""
        self.log("=" * 70)
        self.log("ADMIN PATCH AUTH SETTINGS", "SECTION")
        self.log("=" * 70)
        
        # Test 1: Update baseUrl
        success1, response1 = self.run_test(
            name="Patch baseUrl",
            method="PATCH",
            endpoint="/api/admin/settings/auth",
            expected_status=200,
            data={"baseUrl": "https://test-base.example.com"},
            use_admin_token=True,
            check_response=lambda r: (
                "success" in r and r.get("success") == True,
                "success=true in response"
            )
        )
        
        # Test 2: Verify cache invalidation - GET should reflect new value
        time.sleep(0.5)  # Small delay for cache invalidation
        success2, response2 = self.run_test(
            name="Verify baseUrl updated (cache invalidated)",
            method="GET",
            endpoint="/api/admin/settings/auth",
            expected_status=200,
            use_admin_token=True,
            check_response=lambda r: (
                r.get("baseUrl") == "https://test-base.example.com",
                f"baseUrl updated: {r.get('baseUrl')}"
            )
        )
        
        # Test 3: Update password policy
        success3, response3 = self.run_test(
            name="Patch password policy",
            method="PATCH",
            endpoint="/api/admin/settings/auth",
            expected_status=200,
            data={"password": {"minLength": 10, "resetTokenTtlMinutes": 30}},
            use_admin_token=True,
            check_response=lambda r: (
                "success" in r,
                "password policy update accepted"
            )
        )
        
        # Test 4: Update feature flags
        success4, response4 = self.run_test(
            name="Patch feature flags",
            method="PATCH",
            endpoint="/api/admin/settings/auth",
            expected_status=200,
            data={"features": {"googleEnabled": False}},
            use_admin_token=True,
            check_response=lambda r: (
                "success" in r,
                "feature flags update accepted"
            )
        )
        
        return success1 and success2 and success3 and success4
    
    def test_customer_register(self) -> tuple[bool, str]:
        """Test POST /api/customer-auth/register"""
        self.log("=" * 70)
        self.log("CUSTOMER REGISTRATION", "SECTION")
        self.log("=" * 70)
        
        test_email = f"test_{int(time.time())}@example.com"
        
        success, response = self.run_test(
            name="Customer Register",
            method="POST",
            endpoint="/api/customer-auth/register",
            expected_status=200,
            data={
                "email": test_email,
                "password": "TestPass123!",
                "name": "Test User"
            },
            check_response=lambda r: (
                "sessionToken" in r or "token" in r,
                f"sessionToken present: {'sessionToken' in r or 'token' in r}"
            )
        )
        
        return success, test_email
    
    def test_customer_login(self, email: str, password: str) -> bool:
        """Test POST /api/customer-auth/login"""
        self.log("=" * 70)
        self.log("CUSTOMER LOGIN", "SECTION")
        self.log("=" * 70)
        
        success, response = self.run_test(
            name="Customer Login (valid credentials)",
            method="POST",
            endpoint="/api/customer-auth/login",
            expected_status=200,
            data={"email": email, "password": password},
            check_response=lambda r: (
                "sessionToken" in r or "token" in r,
                f"sessionToken present: {'sessionToken' in r or 'token' in r}"
            )
        )
        
        # Test invalid password
        success2, response2 = self.run_test(
            name="Customer Login (invalid password)",
            method="POST",
            endpoint="/api/customer-auth/login",
            expected_status=401,
            data={"email": email, "password": "WrongPassword123!"}
        )
        
        return success and success2
    
    def test_forgot_password_flow(self, email: str) -> tuple[bool, Optional[str]]:
        """Test POST /api/customer-auth/forgot-password"""
        self.log("=" * 70)
        self.log("FORGOT PASSWORD FLOW", "SECTION")
        self.log("=" * 70)
        
        # Test 1: Existing email (should return reset_link in dry_run mode)
        success1, response1 = self.run_test(
            name="Forgot Password (existing email)",
            method="POST",
            endpoint="/api/customer-auth/forgot-password",
            expected_status=200,
            data={"email": email},
            check_response=lambda r: (
                "success" in r and r.get("dry_run") == True and "reset_link" in r,
                f"dry_run mode with reset_link: {'reset_link' in r}"
            )
        )
        
        reset_link = response1.get("reset_link", "") if success1 else ""
        token = ""
        if reset_link and "token=" in reset_link:
            token = reset_link.split("token=")[1].split("&")[0]
        
        # Test 2: Non-existing email (should still return 200, no enumeration)
        success2, response2 = self.run_test(
            name="Forgot Password (non-existing email, no enumeration)",
            method="POST",
            endpoint="/api/customer-auth/forgot-password",
            expected_status=200,
            data={"email": "nonexistent@example.com"},
            check_response=lambda r: (
                "success" in r and "reset_link" not in r,
                f"No reset_link for non-existing email (correct): {'reset_link' not in r}"
            )
        )
        
        return success1 and success2, token
    
    def test_validate_reset_token(self, token: str) -> bool:
        """Test GET /api/customer-auth/validate-reset-token"""
        self.log("=" * 70)
        self.log("VALIDATE RESET TOKEN", "SECTION")
        self.log("=" * 70)
        
        # Test 1: Valid token
        success1, response1 = self.run_test(
            name="Validate Reset Token (valid)",
            method="GET",
            endpoint="/api/customer-auth/validate-reset-token",
            expected_status=200,
            params={"token": token},
            check_response=lambda r: (
                r.get("valid") == True and "email" in r,
                f"valid=true, email masked: {r.get('email', '')}"
            )
        )
        
        # Test 2: Invalid token
        success2, response2 = self.run_test(
            name="Validate Reset Token (invalid)",
            method="GET",
            endpoint="/api/customer-auth/validate-reset-token",
            expected_status=400,
            params={"token": "invalid_token_12345"}
        )
        
        return success1 and success2
    
    def test_reset_password(self, token: str, new_password: str) -> bool:
        """Test POST /api/customer-auth/reset-password"""
        self.log("=" * 70)
        self.log("RESET PASSWORD", "SECTION")
        self.log("=" * 70)
        
        # Test 1: Valid token and password
        success1, response1 = self.run_test(
            name="Reset Password (valid token)",
            method="POST",
            endpoint="/api/customer-auth/reset-password",
            expected_status=200,
            data={"token": token, "password": new_password},
            check_response=lambda r: (
                "sessionToken" in r and "message" in r,
                f"sessionToken and message present"
            )
        )
        
        # Test 2: Try to use same token again (should fail - already used)
        success2, response2 = self.run_test(
            name="Reset Password (token already used)",
            method="POST",
            endpoint="/api/customer-auth/reset-password",
            expected_status=400,
            data={"token": token, "password": "AnotherPass123!"}
        )
        
        return success1 and success2
    
    def test_password_minlength_validation(self, email: str) -> bool:
        """Test password minLength validation from settings"""
        self.log("=" * 70)
        self.log("PASSWORD MIN LENGTH VALIDATION", "SECTION")
        self.log("=" * 70)
        
        # First, set minLength to 10
        self.run_test(
            name="Set minLength to 10",
            method="PATCH",
            endpoint="/api/admin/settings/auth",
            expected_status=200,
            data={"password": {"minLength": 10}},
            use_admin_token=True
        )
        
        time.sleep(0.5)  # Wait for cache invalidation
        
        # Request forgot password to get a new token
        success1, response1 = self.run_test(
            name="Request new reset token",
            method="POST",
            endpoint="/api/customer-auth/forgot-password",
            expected_status=200,
            data={"email": email}
        )
        
        reset_link = response1.get("reset_link", "")
        token = ""
        if reset_link and "token=" in reset_link:
            token = reset_link.split("token=")[1].split("&")[0]
        
        if not token:
            self.log("  ⚠️  Could not get reset token", "WARN")
            return False
        
        # Test 2: Try 8-char password (should fail with minLength=10)
        success2, response2 = self.run_test(
            name="Reset with 8-char password (should fail)",
            method="POST",
            endpoint="/api/customer-auth/reset-password",
            expected_status=400,
            data={"token": token, "password": "Short123"}
        )
        
        # Request another token for valid test
        success3, response3 = self.run_test(
            name="Request another reset token",
            method="POST",
            endpoint="/api/customer-auth/forgot-password",
            expected_status=200,
            data={"email": email}
        )
        
        reset_link2 = response3.get("reset_link", "")
        token2 = ""
        if reset_link2 and "token=" in reset_link2:
            token2 = reset_link2.split("token=")[1].split("&")[0]
        
        # Test 3: Try 10-char password (should succeed)
        success4, response4 = self.run_test(
            name="Reset with 10-char password (should succeed)",
            method="POST",
            endpoint="/api/customer-auth/reset-password",
            expected_status=200,
            data={"token": token2, "password": "ValidPass10"}
        )
        
        # Reset minLength back to 6
        self.run_test(
            name="Reset minLength to 6",
            method="PATCH",
            endpoint="/api/admin/settings/auth",
            expected_status=200,
            data={"password": {"minLength": 6}},
            use_admin_token=True
        )
        
        return success2 and success4
    
    def test_feature_flag_reset_disabled(self, email: str) -> bool:
        """Test resetPasswordEnabled feature flag"""
        self.log("=" * 70)
        self.log("FEATURE FLAG: resetPasswordEnabled", "SECTION")
        self.log("=" * 70)
        
        # Disable reset password feature
        self.run_test(
            name="Disable resetPasswordEnabled",
            method="PATCH",
            endpoint="/api/admin/settings/auth",
            expected_status=200,
            data={"features": {"resetPasswordEnabled": False}},
            use_admin_token=True
        )
        
        time.sleep(0.5)
        
        # Test forgot-password (should return 403)
        success1, response1 = self.run_test(
            name="Forgot Password (feature disabled)",
            method="POST",
            endpoint="/api/customer-auth/forgot-password",
            expected_status=403,
            data={"email": email}
        )
        
        # Re-enable the feature
        self.run_test(
            name="Re-enable resetPasswordEnabled",
            method="PATCH",
            endpoint="/api/admin/settings/auth",
            expected_status=200,
            data={"features": {"resetPasswordEnabled": True}},
            use_admin_token=True
        )
        
        return success1
    
    def test_old_password_invalid_after_reset(self, email: str, old_password: str, new_password: str) -> bool:
        """Test that old password stops working after reset"""
        self.log("=" * 70)
        self.log("OLD PASSWORD INVALIDATION", "SECTION")
        self.log("=" * 70)
        
        # Test 1: Old password should NOT work
        success1, response1 = self.run_test(
            name="Login with old password (should fail)",
            method="POST",
            endpoint="/api/customer-auth/login",
            expected_status=401,
            data={"email": email, "password": old_password}
        )
        
        # Test 2: New password should work
        success2, response2 = self.run_test(
            name="Login with new password (should succeed)",
            method="POST",
            endpoint="/api/customer-auth/login",
            expected_status=200,
            data={"email": email, "password": new_password},
            check_response=lambda r: (
                "sessionToken" in r or "token" in r,
                "Login successful with new password"
            )
        )
        
        return success1 and success2
    
    def print_summary(self):
        """Print test summary"""
        self.log("=" * 70)
        self.log("TEST SUMMARY", "SUMMARY")
        self.log("=" * 70)
        self.log(f"Total Tests: {self.tests_run}")
        self.log(f"Passed: {self.tests_passed} ✅")
        self.log(f"Failed: {self.tests_failed} ❌")
        
        if self.tests_failed > 0:
            self.log("\nFailed Tests:")
            for test_name in self.failed_tests:
                self.log(f"  - {test_name}")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        self.log(f"\nSuccess Rate: {success_rate:.1f}%")
        self.log("=" * 70)
        
        return self.tests_failed == 0


def main():
    """Main test execution"""
    print("\n" + "=" * 70)
    print("BIBI Cars CRM - Auth Settings & Password Reset Test Suite")
    print("=" * 70 + "\n")
    
    tester = AuthSettingsBackendTester()
    
    # 1. Admin login
    if not tester.test_admin_login():
        print("\n❌ Admin login failed - cannot proceed with admin tests")
        return 1
    
    # 2. Test public settings endpoint
    tester.test_public_settings()
    
    # 3. Test admin get auth settings
    tester.test_admin_get_auth_settings()
    
    # 4. Test admin patch auth settings
    tester.test_admin_patch_auth_settings()
    
    # 5. Test customer registration
    reg_success, test_email = tester.test_customer_register()
    if not reg_success:
        print("\n❌ Customer registration failed - cannot proceed with customer tests")
        return 1
    
    # 6. Test customer login
    tester.test_customer_login(test_email, "TestPass123!")
    
    # 7. Test forgot password flow
    forgot_success, reset_token = tester.test_forgot_password_flow(test_email)
    if not forgot_success or not reset_token:
        print("\n❌ Forgot password flow failed - cannot proceed with reset tests")
        return 1
    
    # 8. Test validate reset token
    tester.test_validate_reset_token(reset_token)
    
    # 9. Test reset password
    new_password = "NewTestPass456!"
    tester.test_reset_password(reset_token, new_password)
    
    # 10. Test old password invalid after reset
    tester.test_old_password_invalid_after_reset(test_email, "TestPass123!", new_password)
    
    # 11. Test password minLength validation
    tester.test_password_minlength_validation(test_email)
    
    # 12. Test feature flag resetPasswordEnabled
    tester.test_feature_flag_reset_disabled(test_email)
    
    # Print summary
    all_passed = tester.print_summary()
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
