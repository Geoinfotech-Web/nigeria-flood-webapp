import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from routers import auth, map_router
from production_config import validate_production_config


class AuthConfigurationTests(unittest.TestCase):
    def test_development_accounts_require_explicit_opt_in(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(auth._load_users(), {})
        with patch.dict(os.environ, {"ALLOW_DEV_ADMIN_USERS": "1"}, clear=True):
            self.assertIn("admin", auth._load_users())
        with patch.dict(os.environ, {"ALLOW_DEV_ADMIN_USERS": "0"}, clear=True):
            self.assertEqual(auth._load_users(), {})

    def test_configured_user_is_loaded_without_development_users(self):
        config = {"ADMIN_USERS_JSON": json.dumps([
            {"username": "operator", "password_hash": "example-hash", "role": "viewer"}
        ])}
        with patch.dict(os.environ, config, clear=True):
            self.assertEqual(list(auth._load_users()), ["operator"])


class ProductionConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.env = {
            "APP_ENV": "production",
            "JWT_SECRET": "0123456789abcdefghijklmnopqrstuvwxyz-A",
            "API_KEY_PEPPER": "0123456789abcdefghijklmnopqrstuvwxyz-B",
            "CORS_ORIGINS": "https://floodwatch.example.com",
        }
        self.users = {"operator": {"role": "admin"}}

    def test_valid_config_and_local_defaults(self):
        validate_production_config(self.env, self.users)
        validate_production_config({}, {})

    def test_rejects_unsafe_settings(self):
        for key, value in [
            ("ALLOW_DEV_ADMIN_USERS", "1"), ("JWT_SECRET", "dev-secret"),
            ("API_KEY_PEPPER", ""), ("CORS_ORIGINS", "*"),
            ("CORS_ORIGINS", "http://example.com"),
            ("CORS_ORIGINS", "https://example.com/path"),
            ("CORS_ORIGINS", "https://example.com:invalid"),
        ]:
            with self.subTest(key=key, value=value):
                with self.assertRaises(RuntimeError):
                    validate_production_config({**self.env, key: value}, self.users)
        with self.assertRaises(RuntimeError):
            validate_production_config(self.env, {})
        with self.assertRaises(RuntimeError):
            validate_production_config({**self.env, "API_KEY_PEPPER": self.env["JWT_SECRET"]}, self.users)


class _Connection:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def fetch(self, query):
        return [{"id": 1, "code": "TEST", "name": "Test", "river": "River",
                 "state": "State", "lat": 1, "lon": 2, "bank_full_m": 3}]


class MapRiskTests(unittest.IsolatedAsyncioTestCase):
    async def check_risk(self, cached):
        class Redis:
            async def get(self, key):
                return cached

        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            db=SimpleNamespace(acquire=lambda: _Connection()), redis=Redis()
        )))
        return (await map_router.risk_map(request))["features"][0]["properties"]

    async def test_no_cached_forecast_is_unknown(self):
        result = await self.check_risk(None)
        self.assertIsNone(result["risk_tier"])
        self.assertIsNone(result["prob_24h"])
        self.assertEqual(result["color"], "#64748b")

    async def test_cached_forecast_is_preserved(self):
        result = await self.check_risk(json.dumps({
            "overall_risk": "Warning", "horizons": {"24h": {"flood_prob": 0.75}}
        }))
        self.assertEqual(result["risk_tier"], "Warning")
        self.assertEqual(result["prob_24h"], 0.75)


if __name__ == "__main__":
    unittest.main()
