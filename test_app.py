import unittest
from pathlib import Path
from streamlit.testing.v1 import AppTest


class SimpleFinancialPlanTests(unittest.TestCase):
    def start(self):
        app=AppTest.from_file(str(Path(__file__).with_name('app.py')),default_timeout=45).run()
        self.assertFalse(app.exception)
        return app

    def complete_costs(self,app):
        for key in ['fuel_pct','supplier_fee','financing','residual_risk','credit_allowance']:
            app.number_input(key=key).set_value(0.)
        app.selectbox(key='fuel_basis').set_value('% of receipts').run()

    def test_unknowns_remain_pending_and_two_reports_are_available(self):
        app=self.start()
        s=app.session_state['proposal_snapshot']
        self.assertIsNone(s['financials']['contribution'])
        self.assertIsNone(s['financials']['operating_funding'])
        self.assertFalse(s['readiness']['delivery_confirmed'])
        self.assertFalse(s['readiness']['demand_validated'])
        self.assertEqual(len(app.get('download_button')),3)

    def test_financial_plan_and_cost_completion_do_not_imply_commercial_readiness(self):
        app=self.start()
        self.complete_costs(app)
        app.number_input(key='customer_days').set_value(30)
        app.number_input(key='supplier_days').set_value(0).run()
        s=app.session_state['proposal_snapshot']
        self.assertAlmostEqual(s['financials']['contribution'],1317.6)
        self.assertGreater(s['financials']['operating_funding'],0)
        self.assertTrue(s['readiness']['cost_complete'])
        self.assertFalse(s['readiness']['delivery_confirmed'])
        self.assertFalse(s['readiness']['credit_reviewed'])
        self.assertIn('Proposed blocks (MMBtu)',[x.label for x in app.metric])

    def test_saved_offer_financial_plan_uses_original_payment_terms(self):
        app=self.start()
        self.complete_costs(app)
        app.number_input(key='customer_days').set_value(30)
        app.number_input(key='supplier_days').set_value(0).run()
        app.button(key='freeze_offer').click().run()
        expected=app.session_state['proposal_snapshot']['financials']['operating_funding']
        app.number_input(key='customer_days').set_value(0).run()
        app.radio(key='mode').set_value('Test existing offer').run()
        s=app.session_state['proposal_snapshot']
        self.assertEqual(s['financials']['inputs']['customer_days'],30)
        self.assertAlmostEqual(s['financials']['operating_funding'],expected)
        app.radio(key='mode').set_value('New offer').run()
        self.assertEqual(app.number_input(key='customer_days').value,0)

    def test_financial_exposure_inputs_clear_for_new_customer(self):
        app=self.start()
        app.number_input(key='unsecured_limit').set_value(500.)
        app.number_input(key='additional_exposure').set_value(100.)
        app.number_input(key='customer_days').set_value(30).run()
        app.text_input(key='customer').set_value('A different customer').run()
        self.assertIsNone(app.number_input(key='unsecured_limit').value)
        self.assertIsNone(app.number_input(key='additional_exposure').value)
        self.assertIsNone(app.number_input(key='customer_days').value)

    def test_review_confirmation_clears_when_offer_exposure_changes(self):
        app=self.start()
        app.radio(key='credit_format').set_value('Enter ratios').run()
        for key,value in [('current_ratio',1.5),('debt_ebitda',2.),('interest_coverage',4.)]:
            app.number_input(key=key).set_value(value)
        app.run()
        app.checkbox(key='credit_reviewed').check().run()
        self.assertTrue(app.session_state['proposal_snapshot']['readiness']['credit_reviewed'])
        app.slider(key='weather_pct').set_value(40).run()
        self.assertFalse(app.session_state['proposal_snapshot']['readiness']['credit_reviewed'])

    def test_delivery_confirmation_clears_when_the_point_changes(self):
        app=self.start()
        point=next(x for x in app.text_input if x.label=='Delivery point / regional index (internal only)')
        point.set_value('Internal route A').run()
        confirm=next(x for x in app.checkbox if x.label=='Delivery route and regional index confirmed')
        confirm.check().run()
        self.assertTrue(app.session_state['proposal_snapshot']['readiness']['delivery_confirmed'])
        next(x for x in app.text_input if x.label=='Delivery point / regional index (internal only)').set_value('Internal route B').run()
        self.assertFalse(app.session_state['proposal_snapshot']['readiness']['delivery_confirmed'])


class AppTests(unittest.TestCase):
    def start(self):
        app = AppTest.from_file(str(Path(__file__).with_name('app.py')), default_timeout=45).run()
        self.assertEqual(len(app.exception), 0, str(app.exception))
        return app

    def test_default_snapshot_and_anonymous_download(self):
        app = self.start()
        s = app.session_state['proposal_snapshot']
        self.assertAlmostEqual(s['price'], 3.0170975592)
        self.assertAlmostEqual(s['volume'], 6588)
        self.assertIsNone(s['credit']['score'])
        self.assertTrue(s['credit']['collateral_required'])
        self.assertEqual(s['risk']['loss_p95'], 0)
        self.assertEqual(len(app.get('download_button')), 3)

    def test_city_term_never_invent_market_prices(self):
        app = self.start()
        for city, term in [('Omaha',12), ('Columbus',12), ('Tulsa',24)]:
            app.selectbox(key='city').set_value(city)
            app.selectbox(key='term').set_value(term)
            app.run()
            self.assertEqual(len(app.exception), 0, str(app.exception))
            self.assertIsNone(app.session_state['proposal_snapshot']['price'])

    def test_existing_offer_freezes_blocks_and_price(self):
        app = self.start()
        app.radio(key='mode').set_value('Test existing offer').run()
        s = app.session_state['proposal_snapshot']
        self.assertAlmostEqual(s['price'], 2.9925253033)
        self.assertAlmostEqual(s['volume'], 6100)
        self.assertAlmostEqual(s['expected_usage'], 6588)
        app.slider(key='weather_pct').set_value(40).run()
        s = app.session_state['proposal_snapshot']
        self.assertAlmostEqual(s['price'], 2.9925253033)
        self.assertAlmostEqual(s['volume'], 6100)
        self.assertAlmostEqual(s['expected_usage'], 7076)

    def test_freeze_new_offer_and_score_credit(self):
        app = self.start()
        app.button(key='freeze_offer').click().run()
        app.radio(key='mode').set_value('Test existing offer').run()
        self.assertAlmostEqual(app.session_state['proposal_snapshot']['price'], 3.0170975592)
        app.radio(key='credit_format').set_value('Enter ratios').run()
        for key, value in [('current_ratio',1.5), ('debt_ebitda',2.), ('interest_coverage',4.)]:
            app.number_input(key=key).set_value(value)
        app.run()
        credit = app.session_state['proposal_snapshot']['credit']
        self.assertEqual(credit['score'], 6)
        self.assertFalse(credit['collateral_required'])

    def test_stress_locks_contract_inputs(self):
        app = self.start()
        app.button(key='freeze_offer').click().run()
        app.radio(key='mode').set_value('Test existing offer').run()
        self.assertTrue(app.number_input(key='annual_gas').disabled)
        self.assertTrue(app.text_input(key='customer').disabled)
        self.assertTrue(app.selectbox(key='city').disabled)
        self.assertTrue(app.selectbox(key='term').disabled)

    def test_new_customer_clears_credit(self):
        app = self.start()
        app.radio(key='credit_format').set_value('Enter ratios').run()
        for key, value in [('current_ratio',2.), ('debt_ebitda',1.), ('interest_coverage',5.)]:
            app.number_input(key=key).set_value(value)
        app.run()
        self.assertEqual(app.session_state['proposal_snapshot']['credit']['score'],6)
        app.text_input(key='customer').set_value('Another unrelated customer').run()
        self.assertIsNone(app.session_state['proposal_snapshot']['credit']['score'])
        self.assertTrue(app.session_state['proposal_snapshot']['credit']['collateral_required'])

    def test_city_switch_preserves_entered_curve(self):
        app = self.start()
        app.session_state['curve_Tulsa_12_bundled'] = {
            'edited_rows':{0:{'basis_usd_mmbtu':2.}}, 'added_rows':[], 'deleted_rows':[]}
        app.text_input(key='source_Tulsa_12').set_value('Internal source')
        app.text_input(key='date_Tulsa_12').set_value('2026-10-30').run()
        expected = app.session_state['proposal_snapshot']['price']
        self.assertAlmostEqual(expected,3.2979157134)
        app.selectbox(key='city').set_value('Omaha').run()
        app.selectbox(key='city').set_value('Tulsa').run()
        self.assertAlmostEqual(app.session_state['proposal_snapshot']['price'], expected)
        self.assertEqual(app.text_input(key='source_Tulsa_12').value,'Internal source')
        self.assertEqual(app.session_state['proposal_snapshot']['market_as_of'],'2026-10-30')

    def test_invalid_edit_does_not_erase_other_months(self):
        app = self.start()
        app.session_state['curve_Tulsa_12_bundled'] = {
            'edited_rows':{0:{'forward_usd_mmbtu':-1.}}, 'added_rows':[], 'deleted_rows':[]}
        app.run()
        self.assertIsNone(app.session_state['proposal_snapshot']['price'])
        app.session_state['curve_Tulsa_12_bundled'] = {
            'edited_rows':{0:{'forward_usd_mmbtu':3.}}, 'added_rows':[], 'deleted_rows':[]}
        app.run()
        s=app.session_state['proposal_snapshot']
        self.assertIsNotNone(s['price'])
        self.assertAlmostEqual(s['months'][1]['hh_reference'],3.061)
        self.assertAlmostEqual(s['months'][0]['basis_reference'],.25)

    def test_stress_data_view_uses_saved_curve(self):
        app = self.start()
        app.button(key='freeze_offer').click().run()
        app.session_state['curve_Tulsa_12_bundled'] = {
            'edited_rows':{0:{'basis_usd_mmbtu':2.}}, 'added_rows':[], 'deleted_rows':[]}
        app.run()
        self.assertAlmostEqual(app.session_state['proposal_snapshot']['price'],3.2979157134)
        app.radio(key='mode').set_value('Test existing offer').run()
        self.assertAlmostEqual(app.session_state['proposal_snapshot']['price'],3.0170975592)
        shown_curve = next(x.value for x in app.dataframe if 'basis_usd_mmbtu' in x.value.columns)
        self.assertAlmostEqual(shown_curve.iloc[0]['basis_usd_mmbtu'],.25)

    def test_financial_denominators_and_complete_cost_assumptions(self):
        app = self.start()
        for key, value in [('current_assets',150.), ('current_liabilities',100.),
                           ('debt',200.), ('ebitda',100.), ('ebit',40.), ('interest_expense',0.)]:
            app.number_input(key=key).set_value(value)
        for key in ['fuel_pct','supplier_fee','financing','residual_risk','credit_allowance']:
            app.number_input(key=key).set_value(0.)
        app.selectbox(key='fuel_basis').set_value('% of receipts').run()
        s = app.session_state['proposal_snapshot']
        self.assertEqual(s['missing_inputs'], [])
        self.assertIsNone(s['credit']['score'])
        self.assertTrue(s['credit']['collateral_required'])
        app.number_input(key='interest_expense').set_value(10.).run()
        self.assertEqual(app.session_state['proposal_snapshot']['credit']['score'], 6)




class GuidedJourneyTests(unittest.TestCase):
    def start(self):
        app = AppTest.from_file(str(Path(__file__).with_name('app.py')), default_timeout=45).run()
        self.assertEqual(len(app.exception), 0, str(app.exception))
        return app

    def advance(self, app, step):
        app.button(key=f'next_{step}').click().run()
        self.assertEqual(len(app.exception), 0, str(app.exception))
        self.assertEqual(app.session_state['wizard_step'], step+1)

    def test_ordered_navigation_and_blank_customer_gate(self):
        app = self.start()
        self.assertEqual(app.session_state['wizard_step'], 1)
        self.assertTrue(app.button(key='step_nav_6').disabled)
        app.text_input(key='customer').set_value('').run()
        self.assertTrue(app.button(key='next_1').disabled)
        app.text_input(key='customer').set_value('Customer estimate').run()
        self.advance(app, 1)
        self.assertFalse(app.button(key='step_nav_1').disabled)
        self.assertTrue(app.button(key='step_nav_3').disabled)

    def test_back_and_forward_keep_inputs_and_credit(self):
        app = self.start()
        self.advance(app, 1)
        app.radio(key='demand_basis').set_value('User-entered annual total').run()
        app.number_input(key='annual_gas').set_value(7000.)
        app.slider(key='weather_pct').set_value(40).run()
        self.advance(app, 2)
        app.text_input(key='source_Tulsa_12').set_value('Private reference')
        app.text_input(key='date_Tulsa_12').set_value('2026-10-30').run()
        self.advance(app, 3)
        app.number_input(key='supplier_fee').set_value(.05).run()
        self.advance(app, 4)
        app.radio(key='credit_format').set_value('Enter ratios').run()
        for key,value in [('current_ratio',1.5),('debt_ebitda',2.),('interest_coverage',4.)]:
            app.number_input(key=key).set_value(value)
        app.run()
        self.advance(app, 5)
        app.button(key='step_nav_2').click().run()
        self.assertEqual(app.number_input(key='annual_gas').value,7000.)
        self.assertEqual(app.slider(key='weather_pct').value,40)
        app.button(key='step_nav_5').click().run()
        self.assertEqual(app.session_state['proposal_snapshot']['credit']['score'],6)
        self.assertEqual(app.number_input(key='supplier_fee').value,.05)
        self.assertEqual(app.text_input(key='source_Tulsa_12').value,'Private reference')

    def test_invalid_curve_blocks_next_and_reached_review(self):
        app = self.start()
        for step in range(1,6): self.advance(app,step)
        app.button(key='step_nav_3').click().run()
        app.session_state['curve_Tulsa_12_bundled'] = {
            'edited_rows':{0:{'forward_usd_mmbtu':-1.}}, 'added_rows':[], 'deleted_rows':[]}
        app.run()
        self.assertTrue(app.button(key='next_3').disabled)
        self.assertTrue(app.button(key='step_nav_6').disabled)
        app.session_state['curve_Tulsa_12_bundled'] = {
            'edited_rows':{0:{'forward_usd_mmbtu':3.}}, 'added_rows':[], 'deleted_rows':[]}
        app.run()
        self.assertFalse(app.button(key='next_3').disabled)
        self.assertIsNotNone(app.session_state['proposal_snapshot']['price'])

    def test_pending_credit_can_reach_review_without_fake_score(self):
        app = self.start()
        for step in range(1,6): self.advance(app,step)
        s=app.session_state['proposal_snapshot']
        self.assertIsNone(s['credit']['score'])
        self.assertTrue(s['credit']['collateral_required'])
        self.assertEqual(s['demand_basis'],'benchmark')
        self.assertTrue(s['missing_inputs'])


class GuidedInputSafetyTests(unittest.TestCase):
    def start(self):
        app=AppTest.from_file(str(Path(__file__).with_name('app.py')),default_timeout=45).run()
        self.assertFalse(app.exception)
        return app

    def test_manual_annual_quantity_is_not_mislabeled_as_benchmark(self):
        app=self.start()
        self.assertTrue(app.number_input(key='annual_gas').disabled)
        app.radio(key='demand_basis').set_value('User-entered annual total').run()
        app.number_input(key='annual_gas').set_value(10000.).run()
        self.assertEqual(app.session_state['proposal_snapshot']['demand_basis'],'user_total')
        self.assertEqual(app.radio(key='demand_basis').value,'User-entered annual total')
        app.radio(key='demand_basis').set_value('Estimated benchmark').run()
        self.assertEqual(app.number_input(key='annual_gas').value,6100.)
        self.assertEqual(app.session_state['proposal_snapshot']['demand_basis'],'benchmark')

    def test_mode_switch_revalidates_active_review(self):
        app=self.start()
        app.button(key='next_1').click().run()
        app.button(key='next_2').click().run()
        app.text_input(key='date_Tulsa_12').set_value('bad-date').run()
        self.assertTrue(app.button(key='next_3').disabled)
        app.radio(key='mode').set_value('Test existing offer').run()
        for step in (3,4,5): app.button(key=f'next_{step}').click().run()
        self.assertEqual(app.session_state['wizard_step'],6)
        app.radio(key='mode').set_value('New offer').run()
        self.assertFalse(app.exception)
        self.assertEqual(app.session_state['wizard_step'],3)
        self.assertTrue(app.button(key='next_3').disabled)


class SavedCostDisplayTests(unittest.TestCase):
    def test_stress_displays_original_costs_and_preserves_new_inputs(self):
        app=AppTest.from_file(str(Path(__file__).with_name('app.py')),default_timeout=45).run()
        app.number_input(key='supplier_fee').set_value(.05).run()
        app.button(key='freeze_offer').click().run()
        app.number_input(key='supplier_fee').set_value(.10).run()
        app.radio(key='mode').set_value('Test existing offer').run()
        shown=next(x.value for x in app.dataframe if 'Saved cost assumption' in x.value.columns)
        self.assertEqual(shown.loc[shown['Saved cost assumption']=='Supplier fee','Value'].iloc[0],'$0.0500')
        self.assertEqual(app.session_state['proposal_snapshot']['additional_components']['supplier_fee'],.05)
        app.radio(key='mode').set_value('New offer').run()
        self.assertEqual(app.number_input(key='supplier_fee').value,.10)

    def test_existing_annual_value_gets_honest_initial_provenance(self):
        app=AppTest.from_file(str(Path(__file__).with_name('app.py')),default_timeout=45)
        app.session_state['annual_gas']=10000.
        app.run()
        self.assertFalse(app.exception)
        self.assertEqual(app.session_state['proposal_snapshot']['demand_basis'],'user_total')


if __name__ == '__main__':
    unittest.main()
