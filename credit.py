"""Transparent analyst policy for an illustrative commercial credit screen.

Amounts must use a consistent currency/unit. EBITDA, EBIT and interest expense
must cover the same annual period. See README.md for formulas and policy scope.
The thresholds below are analyst choices, not an empirically calibrated model.
"""

import math


POLICY_NOTE = (
    "Illustrative conservative analyst heuristic, not an empirical PD/LGD model "
    "or a rating-agency model. Each metric earns 0–2 points: current ratio "
    "<1 / 1–<1.5 / ≥1.5; debt/annual EBITDA >4 / >2–4 / ≤2; "
    "annual EBIT/annual interest expense <2 / 2–<4 / ≥4. "
    "Collateral or prepayment is required unless all three metrics are strong "
    "(6/6) with no review flags. The score does not price a default premium "
    "or determine a collateral amount."
)


def _number(value, label, flags):
    """Keep missing and nonfinite inputs out of both arithmetic and scoring."""
    if value is None or (isinstance(value, str) and not value.strip()):
        flags.append(f"{label} is missing; review required.")
        return None
    try:
        parsed = float(value) if not isinstance(value, bool) else math.nan
    except (ValueError, TypeError, OverflowError):
        parsed = math.nan
    if not math.isfinite(parsed):
        flags.append(f"{label} must be a finite number; review required.")
        return None
    return parsed


def _divide(numerator, denominator, label, flags):
    if numerator is None or denominator is None:
        return None
    result = numerator / denominator
    if not math.isfinite(result):
        flags.append(f"{label} is outside the finite numeric range; review required.")
        return None
    return result


def ratios_from_financials(
    current_assets=None,
    current_liabilities=None,
    debt=None,
    ebitda=None,
    ebit=None,
    interest_expense=None,
) -> dict:
    """Return current ratio, debt/annual EBITDA, EBIT/interest and review flags.

    `debt` means interest-bearing short- and long-term debt, before subtracting
    cash. Nonpositive denominators remain unknown, including zero interest
    expense: lack of interest expense does not imply strong coverage here.
    The returned mapping can be passed directly to ``assess_credit(**result)``.
    """
    flags = []
    amounts = {
        "current_assets": (current_assets, "Current assets"),
        "current_liabilities": (current_liabilities, "Current liabilities"),
        "debt": (debt, "Interest-bearing debt"),
        "ebitda": (ebitda, "Annual EBITDA"),
        "ebit": (ebit, "Annual EBIT"),
        "interest_expense": (interest_expense, "Annual interest expense"),
    }
    values = {}
    for name, (raw, label) in amounts.items():
        value = _number(raw, label, flags)
        if value is not None:
            if name in ("current_assets", "debt") and value < 0:
                flags.append(f"{label} cannot be negative; review required.")
                value = None
            elif name in ("current_liabilities", "ebitda", "interest_expense") and value <= 0:
                flags.append(f"{label} must be positive; ratio unavailable and review required.")
                value = None
            elif name == "ebit" and value < 0:
                flags.append("Annual EBIT is negative; weak interest coverage and review required.")
        values[name] = value
    return {
        "current_ratio": _divide(values["current_assets"], values["current_liabilities"], "Current ratio", flags),
        "debt_ebitda": _divide(values["debt"], values["ebitda"], "Debt/EBITDA", flags),
        "interest_coverage": _divide(values["ebit"], values["interest_expense"], "EBIT/interest", flags),
        "flags": flags,
    }


def assess_credit(
    current_ratio=None,
    debt_ebitda=None,
    interest_coverage=None,
    *,
    flags=None,
) -> dict:
    """Score supplied ratios using the disclosed 0–6 analyst policy.

    Missing/invalid ratios have no points and no aggregate score. Negative
    coverage is valid weak coverage; negative debt/EBITDA is invalid because
    this screen uses gross interest-bearing debt and requires positive EBITDA.
    Pass financial-statement review flags through when using calculated ratios.
    """
    review_flags = [flags] if isinstance(flags, str) else list(flags or [])
    ratios = {}
    for name, raw, label in (
        ("current_ratio", current_ratio, "Current ratio"),
        ("debt_ebitda", debt_ebitda, "Debt/EBITDA"),
        ("interest_coverage", interest_coverage, "EBIT/interest"),
    ):
        value = _number(raw, label, review_flags)
        if value is not None and value < 0:
            if name == "interest_coverage":
                review_flags.append("EBIT/interest is negative; weak coverage and review required.")
            else:
                review_flags.append(f"{label} cannot be negative; review required.")
                value = None
        ratios[name] = value

    current, leverage, coverage = (ratios[name] for name in ("current_ratio", "debt_ebitda", "interest_coverage"))
    scores = {
        "current_ratio": None if current is None else (0 if current < 1 else 1 if current < 1.5 else 2),
        "debt_ebitda": None if leverage is None else (0 if leverage > 4 else 1 if leverage > 2 else 2),
        "interest_coverage": None if coverage is None else (0 if coverage < 2 else 1 if coverage < 4 else 2),
    }
    score = None if None in scores.values() else sum(scores.values())
    review_flags = list(dict.fromkeys(flag for flag in review_flags if flag))
    collateral_required = score != 6 or bool(review_flags)
    return {
        "ratios": ratios,
        "metric_scores": scores,
        "score": score,
        "rating": "Review required" if review_flags else (
            "All three metrics strong" if score == 6 else "Payment protection required"
        ),
        "collateral_required": collateral_required,
        "collateral_policy": (
            "Require collateral or prepayment. Amount requires separate exposure review."
            if collateral_required else
            "No collateral required under this illustrative rule; all three metrics are strong with no review flags."
        ),
        "review_flags": review_flags,
        "policy_note": POLICY_NOTE,
    }
