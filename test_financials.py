"""Budget, operating cash and credit exposure checks."""
import copy
import unittest

import numpy as np
import pandas as pd

from engine import build_offer, load_case, stress_offer
from credit import assess_credit
from financials import financial_plan


def complete_offer():
    return build_offer(load_case('Tulsa'), weather_pct=0, costs={
        'fuel_pct': 2., 'fuel_basis': 'receipts', 'supplier_fee': .05,
        'financing': .01, 'residual_risk': .02, 'credit_allowance': .01})


def short_offer(revenues=(110.,), costs=(100.,), months=('2027-01',)):
    # One MMBtu per month makes these unit prices equal invoice amounts.
    result = complete_offer()
    result['months'] = pd.DataFrame({'month': months, 'block_mmbtu': [1.] * len(months),
        'modeled_use_mmbtu': [1.] * len(months), 'regional_reference': costs})
    result['fixed_price'] = revenues[0]
    result['costs'] = {'fuel_pct': 0., 'fuel_basis': 'customer', 'supplier_fee': 0.,
        'financing': 0., 'residual_risk': 0., 'credit_allowance': 0.}
    result['missing_inputs'] = []
    return result


class FinancialPlanTests(unittest.TestCase):
    def test_complete_budget_reconciles_and_break_even(self):
        offer = complete_offer()
        plan = financial_plan(offer)
        self.assertAlmostEqual(plan['revenue'], offer['block_value'])
        self.assertAlmostEqual(plan['contribution'], offer['contribution'])
        self.assertAlmostEqual(plan['cost'] + plan['contribution'], plan['revenue'])
        self.assertAlmostEqual(plan['break_even_price'], offer['fixed_price'] - offer['margin'])
        self.assertAlmostEqual(plan['months'].total_cost.sum(), plan['cost'])
        self.assertIsNone(plan['operating_funding'])
        self.assertEqual(list(plan['cash_months'].columns),
                         ['month', 'cash_in', 'cash_out', 'net_cash', 'closing_cash'])

    def test_saved_stress_uses_indexed_deviation_and_original_fuel_terms(self):
        offer = complete_offer()
        stressed = stress_offer(offer, 20)
        plan = financial_plan(stressed)
        frame = stressed['months']
        deviation = ((frame.modeled_use_mmbtu - frame.block_mmbtu) * frame.regional_reference).sum()
        expected_cost = (frame.modeled_use_mmbtu * frame.regional_reference / .98).sum()
        expected_cost += frame.block_mmbtu.sum() * .09
        self.assertAlmostEqual(plan['revenue'], offer['block_value'] + deviation)
        self.assertAlmostEqual(plan['cost'], expected_cost)
        self.assertAlmostEqual(plan['break_even_price'], (expected_cost - deviation) / offer['volume'])
        self.assertLess(plan['contribution'], offer['contribution'])

    def test_unknown_costs_and_market_remain_pending(self):
        partial = build_offer(load_case('Tulsa'))
        missing_market = build_offer(load_case('Omaha'), costs=complete_offer()['costs'])
        for offer in (partial, missing_market):
            with self.subTest(city=offer['city']):
                plan = financial_plan(offer, customer_days=30, supplier_days=10,
                    additional_exposure=0, unsecured_limit=0, credit=assess_credit())
                for key in ('revenue', 'cost', 'contribution', 'break_even_price',
                            'operating_funding', 'delayed_funding', 'peak_receivables',
                            'exposure', 'protection_gap'):
                    self.assertIsNone(plan[key], key)
                self.assertTrue(plan['cash_months'].empty)
                self.assertTrue(plan['missing'])

    def test_same_month_payment_order_creates_temporary_funding(self):
        plan = financial_plan(short_offer(), customer_days=20, supplier_days=5)
        self.assertEqual(plan['operating_funding'], 100.)
        self.assertEqual(plan['cash_months'].iloc[-1].closing_cash, 10.)
        self.assertEqual(plan['cash_months'].iloc[-1].month, '2027-02')
        self.assertEqual(plan['cash_months'].iloc[-1].net_cash, 10.)

    def test_same_day_cash_is_netted_and_receivables_are_conservative(self):
        plan = financial_plan(short_offer(), customer_days=0, supplier_days=0,
            additional_exposure=0, credit=assess_credit())
        self.assertEqual(plan['operating_funding'], 0.)
        self.assertEqual(plan['peak_receivables'], 110.)
        self.assertEqual(plan['protection_gap'], 110.)

    def test_cash_runoff_and_customer_delay_do_not_change_price_or_budget(self):
        offer = short_offer(months=('2027-12',))
        before = copy.deepcopy(offer)
        base = financial_plan(offer, customer_days=10, supplier_days=20)
        delayed = financial_plan(offer, customer_days=10, supplier_days=20, payment_delay_days=30)
        self.assertEqual(base['operating_funding'], 0.)
        self.assertEqual(base['delayed_funding'], 0.)
        self.assertEqual(delayed['operating_funding'], 0.)
        self.assertEqual(delayed['delayed_funding'], 100.)
        self.assertEqual(delayed['revenue'], base['revenue'])
        self.assertEqual(delayed['contribution'], base['contribution'])
        self.assertEqual(delayed['cash_months'].iloc[-1].month, '2028-01')
        self.assertEqual(offer['fixed_price'], before['fixed_price'])
        pd.testing.assert_frame_equal(offer['months'], before['months'])
        self.assertEqual(offer['costs'], before['costs'])

    def test_overlapping_invoices_and_credit_limit(self):
        offer = short_offer(revenues=(110., 110.), costs=(100., 100.),
                            months=('2027-01', '2027-02'))
        strong = assess_credit(1.5, 2, 4)
        plan = financial_plan(offer, customer_days=40, supplier_days=10,
            unsecured_limit=50, additional_exposure=20, credit=strong)
        self.assertEqual(plan['peak_receivables'], 220.)
        self.assertEqual(plan['exposure'], 240.)
        self.assertEqual(plan['effective_unsecured_limit'], 50.)
        self.assertEqual(plan['protection_gap'], 190.)
        weak = financial_plan(offer, customer_days=40, unsecured_limit=999999,
            additional_exposure=20, credit=assess_credit(1, 3, 2))
        self.assertEqual(weak['effective_unsecured_limit'], 0.)
        self.assertEqual(weak['protection_gap'], 240.)

    def test_strong_credit_is_not_an_unlimited_line_and_missing_extra_is_not_zero(self):
        strong = assess_credit(1.5, 2, 4)
        plan = financial_plan(short_offer(), customer_days=10, additional_exposure=0, credit=strong)
        self.assertIsNone(plan['effective_unsecured_limit'])
        self.assertIsNone(plan['protection_gap'])
        plan = financial_plan(short_offer(), customer_days=10, unsecured_limit=100, credit=strong)
        self.assertIsNone(plan['exposure'])
        self.assertIsNone(plan['protection_gap'])
        self.assertIn('additional_exposure', plan['missing'])

    def test_negative_invoice_is_a_refund_not_a_receivable(self):
        offer = short_offer(revenues=(-10.,), costs=(-20.,))
        plan = financial_plan(offer, customer_days=10, supplier_days=20,
            additional_exposure=0, credit=assess_credit())
        self.assertEqual(plan['peak_receivables'], 0.)
        self.assertEqual(plan['operating_funding'], 10.)
        self.assertEqual(plan['cash_months'].cash_in.sum(), 20.)
        self.assertEqual(plan['cash_months'].cash_out.sum(), 10.)
        self.assertEqual(plan['contribution'], 10.)

    def test_invalid_financial_inputs_are_rejected(self):
        for key, bad in [('customer_days', -1), ('supplier_days', 366),
                         ('customer_days', 1.1), ('customer_days', True),
                         ('payment_delay_days', 91), ('payment_delay_days', None),
                         ('unsecured_limit', -1), ('additional_exposure', float('nan')),
                         ('unsecured_limit', float('inf')), ('additional_exposure', True)]:
            with self.subTest(key=key, bad=bad), self.assertRaises(ValueError):
                financial_plan(complete_offer(), **{key: bad})

    def test_missing_supplier_timing_does_not_erase_billed_exposure(self):
        plan = financial_plan(short_offer(), customer_days=10, additional_exposure=0)
        self.assertIsNone(plan['operating_funding'])
        self.assertEqual(plan['peak_receivables'], 110.)
        self.assertEqual(plan['exposure'], 110.)
        self.assertEqual(plan['protection_gap'], 110.)

    def test_result_contains_no_nonfinite_financial_numbers(self):
        plan = financial_plan(complete_offer(), customer_days=30, supplier_days=10,
            additional_exposure=0, unsecured_limit=0, credit=assess_credit())
        for value in plan.values():
            if isinstance(value, (int, float)):
                self.assertTrue(np.isfinite(value))
        for frame in ('months', 'cash_months'):
            self.assertTrue(np.isfinite(plan[frame].select_dtypes('number')).all().all())


if __name__ == '__main__':
    unittest.main()
