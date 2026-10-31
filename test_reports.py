"""Report contract, privacy, and incomplete-input checks."""
from io import BytesIO
import unittest

from pypdf import PdfReader


def snapshot(term=12, city='Tulsa'):
    rows = []
    for i in range(term):
        rows.append({'month': f'{2027+i//12}-{i%12+1:02d}',
                     'block_mmbtu': 549.0, 'modeled_use_mmbtu': 549.0,
                     'hh_reference': 3.0 if i < 12 else None,
                     'basis_reference': -.20 if i < 12 else None,
                     'hh_hedge_mmbtu': 549.0, 'basis_hedge_mmbtu': 549.0})
    return {'customer': 'UniqueSecretManufacturing-983271', 'city': city, 'term': term,
            'delivery_start': '2027-01', 'delivery_end': rows[-1]['month'],
            'market_as_of': '2026-10-29', 'price': 3.0170975592, 'price_label': 'Partial subtotal',
            'volume': 549.0*term, 'expected_usage': 549.0*term,
            'block_value': 3.0170975592*549.0*term, 'margin': .20, 'commodity': 2.8170975592,
            'fuel_adder': None, 'additional_components': {},
            'missing_inputs': ['fuel_pct', 'supplier_fee', 'financing', 'residual_risk', 'credit_allowance'],
            'mode': 'New offer', 'weather_pct': 20., 'weather_reference_hdd': 3500.,
            'credit': {'ratios': {'current_ratio': 1.7, 'debt_ebitda': 2., 'interest_coverage': 4.},
                       'metric_scores': {'current_ratio': 2, 'debt_ebitda': 2, 'interest_coverage': 2},
                       'score': 6, 'collateral_required': False, 'review_flags': []},
            'risk': {'available': True, 'n_sims': 100000, 'n_unique_years': 9,
                     'loss_p95': 0., 'risk_premium': 0., 'scope': 'base commodity',
                     'limitations': []}, 'months': rows, 'data_notes': ['Generic source fact']}


def read_report(s, customer=False):
    from reports import proposal_pdf, customer_proposal_pdf
    data = customer_proposal_pdf(s) if customer else proposal_pdf(s)
    reader = PdfReader(BytesIO(data))
    return data, reader, '\n'.join(page.extract_text() for page in reader.pages)


class ProposalTests(unittest.TestCase):
    def test_always_anonymous_in_text_and_metadata(self):
        s = snapshot()
        secret = s['customer']
        # Freeform inputs cannot defeat report privacy, including metadata.
        s.update(customer_name=secret, internal_customer_name=secret,
                 market_as_of=secret, price_label=secret, mode=secret, fuel_pct=secret, fuel_basis=secret,
                 data_notes=[secret, 'https://secret-company.invalid/plant-7'],
                 input_checklist=[secret], demand_basis=secret, reference_annual_gas=secret)
        s['risk']['scope'] = secret
        s['risk']['limitations'] = [secret]
        s['credit'].update(rating=secret, collateral_policy=secret, policy_note=secret,
                           review_flags=[secret])
        s['missing_inputs'].append(secret)
        s['additional_components'][secret] = 9.9
        data, reader, text = read_report(s)
        self.assertTrue(data.startswith(b'%PDF'))
        for disallowed in [secret, 'secret-company', 'plant-7', 'R-squared', 'R²', 'fictional', 'invented']:
            self.assertNotIn(disallowed, text + str(reader.metadata))
        self.assertIn('HVAC manufacturer - estimated operating profile', text)
        self.assertNotIn('ReportLab', str(reader.metadata))
        self.assertNotIn('http', str(reader.metadata))
        self.assertNotIn(secret.encode(), data)

    def test_price_hedge_risk_and_credit_contract(self):
        _, reader, text = read_report(snapshot())
        for expected in ['3.0171', 'Partial subtotal', '6,588',
                         'Fixed monthly blocks', 'Same gas volume', 'Henry Hub', 'Regional basis',
                         '100,000', '9', 'Base-commodity', '0.0000', '6 / 6',
                         '1.70', '2.00', '4.00', 'Ratio screen passes', 'gross contribution',
                         'remaining supplier risk', 'Pending']:
            self.assertIn(expected, ' '.join(text.split()))
        self.assertEqual(len(reader.pages), 4)
        self.assertNotIn('net profit', text.lower())
        self.assertNotIn('Full customer bill', text)

    def test_known_fuel_inputs_merge_without_spurious_unknown_assumption(self):
        s = snapshot()
        s['missing_inputs'].append('fuel_basis')
        _, _, text = read_report(s)
        self.assertNotIn('Other required assumptions', ' '.join(text.split()))
        s['missing_inputs'].append('unknown_private_input')
        _, _, text = read_report(s)
        self.assertIn('Other required assumptions', ' '.join(text.split()))
        self.assertNotIn('unknown_private_input', text)

    def test_missing_every_optional_field_is_pending(self):
        s = {key: None for key in snapshot()}
        s['months'] = [{'month': '2027-01', 'block_mmbtu': None, 'hh_reference': None,
                        'basis_reference': None, 'hh_hedge_mmbtu': None,
                        'basis_hedge_mmbtu': None}]
        _, reader, text = read_report(s)
        self.assertIn('Pending', text)
        self.assertIn('Price unavailable', text)
        self.assertNotIn('$0.0000', text)
        self.assertNotIn('No collateral', text)
        self.assertGreaterEqual(len(reader.pages), 4)

    def test_all_supported_cities_and_24_months(self):
        for city in ['Tulsa', 'Omaha', 'Columbus, Ohio']:
            with self.subTest(city=city):
                s = snapshot(24, city)
                s['price'] = None
                s['block_value'] = None
                s['risk'] = {'available': False}
                _, reader, text = read_report(s)
                self.assertIn(city, text)
                self.assertIn('2028-12', text)
                self.assertIn('Price unavailable', text)
                self.assertIn('Pending', text)
                self.assertLessEqual(len(reader.pages), 5)
                self.assertGreaterEqual(len(reader.pages), 4)

    def test_nonfinite_values_and_missing_credit_review(self):
        s = snapshot()
        s.update(price=float('nan'), fuel_adder=float('inf'), margin=float('-inf'))
        s['credit'] = {'ratios': {'current_ratio': None, 'debt_ebitda': None, 'interest_coverage': None},
                       'score': None, 'collateral_required': True,
                       'review_flags': ['Missing inputs']}
        _, _, text = read_report(s)
        self.assertIn('Price unavailable', text)
        self.assertIn('Payment protection required', text)
        self.assertIn('Pending', text)
        self.assertNotIn('$nan', text)
        self.assertNotIn('$inf', text)

    def test_complete_estimate_and_frozen_mode(self):
        s = snapshot()
        s.update(price_label='Complete illustrative estimate', missing_inputs=[], mode='Existing stress',
                 fuel_adder=.03, additional_components={'supplier_fee': .02, 'financing': .01,
                                                       'residual_risk': .04, 'credit_allowance': .01})
        _, _, text = read_report(s)
        self.assertIn('Cost assumptions complete', text)
        self.assertIn('frozen', text)
        self.assertIn('customer deviations', text)
        self.assertIn('additional fuel', text)

    def test_fuel_inclusive_hedge_quantities_and_missing_fuel_scope(self):
        for term in (12, 24):
            for basis, gross in [('receipts', 549.0 / .95), ('customer', 549.0 * 1.05)]:
                with self.subTest(term=term, basis=basis):
                    s = snapshot(term)
                    s.update(fuel_pct=5., fuel_basis=basis, fuel_adder=.15)
                    for row in s['months']:
                        row.update(hh_hedge_mmbtu=gross, basis_hedge_mmbtu=gross)
                    _, reader, text = read_report(s)
                    schedule = reader.pages[3].extract_text()
                    self.assertIn('fuel-inclusive procurement', schedule)
                    self.assertIn('5.00%', text)
                    self.assertIn(f'{gross:,.1f}', schedule)
                    self.assertNotIn('each cover the same contracted customer-block quantity', schedule)
                    self.assertNotIn('fuel hedge notional is separate', text)
                    self.assertEqual(len(reader.pages), 5 if term == 24 else 4)
        # Without a valid fuel assumption, show only matched customer blocks.
        for fuel_pct, fuel_basis in [(None, 'receipts'), (5., None), (float('nan'), 'customer'),
                                     (100., 'receipts'), (-1., 'customer')]:
            s = snapshot()
            s.update(fuel_pct=fuel_pct, fuel_basis=fuel_basis)
            for row in s['months']:
                row.update(hh_hedge_mmbtu=9999., basis_hedge_mmbtu=9999.)
            _, reader, text = read_report(s)
            schedule = reader.pages[3].extract_text()
            self.assertIn('Customer-block hedges only', schedule)
            self.assertIn('Fuel execution quantities: Pending', schedule)
            self.assertNotIn('9,999.0', schedule)

    def test_summary_protection_actions_and_appendix_have_distinct_pages(self):
        s = snapshot()
        s.update(demand_basis='benchmark', reference_annual_gas=6100.)
        _, reader, text = read_report(s)
        self.assertEqual(len(reader.pages), 4)
        overview, protection, financial, appendix = [' '.join(p.extract_text().split()) for p in reader.pages]
        for expected in ['Internal financial review', 'What this means', 'Partial subtotal',
                         'Benchmark annual gas use', '6,100', 'customer bill']:
            self.assertIn(expected, overview)
        for expected in ['Protection and next steps', 'Before you use this estimate',
                         'Confirm supplier costs', 'Credit ratios', 'P95', 'Glossary',
                         'Only modeled commodity exposure cancels', 'remaining supplier risk']:
            self.assertIn(expected, protection)
        self.assertIn('Monthly detail', appendix)
        self.assertIn('Worked example', appendix)
        self.assertIn('549.0', appendix)
        self.assertIn('$2.8000', appendix)
        self.assertNotIn('Monthly detail', overview)
        self.assertNotIn('total risk is zero', text.lower())

    def test_demand_basis_is_safe_and_does_not_claim_meter_validation(self):
        s = snapshot()
        s.update(demand_basis='user_total', reference_annual_gas=12345.)
        _, _, text = read_report(s)
        self.assertIn('User-entered annual gas use', text)
        self.assertIn('12,345', text)
        self.assertIn('meter records have not been supplied', text)
        self.assertNotIn('Benchmark annual gas use', text)
        s.update(demand_basis='PRIVATE-METER-CLIENT', reference_annual_gas='PRIVATE-METER-CLIENT')
        _, _, text = read_report(s)
        self.assertNotIn('PRIVATE-METER-CLIENT', text)
        self.assertIn('Annual gas use basis: Pending', text)

    def test_example_precision_and_market_confirmation_followups(self):
        s = snapshot()
        s['months'][0].update(block_mmbtu=1057.16, modeled_use_mmbtu=1058.39,
                              hh_reference=3.392, basis_reference=.25)
        _, reader, _ = read_report(s)
        appendix = ' '.join(reader.pages[3].extract_text().split())
        for expected in ['Block: 1,057.16 MMBtu', '1,058.39 MMBtu', '1.23 MMBtu',
                         '$3,850.18', '$4.48',
                         'Figures are rounded for display; calculations use full precision.']:
            self.assertIn(expected, appendix)
        for price, valuation_date in [(None, None), (s['price'], '2026-10-29')]:
            s.update(price=price, market_as_of=valuation_date)
            _, reader, _ = read_report(s)
            actions = ' '.join(reader.pages[1].extract_text().split())
            self.assertIn('matching delivery route and regional index', actions)
            self.assertIn('market valuation date', actions)

    def test_worked_example_requires_real_snapshot_prices(self):
        s = snapshot()
        for row in s['months']:
            row.update(hh_reference=None, basis_reference=None)
        _, _, text = read_report(s)
        self.assertIn('Worked example: Pending', text)
        self.assertNotIn('$2.8000', text)

    def test_empty_snapshot_uses_safe_defaults(self):
        _, reader, text = read_report({})
        self.assertIn('HVAC manufacturer - estimated operating profile', text)
        self.assertIn('Pending', text)
        self.assertLessEqual(len(reader.pages), 5)


    def test_customer_proposal_keeps_only_external_terms(self):
        s = snapshot()
        s.update(margin=99.01234, market_source='SecretReference238', delivery_point='SecretPipeline973',
                 quote_valid_until='2026-11-05')
        s['credit']['ratios'].update(current_ratio=7.89, debt_ebitda=8.76, interest_coverage=9.87)
        s['risk']['unhedged_loss_p95'] = 91234.56
        s['financials'] = {'revenue': 76432.10, 'exposure': 54321.98,
                           'inputs': {'customer_days': 25, 'supplier_days': 5, 'unsecured_limit': 42341.99}}
        s['readiness'] = {'credit_reviewed': True}
        _, reader, text = read_report(s, customer=True)
        for forbidden in ['Target margin', 'Procurement', 'Financing', 'Credit allowance', 'EBIT', 'Score',
                          'P95', 'Monte Carlo', 'hedge', '99.0123', '7.89', '8.76', '9.87',
                          '91,234.56', '76,432.10', '54,321.98', '42,341.99', 'SecretReference', 'SecretPipeline']:
            self.assertNotIn(forbidden.lower(), (text + str(reader.metadata)).lower())
        for expected in ['Your gas proposal', 'Proposed monthly blocks', '25 days', '2026-11-05',
                         'regional index', 'not the full customer bill', 'Estimated operating profile']:
            self.assertIn(expected, text)
        self.assertEqual(len(reader.pages), 2)

    def test_internal_financials_and_evidence_remain_controlled(self):
        s = snapshot()
        s['risk']['unhedged_loss_p95'] = 6829.85
        s['financials'] = {'revenue': 20000., 'cost': 18500., 'contribution': 1500.,
            'break_even_price': 2.81, 'operating_funding': 3500., 'delayed_funding': 6500.,
            'peak_receivables': 4000., 'exposure': 4500., 'effective_unsecured_limit': 1000.,
            'protection_gap': 3500., 'inputs': {'customer_days': 25, 'supplier_days': 5,
            'payment_delay_days': 30, 'additional_exposure': 500., 'unsecured_limit': 1000.},
            'months': [{'month': f'2027-{i:02d}', 'revenue': 20000./12, 'total_cost': 18500./12,
                        'contribution': 1500./12} for i in range(1,13)]}
        s['readiness'] = {'cost_complete': False, 'delivery_confirmed': 'SecretValue199',
                          'quote_valid': False, 'payment_terms': True, 'credit_reviewed': False}
        _, reader, text = read_report(s)
        for expected in ['Internal financial review', 'Financial plan', 'Budget by quarter', '$20,000.00',
                         '$18,500.00', '$1,500.00', '$3,500.00', '$6,500.00', '$4,500.00',
                         '$1,000.00', '$6,829.85', '60% steady', '14 assessment records',
                         'route proxy', 'billed receivables', 'not net income', 'Commercial checks']:
            self.assertIn(expected, ' '.join(text.split()))
        self.assertNotIn('SecretValue199', text)
        self.assertEqual(len(reader.pages), 4)

    def test_customer_all_terms_pending_dates_and_metadata_safe(self):
        for term in (12,24):
            s = snapshot(term)
            secret='SecretManufacturer6971'
            s.update(customer=secret, quote_valid_until=secret, market_as_of=secret,
                     market_source=secret, delivery_point=secret, mode=secret)
            s['financials'] = {'inputs': {'customer_days': secret, 'supplier_days': secret},
                               'exposure': secret}
            s['readiness'] = {'credit_reviewed': secret, 'delivery_confirmed': secret}
            _, reader, text = read_report(s, customer=True)
            self.assertNotIn(secret, text + str(reader.metadata))
            self.assertIn('Pending', text)
            self.assertIn('Proposed monthly blocks', text)
            self.assertEqual(len(reader.pages), 3 if term == 24 else 2)
            self.assertNotIn('No collateral', text)

    def test_full_two_year_budget_stays_within_page_limit(self):
        s = snapshot(24)
        s['financials'] = {'months': [{'month': f'{2027+i//12}-{i%12+1:02d}',
            'revenue': 1800., 'total_cost': 1600., 'contribution': 200.} for i in range(24)]}
        _, reader, text = read_report(s)
        self.assertEqual(len(reader.pages), 5)
        financial = ' '.join(reader.pages[2].extract_text().split())
        self.assertIn('2027 Q1', financial)
        self.assertIn('2028 Q4', financial)
        self.assertIn('Demand validation: Pending', financial)
        self.assertIn('Monthly detail', reader.pages[3].extract_text())

    def test_new_and_existing_block_labels(self):
        for customer in (False, True):
            for mode, expected in [('New offer', 'Proposed'), ('Existing stress', 'Agreed')]:
                s = snapshot()
                s['mode'] = mode
                _, _, text = read_report(s, customer=customer)
                self.assertIn(expected.upper(), text.upper())
                self.assertNotIn('CONTRACTED BLOCKS', text)


if __name__ == '__main__':
    unittest.main()
