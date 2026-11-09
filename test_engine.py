import unittest
import numpy as np
import pandas as pd
import engine

class EngineTests(unittest.TestCase):
    def test_reference_and_repriced_offer(self):
        case = engine.load_case('Tulsa')
        self.assertTrue(np.allclose(case['reference_blocks'], [931.8,776.2,568.4,437.1,333.2,305.1,305,305,306.9,421,607.2,803.1]))
        offer = engine.build_offer(case, weather_pct=0)
        self.assertAlmostEqual(offer['volume'], 6100)
        self.assertAlmostEqual(offer['fixed_price'], 2.992525303, places=8)
        self.assertAlmostEqual(offer['block_value'], 18254.40435, places=4)
        revised = engine.build_offer(case, weather_pct=20)
        self.assertAlmostEqual(revised['volume'], 6588)
        self.assertAlmostEqual(revised['fixed_price'], 3.0170975592, places=8)
        self.assertAlmostEqual(revised['block_value'], 19876.63872, places=4)
        self.assertTrue(revised['missing_inputs'])
    def test_stress_freezes_quote(self):
        original = engine.build_offer(engine.load_case('Tulsa'), weather_pct=0)
        stressed = engine.stress_offer(original, 20)
        self.assertAlmostEqual(stressed['fixed_price'], original['fixed_price'])
        self.assertAlmostEqual(stressed['volume'], 6100)
        self.assertAlmostEqual(stressed['expected_usage'], 6588)
        self.assertAlmostEqual(stressed['contribution'], 1220)
        np.testing.assert_array_equal(stressed['months'].block_mmbtu, original['months'].block_mmbtu)
        self.assertEqual(original['weather_pct'], 0)
    def test_stress_rejects_overflowing_aggregates(self):
        offer = engine.build_offer(engine.load_case('Tulsa'))
        with self.assertRaises(ValueError):
            engine.stress_offer(offer, 1e307)
    def test_missing_curves(self):
        for city in ['Tulsa','Omaha','Columbus']:
            for term in [12,24]:
                offer = engine.build_offer(engine.load_case(city,term))
                if city != 'Tulsa' or term == 24:
                    self.assertIsNone(offer['fixed_price'])
                    self.assertIsNone(offer['commodity'])
                    self.assertFalse(engine.simulate_joint_risk(offer,100)['available'])
                self.assertEqual(len(offer['months']),term)
                self.assertGreater(offer['volume'],0)
    def test_curve_validation(self):
        c = engine.load_case('Tulsa')
        for value in [float('inf'), 'bad', -1, 0]:
            curve = c['market_curve'].copy(); curve['forward_usd_mmbtu'] = curve['forward_usd_mmbtu'].astype(object); curve.loc[0,'forward_usd_mmbtu']=value
            with self.assertRaises(ValueError): engine.validate_curve(curve,c['months'])
        curve = c['market_curve'].copy(); curve.loc[0,'basis_usd_mmbtu']=float('-inf')
        with self.assertRaises(ValueError): engine.validate_curve(curve,c['months'])
        curve = c['market_curve'].copy(); curve.loc[0,'month']='2027-13'
        with self.assertRaises(ValueError): engine.validate_curve(curve,c['months'])
        curve = c['market_curve'].copy(); curve.loc[0,'forward_usd_mmbtu']=None
        self.assertTrue(pd.isna(engine.validate_curve(curve,c['months']).iloc[0].forward_usd_mmbtu))
    def test_fuel_conventions_and_missing_costs(self):
        case=engine.load_case('Tulsa')
        a=engine.build_offer(case,weather_pct=0,costs={'fuel_pct':10,'fuel_basis':'receipts'})
        b=engine.build_offer(case,weather_pct=0,costs={'fuel_pct':10,'fuel_basis':'customer'})
        self.assertAlmostEqual(a['fuel_adder'],a['commodity']*(1/.9-1))
        self.assertAlmostEqual(b['fuel_adder'],b['commodity']*.1)
        np.testing.assert_allclose(a['months'].hh_hedge_mmbtu,a['months'].basis_hedge_mmbtu)
        np.testing.assert_allclose(a['months'].hh_hedge_mmbtu,a['months'].block_mmbtu/.9)
        self.assertIn('supplier_fee',a['missing_inputs'])
        with self.assertRaises(ValueError): engine.build_offer(case,costs={'fuel_pct':100,'fuel_basis':'receipts'})
    def test_risk_reproducible_and_cancels(self):
        offer=engine.build_offer(engine.load_case('Tulsa'))
        a=engine.simulate_joint_risk(offer,1000,5); b=engine.simulate_joint_risk(offer,1000,5)
        self.assertTrue(a['available'])
        self.assertEqual(a['loss_p95'],0)
        self.assertEqual(a['risk_premium'],0)
        self.assertGreater(a['unhedged_loss_p95'],0)
        pd.testing.assert_frame_equal(a['frame'],b['frame'])
        self.assertTrue(np.allclose(a['frame'].hedged_contribution, a['baseline_contribution']))
    def test_invalid_scalar_inputs(self):
        case=engine.load_case('Tulsa')
        for kwargs in [{'annual_gas':0},{'weather_pct':-101},{'margin':float('inf')},{'annual_gas':1e308},{'costs':{'supplier_fee':-1}}]:
            with self.assertRaises(ValueError): engine.build_offer(case,**kwargs)
    def test_supplied_curves_and_full_costs_for_all_terms(self):
        for city in ['Tulsa','Omaha','Columbus']:
            for term in [12,24]:
                case=engine.load_case(city,term)
                curve=pd.DataFrame({'month':case['months'], 'forward_usd_mmbtu':[3.0]*term, 'basis_usd_mmbtu':[-.2]*term})
                costs={'fuel_pct':0,'fuel_basis':'customer','supplier_fee':.1,'financing':.05,'residual_risk':.03,'credit_allowance':.02}
                offer=engine.build_offer(case,curve,costs=costs)
                self.assertEqual(offer['missing_inputs'],[])
                self.assertAlmostEqual(offer['fixed_price'],3.2)
                risk=engine.simulate_joint_risk(offer,100,6)
                self.assertTrue(risk['available'])
                self.assertEqual(risk['loss_p95'],0)
                self.assertAlmostEqual(risk['baseline_contribution'],offer['volume']*.2)
