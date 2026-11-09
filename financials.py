"""Simple budget, operating cash timing and billed-exposure estimates.

Entered cost allowances are budget expenses/reserves, not audited cash costs.
Daily hedge collateral and reference-price changes remain outside this plan.
"""
from collections import defaultdict
from datetime import timedelta
import math

import numpy as np
import pandas as pd


_TOTALS = ('revenue', 'cost', 'contribution', 'break_even_price', 'operating_funding',
           'delayed_funding', 'peak_receivables', 'exposure', 'effective_unsecured_limit',
           'protection_gap')
_CASH_COLUMNS = ['month', 'cash_in', 'cash_out', 'net_cash', 'closing_cash']
_ALLOWANCES = ('supplier_fee', 'financing', 'residual_risk', 'credit_allowance')


def _input(value, name, days=None, optional=True):
    if value is None and optional:
        return None
    try:
        if isinstance(value, (bool, np.bool_)):
            raise ValueError
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f'{name} must be a finite nonnegative number') from exc
    if not math.isfinite(number) or number < 0:
        raise ValueError(f'{name} must be a finite nonnegative number')
    if days is not None:
        if not number.is_integer() or number > days:
            raise ValueError(f'{name} must be a whole number from 0 to {days}')
        return int(number)
    return number


def _finite(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError('Financial amounts exceed the finite range')
    return number


def _cash_schedule(rows, customer_days, supplier_days, delay=0):
    events = defaultdict(lambda: [0., 0.])
    for row in rows.itertuples(index=False):
        invoice = pd.Period(row.month, freq='M').end_time.date()
        for due, amount in ((invoice + timedelta(days=customer_days + delay), row.revenue),
                            (invoice + timedelta(days=supplier_days), -row.total_cost)):
            events[due][0 if amount >= 0 else 1] += abs(amount)
    daily = pd.DataFrame([{'date': day, 'cash_in': flow[0], 'cash_out': flow[1]}
                          for day, flow in sorted(events.items())])
    daily['net_cash'] = daily.cash_in - daily.cash_out
    daily['closing_cash'] = daily.net_cash.cumsum()
    if not np.isfinite(daily[_CASH_COLUMNS[1:]].to_numpy()).all():
        raise ValueError('Financial cash amounts exceed the finite range')
    funding = max(0., -float(daily.closing_cash.min()))
    daily['month'] = pd.to_datetime(daily.date).dt.to_period('M')
    month_range = pd.period_range(rows.month.iloc[0], daily.month.iloc[-1], freq='M')
    monthly = daily.groupby('month')[['cash_in', 'cash_out', 'net_cash']].sum().reindex(month_range, fill_value=0.)
    monthly['closing_cash'] = monthly.net_cash.cumsum()
    monthly.index = monthly.index.astype(str)
    monthly.index.name = 'month'
    return funding, monthly.reset_index()[_CASH_COLUMNS]


def _receivables(rows, customer_days):
    events = defaultdict(lambda: [0., 0.])
    for row in rows.itertuples(index=False):
        amount = max(float(row.revenue), 0.)
        invoice = pd.Period(row.month, freq='M').end_time.date()
        events[invoice][0] += amount
        events[invoice + timedelta(days=customer_days)][1] += amount
    balance = peak = 0.
    for invoices, collections in (flow for _, flow in sorted(events.items())):
        balance += invoices
        peak = max(peak, balance)  # Conservative: invoices precede same-day receipts.
        balance = max(0., balance - collections)
    return _finite(peak)


def financial_plan(offer, *, customer_days=None, supplier_days=None, payment_delay_days=0,
                   unsecured_limit=None, additional_exposure=None, credit=None):
    """Derive a budget and event-date operating funding estimate without repricing.

    Payment days run from each delivery month's end. Billed receivable exposure
    excludes unbilled/close-out exposure unless the user supplies an extra amount.
    Additional payment delay affects only the separate funding stress result.
    """
    inputs = {
        'customer_days': _input(customer_days, 'Customer payment days', days=365),
        'supplier_days': _input(supplier_days, 'Supplier payment days', days=365),
        'payment_delay_days': _input(payment_delay_days, 'Payment delay', days=90, optional=False),
        'unsecured_limit': _input(unsecured_limit, 'Unsecured limit'),
        'additional_exposure': _input(additional_exposure, 'Additional exposure'),
    }
    result = {key: None for key in _TOTALS}
    result.update(inputs=inputs, missing=[], cash_months=pd.DataFrame(columns=_CASH_COLUMNS))
    original = offer['months']
    rows = pd.DataFrame({'month': original.month.tolist()})
    for col in ('revenue', 'commodity_cost', 'cost_allowances', 'total_cost', 'contribution'):
        rows[col] = pd.Series([None] * len(rows), dtype=object)
    result['months'] = rows
    costs = offer.get('costs') or {}
    missing = [key for key in ('fuel_pct', 'fuel_basis', *_ALLOWANCES) if costs.get(key) is None]
    q = original.block_mmbtu.to_numpy(float)
    use = original.modeled_use_mmbtu.to_numpy(float)
    index = original.regional_reference.to_numpy(float)
    if len(q) == 0 or not np.isfinite(q).all() or not np.isfinite(use).all() or (q < 0).any() or (use < 0).any() or q.sum() <= 0:
        raise ValueError('Financial plan requires valid positive total blocks and nonnegative usage')
    price = offer.get('fixed_price')
    if price is None or not np.isfinite(price) or not np.isfinite(index).all():
        missing.append('market_curve')
    credit = credit or {}
    strong = (credit.get('score') == 6 and credit.get('collateral_required') is False
              and not credit.get('review_flags'))
    result['effective_unsecured_limit'] = inputs['unsecured_limit'] if strong else 0.
    result['missing'] = missing + [key for key in ('customer_days', 'supplier_days', 'additional_exposure')
                                   if inputs[key] is None]
    if strong and inputs['unsecured_limit'] is None:
        result['missing'].append('unsecured_limit')
    if missing:
        return result
    fuel = _input(costs['fuel_pct'], 'Fuel percentage') / 100
    if costs['fuel_basis'] == 'receipts' and fuel < 1:
        factor = 1 / (1 - fuel)
    elif costs['fuel_basis'] == 'customer':
        factor = 1 + fuel
    else:
        raise ValueError('Invalid fuel convention or percentage')
    allowance = math.fsum(_input(costs[key], key, optional=False) for key in _ALLOWANCES)
    with np.errstate(over='ignore', invalid='ignore'):
        deviations = (use - q) * index
        rows['revenue'] = float(price) * q + deviations
        rows['commodity_cost'] = use * index * factor
        rows['cost_allowances'] = q * allowance
        rows['total_cost'] = rows.commodity_cost + rows.cost_allowances
        rows['contribution'] = rows.revenue - rows.total_cost
    if not np.isfinite(rows.iloc[:, 1:].to_numpy(float)).all():
        raise ValueError('Financial amounts exceed the finite range')
    result.update(revenue=_finite(math.fsum(rows.revenue)),
                  cost=_finite(math.fsum(rows.total_cost)),
                  contribution=_finite(math.fsum(rows.contribution)))
    result['break_even_price'] = _finite((result['cost'] - math.fsum(deviations)) / math.fsum(q))
    if inputs['customer_days'] is not None:
        result['peak_receivables'] = _receivables(rows, inputs['customer_days'])
        if inputs['additional_exposure'] is not None:
            result['exposure'] = _finite(result['peak_receivables'] + inputs['additional_exposure'])
            if result['effective_unsecured_limit'] is not None:
                result['protection_gap'] = max(0., result['exposure'] - result['effective_unsecured_limit'])
    if inputs['customer_days'] is not None and inputs['supplier_days'] is not None:
        result['operating_funding'], result['cash_months'] = _cash_schedule(
            rows, inputs['customer_days'], inputs['supplier_days'])
        result['delayed_funding'] = _cash_schedule(
            rows, inputs['customer_days'], inputs['supplier_days'], inputs['payment_delay_days'])[0]
    return result
