"""Offline fixed-block gas offer and matched monthly commodity risk model."""
from pathlib import Path
from numbers import Integral
import copy
import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parent / 'data'
CITIES = ('Tulsa', 'Omaha', 'Columbus')
TULSA_BLOCKS = np.array([931.8, 776.2, 568.4, 437.1, 333.2, 305.1, 305., 305., 306.9, 421., 607.2, 803.1])
COST_KEYS = ('fuel_pct', 'fuel_basis', 'supplier_fee', 'financing', 'residual_risk', 'credit_allowance')


def _number(value, name, minimum=None, maximum=None):
    try:
        if isinstance(value, (bool, np.bool_)): raise ValueError
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f'{name} must be a finite number') from exc
    if not np.isfinite(result) or (minimum is not None and result < minimum) or (maximum is not None and result > maximum):
        raise ValueError(f'{name} is outside its valid range')
    return result


def validate_curve(curve, expected_months):
    columns = ['month', 'forward_usd_mmbtu', 'basis_usd_mmbtu']
    if not isinstance(curve, pd.DataFrame) or not set(columns).issubset(curve.columns):
        raise ValueError('Market curve must contain month, forward and basis columns')
    result = curve[columns].copy().reset_index(drop=True)
    months = result['month']
    if not all(isinstance(m, str) and len(m) == 7 and m[4] == '-' and m[:4].isdigit() and m[5:].isdigit() for m in months):
        raise ValueError('Months must use YYYY-MM')
    try:
        periods = pd.PeriodIndex(months, freq='M')
    except (ValueError, TypeError) as exc:
        raise ValueError('Invalid month') from exc
    if list(months) != list(expected_months) or periods.has_duplicates or not periods.is_monotonic_increasing:
        raise ValueError('Curve must contain exactly the expected months in chronological order')
    for col in columns[1:]:
        try:
            result[col] = pd.to_numeric(result[col], errors='raise').astype(float)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError(f'{col} must contain numbers or missing values') from exc
        values = result[col].dropna().to_numpy()
        if not np.isfinite(values).all() or (col == 'forward_usd_mmbtu' and (values <= 0).any()):
            raise ValueError(f'Invalid {col}')
    return result


def load_case(city: str, term_months: int = 12) -> dict:
    if city not in CITIES: raise ValueError('Unsupported city')
    if isinstance(term_months, bool) or not isinstance(term_months, Integral) or term_months not in (12, 24):
        raise ValueError('Term must be 12 or 24 months')
    months = pd.period_range('2027-01', periods=term_months, freq='M').astype(str).tolist()
    weather = pd.read_csv(DATA / 'weather_history.csv')
    price = pd.read_csv(DATA / 'hh_spot_history.csv')
    weather = weather.loc[weather.city == city].copy()
    joint = weather.merge(price, on=['year', 'calendar_month'], how='inner', validate='one_to_one')
    if joint.empty or joint.duplicated(['year', 'calendar_month']).any() or not joint.groupby('year').calendar_month.apply(lambda s: set(s) == set(range(1, 13))).all():
        raise ValueError('Weather and price history must contain complete paired years')
    for col in ('hdd', 'hh_spot_usd_mmbtu'):
        joint[col] = pd.to_numeric(joint[col], errors='raise')
        if not np.isfinite(joint[col]).all() or (joint[col] < 0).any() or (col.startswith('hh_') and (joint[col] == 0).any()):
            raise ValueError('Invalid historical data')
    ref = joint.groupby('calendar_month').hdd.mean().reindex(range(1, 13)).to_numpy(float)
    if ref.sum() <= 0: raise ValueError('Historical HDD must be positive')
    beta = 2440 / ref.sum()
    blocks = TULSA_BLOCKS.copy() if city == 'Tulsa' else 305 + beta * ref
    market = pd.read_csv(DATA / 'market_curves.csv')
    market = market.loc[market.city == city].copy()
    curve = pd.DataFrame({'month': months}).merge(market, on='month', how='left')
    curve = validate_curve(curve, months)
    return {'city': city, 'term': int(term_months), 'months': months, 'weather': joint.sort_values(['year','calendar_month']).reset_index(drop=True),
            'reference_hdd': np.tile(ref, term_months // 12), 'reference_blocks': np.tile(blocks, term_months // 12),
            'base_monthly': 305., 'beta': beta, 'market_curve': curve,
            'source_years': sorted(joint.year.unique().astype(int).tolist()), 'market_as_of': '2026-10-29' if city == 'Tulsa' else None}


def build_offer(case: dict, curve=None, *, annual_gas=6100., weather_pct=20., margin=.20, costs=None) -> dict:
    annual_gas = _number(annual_gas, 'annual gas', minimum=0)
    if annual_gas == 0: raise ValueError('Annual gas must be positive')
    weather_pct = _number(weather_pct, 'weather percentage', minimum=-100)
    margin = _number(margin, 'margin', minimum=0)
    if costs is not None and not isinstance(costs, dict): raise ValueError('Costs must be a dictionary')
    supplied = costs or {}
    if set(supplied) - set(COST_KEYS): raise ValueError('Unknown cost input')
    costs = {k: supplied.get(k) for k in COST_KEYS}
    for k in ('fuel_pct', 'supplier_fee', 'financing', 'residual_risk', 'credit_allowance'):
        if costs[k] is not None:
            costs[k] = _number(costs[k], k, minimum=0)
    if costs['fuel_basis'] is not None and costs['fuel_basis'] not in ('receipts', 'customer'):
        raise ValueError('Fuel basis must be receipts or customer')
    if costs['fuel_pct'] is not None and costs['fuel_basis'] == 'receipts' and costs['fuel_pct'] >= 100:
        raise ValueError('Fuel percentage of receipts must be below 100')
    curve = validate_curve(case['market_curve'] if curve is None else curve, case['months'])
    scale = annual_gas / 6100
    ref = np.asarray(case['reference_blocks'], dtype=float) * scale
    base = case['base_monthly'] * scale
    blocks = base + (ref-base) * (1 + weather_pct/100)
    if not np.isfinite(blocks).all() or (blocks < 0).any() or not np.isfinite(blocks.sum()) or blocks.sum() <= 0:
        raise ValueError('Modeled block volumes must be finite and positive in total')
    volume = float(blocks.sum())
    hh = curve.forward_usd_mmbtu.to_numpy(); basis = curve.basis_usd_mmbtu.to_numpy(); regional = hh+basis
    complete = np.isfinite(regional).all()
    commodity = float(np.dot(blocks, regional)/volume) if complete else None
    fuel_known = costs['fuel_pct'] is not None and costs['fuel_basis'] is not None
    fuel_factor = 1.
    if fuel_known:
        f = costs['fuel_pct']/100
        fuel_factor = 1/(1-f) if costs['fuel_basis'] == 'receipts' else 1+f
    fuel_adder = commodity * (fuel_factor-1) if fuel_known and commodity is not None else None
    other = sum(costs[k] for k in ('supplier_fee','financing','residual_risk','credit_allowance') if costs[k] is not None)
    fixed = commodity + (fuel_adder or 0) + margin + other if commodity is not None else None
    if fixed is not None and not np.isfinite(fixed): raise ValueError('Price exceeds finite range')
    missing = [k for k in COST_KEYS if costs[k] is None]
    if not complete: missing.insert(0, 'market_curve')
    block_value = fixed*volume if fixed is not None else None
    contribution = volume*margin
    if not np.isfinite(contribution) or (block_value is not None and not np.isfinite(block_value)) or not np.isfinite(blocks * fuel_factor).all():
        raise ValueError('Offer amounts exceed finite range')
    month_frame = pd.DataFrame({'month': case['months'], 'reference_block_mmbtu': ref, 'block_mmbtu': blocks,
        'modeled_use_mmbtu': blocks.copy(), 'hh_reference': hh, 'basis_reference': basis, 'regional_reference': regional,
        'hh_hedge_mmbtu': blocks * fuel_factor, 'basis_hedge_mmbtu': blocks * fuel_factor})
    return {'case': copy.deepcopy(case), 'city': case['city'], 'term': case['term'], 'annual_gas': annual_gas,
        'weather_pct': weather_pct, 'margin': margin, 'costs': costs, 'months': month_frame, 'volume': volume,
        'expected_usage': volume, 'commodity': commodity, 'fuel_adder': fuel_adder, 'fixed_price': fixed,
        'block_value': block_value, 'contribution': contribution,
        'missing_inputs': missing, 'pricing_status': 'Complete illustrative estimate' if not missing else ('Partial subtotal' if complete else 'Market curve incomplete')}


def stress_offer(frozen: dict, weather_pct: float) -> dict:
    weather_pct = _number(weather_pct, 'weather percentage', minimum=-100)
    result = copy.deepcopy(frozen)
    months = result['months']
    base = result['case']['base_monthly'] * result['annual_gas']/6100
    with np.errstate(over='ignore', invalid='ignore'):
        actual = base + (months.reference_block_mmbtu.to_numpy() - base) * (1+weather_pct/100)
        total = float(actual.sum())
        regional = months.regional_reference.to_numpy()
        deviation = float(np.dot(actual-months.block_mmbtu.to_numpy(), regional)) if np.isfinite(regional).all() else None
    if not np.isfinite(actual).all() or (actual < 0).any() or not np.isfinite(total) or (deviation is not None and not np.isfinite(deviation)):
        raise ValueError('Stressed usage or deviation value exceeds finite range')
    months['modeled_use_mmbtu'] = actual
    result['weather_pct'] = weather_pct
    result['expected_usage'] = total
    result['deviation_value'] = deviation
    return result


def simulate_joint_risk(offer: dict, n_sims=100000, seed=20261031) -> dict:
    if isinstance(n_sims, bool) or not isinstance(n_sims, Integral) or not 1 <= n_sims <= 1000000: raise ValueError('Invalid simulation count')
    if isinstance(seed, bool) or not isinstance(seed, Integral) or seed < 0: raise ValueError('Invalid seed')
    scope = 'Base commodity only: matched monthly index for deviations and paired HH and basis hedges.'
    limitations = ['Historical paired annual weather and HH spot are proxies; fixed basis.', 'Two-year terms independently resample annual blocks.', 'Daily/monthly mismatch, fuel, fees, financing and credit are excluded; total supplier risk premium remains unpriced.']
    result = {'available': False, 'reason': 'Complete monthly market curve required', 'frame': None, 'loss_p95': None,
              'risk_premium': None, 'unhedged_loss_p95': None, 'baseline_contribution': None, 'n_sims': int(n_sims),
              'n_unique_years': len(offer['case']['source_years']), 'years': offer['case']['source_years'], 'scope': scope, 'limitations': limitations}
    if offer['commodity'] is None: return result
    case = offer['case']; history = case['weather']; years = case['source_years']
    hdd = history.pivot(index='year', columns='calendar_month', values='hdd').loc[years,range(1,13)].to_numpy(float)
    hh_hist = history.pivot(index='year', columns='calendar_month', values='hh_spot_usd_mmbtu').loc[years,range(1,13)].to_numpy(float)
    if not np.isfinite(hdd).all() or not np.isfinite(hh_hist).all() or (hh_hist <= 0).any(): raise ValueError('Invalid paired history')
    months = offer['months']; q = months.block_mmbtu.to_numpy(float); K = months.regional_reference.to_numpy(float)
    hh = months.hh_reference.to_numpy(float); basis = months.basis_reference.to_numpy(float)
    if not np.isfinite(q).all() or not np.isfinite(K).all() or q.sum() <= 0: raise ValueError('Invalid offer')
    p = float(np.dot(q,K)/q.sum()+offer['margin'])
    baseline = float(q.sum()*offer['margin'])
    rng = np.random.default_rng(seed)
    draw = rng.integers(0,len(years),size=(int(n_sims),len(q)//12))
    hh_rel = hh_hist / hh_hist.mean(axis=0)
    actual_parts=[]; index_parts=[]
    scale = offer['annual_gas']/6100
    for i in range(len(q)//12):
        idx = draw[:,i]; sl = slice(i*12,(i+1)*12)
        actual_parts.append(scale * (case['base_monthly'] + case['beta']*hdd[idx]*(1+offer['weather_pct']/100)))
        index_parts.append(hh[sl][None,:]*hh_rel[idx] + basis[sl][None,:])
    actual=np.concatenate(actual_parts,axis=1); index=np.concatenate(index_parts,axis=1)
    revenue = q.sum()*p + np.sum((actual-q)*index,axis=1)
    physical = np.sum(actual*index,axis=1)
    hedge = np.sum(q*(index-K),axis=1)
    hedged = revenue-physical+hedge
    if not np.isfinite(hedged).all() or not np.allclose(hedged,baseline,rtol=1e-10,atol=1e-7): raise ValueError('Commodity reconciliation failed')
    unhedged = revenue-physical
    losses = np.maximum(baseline-hedged,0); losses[losses < 1e-7] = 0
    p95=float(np.quantile(losses,.95))
    result.update(available=True, reason=None, frame=pd.DataFrame({'hedged_contribution':hedged,'unhedged_contribution':unhedged,'total_volume_mmbtu':actual.sum(axis=1)}),
        loss_p95=p95, risk_premium=p95/float(q.sum()), unhedged_loss_p95=float(np.quantile(np.maximum(baseline-unhedged,0),.95)), baseline_contribution=baseline)
    return result
