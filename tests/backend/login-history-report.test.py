import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parents[2] / "ops/login-history/counts.py"
spec = importlib.util.spec_from_file_location("counts", path)
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)
SUB = "11111111-1111-4111-8111-111111111111"

class Reporting(unittest.TestCase):
    def test_paginated_count_excludes_expired_rows_at_query_and_is_not_lifetime(self):
        calls = []
        def query(request):
            calls.append(dict(request))
            self.assertEqual(request["Select"], "COUNT")
            self.assertTrue(request["ConsistentRead"])
            self.assertEqual(request["ExpressionAttributeValues"][":now"], {"N": "1800000000"})
            self.assertEqual(request["FilterExpression"], "expiresAt > :now AND authenticatedAt >= :since")
            return {"Count": 2, "LastEvaluatedKey": {"PK": {"S": "cursor"}}} if len(calls) == 1 else {"Count": 1}
        result = report.count_user(SUB, "2026-01-01T00:00:00Z", 1800000000, query)
        self.assertEqual(result["count"], 3)
        self.assertFalse(result["exactUniqueLoginCount"])
        self.assertIn("ExclusiveStartKey", calls[1])
        self.assertEqual(calls[0]["ExpressionAttributeValues"][":pk"], {"S": "USER#" + SUB})

    def test_no_query_for_invalid_identity_or_non_utc_or_future_time(self):
        def forbidden(_):
            self.fail("Query must not occur")
        for sub, since in [("email@example.invalid", "2026-01-01T00:00:00Z"),
                           (SUB, "2026-01-01T00:00:00"),
                           (SUB, "2026-01-01T00:00:00-05:00"),
                           (SUB, "2099-01-01T00:00:00Z")]:
            with self.assertRaises(ValueError):
                report.count_user(sub, since, 1800000000, forbidden)

    def test_empty_count(self):
        result = report.count_user(SUB, "2026-01-01T00:00:00Z", 1800000000, lambda _: {"Count": 0})
        self.assertEqual(result["count"], 0)

if __name__ == "__main__":
    unittest.main()
