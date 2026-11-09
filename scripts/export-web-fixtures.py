"""Export browser parity cases from the unchanged Python reference models."""
from pathlib import Path
import json
import sys
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import load_case, build_offer, stress_offer, simulate_joint_risk
from credit import assess_credit, ratios_from_financials
from financials import financial_plan


def plain(value):
    if isinstance(value, pd.DataFrame):
        return plain(value.to_dict('records'))
    if isinstance(value, np.ndarray):
        return plain(value.tolist())
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [plain(v) for v in value]
    return value


zero_costs = dict(fuel_pct=0, fuel_basis='receipts', supplier_fee=0, financing=0, residual_risk=0, credit_allowance=0)
full_costs = dict(fuel_pct=5, fuel_basis='receipts', supplier_fee=.04, financing=.025, residual_risk=.07, credit_allowance=.015)
credit_sets = [
    {},
    dict(current_ratio=1.5, debt_ebitda=2, interest_coverage=4),
    dict(current_ratio=.99, debt_ebitda=4.1, interest_coverage=1.9),
    dict(current_ratio=1, debt_ebitda=4, interest_coverage=2),
    dict(current_ratio=1.5, debt_ebitda=2.01, interest_coverage=-.1),
    dict(current_ratio=-1, debt_ebitda=2, interest_coverage=4),
    dict(current_ratio=1.5, debt_ebitda=2, interest_coverage=4, flags=['Manual review']),
]
amount_sets = [
    {},
    dict(current_assets=150, current_liabilities=100, debt=200, ebitda=100, ebit=40, interest_expense=10),
    dict(current_assets=150, current_liabilities=0, debt=200, ebitda=100, ebit=40, interest_expense=10),
    dict(current_assets=150, current_liabilities=100, debt=200, ebitda=-100, ebit=40, interest_expense=10),
    dict(current_assets=150, current_liabilities=100, debt=200, ebitda=100, ebit=40, interest_expense=0),
    dict(current_assets=-150, current_liabilities=100, debt=-1, ebitda=100, ebit=-40, interest_expense=10),
    dict(current_assets=1e308, current_liabilities=1e-308, debt=0, ebitda=100, ebit=40, interest_expense=10),
]
strong = assess_credit(current_ratio=1.5, debt_ebitda=2, interest_coverage=4)
weak = assess_credit(current_ratio=.5, debt_ebitda=6, interest_coverage=1)
financial_inputs = [
    {},
    dict(customer_days=30, supplier_days=0, payment_delay_days=30, unsecured_limit=0, additional_exposure=0, credit=strong),
    dict(customer_days=0, supplier_days=30, payment_delay_days=0, unsecured_limit=10000, additional_exposure=500, credit=strong),
    dict(customer_days=365, supplier_days=0, payment_delay_days=90, unsecured_limit=1e6, additional_exposure=0, credit=weak),
    dict(customer_days=0, supplier_days=0, unsecured_limit=None, additional_exposure=0, credit=strong),
    dict(customer_days=15, supplier_days=None, unsecured_limit=5000, additional_exposure=1500, credit=strong),
]
specs = [
    ('default', 'Tulsa', 12, {}, None),
    ('reference', 'Tulsa', 12, dict(weather_pct=0), None),
    ('no_heating', 'Tulsa', 12, dict(weather_pct=-100, costs=zero_costs), None),
    ('zero_costs', 'Tulsa', 12, dict(costs=zero_costs), None),
    ('fuel_receipts', 'Tulsa', 12, dict(costs=full_costs), None),
    ('fuel_deliveries', 'Tulsa', 12, dict(costs={**full_costs, 'fuel_basis':'customer'}), None),
    ('custom_annual', 'Tulsa', 12, dict(annual_gas=8350, weather_pct=40, margin=.33, costs=full_costs), None),
    ('saved_stress', 'Tulsa', 12, dict(costs=full_costs), 70),
    ('saved_warm_stress', 'Tulsa', 12, dict(weather_pct=40, costs=zero_costs), -80),
    ('omaha_pending', 'Omaha', 12, {}, None),
    ('columbus_pending', 'Columbus', 12, {}, None),
    ('tulsa24_pending', 'Tulsa', 24, {}, None),
    ('omaha_entered', 'Omaha', 12, dict(annual_gas=7100, weather_pct=15, costs=full_costs), None),
    ('columbus24_entered', 'Columbus', 24, dict(annual_gas=5200, weather_pct=-15, costs=zero_costs), None),
    ('tulsa24_entered', 'Tulsa', 24, dict(costs=full_costs), 50),
    ('refund_entered', 'Tulsa', 12, dict(costs=zero_costs), -100),
    ('negative_regional_entered', 'Tulsa', 12, dict(costs=full_costs), None),
]
fixtures = {'note':'Validation inputs only: entered curves in tests are numerical fixtures, not regional quotes.',
            'offers':[], 'credit':[], 'amounts':[]}
for name, city, term, options, stress in specs:
    case = load_case(city, term)
    curve = None
    if name.endswith('entered'):
        curve = pd.DataFrame({'month':case['months'],
                              'forward_usd_mmbtu':[3 + i*.035 for i in range(term)],
                              'basis_usd_mmbtu':[-.3 + (i%4)*.05 for i in range(term)]})
    if name == 'refund_entered':
        curve.loc[0, 'forward_usd_mmbtu'] = 100
    elif name == 'negative_regional_entered':
        curve['forward_usd_mmbtu'] = 3
        curve['basis_usd_mmbtu'] = -4
    offer = build_offer(case, curve, **options)
    if stress is not None:
        offer = stress_offer(offer, stress)
    risk = simulate_joint_risk(offer)
    expected = {k:v for k,v in offer.items() if k != 'case'}
    risk_keys = ('available','reason','loss_p95','risk_premium','unhedged_loss_p95','baseline_contribution','n_sims','n_unique_years','years','scope','limitations')
    fixtures['offers'].append({'id':name,'city':city,'term':term,'options':options,'curve':curve,
                               'stress_weather':stress,'expected':expected,
                               'risk':{k:risk[k] for k in risk_keys},
                               'financials':[{'inputs':inp,'expected':financial_plan(offer, **inp)} for inp in financial_inputs]})
for inputs in credit_sets:
    fixtures['credit'].append({'inputs':inputs,'expected':assess_credit(**inputs)})
for inputs in amount_sets:
    ratios=ratios_from_financials(**inputs)
    fixtures['amounts'].append({'inputs':inputs,'expected':ratios,'assessment':assess_credit(**ratios)})
(ROOT/'web-tests/fixtures.json').write_text(json.dumps(plain(fixtures), indent=2, allow_nan=False)+'\n')
print(f'Exported {len(fixtures["offers"])} offer/risk and {len(fixtures["offers"])*len(financial_inputs)} financial parity cases.')
