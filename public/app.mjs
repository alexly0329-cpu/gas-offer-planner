import {loadCase, validateCurve, buildOffer, stressOffer, simulateJointRisk, ratiosFromFinancials, assessCredit, financialPlan, priceBuild, priceBuildBars} from './model.mjs';
import {downloadProposal} from './reports.mjs';
import {gauge, bandBars, meter} from './charts.mjs';
import {EXAMPLE_NOTE, makeEntry, totals, bookCsv, monthlyCsv, sampleEntries} from './book.mjs';

const app = document.getElementById('app');
const steps = ['Customer','Gas & weather','Market prices','Supplier costs','Credit','Review & PDF'];
const costNames = {supplier_fee:'Supplier fee',financing:'Financing',residual_risk:'Residual risk allowance',credit_allowance:'Credit allowance'};
const missingNames = {market_curve:'Complete monthly market curve',fuel_pct:'Fuel percentage',fuel_basis:'Fuel convention',...costNames};
const amountFields = {current_assets:'Current assets',current_liabilities:'Current liabilities',debt:'Interest-bearing debt',ebitda:'Annual EBITDA',ebit:'Annual EBIT',interest_expense:'Annual interest expense'};
const ratioFields = {current_ratio:'Current ratio',debt_ebitda:'Debt / EBITDA',interest_coverage:'EBIT / interest'};
const clone = value => structuredClone(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const number = (value,d=1) => value == null || !Number.isFinite(Number(value)) ? 'Pending' : Number(value).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const money = (value,d=4) => value == null || !Number.isFinite(Number(value)) ? 'Pending' : '$'+number(value,d);
const sum = values => values.reduce((a,b)=>a+b,0);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
const today = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
let data;
const state = {
  step:1,furthest:1,mode:'new',customer:'HVAC equipment manufacturer — estimated profile',city:'Tulsa',term:12,
  demand_basis:'benchmark',annual_gas:6100,weather_pct:20,margin:.20,
  costs:{fuel_pct:null,fuel_basis:null,supplier_fee:null,financing:null,residual_risk:null,credit_allowance:null},
  customer_days:null,supplier_days:null,credit_format:'amounts',amounts:Object.fromEntries(Object.keys(amountFields).map(k=>[k,null])),
  ratios:Object.fromEntries(Object.keys(ratioFields).map(k=>[k,null])),unsecured_limit:null,additional_exposure:null,credit_reviewed:false,
  payment_delay_days:0,context_version:0,upload_sequence:0,curves:{},commercial:{},frozen:null,frozen_context:null,frozen_explicit:false,tab:'Offer',upload_error:'',notice:'',view:'overview',band_mode:'credit',book:[],book_prompt:false,book_msg:''
};
const locked = () => state.mode === 'existing';
const contextKey = () => `${state.city}_${state.term}`;
const commercialKey = () => `${state.customer}|${state.city}|${state.term}`;
function marketState(c) {
  const key=contextKey();
  return state.curves[key] ??= {curve:clone(c.market_curve),source:'',date:''};
}
function commercialState() {return state.commercial[commercialKey()] ??= {delivery_point:'',quote_valid_until:null,delivery_confirmed:false};}
function clearCredit() {
  state.amounts=Object.fromEntries(Object.keys(amountFields).map(k=>[k,null]));
  state.ratios=Object.fromEntries(Object.keys(ratioFields).map(k=>[k,null]));
  state.customer_days=null;state.supplier_days=null;state.unsecured_limit=null;state.additional_exposure=null;
  state.credit_reviewed=false;state.payment_delay_days=0;
}
function derive() {
  const result={errors:[],market_error:'',case:null,offer:null,credit:assessCredit({})};
  try {
    const c=loadCase(data,state.city,state.term);result.case=c;
    const m=marketState(c);
    const ctx=JSON.stringify([state.customer,state.city,state.term,state.annual_gas]);
    if(state.frozen_context !== ctx && state.annual_gas > 0) {
      state.frozen=buildOffer(c,null,{annual_gas:state.annual_gas,weather_pct:0,margin:.20});
      state.frozen.market_as_of=c.market_as_of;
      state.frozen.demand_basis=state.demand_basis;
      state.frozen.financial_terms={customer_days:null,supplier_days:null};
      state.frozen.commercial_terms={delivery_point:'',quote_valid_until:null,delivery_confirmed:false};
      state.frozen_context=ctx;state.frozen_explicit=false;
    }
    const rawCurve=locked() ? state.frozen.months.map(r=>({month:r.month,forward_usd_mmbtu:r.hh_reference,basis_usd_mmbtu:r.basis_reference})) : m.curve;
    let curve;
    try {curve=validateCurve(rawCurve,c.months);} catch(error) {
      result.market_error=error.message;
      curve=c.months.map(month=>({month,forward_usd_mmbtu:null,basis_usd_mmbtu:null}));
    }
    if(!locked() && m.date && !validDate(m.date))result.market_error='Use a valid YYYY-MM-DD date, or clear the field to leave it pending.';
    if(!locked() && state.upload_error)result.market_error=state.upload_error;
    result.market=locked()?{curve,source:state.frozen.market_source ?? '',date:state.frozen.market_as_of ?? ''}:m;
    result.commercial=locked()?state.frozen.commercial_terms:commercialState();
    result.credit=assessCredit(state.credit_format==='amounts'?ratiosFromFinancials(state.amounts):state.ratios);
    let offer;
    if(locked()) offer=stressOffer(state.frozen,state.weather_pct);
    else {
      offer=buildOffer(c,curve,{annual_gas:state.annual_gas,weather_pct:state.weather_pct,margin:state.margin,costs:state.costs});
      const changed=JSON.stringify(curve)!==JSON.stringify(c.market_curve);
      offer.market_as_of=changed?(m.date||null):c.market_as_of;
      offer.market_source=m.source;offer.demand_basis=state.demand_basis;
      offer.financial_terms={customer_days:state.customer_days,supplier_days:state.supplier_days};
      offer.commercial_terms=clone(result.commercial);
    }
    result.offer=offer;
    result.risk=simulateJointRisk(offer,data);
    const payment=offer.financial_terms??{};
    result.financials=financialPlan(offer,{customer_days:payment.customer_days??null,supplier_days:payment.supplier_days??null,
      payment_delay_days:state.payment_delay_days,unsecured_limit:state.unsecured_limit,additional_exposure:state.additional_exposure,credit:result.credit});
    const commercial=offer.commercial_terms??{};
    result.readiness={cost_complete:offer.missing_inputs.length===0,market_dated:!!offer.market_as_of,
      delivery_confirmed:!!commercial.delivery_confirmed,quote_valid:!!(commercial.quote_valid_until&&validDate(commercial.quote_valid_until)&&commercial.quote_valid_until>=today()),
      payment_terms:payment.customer_days!=null&&payment.supplier_days!=null,credit_reviewed:state.credit_reviewed&&result.credit.score!=null,demand_validated:false};
    result.price_status=offer.missing_inputs.length?'Partial subtotal':'Cost assumptions complete';
    if(offer.fixed_price==null)result.price_status='Market curve incomplete';
    result.snapshot={customer:state.customer,city:state.city,term:state.term,delivery_start:c.months[0],delivery_end:c.months.at(-1),
      market_as_of:offer.market_as_of,price:offer.fixed_price,price_label:result.price_status,volume:offer.volume,expected_usage:offer.expected_usage,
      block_value:offer.block_value,margin:offer.margin,commodity:offer.commodity,fuel_adder:offer.fuel_adder,fuel_basis:offer.costs.fuel_basis,fuel_pct:offer.costs.fuel_pct,
      additional_components:Object.fromEntries(Object.keys(costNames).map(k=>[k,offer.costs[k]])),missing_inputs:offer.missing_inputs,
      mode:locked()?'Existing stress':'New offer',weather_pct:state.weather_pct,weather_reference_hdd:sum(c.reference_hdd.slice(0,12)),credit:result.credit,
      risk:Object.fromEntries(['available','n_sims','n_unique_years','loss_p95','risk_premium','unhedged_loss_p95','scope','limitations'].map(k=>[k,result.risk[k]])),
      months:offer.months,data_notes:[],demand_basis:offer.demand_basis,reference_annual_gas:offer.annual_gas,
      price_build:priceBuild(offer),financials:result.financials,readiness:result.readiness,quote_valid_until:commercial.quote_valid_until??null,delivery_confirmed:result.readiness.delivery_confirmed};
  } catch(error) {result.errors.push(error.message || 'Check the entered values.');}
  return result;
}
const notice=(text,type='')=>`<div class="notice ${type}"${type==='error'?' role="alert"':''}>${esc(text)}</div>`;
const caption=text=>`<p class="caption">${esc(text)}</p>`;
function input(id,label,value,{type='number',min,max,step='any',disabled=false,help='',placeholder=''}={}) {
  return `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" name="${id}" type="${type}" value="${esc(value)}"${type==='number'?` step="${step}"`:''}${min!=null?` min="${min}"`:''}${max!=null?` max="${max}"`:''}${disabled?' disabled':''}${placeholder?` placeholder="${esc(placeholder)}"`:''}>${help?`<small>${esc(help)}</small>`:''}</div>`;
}
function select(id,label,value,options,disabled=false) {
  return `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}"${disabled?' disabled':''}>${options.map(([v,t])=>`<option value="${esc(v)}"${String(value??'')===String(v)?' selected':''}>${esc(t)}</option>`).join('')}</select></div>`;
}
function radio(id,label,value,options,disabled=false) {
  return `<fieldset class="radio-group"><legend>${esc(label)}</legend><div class="radio-options">${options.map(([v,t])=>`<label><input type="radio" name="${id}" value="${v}"${value===v?' checked':''}${disabled?' disabled':''}>${esc(t)}</label>`).join('')}</div></fieldset>`;
}
function checkbox(id,label,checked,disabled=false) {return `<label class="checkbox"><input type="checkbox" id="${id}"${checked?' checked':''}${disabled?' disabled':''}><span>${esc(label)}</span></label>`;}
function details(id,label,body,open=false) {return `<details id="${id}"${open?' open':''}><summary>${esc(label)}</summary><div class="details-body">${body}</div></details>`;}
function metric(label,value,dark=false) {return `<div class="metric${dark?' dark':''}" data-metric="${esc(label)}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`;}
function table(headers,rows) {return `<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function intro(n,title,description,requirements=[]) {return `<div class="stage-kicker">STEP ${String(n).padStart(2,'0')} / 06</div><h2 id="stage-title" tabindex="-1">${esc(title)}</h2><p class="stage-description">${esc(description)}</p>${requirements.length?`<div class="requirements"><h4>What you need</h4><ul>${requirements.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></div>`:''}`;}
function navigate(number,label,blocked=false) {return `<div class="navigation">${number>1?`<button class="button" data-step="${number-1}">Back</button>`:'<span></span>'}${number<6?`<button class="button primary" id="next_${number}" data-next="${number+1}"${blocked?' disabled':''}>${esc(label)}</button>`:''}</div>`;}
function stageOne() {return intro(1,'Start with the customer.','Set the context for the whole offer.',[
  'Required: an internal customer label, city and contract term.','This version starts in January 2027 and uses fixed monthly gas blocks.','The exported proposal uses an anonymized estimated operating profile.'])+
  input('customer','Customer — internal label',state.customer,{type:'text',disabled:locked(),help:'This label stays on your device. Customer names are excluded from both PDFs.'})+
  `<div class="grid">${select('city','City',state.city,[['Tulsa','Tulsa'],['Omaha','Omaha'],['Columbus','Columbus, Ohio']],locked())}${select('term','Term',state.term,[[12,'12 months'],[24,'24 months']],locked())}</div>`+
  (locked()?notice('The saved contract context is locked. Choose New offer to change the customer, city or term.'):'')+
  `<div id="customer-status">${!state.customer.trim()?notice('Enter a customer label to continue. It will remain internal.','warn'):''}</div>`+navigate(1,'Continue to gas use & weather',!state.customer.trim());}
function stageTwo(d) {const hdd=d.case?sum(d.case.reference_hdd.slice(0,12)):null;return intro(2,'Understand the gas demand.','Separate the annual gas estimate from the weather assumption.',[
 'Required: a positive annual gas quantity in MMBtu, not annual dollar spend.','Choose the estimated benchmark or enter a customer annual total from billing records.','More HDD means greater heating demand; it is not a temperature percentage.'])+
 radio('demand_basis','Annual gas input basis',state.demand_basis,[['benchmark','Estimated benchmark'],['user_total','User-entered annual total']],locked())+
 input('annual_gas','Reference annual gas (MMBtu)',state.annual_gas,{min:1,max:1e9,step:100,disabled:locked()||state.demand_basis==='benchmark'})+
 caption('The sourced benchmark stays at 6,100 MMBtu. A custom annual total still uses an estimated seasonal profile until checked against customer records.')+
 details('demand-help','What would make the demand estimate more reliable?',`<p>Use monthly customer bills with billing dates and matching weather, ideally covering two or more years. Check forecast errors on months held out of the model. An annual total alone cannot validate the seasonal split.</p>${caption('Customer demand validation is pending. No forecasting accuracy or regression score is claimed.')}`)+
 `<div class="field"><label class="slider-label" for="weather_pct"><span>Assumed HDD change (%)</span><output id="weather-output" for="weather_pct">${state.weather_pct>0?'+':''}${state.weather_pct}%</output></label><input id="weather_pct" type="range" min="-100" max="100" step="5" value="${state.weather_pct}"><div class="slider-limits"><span>−100%</span><span>Historical reference</span><span>+100%</span></div></div>`+
 notice(`${state.city} reference: ${number(hdd,1)} HDD/year. The model holds 60% of gas steady and varies the 40% heating portion with HDD.`)+
 caption(locked()?'Only modeled usage changes in a saved-offer stress test. Agreed blocks and price stay fixed.':'A new offer updates gas blocks and monthly price weights automatically when you change weather.')+
 `<div id="demand-errors">${d.errors.map(t=>notice(t,'error')).join('')}</div>`+navigate(2,'Continue to market prices',!!d.errors.length);}
function stageThree(d) {
 const m=d.market??marketState(d.case), c=d.commercial??commercialState();
 const curve=m.curve??[];const missing=curve.filter(r=>r.forward_usd_mmbtu==null||r.basis_usd_mmbtu==null).length;
 return intro(3,'Match the market to the term.','Use one consistent market snapshot for the delivery period.',[
  'To calculate a full-term price: Henry Hub and matching regional basis for every delivery month, in USD/MMBtu.','Record the valuation date and source. The regional index must match the actual supply route.','Other cities and 2028 need their own prices. Missing prices may stay pending.'])+
 (state.city==='Tulsa'?notice('Bundled Tulsa 2027 reference: dated October 29, 2026. Indicative archive, not an executable quote. 2028 remains blank.')+caption('Regional basis is a delivery-route proxy. Its date was corroborated against dated seasonal averages; the monthly file does not print a valuation date. The factory delivery route remains unconfirmed.'):notice(`${state.city} weather is available. Enter a separately sourced regional market curve to calculate its price.`))+
 `<div class="file-row"><div class="field"><label for="curve-upload">Upload a market curve (CSV)</label><input type="file" id="curve-upload" accept=".csv,text/csv"${locked()?' disabled':''}><small>Columns: month, forward_usd_mmbtu, basis_usd_mmbtu. Maximum 2 MB.</small></div><button class="button" id="curve-template">Download curve template</button></div>`+
 `<div class="table-wrap"><table class="curve-table"><thead><tr><th>Delivery month</th><th>Henry Hub ($/MMBtu)</th><th>Regional basis ($/MMBtu)</th></tr></thead><tbody>${curve.map((r,i)=>`<tr><td>${esc(r.month)}</td><td><input type="number" step="any" id="forward_${i}" aria-label="Henry Hub ${esc(r.month)}" data-curve="${i}" data-column="forward_usd_mmbtu" value="${esc(r.forward_usd_mmbtu)}"${locked()?' disabled':''}></td><td><input type="number" step="any" id="basis_${i}" aria-label="Regional basis ${esc(r.month)}" data-curve="${i}" data-column="basis_usd_mmbtu" value="${esc(r.basis_usd_mmbtu)}"${locked()?' disabled':''}></td></tr>`).join('')}</tbody></table></div>`+
 input('market_source','Market source / reference (internal only)',m.source,{type:'text',disabled:locked()})+
 input('market_date','User-entered curve date (YYYY-MM-DD; optional)',m.date,{type:'text',disabled:locked(),placeholder:'YYYY-MM-DD'})+
 `<div id="market-status">${marketStatus(d)}</div>`+
 details('commercial-details','Commercial details — needed before an offer can be reviewed',
  input('delivery_point','Delivery point / regional index (internal only)',c.delivery_point,{type:'text',disabled:locked()})+
  input('quote_valid_until','Quote valid until',c.quote_valid_until,{type:'date',disabled:locked()})+
  checkbox('delivery_confirmed','Delivery route and regional index confirmed',c.delivery_confirmed,locked()||!c.delivery_point?.trim())+
  caption('Keep the route and index consistent with the curve. Both PDFs omit the private route and source notes; only confirmation status and the validity date are exported.'))+
 navigate(3,missing?'Continue with prices pending':'Continue to supplier costs',!!d.market_error||!!d.errors.length);
}
function stageFour(d) {
 const offer=d.offer,costs=locked()?offer?.costs:state.costs, payment=locked()?offer?.financial_terms??{}:state;
 let fields='';
 if(locked()) {
  fields=notice('Pricing uses the saved offer’s original cost inputs and payment terms.')+table(['Saved cost assumption','Value'],[
   ['Target margin',money(offer?.margin)],['Fuel percentage',costs?.fuel_pct==null?'Pending':number(costs.fuel_pct,1)+'%'],
   ['Fuel calculation basis',{receipts:'% of receipts',customer:'% of customer deliveries'}[costs?.fuel_basis]??'Pending'],
   ...Object.entries(costNames).map(([k,label])=>[label,money(costs?.[k])])]);
 } else fields=input('margin','Target margin (USD/MMBtu)',state.margin,{min:0,max:100,step:.01})+
  `<div class="grid">${input('fuel_pct','Fuel (%)',costs.fuel_pct,{min:0,max:99,step:.1})}${select('fuel_basis','Fuel calculation basis',costs.fuel_basis,[['','Pending'],['receipts','% of receipts'],['customer','% of customer deliveries']])}</div>`+
  caption('Receipts: buy q/(1−f). Customer deliveries: buy q×(1+f). Use the percentage and convention from the supply/service terms.')+
  `<div class="grid">${Object.entries(costNames).map(([k,label])=>input(k,label+' (USD/MMBtu)',costs[k],{min:0,max:1000,step:.01})).join('')}</div>`;
 const pending=Object.values(costs??{}).some(v=>v==null);
 return intro(4,'Build the supplier cost stack.','Make every allowance visible before the estimate is treated as complete.',[
  'To complete costs: fuel percentage and convention, supplier fee, financing, residual risk and credit allowance.','Enter allowances in USD per customer-block MMBtu. Target margin is separate.','Blank means pending. Enter zero only when you deliberately assume no charge.'])+fields+
 `<div id="cost-status">${pending?notice('Some supplier costs are pending. Continuing will produce a partial estimate until they are supplied.'):''}</div>`+
 '<h3>When does the money move?</h3>'+caption('Assume both invoices are issued at the end of each delivery month. Enter the agreed days after that date. Leave unknown terms blank.')+
 (locked()?table(['Saved payment terms','Days after month-end invoice'],[['Customer pays',number(payment.customer_days,0)],['Supplier is paid',number(payment.supplier_days,0)]]):`<div class="grid">${input('customer_days','Customer pays after invoice (days)',state.customer_days,{min:0,max:365,step:1})}${input('supplier_days','Supplier is paid after invoice (days)',state.supplier_days,{min:0,max:365,step:1})}</div>`)+
 `<div id="cost-errors">${d.errors.map(t=>notice(t,'error')).join('')}</div>`+navigate(4,pending?'Continue with costs pending':'Continue to credit',!!d.errors.length);
}
function creditSummary(credit) {return table(['Ratio','Value','Points'],Object.entries(ratioFields).map(([k,label])=>[label,credit.ratios[k]==null?'Pending / N/M':number(credit.ratios[k],2)+'×',credit.metric_scores[k]==null?'Pending':credit.metric_scores[k]+' / 2']))+
 `<div class="metrics">${metric('Credit score',credit.score==null?'Pending':credit.score+' / 6')}</div>`+
 notice(credit.collateral_required?credit.collateral_policy:'Ratio screen passes. Confirm the approved unsecured limit and exposure-based payment protection in the review.',credit.collateral_required?'warn':'success')+
 (credit.review_flags?.length?details('credit-flags','Items requiring review',`<ul>${credit.review_flags.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`):'');}
function stageFive(d) {
 const credit=d.credit;
 return intro(5,'Check payment protection.','Use financial evidence to decide whether collateral or prepayment is required.',[
  'Use financial statement amounts or the three financial ratios.','Use a consistent currency/unit and the same annual period for EBITDA, EBIT and interest.','No statements yet? Continue with credit pending; payment protection remains required.'])+
 radio('credit_format','Financial inputs',state.credit_format,[['amounts','Financial statement amounts'],['ratios','Enter ratios']])+
 `<div class="grid three">${Object.entries(state.credit_format==='amounts'?amountFields:ratioFields).map(([k,label])=>input(k,label,state.credit_format==='amounts'?state.amounts[k]:state.ratios[k],{step:state.credit_format==='amounts'?1000:.1})).join('')}</div>`+
 `<div id="credit-summary">${creditSummary(credit)}</div>`+
 details('credit-policy','How the ratio screen works',table(['Metric','0 points','1 point','2 points'],[
  ['Current ratio','< 1','1 to < 1.5','≥ 1.5'],['Debt / EBITDA','> 4','> 2 to 4','≤ 2'],['EBIT / interest','< 2','2 to < 4','≥ 4']])+
  caption('Only 6/6 with no review flags passes this conservative analyst-selected ratio screen. This is not an empirical rating or probability of default. The score determines neither a default premium nor a collateral amount.'))+
 details('exposure-panel','Estimate the amount needing payment protection',caption('Use an approved unsecured limit, not one inferred from the score. Include separately estimated unbilled or close-out exposure. Blank means pending; zero is deliberate.')+
  `<div class="grid">${input('unsecured_limit','Approved unsecured limit (USD)',state.unsecured_limit,{min:0,step:100})}${input('additional_exposure','Additional exposure estimate (USD)',state.additional_exposure,{min:0,step:100})}</div>`+
  caption('An unsecured limit is permitted only with a 6/6 score and no flags. Otherwise the modeled permitted limit is zero. This estimates a coverage gap; it does not approve collateral.'))+
 checkbox('credit_reviewed','Financials and payment protection reviewed',state.credit_reviewed,credit.score==null)+
 `<div id="credit-errors">${d.errors.map(t=>notice(t,'error')).join('')}</div>`+navigate(5,credit.score==null?'Review with credit pending':'Review the offer',!!d.errors.length);
}
function profileChart(offer) {
 const rows=offer.months,max=Math.max(1,...rows.flatMap(x=>[x.block_mmbtu,x.modeled_use_mmbtu])),w=800,h=240,pad=38,bar=(w-pad*2)/rows.length;
 let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Monthly proposed or agreed gas blocks compared with modeled usage"><line x1="${pad}" y1="${h-32}" x2="${w-10}" y2="${h-32}" stroke="#e6e8eb"/>`;
 for(let t=0;t<4;t++){let y=h-32-t*(h-60)/3;svg+=`<text x="${pad-7}" y="${y+3}" text-anchor="end" font-size="10" fill="#7b838c">${Math.round(max*t/3)}</text>`;}
 rows.forEach((r,i)=>{const x=pad+i*bar;for(const [j,key,color]of [[0,'block_mmbtu','#b3202f'],[1,'modeled_use_mmbtu','#8b939c']]){const height=r[key]/max*(h-60);svg+=`<rect x="${x+bar*.12+j*bar*.36}" y="${h-32-height}" width="${Math.max(2,bar*.31)}" height="${height}" rx="2" fill="${color}"><title>${esc(r.month)}: ${number(r[key],1)} MMBtu</title></rect>`;}if(rows.length===12||i%2===0)svg+=`<text x="${x+bar*.48}" y="${h-11}" text-anchor="middle" fill="#7b838c" font-size="9">${esc(r.month.slice(2))}</text>`;});
 return `<div class="chart">${svg}</svg><div class="chart-legend"><span>${locked()?'Agreed':'Proposed'} blocks</span><span>Modeled usage</span></div></div>`;
}
function riskChart(risk) {
 const rows=risk.histogram??[];if(!rows.length)return '';
 const w=800,h=240,pad=40,bw=(w-pad*2)/rows.length,max=Math.max(1,...rows.flatMap(r=>[r.matched_count,r.unhedged_count]));
 let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Distribution of shortfall: matched hedge loss is zero; unhedged commodity shortfall varies"><line x1="${pad}" y1="${h-35}" x2="${w-12}" y2="${h-35}" stroke="#e6e8eb"/>`;
 rows.forEach((r,i)=>{for(const[key,color]of [['unhedged_count','#d9342b'],['matched_count','#12a878']]){const height=r[key]/max*(h-65);svg+=`<rect x="${pad+i*bw}" y="${h-35-height}" width="${Math.max(2,bw-1)}" height="${height}" fill="${color}" opacity=".75"><title>${key==='matched_count'?'Matched hedges':'Without hedges'}: ${money(r.start,0)} to ${money(r.end,0)}, ${number(r[key]/risk.n_sims*100,1)}% of draws</title></rect>`;}});
 const last=rows.at(-1);svg+=`<text x="${pad}" y="${h-13}" fill="#7b838c" font-size="10">$0</text><text x="${w-15}" y="${h-13}" text-anchor="end" fill="#7b838c" font-size="10">${money(last.end,0)}</text>`;
 return `<div class="chart">${svg}</svg><div class="chart-legend risk"><span>Matched hedges</span><span>Without hedges</span></div></div>`;
}
const signed = (value,d=4) => value == null || !Number.isFinite(Number(value)) ? 'Pending' : (value<0?'−':'')+money(Math.abs(value),d);
const shortLabels = {credit_allowance:'Credit',residual_risk:'Residual risk'};
function priceBuildChart(build) {
 const bars=priceBuildBars(build),levels=bars.flatMap(b=>[b.from,b.to]),w=800,h=300,left=56,right=12,top=40,bottom=58;
 const hi0=Math.max(0,...levels),lo0=Math.min(0,...levels),span=(hi0-lo0)||1,hi=hi0+span*.06,lo=lo0<0?lo0-span*.06:0;
 const y=v=>top+(hi-v)/(hi-lo)*(h-top-bottom),slot=(w-left-right)/bars.length,bw=slot*.62;
 let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Price build in dollars per MMBtu, from Henry Hub to ${esc(build.total_label)}. The same numbers are in the table below."><defs><pattern id="pb-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#f1f3f5"/><line x1="0" y1="0" x2="0" y2="7" stroke="#8b939c" stroke-width="2.4"/></pattern></defs>`;
 for(let t=0;t<=4;t++){const v=lo+(hi-lo)*t/4,gy=y(v);svg+=`<line x1="${left}" y1="${gy}" x2="${w-right}" y2="${gy}" stroke="${t===0?'#d8dde2':'#eceff2'}"/><text x="${left-8}" y="${gy+3.5}" text-anchor="end" font-size="10" fill="#7b838c">${v<0?'−':''}$${Math.abs(v).toFixed(2)}</text>`;}
 if(lo<0)svg+=`<line x1="${left}" y1="${y(0)}" x2="${w-right}" y2="${y(0)}" stroke="#7b838c" stroke-dasharray="3 3"/>`;
 let previous=null;
 bars.forEach((b,i)=>{
  const x=left+i*slot+(slot-bw)/2,cx=x+bw/2;
  if(previous!==null&&!b.total)svg+=`<line x1="${x-(slot-bw)}" y1="${y(previous)}" x2="${x}" y2="${y(previous)}" stroke="#c4cbd2" stroke-dasharray="2 3"/>`;
  let yTop,height,fill,label;
  if(b.pending){const level=b.total?0:b.from;yTop=y(level)-9;height=18;fill='url(#pb-hatch)';label='Pending';}
  else{yTop=y(Math.max(b.from,b.to));height=Math.max(2,Math.abs(y(b.from)-y(b.to)));fill=b.total?'#16191c':b.key==='margin'?'#12a878':b.value<0?'#f08a3c':'#2f6f8f';label=signed(b.value);}
  const title=`${b.label}: ${b.pending?'Pending':signed(b.value)} per MMBtu`;
  svg+=`<rect x="${x}" y="${yTop}" width="${bw}" height="${height}" rx="4" fill="${fill}"${b.pending?' stroke="#8b939c" stroke-dasharray="3 2"':''}><title>${esc(title)}</title></rect><text x="${cx}" y="${yTop-7}" text-anchor="middle" font-size="11" font-weight="${b.total?700:500}" fill="${b.pending?'#7b838c':'#1c2024'}">${esc(label)}</text>`;
  const name=b.total?b.label:shortLabels[b.key]??b.label,parts=name.length>10&&name.includes(' ')?[name.slice(0,name.indexOf(' ')),name.slice(name.indexOf(' ')+1)]:[name];
  svg+=`<text x="${cx}" y="${h-bottom+18}" text-anchor="middle" font-size="10.5" fill="${b.total?'#1c2024':'#4a525b'}" font-weight="${b.total?700:400}">${parts.map((t,j)=>`<tspan x="${cx}" dy="${j?12:0}">${esc(t)}</tspan>`).join('')}</text>`;
  if(!b.pending)previous=b.to;
 });
 return `${svg}</svg>`;
}
function priceBuildPanel(o) {
 const build=priceBuild(o),total=build.total;
 const rows=[...build.steps.map(s=>[s.label,s.pending?'Pending':signed(s.value)]),[build.total_label,total===null?'Pending':money(total)]];
 return `<section class="price-build" aria-labelledby="price-build-title"><div class="pb-head"><div><div class="section-label">PRICE BUILD</div><h3 id="price-build-title">How the offer price is built</h3></div><div class="pb-total"><b>${esc(total===null?'Pending':money(total))}</b><span>${esc(build.total_label)} · $/MMBtu</span></div></div>`+
  `<div class="chart pb-chart">${priceBuildChart(build)}<div class="pb-legend"><span class="up">Adds to price</span><span class="down">Reduces price</span><span class="margin">Margin</span><span class="pending">Pending</span><span class="total">${esc(build.total_label)}</span></div></div>`+
  table(['Component','USD/MMBtu'],rows)+
  caption('Henry Hub and regional basis are weighted by the proposed monthly blocks, as in the offer price. A negative component pulls the price down. Pending items are not counted, so the last bar is a subtotal until every cost is supplied.')+`</section>`;
}
function offerPanel(d) {
 const o=d.offer,blocks=locked()?'Agreed blocks':'Proposed blocks';return `<h3>${locked()?'Existing offer stress test':'Proposed offer'}</h3>`+
 (locked()?notice(state.frozen_explicit?'Using the saved offer.':'Using the original reference offer: historical reference weather, $0.20 margin and costs pending. Save a new offer to test different agreed terms.'):'')+
 `<div class="metrics three">${metric(d.price_status+' ($/MMBtu)',money(o.fixed_price),true)}${metric(blocks+' (MMBtu)',number(o.volume,1))}${metric('Modeled usage (MMBtu)',number(o.expected_usage,1))}</div>`+
 (o.missing_inputs.length?notice('Pending: '+o.missing_inputs.map(k=>missingNames[k]??'Required input').join(', ')+'. This is not a complete supplier quote.','warn'):'')+
 `<div class="metrics">${metric('Fixed-block subtotal',money(o.block_value,2))}${metric('Target contribution before unmodeled costs',money(o.contribution,2))}</div>`+
 caption('The customer bill also includes indexed monthly deviations. Target contribution is not net profit. Transport and taxes are not included.')+
 table(['Component','USD/MMBtu'],[['Weighted Henry Hub + basis',money(o.commodity)],['Procurement fuel',money(o.fuel_adder)],...Object.entries(costNames).map(([k,v])=>[v,money(o.costs[k])]),['Target margin',money(o.margin)]])+
 priceBuildPanel(o)+
 '<h3>Monthly gas profile</h3>'+profileChart(o)+
 (!locked()?'<button class="button" id="freeze-offer">Use this offer for stress test</button>'+caption('This stores the price, monthly blocks, cost assumptions and payment terms. Then select “Test existing offer”.'):
 `<div class="metrics">${metric('Illustrative indexed deviation settlement',money(o.deviation_value,2))}</div>`+caption('Uses the saved monthly reference indices for this example. Future actual index prices are not known.'));
}
function financialPanel(d) {
 const f=d.financials;
 return '<h3>Can this agreement fund itself?</h3><p>A simple budget shows what the agreement earns and when cash is needed. Complete costs in step 4 before treating the figures as a full estimate.</p>'+
 `<div class="metrics">${metric('Budgeted revenue',money(f.revenue,2))}${metric('Budgeted supplier costs',money(f.cost,2))}${metric('Budgeted contribution',money(f.contribution,2))}${metric('Peak operating cash needed',money(f.operating_funding,2))}</div>`+
 caption('Break-even fixed-block price: '+money(f.break_even_price)+'/MMBtu. Contribution is before overhead, taxes and costs outside this budget.')+
 (f.revenue==null?notice('Complete the monthly market curve and all supplier cost assumptions to calculate this financial plan. Unknown amounts stay Pending.'):f.operating_funding==null?notice('Enter both payment terms in step 4 to calculate cash timing.'):'')+
 table(['Delivery month','Revenue','Budgeted costs','Contribution'],f.months.map(r=>[r.month,money(r.revenue,2),money(r.total_cost,2),money(r.contribution,2)]))+
 details('cash-panel','Cash timing and a late-payment check',`<div class="field"><label class="slider-label" for="payment_delay_days"><span>Extra customer payment delay (days)</span><output id="delay-output" for="payment_delay_days">${state.payment_delay_days} days</output></label><input id="payment_delay_days" type="range" min="0" max="90" step="5" value="${state.payment_delay_days}"></div><div class="metrics">${metric('Peak operating cash with this delay',money(f.delayed_funding,2))}</div>`+
 caption('This delays collections only. It does not change the price, blocks or hedge plan. The cash table below shows original payment timing, including collections after delivery ends.')+
 (f.cash_months.length?table(['Cash month','Cash in','Cash out','Net cash','Closing cash'],f.cash_months.map(r=>[r.month,money(r.cash_in,2),money(r.cash_out,2),money(r.net_cash,2),money(r.closing_cash,2)])):caption('Cash schedule: Pending.')))+
 caption('The budget uses supplied per-MMBtu allowances, including financing and risk reserves; it does not infer actual expenses. Reference hedge settlements are zero at the entered indices. Daily hedge collateral, default losses and other unmodeled cash needs are excluded.');
}
function hedgePanel(d) {
 const o=d.offer,r=d.risk;
 return '<h3>Hedge the two price components</h3><p>Henry Hub and regional basis each cover the same gas quantity. Adding the two legs would double-count the gas.</p>'+
 caption(o.costs.fuel_pct==null||o.costs.fuel_basis==null?'Schedule covers customer blocks. Additional procurement fuel quantity is pending.':'Both hedge legs include the supplied fuel convention. The check below covers customer-block base commodity only.')+
 table(['Month','Customer blocks','HH hedge MMBtu','Basis hedge MMBtu','HH $/MMBtu','Basis $/MMBtu'],o.months.map(m=>[m.month,number(m.block_mmbtu),number(m.hh_hedge_mmbtu),number(m.basis_hedge_mmbtu),money(m.hh_reference),money(m.basis_reference)]))+
 caption('A proposed volume plan, not exchange orders. Instrument availability, lot sizes and execution require separate review.')+
 '<h3>Monthly hedge check</h3>'+
 (r.available?`<div class="metrics three">${metric('Matched monthly P95 loss',money(r.loss_p95,2))}${metric('Component premium ($/MMBtu)',money(r.risk_premium))}${metric('Without hedges: P95 shortfall',money(r.unhedged_loss_p95,2))}</div>`+riskChart(r)+
 caption(`${number(r.n_sims,0)} seeded draws from ${r.n_unique_years} paired historical years. Matched monthly loss is exactly zero in this model.`)+
 '<p>“Loss” means deterioration from baseline gross commodity contribution. Matched indexed customer deviations and both hedge legs cancel monthly commodity exposure. The unhedged comparison shows why hedging matters.</p>':notice('Risk results pending: a complete monthly Henry Hub and regional basis curve is required.'))+
 notice('This component’s zero premium does not make total supplier risk zero. Daily/monthly mismatch, fuel, execution, financing and customer default remain outside the simulation.','warn')+
 caption('Paired whole-year HDD and Henry Hub spot anomalies are centered on the entered curve; regional basis is fixed. Nine or ten past years are a scenario exercise, not a validated future 95% tail forecast. A 24-month term independently resamples each year.')+
 caption('Component premium = P95 loss ÷ customer blocks. Any residual or credit allowance is a separate user assumption. The browser evaluates the same 100,000 fixed-seed historical draws using their repeated year-combination counts.');
}
function creditPanel(d) {
 const c=d.credit,f=d.financials;
 return `<div class="metrics">${metric('Credit score',c.score==null?'Pending':c.score+' / 6')}</div>`+
 `<p>${esc(c.collateral_required?c.collateral_policy:'Ratio screen passes. The permitted unsecured limit and estimated protection gap still need review.')}</p>`+
 caption('Return to step 5 to edit the financial inputs. The score does not determine a default premium or collateral amount.')+
 `<div class="metrics">${metric('Peak billed receivables',money(f.peak_receivables,2))}${metric('Estimated protection gap',money(f.protection_gap,2))}</div>`+
 caption('Exposure = peak billed receivables + your additional exposure estimate. Protection gap = exposure minus the permitted unsecured limit, floored at zero. This is an estimate to review, not an approved collateral demand.')+
 caption('Exposure uses original payment timing. The delay slider is a separate funding check.')+
 `<p>Additional exposure: ${esc(money(state.additional_exposure,2))} · Permitted unsecured limit: ${esc(money(f.effective_unsecured_limit,2))}</p>`+
 (state.additional_exposure==null?notice('Enter an additional exposure estimate in step 5, including zero only if deliberate. Unbilled supply and close-out exposure are not inferred from the score.'):'');
}
function sourcesPanel(d) {
 const p=data.provenance.cities[state.city], c=d.case;
 return `<h3>Evidence behind the estimate</h3><p>NOAA station ${esc(p.station)}; paired complete years: ${c.source_years.join(', ')}.</p>`+
 (state.city==='Tulsa'?caption('2022 is excluded because March carried a quality flag; complete years stay together in the simulation.'):'')+
 `<p>Historical reference: ${number(sum(c.reference_hdd.slice(0,12)),1)} HDD/year. This is the selected historical cohort, not the 1991–2020 climate normal or a forecast for 2027.</p>`+
 caption('HDD use a 65°F base. Warmer years need less space heating. Production gas is held steady in this estimated profile.')+
 '<p>Demand starts from a selected public manufacturing energy-assessment benchmark: 6,100 MMBtu/year, split 60% steady and 40% weather-sensitive. Customer meter records have not been supplied. This is not a representative regional average.</p>'+
 caption('Omaha and Columbus use the same estimated annual benchmark with their own seasonal weather. Actual monthly bills are needed for calibration; no fitted accuracy or R² is claimed.')+
 '<p><a href="https://www.ncei.noaa.gov/access/services/data/v1" target="_blank" rel="noopener">NOAA data service</a> · <a href="https://www.eia.gov/dnav/ng/hist/rngwhhdm.htm" target="_blank" rel="noopener">EIA Henry Hub history</a></p>'+
 caption('Historical references are bundled. There are no live pricing requests. Refresh the archive and confirm source/data-use rights before a commercial quote.')+
 details('calculation-trail','Calculation trail','<p>Monthly gas = steady gas + reference heating gas × (1 + HDD adjustment).</p><p>Subtotal = weighted monthly commodity + known fuel/cost allowances + target margin. Fixed-block value = subtotal × customer blocks.</p>'+caption('Fuel on receipts: gross = q/(1−f). Fuel on customer deliveries: gross = q×(1+f). Transport, taxes and omitted costs stay outside this supplier subtotal.'));
}
function stageSix(d) {
 if(!d.offer||d.errors.length)return intro(6,'Check the inputs.','Correct the highlighted values before reviewing this estimate.')+d.errors.map(t=>notice(t,'error')).join('')+navigate(6,'');
 const status=[['Customer context',state.customer.trim()?'Set':'Pending'],['Gas use & weather','Estimated profile'],['Monthly market curve',d.offer.commodity==null?'Pending':'Available'],['Supplier cost inputs',d.readiness.cost_complete?'Cost assumptions complete':'Pending'],
  ...[['market_dated','Market valuation date'],['delivery_confirmed','Delivery route / index confirmation'],['quote_valid','Quote validity'],['payment_terms','Payment timing'],['credit_reviewed','Financial / protection review']].map(([k,label])=>[label,d.readiness[k]?'Recorded':'Pending'])];
 const panels={'Offer':offerPanel,'Financial plan':financialPanel,'Hedge & risk':hedgePanel,'Credit summary':creditPanel,'Sources':sourcesPanel};
 return intro(6,'See the offer. Know what comes next.','Review the estimate, the hedge and the open items before sharing.')+
 details('readiness-panel','Review input status and outstanding items',table(['Review item','Status'],status)+caption('Complete cost assumptions do not make a firm quote. Customer demand is still estimated, not validated against monthly bills.'))+
 `<div class="tabs" role="tablist" aria-label="Review sections">${Object.keys(panels).map(t=>`<button id="tab-${t.replace(/\W/g,'')}" role="tab" data-tab="${esc(t)}" aria-selected="${state.tab===t}" aria-controls="review-panel">${esc(t)}</button>`).join('')}</div>`+
 `<section class="tab-panel" role="tabpanel" id="review-panel" aria-labelledby="tab-${state.tab.replace(/\W/g,'')}">${panels[state.tab](d)}</section>`+
 `<div class="proposal-panel"><div class="section-label">YOUR PROPOSAL</div><h3>The right detail for each reader.</h3><p>The customer proposal shows the offer and its conditions. The internal review adds costs, financial planning, hedges and credit. Both omit names and private source notes.</p><div class="button-row"><button class="button primary" id="download-customer">Download customer proposal</button><button class="button" id="download-internal">Download internal financial review</button></div><div id="download-status" class="caption" role="status"></div><div class="book-save"><h3>Keep this offer</h3><p>Save a snapshot to the offer book to compare it with other offers.</p><div class="button-row"><button class="button" id="save-book"${locked()?' disabled':''}>Save to offer book</button></div>${locked()?caption('Choose New offer to save. A saved stress test is not added to the book.'):''}<div id="book-status" role="status">${bookStatus()}</div></div></div>`+
 `<div class="navigation"><button class="button" data-step="5">Back to credit</button></div>`;
}
/* Offer book: in-memory only, like the rest of the page session. */
let bookSeq=0;
function captureInputs() {
 const m=marketState(current.case),c=commercialState();
 return {customer:state.customer,city:state.city,term:state.term,demand_basis:state.demand_basis,annual_gas:state.annual_gas,weather_pct:state.weather_pct,margin:state.margin,
  costs:clone(state.costs),customer_days:state.customer_days,supplier_days:state.supplier_days,credit_format:state.credit_format,amounts:clone(state.amounts),ratios:clone(state.ratios),
  unsecured_limit:state.unsecured_limit,additional_exposure:state.additional_exposure,credit_reviewed:state.credit_reviewed,payment_delay_days:state.payment_delay_days,
  curve:clone(m.curve),market_source:m.source,market_date:m.date,commercial:clone(c)};
}
function saveToBook(mode) {
 if(locked()||!current.offer||current.errors.length)return;
 const inputs=captureInputs(),key=inputs.customer.trim().toLowerCase();
 const index=state.book.findIndex(e=>e.row.customer.trim().toLowerCase()===key);
 if(index>=0&&!mode){state.book_prompt=true;state.book_msg='';render();return;}
 let entry;
 try{entry=makeEntry(data,inputs,{id:`offer-${++bookSeq}`});}
 catch(error){state.book_prompt=false;state.book_msg='Could not save: '+error.message;render();return;}
 if(index>=0&&mode==='replace')state.book[index]=entry;else state.book.push(entry);
 state.book_prompt=false;state.book_msg=`${mode==='replace'?'Replaced':'Saved'} “${inputs.customer}” in the offer book (${state.book.length} ${state.book.length===1?'offer':'offers'}).`;
 render();
}
function bookStatus() {
 if(state.book_prompt)return `<div class="notice warn" role="alert">An offer for “${esc(state.customer.trim())}” is already in the offer book. Replace it, or add this as a new row?<div class="button-row"><button class="button primary" id="book-replace">Replace</button><button class="button" id="book-add">Add as new row</button><button class="button" id="book-cancel">Cancel</button></div></div>`;
 return state.book_msg?notice(state.book_msg,state.book_msg.startsWith('Could not')?'error':'success'):'';
}
function reopenEntry(entry) {
 const i=clone(entry.inputs);
 Object.assign(state,{mode:'new',customer:i.customer,city:i.city,term:i.term,demand_basis:i.demand_basis,annual_gas:i.annual_gas,weather_pct:i.weather_pct,margin:i.margin,costs:i.costs,
  customer_days:i.customer_days,supplier_days:i.supplier_days,credit_format:i.credit_format,amounts:i.amounts,ratios:i.ratios,unsecured_limit:i.unsecured_limit,
  additional_exposure:i.additional_exposure,credit_reviewed:i.credit_reviewed,payment_delay_days:i.payment_delay_days});
 state.curves[`${i.city}_${i.term}`]={curve:i.curve??clone(loadCase(data,i.city,i.term).market_curve),source:i.market_source??'',date:i.market_date??''};
 state.commercial[`${i.customer}|${i.city}|${i.term}`]=clone(i.commercial);
 state.context_version++;state.upload_error='';state.view='build';state.step=6;state.furthest=6;state.tab='Offer';state.book_msg='';state.book_prompt=false;
 state.notice=`Reopened “${i.customer}” from the offer book.`;
 render({focusHeading:true});
}
function bookView() {
 const t=totals(state.book),examples=state.book.some(e=>e.example);
 const card=(label,x,format,dark=false)=>`<div class="metric${dark?' dark':''}" data-metric="${esc(label)}"><div class="label">${esc(label)}</div><div class="value">${esc(x.value===null?'Pending':format(x.value))}</div>${x.pending?`<div class="sub">${x.pending} of ${x.count} offers incomplete</div>`:''}</div>`;
 const cell=(x,format)=>x.value===null?'Pending':format(x.value);
 const rows=state.book.map(e=>{const r=e.row;return `<tr tabindex="0" role="button" data-book-id="${esc(e.id)}" aria-label="Reopen ${esc(r.customer)} in the guided steps"><td>${esc(r.customer)}${e.example?' <span class="tag example">Example</span>':''}</td><td>${esc(r.city==='Columbus'?'Columbus, Ohio':r.city)}</td><td>${r.term} months</td><td class="num">${number(r.annual_mmbtu,1)}</td><td class="num">${r.price===null?'Pending':esc(money(r.price))+(r.price_partial?' <small>Partial subtotal</small>':'')}</td><td class="num">${esc(money(r.margin_total,2))}</td><td class="num">${esc(money(r.margin_per))}</td><td>${esc(r.credit_result??'Pending')}</td><td class="num">${esc(money(r.exposure,2))}</td><td>${esc(r.valid_until??'Pending')}</td><td><button class="button small" data-book-remove="${esc(e.id)}" aria-label="Remove ${esc(r.customer)} from the offer book">Remove</button></td></tr>`;}).join('');
 const head=['Customer label','City','Term','Annual MMBtu','Offer price ($/MMBtu)','Margin ($, full term)','Margin ($/MMBtu)','Credit result','Peak credit exposure ($)','Quote valid until',''];
 const foot=`<tfoot><tr><td>Total (${t.count} ${t.count===1?'offer':'offers'})</td><td></td><td></td><td class="num">${esc(cell(t.annual_mmbtu,v=>number(v,1)))}</td><td></td><td class="num">${esc(cell(t.margin_total,v=>money(v,2)))}</td><td></td><td></td><td class="num">${esc(cell(t.exposure,v=>money(v,2)))}</td><td></td><td></td></tr></tfoot>`;
 return `<div class="stage-kicker">OFFER BOOK</div><h2 id="stage-title" tabindex="-1">Offer book</h2><p class="stage-description">Compare saved offers side by side. Select a row to reopen it in the guided steps.</p>`+
  `<div class="metrics three">${card('Total annual volume (MMBtu)',t.annual_mmbtu,v=>number(v,1),true)}${card('Total margin ($, full term)',t.margin_total,v=>money(v,2))}${card('Total credit exposure ($)',t.exposure,v=>money(v,2))}</div>`+
  (t.incomplete?caption(`${t.incomplete} of ${t.count} offers are incomplete (a Pending value in at least one column). A total that includes a Pending value shows Pending.`):'')+
  `<div class="button-row"><button class="button primary" id="book-csv"${state.book.length?'':' disabled'}>Download book (CSV)</button><button class="button" id="book-monthly-csv"${state.book.length?'':' disabled'}>Download monthly detail (CSV)</button><button class="button" id="book-clear-examples"${examples?'':' disabled'}>Clear examples</button></div>`+
  (examples?notice(EXAMPLE_NOTE):'')+
  (state.book.length?`<div class="table-wrap"><table class="book-table"><thead><tr>${head.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>${foot}</table></div>`:`<div class="empty">The offer book is empty. Finish an offer, then select “Save to offer book” in step 6.</div>`)+
  caption('Margin and exposure are for the full term; annual MMBtu is the proposed blocks per year. The book is kept only for this page session: refreshing resets it.');
}
/* Dashboard shell: navigation, Overview and the Build offer wrapper. */
const ico = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const NAV = [['overview','Overview','M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z'],['build','Build offer','M4 19V9m6 10V5m6 14v-7m6 7H2'],['book','Offer book','M7 3h8l4 4v14H7zM14 3v5h5M10 13h6M10 17h6']];
const share = (part,whole) => part==null||whole==null||!(whole>0)?null:part/whole*100;
const kpi = (label,value,sub,hint,pct) => `<article class="card kpi"><h3>${esc(label)}</h3><div class="v">${esc(value)}</div><p class="sub">${esc(sub)}</p>${meter(pct)}<p class="foot">${esc(hint)}</p></article>`;
const pillClass = status => status==='Pending'?'p-degraded':status==='Estimated profile'?'p-fair':'p-optimal';
function readinessRows(d) {
 const r=d.readiness,o=d.offer;
 return [['Customer context',state.customer.trim()?'Set':'Pending',1],['Gas use & weather','Estimated profile',2],['Monthly market curve',o.commodity==null?'Pending':'Available',3],
  ['Supplier cost inputs',r.cost_complete?'Cost assumptions complete':'Pending',4],['Market valuation date',r.market_dated?'Recorded':'Pending',3],
  ['Delivery route / index confirmation',r.delivery_confirmed?'Recorded':'Pending',3],['Quote validity',r.quote_valid?'Recorded':'Pending',3],
  ['Payment timing',r.payment_terms?'Recorded':'Pending',4],['Financial / protection review',r.credit_reviewed?'Recorded':'Pending',5]];
}
function bookBands() {
 const rows=state.book.map(e=>e.row),n=rows.length;
 if(state.band_mode==='size'){
  const edges=[3000,6000,9000,12000],counts=[0,0,0,0,0];
  rows.forEach(r=>{const i=edges.findIndex(e=>r.annual_mmbtu<e);counts[i<0?4:i]++;});
  return {items:[['XS','Under 3,000'],['S','3,000–5,999'],['M','6,000–8,999'],['L','9,000–11,999'],['XL','12,000+']].map(([name,sub],i)=>({name,sub,value:counts[i]})),
   big:n?Math.round(rows.filter(r=>r.annual_mmbtu>=6000).length/n*100):null,label:'of saved offers are 6,000 MMBtu a year or more',aria:'Saved offers by annual volume'};
 }
 const counts=[0,0,0,0,0],pending=rows.filter(r=>r.credit_score==null).length;
 rows.forEach(r=>{const s=r.credit_score;if(s!=null)counts[s<=1?0:s===2?1:s<=4?2:s===5?3:4]++;});
 return {items:[['Weak','0–1'],['Low','2'],['Fair','3–4'],['Good','5'],['Strong','6']].map(([name,sub],i)=>({name,sub,value:counts[i]})),
  big:n?Math.round(counts[4]/n*100):null,label:`of saved offers pass the ratio screen (6 / 6)${pending?` · ${pending} with credit pending`:''}`,aria:'Saved offers by credit score'};
}
function overviewView(d) {
 const title='<h2 class="sr-only" id="stage-title" tabindex="-1">Overview</h2>';
 if(!d.offer||d.errors.length)return title+notice('Check the inputs before continuing. '+(d.errors[0]??''),'error')+'<button class="btn ghost" data-view="build">Open Build offer</button>';
 const o=d.offer,f=d.financials,c=d.credit,price=o.fixed_price,bands=bookBands(),score=c.score;
 const label=score==null?'':score===6?'PASSES SCREEN':score>=4?'PARTIAL':'WEAK';
 const marginShare=share(o.margin,price),limit=f.effective_unsecured_limit;
 const rows=readinessRows(d).sort((a,b)=>(b[1]==='Pending')-(a[1]==='Pending'));
 const open=rows.filter(r=>r[1]==='Pending').length;
 return title+
  `<p class="note">${ico('M12 8v5m0 3v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z')}<span>Showing the offer from the guided steps: ${esc(state.city==='Columbus'?'Columbus, Ohio':state.city)}, ${state.term} months from Jan 2027, ${state.weather_pct>0?'+':''}${state.weather_pct}% assumed HDD. Estimated operating profile, not a firm quote. Change any input under Build offer.</span></p>`+
  `<div class="dgrid d-top"><article class="card"><h3>Credit screen</h3><p class="sub">Three ratios, 0–2 points each, scored out of 6</p><div class="center">${gauge({value:score,max:6,label,ariaLabel:score==null?'Credit score pending':`Credit score ${score} out of 6`})}</div><p class="foot">${esc(score==null?'Enter financial amounts or ratios in step 5 to score credit.':c.collateral_required?'Payment protection is required under this screen.':'Ratio screen passes; confirm the exposure and unsecured limit.')}</p></article>`+
  `<article class="card"><div class="row"><h3>Saved offers by ${state.band_mode==='size'?'annual volume':'credit score'}</h3><div class="seg" role="group" aria-label="Group saved offers by"><button class="${state.band_mode==='credit'?'on':''}" data-band="credit">Credit</button><button class="${state.band_mode==='size'?'on':''}" data-band="size">Volume</button></div></div>`+
  `<div class="split"><div class="big"><b>${bands.big==null?'—':bands.big}${bands.big==null?'':'<small>%</small>'}</b><span>${esc(bands.label)}</span></div><div>${bandBars(bands.items,bands.aria)}</div></div></article></div>`+
  `<div class="dgrid d-kpi">`+
   kpi(`${d.price_status} ($/MMBtu)`,money(price),o.missing_inputs.length?`${o.missing_inputs.length} inputs pending`:'all cost inputs supplied',marginShare==null?'Complete the market curve to price the offer':`Margin is ${number(marginShare,1)}% of the price`,marginShare)+
   kpi('Proposed blocks (MMBtu)',number(o.volume,1),`modeled usage ${number(o.expected_usage,1)} MMBtu`,`${state.weather_pct>0?'+':''}${state.weather_pct}% assumed HDD versus history`,share(o.expected_usage,o.volume))+
   kpi('Target contribution ($)',money(o.contribution,2),'margin × blocks, before unmodeled costs',`Budgeted contribution: ${money(f.contribution,2)}`,marginShare)+
   kpi('Peak credit exposure ($)',money(f.exposure,2),'peak billed receivables + additional exposure',`Protection gap: ${money(f.protection_gap,2)}`,limit>0?share(f.exposure,limit):null)+
  `</div>`+
  `<article class="card wide"><div class="row"><div><h3>Monthly gas blocks</h3><p class="sub">${locked()?'Agreed':'Proposed'} blocks compared with modeled usage, MMBtu per month</p></div></div>${profileChart(o)}</article>`+
  `<article class="card wide">${priceBuildPanel(o)}</article>`+
  `<article class="card wide"><div class="row"><div><h3>Open items</h3><p class="sub">${open?`${open} items still pending. Pending means unknown, not zero.`:'Every review item is recorded.'}</p></div><button class="btn ghost" data-view="build">Build offer</button></div>`+
  `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Review item</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(([item,status,step])=>`<tr><td>${esc(item)}</td><td><span class="pill ${pillClass(status)}">${esc(status)}</span></td><td class="r"><button class="btn ghost small" data-goto="${step}">Open step ${step}</button></td></tr>`).join('')}</tbody></table></div></article>`;
}
function buildView(d) {
 const stage=[null,stageOne,stageTwo,stageThree,stageFour,stageFive,stageSix][state.step];
 let body;
 try {body=stage(d);} catch(error){body=notice('Check the inputs before continuing. '+error.message,'error')+navigate(state.step,'Continue',true);}
 return `<div class="build-bar card"><fieldset class="purpose"><legend>Purpose</legend><label><input type="radio" name="mode" value="new"${!locked()?' checked':''}>New offer</label><label><input type="radio" name="mode" value="existing"${locked()?' checked':''}>Test existing offer</label></fieldset>`+
  `<nav class="step-nav tabs" aria-label="Input steps">${steps.map((t,i)=>`<button data-step="${i+1}"${state.step===i+1?' aria-current="step"':''}${i+1>state.furthest||(i+1>1&&!state.customer.trim())||(i+1>3&&d.market_error)?' disabled':''}>${String(i+1).padStart(2,'0')} ${esc(t)}</button>`).join('')}</nav>`+
  `<div class="progress-track" role="progressbar" aria-valuemin="1" aria-valuemax="6" aria-valuenow="${state.step}" aria-label="Current step"><div class="progress-fill" style="width:${(state.step-1)*20}%"></div></div></div>`+
  `<section id="stage" class="stage card" aria-labelledby="stage-title" data-step="${state.step}">${state.notice?notice(state.notice,'success'):''}${body}</section>`;
}
let current;
function setView(view) {
 state.view=view;state.notice='';
 if(location.hash!=='#'+view)history.replaceState(null,'','#'+view);
 render({focusHeading:true});
}
function render({focusHeading=false}={}) {
 const opened=[...app.querySelectorAll('details[open]')].map(e=>e.id);
 const active=document.activeElement?.id;
 current=derive();
 if(state.step>1&&!state.customer.trim())state.step=1;
 if(state.step>3&&current.market_error)state.step=3;
 const d=current;
 if(location.hash!=='#'+state.view)history.replaceState(null,'','#'+state.view);
 let view;
 try {view=state.view==='book'?`<section id="stage" class="stage card" aria-labelledby="stage-title" data-step="book">${bookView()}</section>`:state.view==='overview'?overviewView(d):buildView(d);}
 catch(error){view=notice('Check the inputs before continuing. '+error.message,'error');}
 const chips=[state.city==='Columbus'?'Columbus, Ohio':state.city,`${state.term} months · Jan 2027 start`,`${state.weather_pct>0?'+':''}${state.weather_pct}% assumed HDD`,locked()?'Existing offer stress':'New offer','Estimated profile'];
 const pdfOff=!d.snapshot||d.errors.length?' disabled':'';
 app.setAttribute('aria-busy','false');
 app.innerHTML=`<div class="app"><aside class="side"><a class="brand" href="#overview" data-view="overview" aria-label="Gas Offer Planner home"><svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M16 6c4 5 7 8 7 12a7 7 0 0 1-14 0c0-2 1-4 3-6 0 2 1 3 2 3 0-3 0-6 2-9z" fill="#fff"/></svg><span><b>Gas Offer</b> Planner</span></a>`+
  `<nav id="nav" aria-label="Sections">${NAV.map(([key,title,icon])=>`<a href="#${key}" data-view="${key}"${state.view===key?' class="on" aria-current="page"':''}>${ico(icon)}<span>${title}</span>${key==='book'?`<em class="count">${state.book.length}</em>`:''}</a>`).join('')}</nav>`+
  `<p class="side-foot">Supplier workspace · Client Energy Solutions.<br>Estimated operating profile: illustrative data, not a firm quote.</p></aside>`+
  `<main id="main"><header class="banner"><div class="logo-tile" aria-hidden="true"><svg viewBox="0 0 32 32" width="34" height="34"><path d="M16 5c4.4 5.4 8 8.8 8 13.2a8 8 0 0 1-16 0c0-2.4 1.2-4.6 3.4-6.6.2 2.2 1.2 3.4 2.4 3.4C13.8 11.6 13.8 8.4 16 5z" fill="#fff"/></svg></div>`+
  `<div class="b-main"><h1>Gas Offer Planner</h1><div class="chips">${chips.map(t=>`<span class="chip">${esc(t)}</span>`).join('')}</div></div>`+
  `<div class="b-act"><button class="btn dark" id="banner-customer"${pdfOff}>Customer proposal</button><button class="btn dark" id="banner-internal"${pdfOff}>Internal review</button></div></header>`+
  `<div id="view" class="view" data-section="${state.view}">${view}</div>`+
  `<p class="page-footer">Estimated operating profile · All calculations and PDFs run on your device. Entries are kept only for this page session; refreshing resets them. No trades or live market requests.</p></main></div>`;
 for(const id of opened){const e=document.getElementById(id);if(e)e.open=true;}
 bind();
 if(focusHeading){document.getElementById('stage-title')?.focus({preventScroll:true});window.scrollTo(0,0);}
 else if(active){document.getElementById(active)?.focus({preventScroll:true});}
}
function storedValue(element) {
 const id=element.id;
 if(element.dataset.curve)return marketState(current.case).curve[Number(element.dataset.curve)][element.dataset.column];
 if(Object.hasOwn(state.costs,id))return state.costs[id];
 if(Object.hasOwn(amountFields,id))return state.amounts[id];
 if(Object.hasOwn(ratioFields,id))return state.ratios[id];
 if(id==='market_source'||id==='market_date')return marketState(current.case)[id==='market_source'?'source':'date'];
 if(['delivery_point','quote_valid_until','delivery_confirmed'].includes(id))return commercialState()[id];
 return state[id];
}
function setInput(element,{refresh=true}={}) {
 const id=element.id;
 let value=element.type==='checkbox'?element.checked:element.type==='number'?(element.value.trim()===''?null:element.valueAsNumber):element.type==='range'?Number(element.value):element.value;
 if(id==='term')value=Number(value);
 if(id==='fuel_basis'||id==='quote_valid_until')value=value||null;
 if(Object.is(storedValue(element),value))return;
 if(['customer','city','term'].includes(id))state.context_version++;
 state.notice='';
 if(element.dataset.curve){const m=marketState(current.case);m.curve[Number(element.dataset.curve)][element.dataset.column]=value;state.upload_error='';}
 else if(Object.hasOwn(state.costs,id))state.costs[id]=id==='fuel_basis'?(value||null):value;
 else if(Object.hasOwn(amountFields,id))state.amounts[id]=value;
 else if(Object.hasOwn(ratioFields,id))state.ratios[id]=value;
 else if(id==='market_source'||id==='market_date'){const m=marketState(current.case);m[id==='market_source'?'source':'date']=value;if(id==='market_source')commercialState().delivery_confirmed=false;}
 else if(['delivery_point','quote_valid_until','delivery_confirmed'].includes(id)){const c=commercialState();if(id==='delivery_point')c.delivery_confirmed=false;c[id]=value|| (id==='delivery_confirmed'?false:null);}
 else if(id==='customer') {if(value!==state.customer)clearCredit();state.customer=value;}
 else if(id==='term')state.term=Number(value);
 else state[id]=value;
 if(id!=='credit_reviewed'&&id!=='payment_delay_days')state.credit_reviewed=false;
 if(refresh){if(element.tagName==='SELECT'||element.type==='range')render();else refreshControls();}
}
function marketStatus(d) {
 const curve=d.market?.curve??[];
 const missing=curve.filter(r=>r.forward_usd_mmbtu==null||r.basis_usd_mmbtu==null).length;
 return (d.market_error?notice(d.market_error,'error'):'')+
  (state.upload_error?'<button class="button small" id="clear-upload">Use the current table instead</button>':'')+
  (missing?notice(`${missing} delivery months still need prices. You can continue, but the full-term price stays pending.`,'warn'):'');
}
function refreshControls() {
 current=derive();const d=current;
 const replace=(id,html)=>{const el=document.getElementById(id);if(el)el.innerHTML=html;};
 replace('customer-status',state.customer.trim()?'':notice('Enter a customer label to continue. It will remain internal.','warn'));
 for(const id of ['demand-errors','cost-errors','credit-errors'])replace(id,d.errors.map(t=>notice(t,'error')).join(''));
 replace('market-status',marketStatus(d));
 const pending=Object.values(locked()?d.offer?.costs??{}:state.costs).some(v=>v==null);
 replace('cost-status',pending?notice('Some supplier costs are pending. Continuing will produce a partial estimate until they are supplied.'):'');
 replace('credit-summary',creditSummary(d.credit));
 const confirm=document.getElementById('delivery_confirmed');
 if(confirm){confirm.disabled=locked()||!commercialState().delivery_point?.trim();confirm.checked=!!commercialState().delivery_confirmed;}
 const reviewed=document.getElementById('credit_reviewed');
 if(reviewed){reviewed.disabled=d.credit.score==null;reviewed.checked=state.credit_reviewed;}
 const next=document.getElementById(`next_${state.step}`);
 if(next){
  next.disabled=(state.step===1&&!state.customer.trim())||!!d.errors.length||(state.step===3&&!!d.market_error);
  if(state.step===3)next.textContent=(d.market?.curve??[]).some(r=>r.forward_usd_mmbtu==null||r.basis_usd_mmbtu==null)?'Continue with prices pending':'Continue to supplier costs';
  if(state.step===4)next.textContent=pending?'Continue with costs pending':'Continue to credit';
  if(state.step===5)next.textContent=d.credit.score==null?'Review with credit pending':'Review the offer';
 }
 app.querySelectorAll('.step-nav [data-step]').forEach(el=>{const step=Number(el.dataset.step);el.disabled=step>state.furthest||(step>1&&!state.customer.trim())||(step>3&&!!d.market_error);});
 document.getElementById('clear-upload')?.addEventListener('click',()=>{state.upload_error='';render();});
}
function goStep(step,advance=false) {
 for(const element of app.querySelectorAll('input:not([type="radio"]):not([type="file"]),select')){if(!element.disabled)setInput(element,{refresh:false});}
 current=derive();
 if(step<1||step>6||(!advance&&step>state.furthest))return;
 if(step>1&&!state.customer.trim())return;
 if(step>3&&current.market_error)return;
 if(advance&&current.errors.length)return;
 state.step=step;state.furthest=Math.max(state.furthest,step);state.notice='';state.view='build';state.book_msg='';state.book_prompt=false;render({focusHeading:true});
}
function csvText(curve){return 'month,forward_usd_mmbtu,basis_usd_mmbtu\n'+curve.map(r=>[r.month,r.forward_usd_mmbtu??'',r.basis_usd_mmbtu??''].join(',')).join('\n')+'\n';}
function saveBlob(text,name,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function parseCSV(text) {
 const rows=[];let row=[],cell='',quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(ch===','&&!quoted){row.push(cell);cell='';}
  else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
  else cell+=ch;
 }
 if(quoted)throw Error('CSV contains an unclosed quoted value.');
 row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 const headers=rows.shift()?.map(x=>x.trim())??[];
 const required=['month','forward_usd_mmbtu','basis_usd_mmbtu'];
 if(new Set(headers).size!==headers.length||required.some(k=>!headers.includes(k)))throw Error('CSV needs month, forward_usd_mmbtu and basis_usd_mmbtu columns.');
 return rows.map(values=>Object.fromEntries(required.map(k=>{
  const raw=(values[headers.indexOf(k)]??'').trim();
  if(k==='month')return [k,raw];
  if(!raw)return [k,null];
  const n=Number(raw);if(!Number.isFinite(n))throw Error('Market prices must be finite numbers or blank.');
  return [k,n];
 })));
}
function bind() {
 app.querySelectorAll('[data-step]').forEach(el=>{if(el.tagName==='BUTTON')el.addEventListener('click',()=>goStep(Number(el.dataset.step)));});
 app.querySelectorAll('[data-next]').forEach(el=>el.addEventListener('click',()=>goStep(Number(el.dataset.next),true)));
 app.querySelectorAll('input[name="mode"]').forEach(el=>el.addEventListener('change',()=>{state.mode=el.value;state.context_version++;state.credit_reviewed=false;state.notice='';render();}));
 app.querySelectorAll('input[name="demand_basis"]').forEach(el=>el.addEventListener('change',()=>{state.demand_basis=el.value;if(el.value==='benchmark')state.annual_gas=6100;state.credit_reviewed=false;render();}));
 app.querySelectorAll('input[name="credit_format"]').forEach(el=>el.addEventListener('change',()=>{state.credit_format=el.value;state.credit_reviewed=false;render();}));
 app.querySelectorAll('input:not([type="radio"]):not([type="file"]),select').forEach(el=>{
  el.addEventListener('change',()=>setInput(el));
  if(['text','number','date'].includes(el.type))el.addEventListener('input',()=>setInput(el));
  if(el.type==='range')el.addEventListener('input',()=>{const out=document.getElementById(el.id==='weather_pct'?'weather-output':'delay-output');if(out)out.textContent=el.id==='weather_pct'?`${Number(el.value)>0?'+':''}${el.value}%`:`${el.value} days`;});
  if(['text','number'].includes(el.type))el.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();el.blur();}});
 });
 app.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>{state.tab=el.dataset.tab;render();}));
 document.getElementById('curve-template')?.addEventListener('click',()=>saveBlob(csvText(current.case.market_curve),`${state.city.toLowerCase()}-${state.term}-month-curve.csv`,'text/csv'));
 document.getElementById('clear-upload')?.addEventListener('click',()=>{state.upload_error='';render();});
 document.getElementById('curve-upload')?.addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file||locked())return;
  const targetCase=current.case,targetKey=contextKey(),version=state.context_version,sequence=++state.upload_sequence;
  const stillCurrent=()=>!locked()&&state.context_version===version&&state.upload_sequence===sequence&&contextKey()===targetKey;
  try{
    if(file.size>2*1024*1024)throw Error('CSV is larger than 2 MB.');
    const text=await file.text();if(!stillCurrent())return;
    const curve=validateCurve(parseCSV(text),targetCase.months);
    if(!stillCurrent())return;
    state.curves[targetKey].curve=curve;state.upload_error='';state.credit_reviewed=false;
  }catch(error){if(!stillCurrent())return;state.upload_error='Upload not accepted: '+error.message;}
  if(stillCurrent())render();
 });
 document.getElementById('freeze-offer')?.addEventListener('click',()=>{
  if(!current.offer||current.errors.length)return;
  state.frozen=clone(current.offer);state.frozen_explicit=true;state.notice='Offer saved for stress testing. Select Test existing offer to vary usage while keeping these terms.';render();
 });
 for(const [id,internal]of [['download-customer',false],['download-internal',true],['banner-customer',false],['banner-internal',true]])document.getElementById(id)?.addEventListener('click',()=>{
  const status=document.getElementById('download-status');
  try{downloadProposal(current.snapshot,{internal});if(status)status.textContent='Anonymous PDF prepared.';}
  catch{if(status)status.textContent='The PDF could not be created. Please reload the page and try again.';}
 });
 document.getElementById('save-book')?.addEventListener('click',()=>saveToBook());
 document.getElementById('book-replace')?.addEventListener('click',()=>saveToBook('replace'));
 document.getElementById('book-add')?.addEventListener('click',()=>saveToBook('add'));
 document.getElementById('book-cancel')?.addEventListener('click',()=>{state.book_prompt=false;render();});
 app.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',event=>{event.preventDefault();setView(el.dataset.view);}));
 app.querySelectorAll('[data-goto]').forEach(el=>el.addEventListener('click',()=>{const step=Number(el.dataset.goto);state.furthest=Math.max(state.furthest,step);goStep(step);}));
 app.querySelectorAll('[data-band]').forEach(el=>el.addEventListener('click',()=>{state.band_mode=el.dataset.band;render();}));
 app.querySelectorAll('[data-book-id]').forEach(row=>{
  const open=()=>{const entry=state.book.find(e=>e.id===row.dataset.bookId);if(entry)reopenEntry(entry);};
  row.addEventListener('click',event=>{if(!event.target.closest('button'))open();});
  row.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target===row){event.preventDefault();open();}});
 });
 app.querySelectorAll('[data-book-remove]').forEach(el=>el.addEventListener('click',()=>{state.book=state.book.filter(e=>e.id!==el.dataset.bookRemove);render();}));
 document.getElementById('book-clear-examples')?.addEventListener('click',()=>{state.book=state.book.filter(e=>!e.example);render();});
 document.getElementById('book-csv')?.addEventListener('click',()=>saveBlob(bookCsv(state.book),'offer-book.csv','text/csv;charset=utf-8'));
 document.getElementById('book-monthly-csv')?.addEventListener('click',()=>saveBlob(monthlyCsv(state.book),'offer-book-monthly.csv','text/csv;charset=utf-8'));
}
try {
 const response=await fetch(new URL('./data/model.json',import.meta.url));
 if(!response.ok)throw Error('Reference data could not be loaded.');data=await response.json();state.book=sampleEntries(data);
 const route=()=>{const view=location.hash.slice(1);if(['overview','build','book'].includes(view))state.view=view;};
 route();window.addEventListener('hashchange',()=>{route();render({focusHeading:true});});render();
} catch(error) {
 app.setAttribute('aria-busy','false');app.innerHTML=`<main class="loading"><h1>Gas Offer Planner</h1>${notice(error.message||'The planner could not be loaded.','error')}<p>Please reload the page. If this continues, the deployment may be missing an application asset.</p><button class="button primary" id="reload">Reload planner</button></main>`;
 document.getElementById('reload')?.addEventListener('click',()=>location.reload());
}
