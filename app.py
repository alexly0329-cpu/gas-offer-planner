"""Local supplier-side natural gas offer planner; no network calls or trades."""
import copy
from datetime import date
from html import escape
import hashlib
from io import BytesIO
import json
from pathlib import Path

import altair as alt
import numpy as np
import pandas as pd
import streamlit as st

from credit import assess_credit, ratios_from_financials
from engine import CITIES, build_offer, load_case, simulate_joint_risk, stress_offer, validate_curve
from financials import financial_plan
from reports import proposal_pdf, customer_proposal_pdf

st.set_page_config(page_title='Gas Offer Planner', page_icon='🔥', layout='wide')
st.session_state.setdefault('wizard_step',1)
st.session_state.setdefault('wizard_furthest',1)
active_step = st.session_state['wizard_step']
hidden_stages = ''.join(f'.st-key-stage_{n},[data-testid="stLayoutWrapper"]:has(>.st-key-stage_{n}){{display:none;}}' for n in range(1,7) if n!=active_step)
for current,saved in [('current_cost_inputs','frozen_cost_summary'),('current_payment_inputs','frozen_payment_summary')]:
    hidden_panel=current if st.session_state.get('mode')=='Test existing offer' else saved
    hidden_stages += f'.st-key-{hidden_panel},[data-testid="stLayoutWrapper"]:has(>.st-key-{hidden_panel}){{display:none;}}'
st.markdown('<style>' + (Path(__file__).parent/'ui.css').read_text() + hidden_stages + '</style>', unsafe_allow_html=True)

LABELS = {'market_curve':'Complete monthly market curve', 'fuel_pct':'Fuel percentage',
          'fuel_basis':'Fuel convention', 'supplier_fee':'Supplier fee', 'financing':'Financing',
          'residual_risk':'Residual risk allowance', 'credit_allowance':'Credit allowance'}
COST_NAMES = {'supplier_fee':'Supplier fee', 'financing':'Financing',
              'residual_risk':'Residual risk allowance', 'credit_allowance':'Credit allowance'}


def money(value, decimals=4):
    return 'Pending' if value is None else f'${value:,.{decimals}f}'


@st.cache_data(max_entries=6, show_spinner=False)
def risk_for(offer):
    return simulate_joint_risk(offer)


def freeze_offer(offer):
    st.session_state['frozen_offer'] = copy.deepcopy(offer)
    st.session_state['frozen_explicitly'] = True


# Update the previous default label without changing custom names or saved terms.
legacy_label = 'Fictional HVAC equipment manufacturer'
estimated_label = 'HVAC equipment manufacturer — estimated profile'
if st.session_state.get('customer') == legacy_label:
    st.session_state['customer'] = estimated_label
    if st.session_state.get('credit_customer') == legacy_label:
        st.session_state['credit_customer'] = estimated_label
    prior_context = st.session_state.get('frozen_context')
    if prior_context and prior_context[0] == legacy_label:
        st.session_state['frozen_context'] = (estimated_label, *prior_context[1:])
st.session_state.setdefault('customer', estimated_label)
st.session_state.setdefault('annual_gas',6100.)
st.session_state.setdefault('demand_basis','Estimated benchmark' if st.session_state['annual_gas']==6100. else 'User-entered annual total')


STEPS = ['Customer','Gas & weather','Market prices','Supplier costs','Credit','Review & PDF']

def go_step(target):
    if target<1 or target>min(6,st.session_state['wizard_furthest']+1):
        return
    if target>1 and not st.session_state.get('customer','').strip():
        return
    if target>3 and st.session_state.get('market_validation_error'):
        return
    st.session_state['wizard_step'] = target
    st.session_state['wizard_furthest'] = max(st.session_state['wizard_furthest'],target)


def annual_basis_changed():
    if st.session_state.get('demand_basis')=='Estimated benchmark':
        st.session_state['annual_gas']=6100.


def stage_intro(number,title,description,requirements):
    st.markdown(f'<div class="gp-step-intro"><div class="gp-step-kicker">STEP {number:02d} / 06</div>'
                f'<h2 class="gp-step-heading">{title}</h2><p class="gp-step-description">{description}</p></div>',unsafe_allow_html=True)
    if requirements:
        items=''.join(f'<li>{escape(item)}</li>' for item in requirements)
        st.markdown(f'<div class="gp-requirements"><h4>What you need</h4><ul>{items}</ul></div>',unsafe_allow_html=True)


def stage_navigation(number,label,blocked=False):
    with st.container(key=f'stage_nav_{number}'):
        back,next_col = st.columns([1,2])
        if number>1:
            back.button('Back',key=f'back_{number}',on_click=go_step,args=(number-1,),width='stretch')
        next_col.button(label,key=f'next_{number}',on_click=go_step,args=(number+1,),disabled=blocked,type='primary',width='stretch')


with st.sidebar:
    st.markdown('<div class="gp-section-label">YOUR JOURNEY</div>',unsafe_allow_html=True)
    st.title('Build your offer')
    mode=st.radio('Purpose',['New offer','Test existing offer'],key='mode')
    locked=mode!='New offer'
    st.caption('Follow the six steps. You can revisit any step you have reached.')
    st.progress((active_step-1)/5,text=f'Step {active_step} of 6')
    journey_controls=st.container()
    st.caption('Missing information can stay pending. The review will show what still needs confirmation.')

city=st.session_state.get('city','Tulsa')
term=st.session_state.get('term',12)
weather_pct=st.session_state.get('weather_pct',20)
display_city = city + (', Ohio' if city=='Columbus' else '')
st.markdown(f"""
<div class="gp-brandbar">
  <div class="gp-brand"><span class="gp-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span>Client Energy Solutions</div>
  <div class="gp-brand-note">Supplier workspace <span class="gp-tag">Estimated profile</span></div>
</div>
<section class="gp-hero {"gp-hero--compact" if active_step>1 else ""}" aria-label="Gas offer workspace">
  <div class="gp-hero-content">
    <div class="gp-eyebrow"><span class="gp-status-dot" aria-hidden="true"></span> NATURAL GAS / COMMERCIAL &amp; INDUSTRIAL</div>
    <h1>Gas Offer Planner</h1>
    <p class="gp-subtitle">From market inputs to a <span class="gp-accent">clearer gas offer.</span></p>
    <div class="gp-meta"><span>{display_city}</span><span>{term} months · Jan 2027 start</span><span>{weather_pct:+d}% assumed HDD</span></div>
  </div>
  <div class="gp-hero-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
</section>
""", unsafe_allow_html=True)

journey=[]
for index,label in enumerate(STEPS,1):
    state='is-current' if index==active_step else ('is-reached' if index<active_step else 'is-upcoming')
    current=' aria-current="step"' if index==active_step else ''
    journey.append(f'<div class="gp-journey-step {state}" role="listitem"{current}><span class="gp-step-number">{index:02d}</span><span class="gp-step-name">{label}</span></div>')
st.markdown(f'<div class="gp-journey" role="list" aria-label="Input sequence" style="--gp-progress:{(active_step-1)*20}%"><div class="gp-journey-line" aria-hidden="true"></div>'+''.join(journey)+'</div>',unsafe_allow_html=True)

with st.container(key='stage_1'):
    stage_intro(1,'Start with the customer.','Set the context for the whole offer.',[
        'Required: an internal customer label, city and contract term.',
        'This version starts in January 2027 and uses fixed monthly gas blocks.',
        'The exported proposal uses an anonymized estimated operating profile.'])
    customer=st.text_input('Customer — internal label',key='customer',disabled=locked,
                           help='An internal reference for this session. Customer names are excluded from the PDF.')
    city_col,term_col=st.columns(2)
    city=city_col.selectbox('City',CITIES,key='city',disabled=locked)
    term=term_col.selectbox('Term',[12,24],format_func=lambda n:f'{n} months',key='term',disabled=locked)
    if locked: st.info('The saved contract context is locked. Choose New offer to change the customer, city or term.')
    customer_ready=bool(customer and customer.strip())
    if not customer_ready: st.warning('Enter a customer label to continue. It will remain internal.')
    stage_navigation(1,'Continue to gas use & weather',blocked=not customer_ready)

case=load_case(city,term)
if st.session_state.get('credit_customer')!=customer:
    for key in ('current_assets','current_liabilities','debt','ebitda','ebit','interest_expense','current_ratio','debt_ebitda','interest_coverage',
                'customer_days','supplier_days','unsecured_limit','additional_exposure','credit_reviewed','credit_review_signature','payment_delay_days'):
        st.session_state.pop(key,None)
    st.session_state['credit_customer']=customer

with st.container(key='stage_2'):
    stage_intro(2,'Understand the gas demand.','Separate the annual gas estimate from the weather assumption.',[
        'Required: a positive annual gas quantity in MMBtu, not annual dollar spend.',
        'Choose the estimated benchmark or enter a customer annual total from billing records.',
        'Choose the assumed HDD change. More HDD means greater heating demand; it is not a temperature percentage.'])
    basis_label=st.radio('Annual gas input basis',['Estimated benchmark','User-entered annual total'],key='demand_basis',horizontal=True,disabled=locked,on_change=annual_basis_changed)
    annual_gas=st.number_input('Reference annual gas (MMBtu)',min_value=1.,max_value=1e9,value='min',step=100.,key='annual_gas',disabled=locked or basis_label=='Estimated benchmark')
    demand_basis='benchmark' if basis_label=='Estimated benchmark' and annual_gas==6100. else 'user_total'
    st.caption('The sourced benchmark stays at 6,100 MMBtu. Choose User-entered annual total to provide another quantity. The seasonal profile remains estimated until checked against customer records.')
    with st.expander('What would make the demand estimate more reliable?'):
        st.write('Use monthly customer bills with billing dates and matching weather, ideally covering two or more years. Check forecast errors on months held out of the model. An annual total alone cannot validate the seasonal split.')
        st.caption('Customer demand validation is pending. No forecasting accuracy or regression score is claimed.')
    weather_pct=st.slider('Assumed HDD change (%)',-100,100,20,5,key='weather_pct',help='Absolute change from the selected city historical reference. +20% means 20% more heating degree days.')
    annual_hdd=float(np.sum(case['reference_hdd'][:12]))
    st.info(f'{city} reference: {annual_hdd:,.1f} HDD/year. The model holds 60% of gas steady and varies the 40% heating portion with HDD.')
    if locked:st.caption('Only modeled usage changes in a saved-offer stress test. Agreed blocks and price stay fixed.')
    else:st.caption('A new offer updates gas blocks and monthly price weights automatically when you change weather.')
    stage_navigation(2,'Continue to market prices')

context=(customer,city,term,annual_gas)
if st.session_state.get('frozen_context')!=context:
    st.session_state['frozen_context']=context
    st.session_state['frozen_offer']=build_offer(case,annual_gas=annual_gas,weather_pct=0,margin=.20)
    st.session_state['frozen_offer'].update(market_as_of=case['market_as_of'],demand_basis=demand_basis)
    st.session_state['frozen_explicitly']=False

with st.container(key='stage_3'):
    stage_intro(3,'Match the market to the term.','Use one consistent market snapshot for the delivery period.',[
        'To calculate a full-term price: Henry Hub and matching regional basis for every delivery month, in USD/MMBtu.',
        'Record the valuation date and source. The regional index must match the actual supply route; a city alone does not confirm that route.',
        'Tulsa 2027 has a dated reference. Other cities and 2028 need their own prices. Missing prices may stay pending.'])
    st.write('Henry Hub plus the matching regional basis, in USD/MMBtu. Every delivery month needs both prices.')
    if city=='Tulsa':
        st.info('Bundled Tulsa 2027 reference: dated October 29, 2026. Indicative archive, not an executable quote. 2028 remains blank.')
        st.caption('Regional pipeline basis is a delivery-route proxy. Its date was corroborated against three dated seasonal averages; the monthly file does not print a valuation date. The actual factory delivery route remains unconfirmed.')
    else:
        st.info(f'{city} weather is available. Enter a separately sourced regional market curve to calculate its price.')
    upload = st.file_uploader('Upload a market curve (CSV)', type='csv', key=f'upload_{city}_{term}', disabled=mode!='New offer')
    st.download_button('Download curve template', case['market_curve'].to_csv(index=False).encode(),
                        file_name=f'{city.lower()}-{term}-month-curve.csv', mime='text/csv', key='curve_template')
    saved_curves = st.session_state.setdefault('saved_curves',{})
    saved = saved_curves.setdefault((city,term), {'curve':case['market_curve'].copy(),'source':'','date':''})
    curve = saved['curve'].copy()
    if locked:
        frozen = st.session_state['frozen_offer']
        curve = frozen['months'][['month','hh_reference','basis_reference']].rename(
            columns={'hh_reference':'forward_usd_mmbtu','basis_reference':'basis_usd_mmbtu'})
    curve_error = None
    upload_digest = 'bundled'
    if upload is not None and not locked:
        upload_digest = hashlib.sha256(upload.getvalue()).hexdigest()[:12]
        try:
            curve = validate_curve(pd.read_csv(BytesIO(upload.getvalue())), case['months'])
        except (ValueError,TypeError,pd.errors.ParserError,pd.errors.EmptyDataError) as exc:
            curve_error = str(exc)
            curve[['forward_usd_mmbtu','basis_usd_mmbtu']] = np.nan
    edited_curve = st.data_editor(curve, hide_index=True, disabled=['month'] if mode=='New offer' else True,
        width='stretch', key=f'curve_{city}_{term}_{"frozen" if locked else upload_digest}',
        column_config={'month':st.column_config.TextColumn('Delivery month'),
                       'forward_usd_mmbtu':st.column_config.NumberColumn('Henry Hub ($/MMBtu)',format='%.4f'),
                       'basis_usd_mmbtu':st.column_config.NumberColumn('Regional basis ($/MMBtu)',format='%.4f')})
    source_value = frozen.get('market_source','Bundled reference / missing inputs') if locked else saved['source']
    date_value = (frozen.get('market_as_of') or '') if locked else saved['date']
    suffix = '_frozen' if locked else ''
    market_source = st.text_input('Market source / reference (internal only)', value=source_value, key=f'source_{city}_{term}{suffix}',
                                 disabled=mode!='New offer')
    market_date = st.text_input('User-entered curve date (YYYY-MM-DD; optional)', value=date_value, key=f'date_{city}_{term}{suffix}',
                               disabled=mode!='New offer')
    market_changed = upload is not None or not edited_curve.equals(case['market_curve'])
    date_error = None
    if market_date:
        try:
            if len(market_date)!=10: raise ValueError
            date.fromisoformat(market_date)
        except ValueError:
            date_error = 'Use a valid YYYY-MM-DD date, or clear the field to leave it pending.'
            st.error(date_error)
    if curve_error:
        st.error('Upload not accepted: ' + curve_error + '. Price stays pending until a valid curve is supplied.')
    try:
        curve = validate_curve(edited_curve, case['months'])
    except ValueError as exc:
        st.error(str(exc))
        curve_error = str(exc)
    if curve_error:
        curve = case['market_curve'].copy()
        curve[['forward_usd_mmbtu','basis_usd_mmbtu']] = np.nan
    if mode=='New offer':
        saved.update(source=market_source,date=market_date)
        if not curve_error:
            saved['curve'] = curve.copy()
    st.session_state['market_validation_error'] = curve_error or date_error
    missing_months = int(curve[['forward_usd_mmbtu','basis_usd_mmbtu']].isna().any(axis=1).sum())
    if missing_months:
        st.warning(f'{missing_months} delivery months still need prices. You can continue, but the full-term price stays pending.')
    with st.expander('Commercial details — needed before an offer can be reviewed'):
        commercial_store=st.session_state.setdefault('commercial_terms',{})
        commercial_saved=commercial_store.setdefault((customer,city,term),{})
        commercial_default=st.session_state['frozen_offer'].get('commercial_terms',{}) if locked else commercial_saved
        commercial_key=hashlib.sha256(f'{customer}|{city}|{term}|{locked}'.encode()).hexdigest()[:12]
        delivery_point=st.text_input('Delivery point / regional index (internal only)',value=commercial_default.get('delivery_point',''),
                                     key=f'delivery_point_{commercial_key}',disabled=locked)
        expiry=commercial_default.get('quote_valid_until')
        quote_valid_until=st.date_input('Quote valid until',value=date.fromisoformat(expiry) if expiry else None,
                                       key=f'quote_valid_{commercial_key}',disabled=locked)
        confirmation_context=(delivery_point.strip(),market_source)
        context_key=f'delivery_context_{commercial_key}'
        if not locked and context_key in st.session_state and st.session_state[context_key]!=confirmation_context:
            st.session_state[f'delivery_confirmed_{commercial_key}']=False
        st.session_state[context_key]=confirmation_context
        st.session_state.setdefault(f'delivery_confirmed_{commercial_key}',commercial_default.get('delivery_confirmed',False))
        delivery_confirmed=st.checkbox('Delivery route and regional index confirmed',
                                        key=f'delivery_confirmed_{commercial_key}',disabled=locked or not delivery_point.strip())
        commercial_terms={'delivery_point':delivery_point,'quote_valid_until':quote_valid_until.isoformat() if quote_valid_until else None,
                          'delivery_confirmed':bool(delivery_point.strip() and delivery_confirmed)}
        if not locked: commercial_saved.update(commercial_terms)
        st.caption('Keep the route and index consistent with the price curve. These details stay internal; the PDF only reports confirmation status and the validity date.')
    stage_navigation(3, 'Continue with prices pending' if missing_months else 'Continue to supplier costs', blocked=bool(curve_error or date_error))

with st.container(key='stage_4'):
    stage_intro(4,'Build the supplier cost stack.','Make every allowance visible before the estimate is treated as complete.',[
        'Required to complete the cost estimate: fuel percentage and its calculation basis, supplier fee, financing, residual risk and credit allowance.',
        'Enter allowances in USD per contracted customer MMBtu. The target margin is a separate input.',
        'Blank means pending. Enter zero only when you deliberately assume no charge.'])
    with st.container(key='current_cost_inputs'):
        margin=st.number_input('Target margin (USD/MMBtu)',min_value=0.,max_value=100.,value=.20,step=.01,format='%.2f',key='margin',disabled=locked)
        fuel_col,basis_col=st.columns(2)
        fuel_pct=fuel_col.number_input('Fuel (%)',min_value=0.,max_value=99.,value=None,step=.1,key='fuel_pct',disabled=locked)
        fuel_label=basis_col.selectbox('Fuel calculation basis',['Pending','% of receipts','% of customer deliveries'],key='fuel_basis',disabled=locked)
        costs={'fuel_pct':fuel_pct,'fuel_basis':{'% of receipts':'receipts','% of customer deliveries':'customer'}.get(fuel_label)}
        st.caption('Receipts: buy q/(1−f). Customer deliveries: buy q×(1+f). Use the percentage and convention from the supplier/service terms.')
        cost_cols=st.columns(2)
        for index,(key,label) in enumerate(COST_NAMES.items()):
            costs[key]=cost_cols[index%2].number_input(label+' (USD/MMBtu)',min_value=0.,max_value=1000.,value=None,step=.01,format='%.4f',key=key,disabled=locked)
    if locked:st.info('Pricing uses the saved offer’s original cost inputs. The controls are locked in stress mode.')
    active_costs=st.session_state['frozen_offer']['costs'] if locked else costs
    with st.container(key='frozen_cost_summary'):
        saved_terms=st.session_state['frozen_offer']
        saved_costs=saved_terms['costs']
        saved_rows=[('Target margin',money(saved_terms['margin'])),
                    ('Fuel percentage','Pending' if saved_costs['fuel_pct'] is None else f'{saved_costs["fuel_pct"]:g}%'),
                    ('Fuel calculation basis',{'receipts':'Percentage of receipts','customer':'Percentage of customer deliveries'}.get(saved_costs['fuel_basis'],'Pending'))]
        saved_rows.extend((label,money(saved_costs[key])) for key,label in COST_NAMES.items())
        st.dataframe(pd.DataFrame(saved_rows,columns=['Saved cost assumption','Value']),hide_index=True,width='stretch')
    costs_pending=any(value is None for value in active_costs.values())
    if costs_pending:st.info('Some supplier costs are pending. Continuing will produce a partial estimate until they are supplied.')
    st.subheader('When does the money move?')
    st.caption('Assume both invoices are issued at the end of each delivery month. Enter the agreed days after that date. Leave unknown terms blank.')
    with st.container(key='current_payment_inputs'):
        pay_a,pay_b=st.columns(2)
        customer_days=pay_a.number_input('Customer pays after invoice (days)',min_value=0,max_value=365,value=None,step=1,key='customer_days',disabled=locked)
        supplier_days=pay_b.number_input('Supplier is paid after invoice (days)',min_value=0,max_value=365,value=None,step=1,key='supplier_days',disabled=locked)
    payment_terms=st.session_state['frozen_offer'].get('financial_terms',{}) if locked else {'customer_days':customer_days,'supplier_days':supplier_days}
    with st.container(key='frozen_payment_summary'):
        st.write('Saved payment terms: customer '+('Pending' if payment_terms.get('customer_days') is None else str(payment_terms['customer_days'])+' days')+
                 ' / supplier '+('Pending' if payment_terms.get('supplier_days') is None else str(payment_terms['supplier_days'])+' days')+' after month-end invoice.')
    stage_navigation(4,'Continue with costs pending' if costs_pending else 'Continue to credit')

with st.container(key='stage_5'):
    stage_intro(5,'Check payment protection.','Use financial evidence to decide whether collateral or prepayment is required.',[
        'To assess credit: current assets, current liabilities, interest-bearing debt, annual EBITDA, annual EBIT and annual interest expense.',
        'Use a consistent currency/unit and annual period. Alternatively, enter the three ratios directly.',
        'No statements yet? Continue with credit pending; payment protection remains required. No score or collateral amount is estimated from missing data.'])
    st.write('Enter financial statements or the three ratios. Use a consistent currency/unit and the same annual period for EBITDA, EBIT and interest expense.')
    credit_format = st.radio('Financial inputs', ['Financial statement amounts','Enter ratios'], horizontal=True, key='credit_format')
    if credit_format=='Financial statement amounts':
        amounts = {}
        cols = st.columns(3)
        fields = [('current_assets','Current assets'), ('current_liabilities','Current liabilities'),
                  ('debt','Interest-bearing debt'), ('ebitda','Annual EBITDA'), ('ebit','Annual EBIT'),
                  ('interest_expense','Annual interest expense')]
        for i,(key,label) in enumerate(fields):
            with cols[i%3]:
                amounts[key] = st.number_input(label, value=None, step=1000., format='%.2f', key=key)
        credit = assess_credit(**ratios_from_financials(**amounts))
    else:
        ratios = {}
        for col,key,label in zip(st.columns(3),['current_ratio','debt_ebitda','interest_coverage'],
                                  ['Current ratio','Debt / EBITDA','EBIT / interest']):
            with col:
                ratios[key] = st.number_input(label, value=None, step=.1, format='%.2f', key=key)
        credit = assess_credit(**ratios)
    ratio_labels = {'current_ratio':'Current assets / current liabilities',
                    'debt_ebitda':'Interest-bearing debt / annual EBITDA',
                    'interest_coverage':'Annual EBIT / annual interest expense'}
    st.dataframe(pd.DataFrame([{'Ratio':label,'Value':'Pending / N/M' if credit['ratios'][key] is None else f'{credit["ratios"][key]:.2f}×',
                                'Points':'Pending' if credit['metric_scores'][key] is None else f'{credit["metric_scores"][key]} / 2'}
                               for key,label in ratio_labels.items()]),hide_index=True,width='stretch')
    st.metric('Credit score', 'Pending' if credit['score'] is None else f'{credit["score"]} / 6')
    if credit['collateral_required']:
        st.warning(credit['collateral_policy'])
    else:
        st.success('Ratio screen passes. Confirm the approved unsecured limit and exposure-based payment protection in the review.')
    if credit['review_flags']:
        with st.expander('Items requiring review', expanded=True):
            for flag in credit['review_flags']:
                st.write('• '+flag)
    st.dataframe(pd.DataFrame([
        {'Metric':'Current ratio','0 points':'< 1','1 point':'1 to < 1.5','2 points':'≥ 1.5'},
        {'Metric':'Debt / EBITDA','0 points':'> 4','1 point':'> 2 to 4','2 points':'≤ 2'},
        {'Metric':'EBIT / interest','0 points':'< 2','1 point':'2 to < 4','2 points':'≥ 4'}]),hide_index=True,width='stretch')
    st.caption('Conservative analyst policy: only 6/6 with no review flags passes without required collateral. Missing data or a nonpositive denominator requires review and payment protection. This is an illustrative screen, not an empirical rating or probability of default.')
    st.caption('The credit score does not determine a collateral amount or default premium. Both require a separate exposure analysis.')

    with st.expander('Estimate the amount needing payment protection',key='exposure_panel'):
        st.caption('Use an approved unsecured limit, not one inferred from the score. Include any separately estimated unbilled or close-out exposure. Blank means pending; zero is a deliberate assumption.')
        limit_col,extra_col=st.columns(2)
        unsecured_limit=limit_col.number_input('Approved unsecured limit (USD)',min_value=0.,value=None,step=100.,key='unsecured_limit')
        additional_exposure=extra_col.number_input('Additional exposure estimate (USD)',min_value=0.,value=None,step=100.,key='additional_exposure')
        st.caption('The current policy allows an unsecured limit only with a 6/6 score and no review flags. Otherwise the modeled permitted limit is zero. This estimates a coverage gap; it does not approve collateral.')
    review_signature=(customer,city,term,annual_gas,weather_pct,mode,tuple(active_costs.items()),curve.to_csv(index=False),
                      margin if not locked else st.session_state['frozen_offer']['margin'],
                      tuple(credit['ratios'].values()),tuple(credit['review_flags']),unsecured_limit,additional_exposure,
                      payment_terms.get('customer_days'),payment_terms.get('supplier_days'))
    if st.session_state.get('credit_review_signature')!=review_signature:
        st.session_state['credit_reviewed']=False
        st.session_state['credit_review_signature']=review_signature
    credit_reviewed=st.checkbox('Financials and payment protection reviewed',key='credit_reviewed',disabled=credit['score'] is None)

    stage_navigation(5,'Review with credit pending' if credit['score'] is None else 'Review the offer')

if mode=='New offer':
    offer=build_offer(case,curve,annual_gas=annual_gas,weather_pct=weather_pct,margin=margin,costs=costs)
    offer.update(market_as_of=market_date if market_changed else case['market_as_of'],market_source=market_source,demand_basis=demand_basis,
                 financial_terms=payment_terms.copy(),commercial_terms=commercial_terms.copy())
else:
    offer=stress_offer(st.session_state['frozen_offer'],weather_pct)
risk=risk_for(offer)
plan=financial_plan(offer,customer_days=payment_terms.get('customer_days'),supplier_days=payment_terms.get('supplier_days'),
                    payment_delay_days=st.session_state.get('payment_delay_days',0),unsecured_limit=unsecured_limit,
                    additional_exposure=additional_exposure,credit=credit)
expiry_text=offer.get('commercial_terms',{}).get('quote_valid_until')
readiness={'cost_complete':not bool(offer['missing_inputs']),
           'market_dated':bool(offer.get('market_as_of')),
           'delivery_confirmed':bool(offer.get('commercial_terms',{}).get('delivery_confirmed')),
           'quote_valid':bool(expiry_text and date.fromisoformat(expiry_text)>=date.today()),
           'payment_terms':all(payment_terms.get(k) is not None for k in ('customer_days','supplier_days')),
           'credit_reviewed':bool(credit_reviewed and credit['score'] is not None),
           'demand_validated':False}
financial_snapshot={k:v.to_dict('records') if isinstance(v,pd.DataFrame) else v for k,v in plan.items()}
price_status='Cost assumptions complete' if not offer['missing_inputs'] else offer['pricing_status']
blocks_label='Proposed blocks' if mode=='New offer' else 'Agreed blocks'

# Mode changes can reveal a different saved curve; recheck the active destination.
redirect = 1 if active_step>1 and not customer_ready else (3 if active_step>3 and st.session_state.get('market_validation_error') else None)
if redirect:
    st.session_state['wizard_step']=redirect
    st.rerun()

with journey_controls:
    for index,label in enumerate(STEPS,1):
        blocked=(index>st.session_state['wizard_furthest']
                 or (index>1 and not st.session_state.get('customer','').strip())
                 or (index>3 and bool(st.session_state.get('market_validation_error'))))
        st.button(f'{index:02d}  {label}',key=f'step_nav_{index}',on_click=go_step,args=(index,),
                  disabled=blocked,type='primary' if index==active_step else 'secondary',width='stretch')

snapshot={
    'customer':customer,'city':city,'term':term,'delivery_start':case['months'][0],'delivery_end':case['months'][-1],
    'market_as_of':offer.get('market_as_of',case['market_as_of']),'price':offer['fixed_price'],
    'price_label':price_status,'volume':offer['volume'],'expected_usage':offer['expected_usage'],
    'block_value':offer['block_value'],'margin':offer['margin'],'commodity':offer['commodity'],
    'fuel_adder':offer['fuel_adder'],'fuel_basis':offer['costs']['fuel_basis'],'fuel_pct':offer['costs']['fuel_pct'],
    'additional_components':{key:offer['costs'][key] for key in COST_NAMES},'missing_inputs':offer['missing_inputs'],
    'mode':'New offer' if mode=='New offer' else 'Existing stress','weather_pct':weather_pct,
    'weather_reference_hdd':annual_hdd,'credit':credit,
    'risk':{key:risk[key] for key in ['available','n_sims','n_unique_years','loss_p95','risk_premium','unhedged_loss_p95','scope','limitations']},
    'months':offer['months'].to_dict('records'),'data_notes':[],
    'demand_basis':offer.get('demand_basis',demand_basis),'reference_annual_gas':offer['annual_gas'],
    'financials':financial_snapshot,'readiness':readiness,'quote_valid_until':expiry_text,
    'delivery_confirmed':readiness['delivery_confirmed']}
st.session_state['proposal_snapshot']=snapshot

with st.container(key='stage_6'):
    stage_intro(6,'See the offer. Know what comes next.','Review the estimate, the hedge and the open items before sharing.',[])
    review_rows=[('Customer context','Set' if customer_ready else 'Pending'),
               ('Gas use & weather','Estimated profile'),
               ('Monthly market curve','Available' if offer['commodity'] is not None else 'Pending'),
               ('Supplier cost inputs','Pending' if offer['missing_inputs'] else 'Supplied assumptions'),
               ('Credit','Pending — protection required' if credit['score'] is None else f'{credit["score"]}/6 — '+('protection required' if credit['collateral_required'] else 'ratio screen passes; check exposure'))]
    review_rows.extend((label,'Recorded' if readiness[key] else 'Pending') for key,label in [
        ('market_dated','Market valuation date'),('delivery_confirmed','Delivery route / index confirmation'),
        ('quote_valid','Quote validity'),('payment_terms','Payment timing'),('credit_reviewed','Financial / protection review')])
    with st.expander('Review input status and outstanding items'):
        st.dataframe(pd.DataFrame(review_rows,columns=['Review item','Status']),hide_index=True,width='stretch')
        st.caption('Cost assumptions can be complete while commercial checks remain pending. Customer demand is still estimated, not validated against monthly bills.')
    offer_tab,finance_tab,hedge_tab,credit_summary_tab,source_tab=st.tabs(['Offer','Financial plan','Hedge & risk','Credit summary','Sources'],key='active_tab',on_change='rerun')
    with offer_tab:
        st.subheader('Proposed offer' if mode=='New offer' else 'Existing offer stress test')
        if mode!='New offer':
            st.info('Using the saved offer.' if st.session_state['frozen_explicitly'] else 'Using the original reference offer: historical reference weather, $0.20 margin, and costs pending. Save a new offer to test different agreed terms.')
        a,b,c = st.columns(3)
        with a:
            with st.container(key='price_card'):
                st.metric(price_status+' ($/MMBtu)', money(offer['fixed_price']))
        b.metric(blocks_label+' (MMBtu)', f'{offer["volume"]:,.1f}')
        c.metric('Modeled usage (MMBtu)', f'{offer["expected_usage"]:,.1f}')
        if offer['missing_inputs']:
            st.warning('Pending: ' + ', '.join(LABELS[k] for k in offer['missing_inputs']) + '. This is not a complete supplier quote.')
        d,e = st.columns(2)
        d.metric('Fixed-block subtotal', money(offer['block_value'],2))
        e.metric('Target contribution before unmodeled costs', money(offer['contribution'],2))
        st.caption('The customer bill also includes indexed monthly deviations. Target contribution is not net profit. Transport and taxes are not included.')
        rows = [('Weighted Henry Hub + basis',offer['commodity']), ('Procurement fuel',offer['fuel_adder'])]
        rows.extend((label,offer['costs'][key]) for key,label in COST_NAMES.items())
        rows.append(('Target margin',offer['margin']))
        st.dataframe(pd.DataFrame({'Component':[x[0] for x in rows], 'USD/MMBtu':[money(x[1]) for x in rows]}), hide_index=True, width='stretch')
        st.subheader('Monthly gas profile')
        plot = offer['months'].set_index('month')[['block_mmbtu','modeled_use_mmbtu']].rename(columns={'block_mmbtu':blocks_label,'modeled_use_mmbtu':'Modeled usage'})
        st.bar_chart(plot, stack=False, y_label='MMBtu', height=300, color=['#7c3aed','#9e97b4'])
        if mode=='New offer':
            st.button('Use this offer for stress test', key='freeze_offer', on_click=freeze_offer, args=(offer,))
            st.caption('This stores the price, monthly blocks and cost assumptions. Then select “Test existing offer” in the sidebar.')
        if mode!='New offer':
            st.metric('Illustrative indexed deviation settlement', money(offer.get('deviation_value'),2))
            st.caption('Uses the saved monthly reference indices for this example. Future actual index prices are not known.')

    with finance_tab:
        st.subheader('Can this agreement fund itself?')
        st.write('A simple budget shows what the agreement earns and when cash is needed. Complete the costs in step 4 before treating the figures as a full estimate.')
        f1,f2=st.columns(2)
        f1.metric('Budgeted revenue',money(plan['revenue'],2))
        f2.metric('Budgeted supplier costs',money(plan['cost'],2))
        f3,f4=st.columns(2)
        f3.metric('Budgeted contribution',money(plan['contribution'],2))
        f4.metric('Peak operating cash needed',money(plan['operating_funding'],2))
        st.caption('Break-even fixed-block price: '+money(plan['break_even_price'])+'/MMBtu. Contribution is before overhead, taxes and costs outside this budget.')
        if plan['revenue'] is None:
            st.info('Complete the monthly market curve and all supplier cost assumptions to calculate this financial plan. Unknown amounts stay Pending.')
        elif plan['operating_funding'] is None:
            st.info('Enter both payment terms in step 4 to calculate cash timing.')
        budget=plan['months'][['month','revenue','total_cost','contribution']].copy()
        budget.columns=['Delivery month','Revenue','Budgeted costs','Contribution']
        for col in budget.columns[1:]: budget[col]=budget[col].map(lambda value:money(value,2) if pd.notna(value) else 'Pending')
        st.dataframe(budget,hide_index=True,width='stretch')
        with st.expander('Cash timing and a late-payment check',key='cash_timing_panel'):
            st.slider('Extra customer payment delay (days)',0,90,0,5,key='payment_delay_days')
            st.metric('Peak operating cash with this delay',money(plan['delayed_funding'],2))
            st.caption('This delays collections only. It does not change the price, gas blocks or hedge plan. The cash table below shows the original payment timing, including collections after delivery ends.')
            cash=plan['cash_months'].copy()
            if cash.empty:
                st.write('Cash schedule: Pending.')
            else:
                cash.columns=['Cash month','Cash in','Cash out','Net cash','Closing cash']
                for col in cash.columns[1:]: cash[col]=cash[col].map(lambda value:money(value,2))
                st.dataframe(cash,hide_index=True,width='stretch')
        st.caption('The budget uses the supplied per-MMBtu allowances, including financing and risk reserves; it does not infer actual expenses. Reference hedge settlements are zero at the entered reference indices. Daily hedge collateral, default losses and other unmodeled cash needs are excluded.')

    with hedge_tab:
        st.subheader('Hedge the two price components')
        st.write('Henry Hub and regional basis each cover the same gas quantity. Adding the two legs would double-count the gas.')
        if offer['costs']['fuel_pct'] is None or offer['costs']['fuel_basis'] is None:
            st.caption('Schedule covers customer blocks. Additional procurement fuel quantity is pending.')
        else:
            st.caption('Both hedge legs include the supplied fuel convention. The Monte Carlo below tests customer-block base commodity only.')
        schedule = offer['months'][['month','block_mmbtu','hh_hedge_mmbtu','basis_hedge_mmbtu','hh_reference','basis_reference']]
        st.dataframe(schedule, hide_index=True, width='stretch', column_config={
            'month':'Month','block_mmbtu':st.column_config.NumberColumn('Customer blocks',format='%.1f'),
            'hh_hedge_mmbtu':st.column_config.NumberColumn('HH hedge MMBtu',format='%.1f'),
            'basis_hedge_mmbtu':st.column_config.NumberColumn('Basis hedge MMBtu',format='%.1f'),
            'hh_reference':st.column_config.NumberColumn('HH $/MMBtu',format='%.4f'),
            'basis_reference':st.column_config.NumberColumn('Basis $/MMBtu',format='%.4f')})
        st.caption('A proposed volume plan, not exchange orders. Instrument availability, lot sizes and execution require separate review.')
        st.subheader('Monthly hedge check')
        if risk['available']:
            r1,r2,r3 = st.columns(3)
            r1.metric('Matched monthly P95 loss', money(risk['loss_p95'],2))
            r2.metric('Component premium ($/MMBtu)', money(risk['risk_premium']))
            r3.metric('Without hedges: P95 shortfall', money(risk['unhedged_loss_p95'],2))
            loss = np.maximum(risk['baseline_contribution'] - risk['frame']['unhedged_contribution'].to_numpy(),0)
            bins = np.linspace(0,max(float(loss.max()),1),31)
            unhedged,_ = np.histogram(loss,bins=bins)
            hedged,_ = np.histogram(np.zeros(len(loss)),bins=bins)
            chart = pd.DataFrame({'start':bins[:-1], 'end':bins[1:],
                                  'Matched hedges':hedged/len(loss), 'Without hedges':unhedged/len(loss)})
            chart = chart.melt(id_vars=['start','end'],var_name='Plan',value_name='Share')
            histogram = alt.Chart(chart).mark_bar(opacity=.7).encode(
                x=alt.X('start:Q',bin='binned',title='Shortfall (USD)',axis=alt.Axis(format='$,.0f',tickCount=8)),
                x2='end:Q', y=alt.Y('Share:Q',stack=None,title='Share of draws',axis=alt.Axis(format='.0%')),
                color=alt.Color('Plan:N',scale=alt.Scale(domain=['Matched hedges','Without hedges'],range=['#7c3aed','#8b859b'])),
                tooltip=['Plan:N',alt.Tooltip('start:Q',title='Bucket from',format='$,.0f'),
                         alt.Tooltip('end:Q',title='Bucket to',format='$,.0f'),alt.Tooltip('Share:Q',format='.1%')]
            ).properties(height=300)
            st.altair_chart(histogram,width='stretch')
            st.caption(f'{risk["n_sims"]:,} seeded draws from {risk["n_unique_years"]} paired historical years. Bars group shortfalls into buckets; matched hedge loss is exactly zero in this model.')
            st.write('Here, “loss” means deterioration from baseline gross commodity contribution. Matched indexed customer deviations and both hedge legs cancel monthly commodity exposure. The unhedged comparison shows why hedging matters.')
        else:
            st.info('Risk results pending: a complete monthly Henry Hub and regional basis curve is required.')
        st.warning('This component’s zero premium does not make total supplier risk zero. Daily/monthly mismatch, fuel, execution, financing and customer default remain outside the simulation.')
        st.caption('Paired whole-year HDD and Henry Hub spot anomalies are centered on the entered curve; regional basis is fixed. Resampling nine or ten past years is a scenario exercise, not a validated future 95% tail forecast. A 24-month term independently resamples each year.')
        st.caption('Component premium = P95 loss ÷ contracted blocks. Any residual or credit allowance entered in pricing is a separate user assumption.')

    with credit_summary_tab:
        st.metric('Credit score','Pending' if credit['score'] is None else f'{credit["score"]} / 6')
        st.write(credit['collateral_policy'] if credit['collateral_required'] else 'Ratio screen passes. The permitted unsecured limit and estimated protection gap still need review.')
        st.caption('Return to step5 to edit the financial inputs. The score does not determine a default premium or collateral amount.')
        ex1,ex2=st.columns(2)
        ex1.metric('Peak billed receivables',money(plan['peak_receivables'],2))
        ex2.metric('Estimated protection gap',money(plan['protection_gap'],2))
        st.caption('Exposure = peak billed receivables + your additional exposure estimate. Protection gap = exposure minus the permitted unsecured limit, floored at zero. This is an estimate to review, not an approved collateral demand.')
        st.caption('Exposure uses the original payment timing. The delay slider is a separate funding check.')
        st.write('Additional exposure: '+money(additional_exposure,2)+' · Permitted unsecured limit: '+money(plan['effective_unsecured_limit'],2))
        if additional_exposure is None:
            st.info('Enter an additional exposure estimate in step 5, including zero only if deliberate. Unbilled supply and close-out exposure are not inferred from the credit score.')
    with source_tab:
        provenance = json.loads((Path(__file__).parent/'data/provenance.json').read_text())
        city_source = provenance['cities'][city]
        st.write(f'NOAA station {city_source["station"]}; paired complete years: ' + ', '.join(map(str,case['source_years'])) + '.')
        if city=='Tulsa':
            st.caption('2022 is excluded because March carried a quality flag; complete years stay together in the simulation.')
        annual_hdd = float(np.sum(case['reference_hdd'][:12]))
        st.write(f'Historical reference: {annual_hdd:,.1f} HDD per year. This is the selected historical cohort, not the 1991–2020 climate normal or a forecast for 2027.')
        st.caption('HDD use a 65°F base. Warmer years need less space heating. Production gas is held steady in this benchmark scenario.')
        st.write('Demand starts from a selected public manufacturing energy-assessment benchmark: 6,100 MMBtu/year, split 60% steady and 40% weather-sensitive. This is an estimated whole-facility profile based on benchmarks; customer meter records have not been supplied, and it is not a representative regional average.')
        st.caption('Omaha and Columbus reuse the scenario’s annual benchmark, with their own seasonal weather profiles. Actual customer bills are needed for calibration; no fitted accuracy or R² is claimed.')
        st.markdown('[NOAA data service](https://www.ncei.noaa.gov/access/services/data/v1) · [EIA Henry Hub monthly spot history](https://www.eia.gov/dnav/ng/hist/rngwhhdm.htm)')
        st.caption('Weather/price history is bundled. The app makes no live data requests. An archived market curve will become stale and must be refreshed for a live offer.')
        with st.expander('Calculation trail'):
            st.write('Monthly gas = steady gas + reference heating gas × (1 + HDD adjustment). New offers use those quantities to weight monthly Henry Hub + basis prices.')
            st.write('Subtotal = weighted commodity + known fuel/cost allowances + target margin. Fixed-block value = subtotal × contracted blocks. Transport, taxes and other omitted items are outside this supplier subtotal.')
            st.write('Fuel on receipts: gross quantity = customer quantity / (1 − fuel fraction). Fuel on deliveries: gross = customer quantity × (1 + fuel fraction).')

    with st.container(key='proposal_panel',border=True):
        st.markdown('<div class="gp-section-label">YOUR PROPOSAL</div>',unsafe_allow_html=True)
        st.subheader('The right detail for each reader.')
        st.caption('The customer proposal shows the offer and its conditions. The internal review adds supplier costs, financial planning, hedges and credit. Both omit names and private source notes.')
        pdf_a,pdf_b=st.columns(2)
        pdf_a.download_button('Download customer proposal',customer_proposal_pdf(snapshot),file_name='estimated-hvac-gas-proposal.pdf',mime='application/pdf',key='proposal_download',type='primary')
        pdf_b.download_button('Download internal financial review',proposal_pdf(snapshot),file_name='estimated-hvac-gas-internal-review.pdf',mime='application/pdf',key='internal_download')
    st.button('Back to credit',key='back_6',on_click=go_step,args=(5,))
