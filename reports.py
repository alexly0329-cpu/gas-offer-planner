"""Anonymous, offline proposal PDFs built from an explicit snapshot.

Only approved categorical values, validated dates and numeric fields enter the
PDF. Freeform snapshot strings (including customer names and source notes) are
intentionally never copied into visible content or PDF metadata.
"""
from datetime import date
from io import BytesIO
import math
import re

from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak


_PENDING = 'Pending'
_COMPONENTS = {
    'supplier_fee': 'Supplier fee', 'financing': 'Financing',
    'residual_risk': 'Residual risk allowance', 'credit_allowance': 'Credit allowance',
}
_MISSING = {**_COMPONENTS, 'fuel_pct': 'Fuel percentage / convention',
            'fuel': 'Fuel percentage / convention', 'fuel_adder': 'Fuel percentage / convention',
            'fuel_basis': 'Fuel percentage / convention',
            'market_curve': 'Complete monthly Henry Hub and regional basis curve',
            'market': 'Complete monthly Henry Hub and regional basis curve',
            'hh_reference': 'Monthly Henry Hub curve', 'basis_reference': 'Monthly regional basis curve'}


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _fmt(value, decimals=2, dollar=False):
    number = _number(value)
    if number is None:
        return _PENDING
    return ('$' if dollar else '') + f'{number:,.{decimals}f}'


def _date(value, month_only=False):
    if not isinstance(value, str):
        return _PENDING
    pattern = r'\d{4}-\d{2}' if month_only else r'\d{4}-\d{2}(?:-\d{2})?'
    if not re.fullmatch(pattern, value):
        return _PENDING
    try:
        date.fromisoformat(value + '-01' if len(value) == 7 else value)
    except ValueError:
        return _PENDING
    return value


def proposal_pdf(snapshot: dict) -> bytes:
    """Create an anonymous internal financial review with the monthly appendix."""
    return _report(snapshot, customer=False)


def customer_proposal_pdf(snapshot: dict) -> bytes:
    """Create a short anonymous proposal without supplier financial information."""
    return _report(snapshot, customer=True)


def _report(snapshot: dict, customer: bool) -> bytes:
    s = snapshot or {}
    output = BytesIO()
    doc = SimpleDocTemplate(output, pagesize=(612, 792), leftMargin=42, rightMargin=42,
                            topMargin=40, bottomMargin=40,
                            title='Natural gas proposal' if customer else 'Internal gas financial review', author='Gas planning report',
                            subject='Estimated HVAC manufacturing profile - monthly gas blocks')
    ink, muted = colors.HexColor('#26242D'), colors.HexColor('#64606F')
    lavender, line = colors.HexColor('#EEE8FB'), colors.HexColor('#DAD1EB')
    styles = getSampleStyleSheet()
    definitions = {
        'Title': (30, 34, ink), 'Heading2': (14, 18, ink),
        'BodyText': (10, 14, ink), 'Small': (8.6, 11.6, muted),
        'Cell': (9, 12, ink), 'Label': (8, 11, muted),
        'HeroValue': (34, 40, colors.white), 'HeroText': (10, 14, colors.white),
        'Metric': (21, 27, ink), 'Kicker': (8, 11, muted),
    }
    for name, (size, leading, color) in definitions.items():
        if name not in styles:
            styles.add(ParagraphStyle(name=name))
        styles[name].fontName = 'Helvetica'
        styles[name].fontSize, styles[name].leading = size, leading
        styles[name].textColor = color
        styles[name].spaceAfter = 0
        styles[name].spaceBefore = 0
    styles['Title'].alignment = 0
    story = []

    def para(text, style='BodyText'):
        return Paragraph(text, styles[style])

    def p(text, style='BodyText', after=7):
        story.extend([para(text, style), Spacer(1, after)])

    def heading(number, title):
        p(f'{number} / {title}', 'Heading2', 8)

    def table(rows, widths, header=True, padding=6):
        cells = [[para(str(value), 'Cell') for value in row] for row in rows]
        t = Table(cells, colWidths=widths, repeatRows=1 if header else 0, hAlign='LEFT')
        commands = [('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('TOPPADDING', (0, 0), (-1, -1), padding),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), padding),
                    ('LEFTPADDING', (0, 0), (-1, -1), 9),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 9),
                    ('LINEBELOW', (0, 0), (-1, -1), .35, line)]
        if header:
            commands.append(('BACKGROUND', (0, 0), (-1, 0), lavender))
        t.setStyle(TableStyle(commands))
        story.extend([t, Spacer(1, 9)])

    city = {'Tulsa': 'Tulsa', 'Omaha': 'Omaha', 'Columbus': 'Columbus, Ohio',
            'Columbus, Ohio': 'Columbus, Ohio'}.get(s.get('city'), _PENDING)
    term = s.get('term') if s.get('term') in (12, 24) else None
    months = s.get('months') or []
    months = [r for r in months[:24] if isinstance(r, dict)] if isinstance(months, list) else []
    long_term = term == 24 or len(months) > 12
    price = _number(s.get('price'))
    missing = s.get('missing_inputs') or []
    missing = missing if isinstance(missing, (tuple, list)) else []
    components = s.get('additional_components') or {}
    components = components if isinstance(components, dict) else {}
    fuel_pct = _number(s.get('fuel_pct'))
    fuel_basis = {'receipts': 'percentage of receipts', 'customer': 'percentage of customer deliveries'}.get(
        s.get('fuel_basis'))
    fuel_known = (fuel_basis is not None and fuel_pct is not None and fuel_pct >= 0
                  and (s.get('fuel_basis') != 'receipts' or fuel_pct < 100))
    if price is None:
        status = 'Price unavailable'
        meaning = 'Provide Henry Hub and regional basis prices for every delivery month to calculate the full term.'
    elif missing or _number(s.get('fuel_adder')) is None or any(
            _number(components.get(key)) is None for key in _COMPONENTS):
        status = 'Partial subtotal'
        meaning = 'The amount includes known costs and target margin. Costs marked Pending still need an input.'
    else:
        status = 'Cost assumptions complete'
        meaning = 'The amount includes the supplied cost assumptions. Confirm those inputs before using it.'
    existing = s.get('mode') in ('Existing stress', 'Existing-offer stress', 'Existing offer stress')
    weather = _fmt(s.get('weather_pct'), 1)
    weather = weather + '%' if weather != _PENDING else weather
    missing_labels = list(dict.fromkeys(_MISSING[key] for key in missing if key in _MISSING))
    if any(key not in _MISSING for key in missing):
        missing_labels.append('Other required assumptions')
    credit = s.get('credit') or {}
    credit = credit if isinstance(credit, dict) else {}
    ratios = credit.get('ratios') or {}
    ratios = ratios if isinstance(ratios, dict) else {}
    score = _number(credit.get('score'))
    score_text = f'{int(score)} / 6' if score in range(7) else _PENDING
    flags = credit.get('review_flags') or []
    required = credit.get('collateral_required')
    if required is True:
        decision = 'Payment protection required: agree collateral or prepayment. Review missing or invalid inputs.'
    elif required is False and score == 6 and not flags:
        decision = 'Ratio screen passes; confirm the exposure-based credit limit and any protection gap.'
    else:
        decision = 'Pending - complete credit review and agree payment protection.'
    risk = s.get('risk') or {}
    risk = risk if isinstance(risk, dict) else {}
    available = risk.get('available') is True

    financial = s.get('financials') or {}
    financial = financial if isinstance(financial, dict) else {}
    financial_inputs = financial.get('inputs') or {}
    financial_inputs = financial_inputs if isinstance(financial_inputs, dict) else {}
    readiness = s.get('readiness') or {}
    readiness = readiness if isinstance(readiness, dict) else {}
    block_label = 'Agreed' if existing else 'Proposed'

    def day_text(value):
        value = _number(value)
        return str(int(value)) + ' days' if value is not None and value.is_integer() and 0 <= value <= 365 else _PENDING

    def full_date(value):
        return _date(value) if isinstance(value, str) and len(value) == 10 else _PENDING

    if not customer:
        # Page 1: executive view and price drivers.
        p('GAS PLANNING / ESTIMATED OPERATING PROFILE', 'Kicker', 12)
        p('Internal financial review', 'Title', 10)
        p('HVAC manufacturer - estimated operating profile', after=5)
        p(f'{city} / {str(term) + " months" if term else _PENDING} / '
          f'{_date(s.get("delivery_start"), True)} to {_date(s.get("delivery_end"), True)}', 'Small', 14)
        hero = Table([[[para('PRICE / USD PER MMBtu', 'HeroText'),
                        para(_fmt(price, 4, True), 'HeroValue')],
                       [para(status, 'HeroText'), para(meaning, 'HeroText')]]],
                     colWidths=[224, 304], hAlign='LEFT')
        hero.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), ink),
                                 ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                                 ('TOPPADDING', (0, 0), (-1, -1), 17),
                                 ('BOTTOMPADDING', (0, 0), (-1, -1), 17),
                                 ('LEFTPADDING', (0, 0), (-1, -1), 16),
                                 ('RIGHTPADDING', (0, 0), (-1, -1), 16)]))
        story.extend([hero, Spacer(1, 12)])
        metrics = Table([[[para(('AGREED' if existing else 'PROPOSED') + ' BLOCKS / MMBtu', 'Label'),
                           para(_fmt(s.get('volume'), 1), 'Metric')],
                          [para('FIXED-BLOCK SUBTOTAL / USD', 'Label'),
                           para(_fmt(s.get('block_value'), 2, True), 'Metric')]]], colWidths=[264, 264])
        metrics.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), lavender),
                                    ('TOPPADDING', (0, 0), (-1, -1), 10),
                                    ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
                                    ('LEFTPADDING', (0, 0), (-1, -1), 13),
                                    ('VALIGN', (0, 0), (-1, -1), 'TOP')]))
        story.extend([metrics, Spacer(1, 15)])
        heading('01', 'What this means')
        p('You buy fixed monthly blocks of gas. Usage above or below a block settles at that month\'s '
          'regional index. The subtotal is price times contracted blocks; it is not the full customer bill.', after=7)
        p('Modeled customer usage: ' + _fmt(s.get('expected_usage'), 1) + ' MMBtu. '
          'Market as of: ' + _date(s.get('market_as_of')) + '.', 'Small', 12)
        heading('02', 'How the price is built')
        rows = [['Component', 'USD / MMBtu'],
                ['Henry Hub + regional basis, weighted by monthly blocks', _fmt(s.get('commodity'), 4, True)],
                ['Procurement fuel adder', _fmt(s.get('fuel_adder'), 4, True)]]
        rows += [[_COMPONENTS[key], _fmt(components.get(key), 4, True)] for key in _COMPONENTS]
        rows += [['Target margin before unmodeled costs', _fmt(s.get('margin'), 4, True)]]
        table(rows, [390, 138], padding=4)
        demand_label = {'benchmark': 'Benchmark annual gas use', 'user_total': 'User-entered annual gas use'}.get(
            s.get('demand_basis'))
        if demand_label:
            p(demand_label + ': ' + _fmt(s.get('reference_annual_gas'), 0) + ' MMBtu. '
              'Customer meter records have not been supplied.', 'Small', 5)
        else:
            p('Annual gas use basis: Pending. Customer meter records have not been supplied.', 'Small', 5)
        if existing:
            p('Existing-offer stress: price, blocks and original costs remain frozen. '
              f'Usage is stressed at {weather} HDD versus history.', 'Small', 0)
        else:
            p(f'New offer: {weather} HDD versus history reprices quantity and monthly cost weights. '
              'Reference HDD: ' + _fmt(s.get('weather_reference_hdd'), 0) + '.', 'Small', 0)

        # Page 2: scoped protection and the actions needed before use.
        story.append(PageBreak())
        p('UNDERSTAND THE LIMITS / COMPLETE THE INPUTS', 'Kicker', 12)
        p('Protection and next steps', 'Title', 15)
        heading('03', 'Monthly hedge check')
        table([['Base-commodity Monte Carlo', 'Result'],
               ['Matched monthly P95 loss / USD', _fmt(risk.get('loss_p95') if available else None, 2, True)],
               ['Without hedges: P95 shortfall / USD', _fmt(risk.get('unhedged_loss_p95') if available else None, 2, True)],
               ['P95 component premium / USD per MMBtu', _fmt(risk.get('risk_premium') if available else None, 4, True)]],
              [390, 138], padding=5)
        if available:
            p(_fmt(risk.get('n_sims'), 0) + ' seeded draws from ' + _fmt(risk.get('n_unique_years'), 0) +
              ' paired annual source years. P95 component premium = P95 loss / contracted blocks.', 'Small', 7)
        else:
            p('Risk result Pending. Complete monthly market inputs and source history are required.', 'Small', 7)
        p('Only modeled commodity exposure cancels when customer blocks, both price components and monthly '
          'indexed deviations match. The result measures change in gross contribution before unmodeled costs. It does not price '
          'remaining supplier risk.', after=6)
        p('Outside this result: daily/monthly mismatch, fuel, execution, fees, financing and credit. '
          'Full supplier risk remains unpriced unless an allowance is supplied.', 'Small', 11)
        heading('04', 'Credit ratios and payment protection')
        table([['Current ratio', 'Debt / EBITDA', 'EBIT / interest', 'Score'],
               [_fmt(ratios.get('current_ratio')), _fmt(ratios.get('debt_ebitda')),
                _fmt(ratios.get('interest_coverage')), score_text]], [132] * 4, padding=5)
        p(decision, after=5)
        p('Analyst-chosen heuristic: 0-2 points per ratio. Strong means current ratio at least 1.5, '
          'debt/EBITDA at most 2 and EBIT/interest at least 4. Only 6/6 with no review flags passes the ratio screen. '
          'This does not estimate default probability, a default premium or a collateral amount.', 'Small', 12)
        heading('05', 'Before you use this estimate')
        market_action = ('Provide Henry Hub and regional basis prices for every delivery month.' if price is None else
                         'Confirm every monthly price and delivery period.')
        market_action += ' Confirm the matching delivery route and regional index, and the market valuation date.'
        p('1. Confirm market prices. ' + market_action, 'Small', 6)
        pending_costs = [_COMPONENTS[key] for key in _COMPONENTS if _number(components.get(key)) is None]
        if not fuel_known or _number(s.get('fuel_adder')) is None:
            pending_costs.insert(0, 'Fuel percentage / convention')
        market_labels = {_MISSING[key] for key in ('market_curve', 'market', 'hh_reference', 'basis_reference')}
        cost_missing_labels = [label for label in missing_labels if label not in market_labels]
        pending_costs = list(dict.fromkeys(pending_costs + cost_missing_labels))
        cost_action = '; '.join(pending_costs) + '.' if pending_costs else 'Review all supplied allowances and margin.'
        p('2. Confirm supplier costs. ' + cost_action + ' Pending means unknown, not zero.', 'Small', 6)
        p('3. Confirm payment terms. ' + ('Record the credit approval and agreed terms.' if required is False and
          score == 6 and not flags else 'Complete missing ratios and agree collateral or prepayment.'), 'Small', 6)
        p('4. Confirm demand and weather. Check annual use and the selected weather assumption. '
          'Recheck execution and contract terms before commitment.', 'Small', 12)
        heading('06', 'Glossary')
        p('MMBtu: a unit of gas energy. HDD: heating degree days, a measure of cold weather. '
          'Basis: the regional price difference from Henry Hub. P95: the 95th percentile of modeled loss, '
          'not a guaranteed maximum.', 'Small', 9)
        p('The input sequence: 1 Customer, city and term / 2 Gas use and weather / 3 Market prices / '
          '4 Supplier costs and margin / 5 Credit / 6 Review and PDF.', 'Small', 0)

        # One compact financial page; a quarterly budget keeps a two-year case readable.
        story.append(PageBreak())
        p('INTERNAL ONLY / REVENUE, COST AND CASH', 'Kicker', 12)
        p('Financial plan', 'Title', 12)
        table([['Full-term budget', 'USD'],
               ['Customer revenue', _fmt(financial.get('revenue'), 2, True)],
               ['Budgeted supplier costs', _fmt(financial.get('cost'), 2, True)],
               ['Budgeted contribution', _fmt(financial.get('contribution'), 2, True)],
               ['Peak operating funding', _fmt(financial.get('operating_funding'), 2, True)],
               ['Funding with selected payment delay', _fmt(financial.get('delayed_funding'), 2, True)]], [390, 138], padding=4)
        p('Break-even block price: ' + _fmt(financial.get('break_even_price'), 4, True) + ' / MMBtu. '
          'Customer payment: ' + day_text(financial_inputs.get('customer_days')) + '; supplier payment: ' +
          day_text(financial_inputs.get('supplier_days')) + ' after month-end invoice. Payment-delay stress: ' +
          day_text(financial_inputs.get('payment_delay_days')) + '.', 'Small', 7)
        p('These are budgeted expenses and reserves, not net income. Cash starts at zero and follows the entered payment dates. '
          'Daily hedge collateral and future price-driven cash settlements are outside this simple operating cash plan.', 'Small', 10)
        p('Budget by quarter', 'Heading2', 7)
        financial_months = financial.get('months') or []
        financial_months = financial_months[:24] if isinstance(financial_months, list) else []
        quarters = {}
        for row in financial_months:
            if not isinstance(row, dict):
                continue
            month = _date(row.get('month'), True)
            if month == _PENDING:
                continue
            quarter = month[:4] + ' Q' + str((int(month[5:7]) - 1) // 3 + 1)
            quarters.setdefault(quarter, []).append(row)
        quarter_rows = [['Period', 'Revenue / USD', 'Costs / USD', 'Contribution / USD']]
        for quarter, entries in sorted(quarters.items()):
            values = []
            for key in ('revenue', 'total_cost', 'contribution'):
                numbers = [_number(row.get(key)) for row in entries]
                values.append(sum(numbers) if len(entries) == 3 and all(value is not None for value in numbers) else None)
            quarter_rows.append([quarter] + [_fmt(value, 2, True) for value in values])
        if not quarters:
            quarter_rows.append([_PENDING] * 4)
        table(quarter_rows, [102, 142, 142, 142], padding=4)
        p('Payment protection / estimated coverage', 'Heading2', 7)
        table([['Peak billed receivables', 'Total exposure', 'Unsecured limit used', 'Protection gap'],
               [_fmt(financial.get('peak_receivables'), 2, True), _fmt(financial.get('exposure'), 2, True),
                _fmt(financial.get('effective_unsecured_limit'), 2, True), _fmt(financial.get('protection_gap'), 2, True)]],
              [132] * 4, padding=4)
        p('Exposure uses the base payment terms and adds billed receivables to the entered additional unbilled/close-out exposure. '
          'The protection gap subtracts the permitted unsecured limit. It is an estimate for review, not collateral approval; '
          'a strong ratio score does not create an unlimited credit line.', 'Small', 6)
        p('Observed: NOAA weather and historical Henry Hub spot records. Estimated demand uses 60% steady / 40% weather-sensitive gas. '
          'The 6,100 MMBtu benchmark rounds a median of 14 assessment records, not a representative regional average. '
          'The bundled Tulsa basis is a route proxy with a corroborated date, not a date printed in its monthly file. Confirm entered curves separately.', 'Small', 6)
        checks = [('Cost inputs', 'cost_complete'), ('Market date', 'market_dated'), ('Delivery/index', 'delivery_confirmed'),
                  ('Quote validity', 'quote_valid'), ('Payment timing', 'payment_terms'), ('Credit review', 'credit_reviewed')]
        p('Commercial checks: ' + '; '.join(label + ': ' + ('recorded' if readiness.get(key) is True else _PENDING)
          for label, key in checks) + '.', 'Small', 5)
        p('Demand validation: Pending. Match monthly customer bills and billing dates to weather before claiming forecast accuracy. '
          'Cost completeness alone does not make a firm quote.', 'Small', 0)

        # Appendix: one year per page, keeping a readable table at 24 months.
        groups = [months[:12]] + ([months[12:24]] if long_term else [])
        for year_index, group in enumerate(groups):
            story.append(PageBreak())
            p('MONTHLY APPENDIX / ' + ('YEAR ' + str(year_index + 1) if long_term else 'DELIVERY SCHEDULE'), 'Kicker', 12)
            p('Monthly detail', 'Title', 13)
            if fuel_known:
                p('Fixed monthly blocks are customer deliveries. Both hedge totals show the same '
                  'fuel-inclusive procurement quantity. Same gas volume, two price components. '
                  'Do not add the legs or fuel again.', after=8)
                hh_label, basis_label = 'Henry Hub total<br/>MMBtu', 'Regional basis total<br/>MMBtu'
                p(f'Fuel: {_fmt(fuel_pct)}% as {fuel_basis}. '
                  'Receipts: gross = q / (1 - f). Customer deliveries: gross = q * (1 + f). '
                  'Fuel procurement uses commodity cost.', 'Small', 10)
            else:
                p('Fixed monthly blocks. Customer-block hedges only: each price component covers the same block. '
                  'Same gas volume; do not add the legs. Fuel execution quantities: Pending.', after=8)
                p('Fuel percentage / convention: Pending. Any additional fuel execution quantity is unknown.', 'Small', 10)
                hh_label, basis_label = 'Henry Hub block<br/>MMBtu', 'Regional basis block<br/>MMBtu'
            rows = [['Month', 'Customer block<br/>MMBtu', hh_label, basis_label,
                     'HH reference<br/>USD/MMBtu', 'Basis reference<br/>USD/MMBtu']]
            for row in group:
                rows.append([_date(row.get('month'), True), _fmt(row.get('block_mmbtu'), 1),
                             _fmt(row.get('hh_hedge_mmbtu') if fuel_known else row.get('block_mmbtu'), 1),
                             _fmt(row.get('basis_hedge_mmbtu') if fuel_known else row.get('block_mmbtu'), 1),
                             _fmt(row.get('hh_reference'), 4, True), _fmt(row.get('basis_reference'), 4, True)])
            if not group:
                rows.append([_PENDING] * 6)
            table(rows, [72, 87, 90, 93, 93, 93], padding=5)
            example = next((row for row in group if _date(row.get('month'), True) != _PENDING and
                            all(_number(row.get(key)) is not None for key in
                                ('block_mmbtu', 'hh_reference', 'basis_reference')) and
                            _number(row.get('block_mmbtu')) > 0), None)
            if example:
                q = _number(example.get('block_mmbtu'))
                regional = _number(example.get('hh_reference')) + _number(example.get('basis_reference'))
                p('Worked example / ' + _date(example.get('month'), True), 'Heading2', 7)
                actual = _number(example.get('modeled_use_mmbtu'))
                p(f'Block: {_fmt(q, 2)} MMBtu. Entered reference index: '
                  f'{_fmt(regional, 4, True)} per MMBtu (Henry Hub + basis).', 'Small', 3)
                p(f'Reference cost: {_fmt(q * regional, 2, True)} of base commodity, before fuel, fees and margin.',
                  'Small', 3)
                if actual is not None:
                    deviation = actual - q
                    p(f'Modeled usage: {_fmt(actual, 2)} MMBtu. Deviation: {_fmt(deviation, 2)} MMBtu. '
                      f'Value at the reference index: {_fmt(deviation * regional, 2, True)}.', 'Small', 5)
                p('This is not a forecast of the settlement index.', 'Small', 5)
            else:
                p('Worked example: Pending. Supply a monthly block and both reference prices.', 'Small', 12)
            p('Figures are rounded for display; calculations use full precision.', 'Small', 8)
            p('Monthly customer deviations settle at the matching regional index. Actual execution, '
              'instrument availability and lot sizes require confirmation; this table is not an exchange order.', 'Small', 9)
            p('Method and sources', 'Heading2', 6)
            p('NOAA historical HDD and EIA Henry Hub spot-price histories are paired by whole year and '
              'centered on the entered curve; regional basis is fixed. Two-year terms independently '
              'resample annual blocks. These histories are not forward quotes. Only Tulsa 2027 has a '
              'bundled complete curve; other cities and 2028 require separate monthly prices.', 'Small', 7)
            p('Identifiers and freeform notes are omitted. No customer forecasting accuracy is asserted. '
              'Estimated operating profile. Educational estimate only. No trade is placed.', 'Small', 0)

    else:
        p('GAS PLANNING / ESTIMATED OPERATING PROFILE', 'Kicker', 12)
        p('Your gas proposal', 'Title', 12)
        p('HVAC manufacturer - estimated operating profile', after=5)
        p(f'{city} / {str(term) + " months" if term else _PENDING} / '
          f'{_date(s.get("delivery_start"), True)} to {_date(s.get("delivery_end"), True)}', 'Small', 15)
        customer_status = 'Indicative estimate' if status == 'Cost assumptions complete' else status
        customer_meaning = ('Review the price and conditions before agreement.' if status == 'Cost assumptions complete' else
                            'The estimate is incomplete. Confirm outstanding items before agreement.')
        hero = Table([[[para('PRICE / USD PER MMBtu', 'HeroText'), para(_fmt(price, 4, True), 'HeroValue')],
                       [para(customer_status, 'HeroText'), para(customer_meaning, 'HeroText')]]],
                     colWidths=[224, 304], hAlign='LEFT')
        hero.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), ink), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                                 ('TOPPADDING', (0, 0), (-1, -1), 17), ('BOTTOMPADDING', (0, 0), (-1, -1), 17),
                                 ('LEFTPADDING', (0, 0), (-1, -1), 16), ('RIGHTPADDING', (0, 0), (-1, -1), 16)]))
        story.extend([hero, Spacer(1, 16)])
        table([[block_label + ' monthly blocks / MMBtu', 'Fixed-block subtotal / USD'],
               [_fmt(s.get('volume'), 1), _fmt(s.get('block_value'), 2, True)]], [264, 264], padding=10)
        heading('01', 'A clear agreement')
        p("You buy fixed monthly gas blocks. Usage above or below each block settles at that month's regional index. "
          'The fixed-block subtotal is price times the blocks; it is not the full customer bill.', after=10)
        p('Utility delivery, transportation, taxes and any unconfirmed charges are outside this subtotal. '
          'Confirm the final included items and the delivery point before commitment.', 'Small', 13)
        heading('02', 'Terms to confirm')
        table([['Term', 'Status'],
               ['Customer payment after month-end invoice', day_text(financial_inputs.get('customer_days'))],
               ['Quote valid until', full_date(s.get('quote_valid_until'))],
               ['Market valuation date', _date(s.get('market_as_of'))],
               ['Delivery point and matching regional index', 'Confirmation recorded' if readiness.get('delivery_confirmed') is True else _PENDING],
               ['Payment terms and protection', 'Review recorded; final terms require agreement' if readiness.get('credit_reviewed') is True else _PENDING]],
              [285, 243], padding=6)
        heading('03', 'What happens next')
        p('Confirm the monthly schedule, payment arrangements, final price and delivery terms. '
          'This is an estimated proposal for discussion, not an executable supplier quote.', after=10)
        p('Estimated operating profile. Demand and weather assumptions need checking against customer records. '
          'The regional price reference must match the agreed delivery route. '
          'Internal names and source notes are omitted.', 'Small', 0)
        groups = [months[:12]] + ([months[12:24]] if long_term else [])
        for year_index, group in enumerate(groups):
            story.append(PageBreak())
            p('MONTHLY SCHEDULE / ' + ('YEAR ' + str(year_index + 1) if long_term else 'DELIVERY PERIOD'), 'Kicker', 12)
            p(block_label + ' monthly blocks', 'Title', 14)
            p('Fixed quantities for each month. Differences between actual use and these blocks settle at the matching regional index.', after=15)
            rows = [['Delivery month', block_label + ' block / MMBtu']]
            for row in group:
                rows.append([_date(row.get('month'), True), _fmt(row.get('block_mmbtu'), 1)])
            if not group:
                rows.append([_PENDING, _PENDING])
            table(rows, [264, 264], padding=9)
            p('MMBtu is a unit of gas energy. Displayed quantities are rounded; calculations use full precision. '
              'This schedule is subject to the final agreement.', 'Small', 0)

    def page_background(canvas, document):
        canvas.saveState()
        canvas.setProducer('Gas planning report')
        canvas.setCreator('Gas planning report')
        if document.page == 1:
            canvas.setFillColor(colors.HexColor('#F9F7FE'))
            canvas.rect(0, 0, 612, 792, fill=1, stroke=0)
        canvas.setFillColor(lavender)
        canvas.roundRect(523, 748, 47, 20, 10, fill=1, stroke=0)
        canvas.setFillColor(ink)
        canvas.setFont('Helvetica', 8)
        canvas.drawCentredString(546.5, 754.5, f'{document.page:02d}')
        canvas.setStrokeColor(line)
        canvas.line(42, 30, 570, 30)
        canvas.setFont('Helvetica', 7)
        canvas.setFillColor(muted)
        canvas.drawString(42, 18, 'NATURAL GAS ESTIMATE / NOT AN EXECUTABLE SUPPLIER QUOTE')
        canvas.drawRightString(570, 18, 'PRIVATE IDENTIFIERS OMITTED')
        canvas.restoreState()

    doc.build(story, onFirstPage=page_background, onLaterPages=page_background)
    return output.getvalue()
