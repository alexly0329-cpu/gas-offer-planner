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
