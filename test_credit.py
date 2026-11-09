"""Conservative illustrative credit screening, with no customer financial fixtures."""

import unittest

from credit import assess_credit, ratios_from_financials


class CreditTests(unittest.TestCase):
    def test_empty_inputs_remain_unscored_and_require_payment_protection(self):
        result = assess_credit()
        self.assertEqual(result["ratios"], dict(current_ratio=None, debt_ebitda=None, interest_coverage=None))
        self.assertEqual(result["metric_scores"], dict(current_ratio=None, debt_ebitda=None, interest_coverage=None))
        self.assertIsNone(result["score"])
        self.assertTrue(result["collateral_required"])
        self.assertTrue(result["review_flags"])

    def test_only_all_three_strong_metrics_without_flags_pass(self):
        result = assess_credit(1.5, 2, 4)
        self.assertEqual(result["score"], 6)
        self.assertEqual(result["metric_scores"], dict(current_ratio=2, debt_ebitda=2, interest_coverage=2))
        self.assertFalse(result["collateral_required"])
        self.assertEqual(result["review_flags"], [])

    def test_current_ratio_boundaries(self):
        for value, points in [(0, 0), (.9999, 0), (1, 1), (1.4999, 1), (1.5, 2)]:
            with self.subTest(value=value):
                result = assess_credit(value, 2, 4)
                self.assertEqual(result["metric_scores"]["current_ratio"], points)
                self.assertEqual(result["collateral_required"], points != 2)

    def test_leverage_boundaries_include_debt_free_borrower(self):
        for value, points in [(0, 2), (2, 2), (2.0001, 1), (4, 1), (4.0001, 0)]:
            with self.subTest(value=value):
                result = assess_credit(1.5, value, 4)
                self.assertEqual(result["metric_scores"]["debt_ebitda"], points)
                self.assertEqual(result["collateral_required"], points != 2)

    def test_coverage_boundaries_and_negative_coverage_are_weak(self):
        for value, points in [(-2, 0), (0, 0), (1.9999, 0), (2, 1), (3.9999, 1), (4, 2)]:
            with self.subTest(value=value):
                result = assess_credit(1.5, 2, value)
                self.assertEqual(result["metric_scores"]["interest_coverage"], points)
                self.assertEqual(result["score"], 4 + points)
                self.assertEqual(result["collateral_required"], points != 2)

    def test_review_flags_override_a_strong_score_and_are_not_mutated(self):
        flags = ["Statements require verification"]
        result = assess_credit(2, 1, 5, flags=flags)
        self.assertEqual(result["score"], 6)
        self.assertTrue(result["collateral_required"])
        self.assertIn("Statements require verification", result["review_flags"])
        self.assertEqual(flags, ["Statements require verification"])

    def test_invalid_direct_inputs_cannot_receive_strong_scores(self):
        for name in ("current_ratio", "debt_ebitda", "interest_coverage"):
            for invalid in (None, "", " ", "bad", float("nan"), float("inf"), -float("inf"), True, []):
                with self.subTest(name=name, invalid=invalid):
                    inputs = dict(current_ratio=2, debt_ebitda=1, interest_coverage=5)
                    inputs[name] = invalid
                    result = assess_credit(**inputs)
                    self.assertIsNone(result["score"])
                    self.assertIsNone(result["metric_scores"][name])
                    self.assertTrue(result["review_flags"])
                    self.assertTrue(result["collateral_required"])

    def test_negative_liquidity_and_leverage_require_review(self):
        for name in ("current_ratio", "debt_ebitda"):
            with self.subTest(name=name):
                inputs = dict(current_ratio=2, debt_ebitda=1, interest_coverage=5)
                inputs[name] = -1
                result = assess_credit(**inputs)
                self.assertIsNone(result["score"])
                self.assertIsNone(result["ratios"][name])
                self.assertTrue(result["review_flags"])
                self.assertTrue(result["collateral_required"])

    def test_amount_ratios_use_annual_ebitda_and_ebit_and_feed_direct_api(self):
        ratios = ratios_from_financials(150, 100, 200, 100, 80, 20)
        self.assertEqual(ratios, dict(current_ratio=1.5, debt_ebitda=2, interest_coverage=4, flags=[]))
        self.assertFalse(assess_credit(**ratios)["collateral_required"])

    def test_blank_amounts_do_not_turn_into_zero(self):
        ratios = ratios_from_financials()
        self.assertIsNone(ratios["current_ratio"])
        self.assertIsNone(ratios["debt_ebitda"])
        self.assertIsNone(ratios["interest_coverage"])
        self.assertTrue(ratios["flags"])
        self.assertIsNone(assess_credit(**ratios)["score"])

    def test_nonpositive_denominators_never_produce_infinite_or_strong_ratios(self):
        for name, ratio_name in [("current_liabilities", "current_ratio"), ("ebitda", "debt_ebitda"), ("interest_expense", "interest_coverage")]:
            for amount in (0, -1):
                with self.subTest(name=name, amount=amount):
                    inputs = dict(current_assets=150, current_liabilities=100, debt=0, ebitda=100, ebit=80, interest_expense=20)
                    inputs[name] = amount
                    ratios = ratios_from_financials(**inputs)
                    self.assertIsNone(ratios[ratio_name])
                    self.assertTrue(ratios["flags"])
                    result = assess_credit(**ratios)
                    self.assertIsNone(result["score"])
                    self.assertTrue(result["collateral_required"])

    def test_negative_ebit_preserves_weak_coverage_with_review_flag(self):
        ratios = ratios_from_financials(150, 100, 200, 100, -20, 10)
        self.assertEqual(ratios["interest_coverage"], -2)
        self.assertTrue(any("EBIT" in flag for flag in ratios["flags"]))
        result = assess_credit(**ratios)
        self.assertEqual(result["score"], 4)
        self.assertTrue(result["collateral_required"])

    def test_invalid_amounts_and_quotient_overflow_require_review(self):
        for name in ("current_assets", "current_liabilities", "debt", "ebitda", "ebit", "interest_expense"):
            for invalid in ("bad", float("nan"), float("inf"), True):
                with self.subTest(name=name, invalid=invalid):
                    inputs = dict(current_assets=150, current_liabilities=100, debt=200, ebitda=100, ebit=80, interest_expense=20)
                    inputs[name] = invalid
                    result = assess_credit(**ratios_from_financials(**inputs))
                    self.assertIsNone(result["score"])
                    self.assertTrue(result["collateral_required"])
        for name in ("current_assets", "debt"):
            with self.subTest(negative=name):
                inputs = dict(current_assets=150, current_liabilities=100, debt=200, ebitda=100, ebit=80, interest_expense=20)
                inputs[name] = -1
                self.assertIsNone(assess_credit(**ratios_from_financials(**inputs))["score"])
        ratios = ratios_from_financials(1e308, 1e-308, 200, 100, 80, 20)
        self.assertIsNone(ratios["current_ratio"])
        self.assertTrue(assess_credit(**ratios)["collateral_required"])

    def test_numeric_strings_are_consistent_with_the_numeric_screen(self):
        ratios = ratios_from_financials("150", "100", "200", "100", "80", "20")
        self.assertEqual(assess_credit(**ratios)["score"], 6)
        self.assertEqual(assess_credit("1.5", "2", "4")["score"], 6)


if __name__ == "__main__":
    unittest.main()
