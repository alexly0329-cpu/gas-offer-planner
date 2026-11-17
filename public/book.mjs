/** Offer book: rows, totals and CSV for several saved offers. Reuses the existing pricing, credit and financial-plan models unchanged. */
import {loadCase,buildOffer,ratiosFromFinancials,assessCredit,financialPlan} from './model.mjs';

export const EXAMPLE_NOTE='Examples use illustrative assumptions, not real customers.';
export const AMOUNT_KEYS=['current_assets','current_liabilities','debt','ebitda','ebit','interest_expense'];
export const RATIO_KEYS=['current_ratio','debt_ebitda','interest_coverage'];
export const BOOK_HEADERS=['Customer label','Example','City','Term (months)','Annual MMBtu','Offer price ($/MMBtu)','Price status','Margin ($, full term)','Margin ($/MMBtu)','Credit result','Peak credit exposure ($)','Quote valid until'];
export const MONTHLY_HEADERS=['Customer label','Example','Month','Block MMBtu','Henry Hub ($/MMBtu)','Basis ($/MMBtu)','Revenue ($)','Cost ($)','Contribution ($)'];
const clone=value=>structuredClone(value);

/** Same calls, in the same order, as the guided steps. */
export function evaluate(data,inputs){
  const c=loadCase(data,inputs.city,inputs.term);
  const offer=buildOffer(c,inputs.curve??null,{annual_gas:inputs.annual_gas,weather_pct:inputs.weather_pct,margin:inputs.margin,costs:inputs.costs});
  const credit=assessCredit(inputs.credit_format==='amounts'?ratiosFromFinancials(inputs.amounts):inputs.ratios);
  const financials=financialPlan(offer,{customer_days:inputs.customer_days??null,supplier_days:inputs.supplier_days??null,payment_delay_days:inputs.payment_delay_days??0,
    unsecured_limit:inputs.unsecured_limit??null,additional_exposure:inputs.additional_exposure??null,credit});
  return {offer,credit,financials};
}

/** A saved snapshot: the inputs (to reopen it) plus the figures shown in the book. Unknown values stay null, never zero. */
export function makeEntry(data,inputs,{id,example=false}={}){
  const {offer:o,credit,financials:f}=evaluate(data,inputs),score=credit.score;
  return {id,example,inputs:clone(inputs),
    row:{customer:inputs.customer,city:inputs.city,term:o.term,annual_mmbtu:o.volume/(o.term/12),price:o.fixed_price,price_partial:o.fixed_price!==null&&o.missing_inputs.length>0,
      margin_total:o.contribution,margin_per:o.margin,credit_score:score,
      credit_result:score===null?null:`${score} / 6 · ${credit.collateral_required?'Protection required':'Passes screen'}`,
      exposure:f.exposure,valid_until:inputs.commercial?.quote_valid_until??null},
    monthly:o.months.map((m,i)=>({month:m.month,block_mmbtu:m.block_mmbtu,hh:m.hh_reference,basis:m.basis_reference,
      revenue:f.months[i]?.revenue??null,cost:f.months[i]?.total_cost??null,contribution:f.months[i]?.contribution??null}))};
}

const PENDING_COLUMNS=['price','credit_result','exposure','valid_until'];
export const isIncomplete=row=>PENDING_COLUMNS.some(key=>row[key]===null||row[key]===undefined);

/** A total is Pending (value null) when any offer has no value for that column. */
export function totals(entries){
  const rows=entries.map(e=>e.row);
  const total=key=>{const pending=rows.filter(r=>r[key]===null||r[key]===undefined).length;return {value:pending?null:rows.reduce((a,r)=>a+r[key],0),pending,count:rows.length};};
  return {annual_mmbtu:total('annual_mmbtu'),margin_total:total('margin_total'),exposure:total('exposure'),incomplete:rows.filter(isIncomplete).length,count:rows.length};
}

const PENDING='Pending';
export function csvCell(value){
  let text;
  if(value===null||value===undefined)text=PENDING;
  else if(typeof value==='number')text=Number.isFinite(value)?String(Number(value.toFixed(6))):PENDING;
  else{text=String(value);if(/^[=+\-@\t\r]/.test(text))text="'"+text;}
  return /[",\n\r]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
}
const csv=(headers,rows)=>[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\n')+'\n';

export function bookCsv(entries){
  const t=totals(entries);
  const rows=entries.map(({row:r,example})=>[r.customer,example?'Yes':'No',r.city,r.term,r.annual_mmbtu,r.price,r.price===null?PENDING:r.price_partial?'Partial subtotal':'Complete',r.margin_total,r.margin_per,r.credit_result,r.exposure,r.valid_until]);
  rows.push([`Total (${t.count} offers)`,'','','',t.annual_mmbtu.value,'','',t.margin_total.value,'','',t.exposure.value,'']);
  return csv(BOOK_HEADERS,rows);
}
export function monthlyCsv(entries){
  return csv(MONTHLY_HEADERS,entries.flatMap(({row,example,monthly})=>monthly.map(m=>[row.customer,example?'Yes':'No',m.month,m.block_mmbtu,m.hh,m.basis,m.revenue,m.cost,m.contribution])));
}

/** Three illustrative offers on the bundled Tulsa 2027 reference curve. Different volumes, margins and credit strength. */
const COSTS={fuel_pct:2,fuel_basis:'receipts',supplier_fee:.05,financing:.03,residual_risk:.04,credit_allowance:.02};
const sampleInputs=({customer,annual_gas,margin,ratios,customer_days,additional_exposure,quote_valid_until})=>({customer,city:'Tulsa',term:12,
  demand_basis:annual_gas===6100?'benchmark':'user_total',annual_gas,weather_pct:20,margin,costs:{...COSTS},customer_days,supplier_days:25,
  credit_format:'ratios',amounts:Object.fromEntries(AMOUNT_KEYS.map(k=>[k,null])),ratios,unsecured_limit:20000,additional_exposure,credit_reviewed:true,payment_delay_days:0,
  curve:null,market_source:'',market_date:'',commercial:{delivery_point:'',quote_valid_until,delivery_confirmed:false}});
export const SAMPLE_INPUTS=[
  sampleInputs({customer:'Example A: small fabricator',annual_gas:4200,margin:.18,ratios:{current_ratio:1.8,debt_ebitda:1.5,interest_coverage:6},customer_days:30,additional_exposure:1500,quote_valid_until:'2026-12-31'}),
  sampleInputs({customer:'Example B: mid-size plant',annual_gas:6100,margin:.25,ratios:{current_ratio:1.2,debt_ebitda:3,interest_coverage:5},customer_days:45,additional_exposure:2500,quote_valid_until:'2027-01-15'}),
  sampleInputs({customer:'Example C: large plant',annual_gas:9800,margin:.32,ratios:{current_ratio:.9,debt_ebitda:4.5,interest_coverage:1.5},customer_days:60,additional_exposure:4000,quote_valid_until:'2027-01-31'})];
export const sampleEntries=data=>SAMPLE_INPUTS.map((inputs,i)=>makeEntry(data,inputs,{id:`example-${i+1}`,example:true}));

/** The template every visitor starts from: Example A, with a quote date 45 days after today so it never starts expired. */
export function templateInputs(today=new Date()){
  const t=structuredClone(SAMPLE_INPUTS[0]),d=new Date(today.getFullYear(),today.getMonth(),today.getDate()+45);
  t.customer='Template: small fabricator';
  // Statement amounts that reproduce Example A's ratios exactly: 450/250 = 1.8, 300/200 = 1.5, 150/25 = 6.
  t.credit_format='amounts';
  t.amounts={current_assets:450000,current_liabilities:250000,debt:300000,ebitda:200000,ebit:150000,interest_expense:25000};
  t.ratios=Object.fromEntries(RATIO_KEYS.map(k=>[k,null]));
  t.commercial.quote_valid_until=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return t;
}
export const BLANK_INPUTS={customer:'HVAC equipment manufacturer — estimated profile',city:'Tulsa',term:12,demand_basis:'benchmark',annual_gas:6100,weather_pct:20,margin:.20,
  costs:{fuel_pct:null,fuel_basis:null,supplier_fee:null,financing:null,residual_risk:null,credit_allowance:null},customer_days:null,supplier_days:null,
  credit_format:'amounts',amounts:Object.fromEntries(AMOUNT_KEYS.map(k=>[k,null])),ratios:Object.fromEntries(RATIO_KEYS.map(k=>[k,null])),
  unsecured_limit:null,additional_exposure:null,credit_reviewed:false,payment_delay_days:0,curve:null,market_source:'',market_date:'',
  commercial:{delivery_point:'',quote_valid_until:null,delivery_confirmed:false}};
/** The values a visitor can edit, in a fixed order, for the "matches the template" check. */
export const editable=i=>JSON.stringify([i.customer,i.city,i.term,i.demand_basis,i.annual_gas,i.weather_pct,i.margin,i.costs,i.customer_days,i.supplier_days,i.credit_format,
  i.credit_format==='amounts'?i.amounts:i.ratios,i.unsecured_limit,i.additional_exposure,i.payment_delay_days,i.commercial?.quote_valid_until??null]);

/** Rows of the before/after table. `get` reads one result from evaluate(); `drivers` says which inputs move it. */
export const IMPACT_METRICS=[
  {key:'price',label:'Offer price ($/MMBtu)',fmt:'usd4',get:r=>r.offer.fixed_price,drivers:'Market prices, fuel, allowances and margin. Weather and gas quantity act only through the monthly weights.'},
  {key:'volume',label:'Gas blocks (MMBtu)',fmt:'n1',get:r=>r.offer.volume,drivers:'Annual gas and the HDD change.'},
  {key:'target',label:'Target contribution ($)',fmt:'usd2',get:r=>r.offer.contribution,drivers:'Margin × blocks.'},
  {key:'budget',label:'Budgeted contribution ($)',fmt:'usd2',get:r=>r.financials.contribution,drivers:'Price, costs and blocks, month by month.'},
  {key:'breakeven',label:'Break-even price ($/MMBtu)',fmt:'usd4',get:r=>r.financials.break_even_price,drivers:'Price minus margin.'},
  {key:'cash',label:'Peak operating cash ($)',fmt:'usd2',get:r=>r.financials.operating_funding,drivers:'Costs, blocks and both payment-day inputs.'},
  {key:'delayed',label:'Peak cash with late payment ($)',fmt:'usd2',get:r=>r.financials.delayed_funding,drivers:'Peak cash plus the extra customer delay.'},
  {key:'receivables',label:'Peak billed receivables ($)',fmt:'usd2',get:r=>r.financials.peak_receivables,drivers:'Price, blocks and the customer’s payment days.'},
  {key:'exposure',label:'Credit exposure ($)',fmt:'usd2',get:r=>r.financials.exposure,drivers:'Peak receivables plus the additional exposure estimate.'},
  {key:'gap',label:'Protection gap ($)',fmt:'usd2',get:r=>r.financials.protection_gap,drivers:'Exposure minus the permitted limit, which is $0 unless the score is 6/6.'},
  {key:'score',label:'Credit score (of 6)',fmt:'score',get:r=>r.credit.score,drivers:'Only the credit ratios.'}];

/** Your current inputs against the template, one row per result. Returns null when either side cannot be evaluated. */
export function impact(data,inputs,base=templateInputs()){
  let a,b;
  try{b=evaluate(data,base);a=evaluate(data,inputs);}catch{return null;}
  return IMPACT_METRICS.map(m=>{
    const before=m.get(b),after=m.get(a),ok=before!=null&&after!=null&&Number.isFinite(before)&&Number.isFinite(after);
    const delta=ok?after-before:null;
    return {key:m.key,label:m.label,fmt:m.fmt,drivers:m.drivers,before:before??null,after:after??null,delta:ok&&Math.abs(delta)<1e-9?0:delta,
      pct:ok&&m.fmt!=='score'&&Math.abs(before)>1e-9&&Math.abs(delta)>=1e-9?delta/Math.abs(before)*100:null};
  });
}

const FIELD_LABELS={customer:'Customer label',city:'City',term:'Term (months)',demand_basis:'Annual gas basis',annual_gas:'Annual gas (MMBtu)',weather_pct:'Assumed HDD change (%)',margin:'Target margin ($/MMBtu)',
  customer_days:'Customer pays after (days)',supplier_days:'Supplier is paid after (days)',credit_format:'Credit input type',unsecured_limit:'Approved unsecured limit ($)',
  additional_exposure:'Additional exposure ($)',payment_delay_days:'Extra customer delay (days)',fuel_pct:'Fuel (%)',fuel_basis:'Fuel basis',supplier_fee:'Supplier fee ($/MMBtu)',
  financing:'Financing ($/MMBtu)',residual_risk:'Residual risk ($/MMBtu)',credit_allowance:'Credit allowance ($/MMBtu)',current_assets:'Current assets ($)',
  current_liabilities:'Current liabilities ($)',debt:'Interest-bearing debt ($)',ebitda:'Annual EBITDA ($)',ebit:'Annual EBIT ($)',interest_expense:'Annual interest expense ($)',
  current_ratio:'Current ratio',debt_ebitda:'Debt / EBITDA',interest_coverage:'EBIT / interest'};
/** Every value that differs from the base inputs, as {label, from, to}. */
export function changedFields(inputs,base=templateInputs()){
  const out=[],add=(key,a,b)=>{if(!Object.is(a??null,b??null))out.push({key,label:FIELD_LABELS[key]??key,from:b??null,to:a??null});};
  for(const key of ['customer','city','term','demand_basis','annual_gas','weather_pct','margin','customer_days','supplier_days','credit_format','unsecured_limit','additional_exposure','payment_delay_days'])add(key,inputs[key],base[key]);
  for(const key of Object.keys(base.costs))add(key,inputs.costs?.[key],base.costs[key]);
  for(const key of AMOUNT_KEYS)add(key,inputs.amounts?.[key],base.amounts?.[key]);
  for(const key of RATIO_KEYS)add(key,inputs.ratios?.[key],base.ratios?.[key]);
  return out;
}

