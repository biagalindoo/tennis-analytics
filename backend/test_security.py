import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import HTTPException, Response
from starlette.requests import Request

from backend import app as api


def make_request(ip="127.0.0.1", user_agent="security-test"):
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": [(b"user-agent", user_agent.encode())],
        "client": (ip, 1234),
        "server": ("testserver", 80),
        "scheme": "http",
        "query_string": b"",
    })


class AuthSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db = api.HISTORY_DB_PATH
        api.HISTORY_DB_PATH = Path(self.temp_dir.name) / "auth.db"
        api._initialize_auth_tables()
        self.env = patch.dict(os.environ, {"APP_ENV": "development", "RESEND_API_KEY": ""}, clear=False)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        api.HISTORY_DB_PATH = self.original_db
        self.temp_dir.cleanup()

    def register(self, email="bia@example.com", password="senha-segura"):
        response = Response()
        result = api.register(api.RegisterPayload(name="Bia", email=email, password=password), make_request(), response)
        cookie = response.headers["set-cookie"].split("tennis_session=", 1)[1].split(";", 1)[0]
        return result, cookie

    def test_password_hash_is_salted_and_verifiable(self):
        first = api._password_hash("senha-segura")
        second = api._password_hash("senha-segura")
        self.assertNotEqual(first, second)
        self.assertTrue(api._password_matches("senha-segura", first))
        self.assertFalse(api._password_matches("senha-errada", first))

    def test_login_blocks_after_five_failures(self):
        self.register()
        payload = api.LoginPayload(email="bia@example.com", password="senha-errada")
        for _ in range(5):
            with self.assertRaises(HTTPException) as error:
                api.login(payload, make_request(), Response())
            self.assertEqual(error.exception.status_code, 401)
        with self.assertRaises(HTTPException) as blocked:
            api.login(payload, make_request(), Response())
        self.assertEqual(blocked.exception.status_code, 429)

    def test_reset_token_is_single_use_and_revokes_sessions(self):
        _, session = self.register()
        forgot = api.forgot_password(api.ForgotPasswordPayload(email="bia@example.com"), make_request())
        token = forgot["developmentToken"]
        api.reset_password(api.ResetPasswordPayload(token=token, newPassword="nova-senha-segura"))
        with self.assertRaises(HTTPException) as reused:
            api.reset_password(api.ResetPasswordPayload(token=token, newPassword="outra-senha-segura"))
        self.assertEqual(reused.exception.status_code, 400)
        with self.assertRaises(HTTPException) as old_session:
            api._authenticated_user(None, session)
        self.assertEqual(old_session.exception.status_code, 401)

    def test_production_response_hides_secrets_and_sets_secure_cookie(self):
        delivered = Mock(return_value=True)
        with patch.dict(os.environ, {"APP_ENV": "production", "RESEND_API_KEY": "re_test"}, clear=False), patch.object(api, "_send_verification_email", delivered):
            response = Response()
            result = api.register(api.RegisterPayload(name="Bia", email="prod@example.com", password="senha-segura"), make_request(), response)
        self.assertNotIn("developmentVerificationCode", result)
        self.assertIn("Secure", response.headers["set-cookie"])
        delivered.assert_called_once()

    def test_resend_request_uses_auth_and_never_places_key_in_body(self):
        http_response = Mock()
        http_response.raise_for_status.return_value = None
        with patch.dict(os.environ, {"RESEND_API_KEY": "re_secret", "EMAIL_FROM": "Tennis <noreply@example.com>"}, clear=False), patch.object(api.requests, "post", return_value=http_response) as post:
            self.assertTrue(api._send_email("bia@example.com", "Assunto", "<p>Oi</p>", "Oi", "test-key"))
        kwargs = post.call_args.kwargs
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer re_secret")
        self.assertNotIn("re_secret", str(kwargs["json"]))
        self.assertEqual(kwargs["timeout"], 10)

    def test_verification_code_expires_and_limits_attempts(self):
        _, session = self.register()
        for _ in range(5):
            with self.assertRaises(HTTPException):
                api.confirm_email_verification(api.EmailVerificationPayload(code="000000"), tennis_session=session)
        with self.assertRaises(HTTPException) as blocked:
            api.confirm_email_verification(api.EmailVerificationPayload(code="000000"), tennis_session=session)
        self.assertEqual(blocked.exception.status_code, 400)
        with sqlite3.connect(api.HISTORY_DB_PATH) as connection:
            attempts = connection.execute("SELECT attempts FROM email_verification_tokens").fetchone()[0]
        self.assertEqual(attempts, 5)


if __name__ == "__main__":
    unittest.main()
