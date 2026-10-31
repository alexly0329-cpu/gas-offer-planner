import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createProposalPdf} from '../public/reports.mjs';
const require=createRequire(import.meta.url);
globalThis.jspdf=require('../public/vendor/jspdf.umd.min.js');
const text=bytes=>new TextDecoder('latin1').decode(bytes);
const pageCount=bytes=>(text(bytes).match(/\/Type \/Page\b/g)||[]).length;
function snapshot(term=12){
 const months=Array.from({length:term},(_,i)=>({month:`${2027+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`,block_mmbtu:549,modeled_use_mmbtu:549,hh_reference:3,basis_reference:-.2,hh_hedge_mmbtu:549,basis_hedge_mmbtu:549}));
 return {customer:'Secret-Client-493176',city:'Tulsa',term,delivery_start:'2027-01',delivery_end:months.at(-1).month,market_as_of:'2026-10-29',price:3.0170975592,volume:549*term,expected_usage:549*term,block_value:3.0170975592*549*term,margin:.2,commodity:2.8170975592,fuel_adder:null,additional_components:{},missing_inputs:['fuel_pct','supplier_fee'],mode:'New offer',weather_pct:20,weather_reference_hdd:3172,demand_basis:'benchmark',reference_annual_gas:6100,credit:{score:6,collateral_required:false,ratios:{current_ratio:1.7,debt_ebitda:2,interest_coverage:4},review_flags:[]},risk:{available:true,n_sims:100000,n_unique_years:9,loss_p95:0,risk_premium:0,unhedged_loss_p95:6829.85},financials:{revenue:19876.64,cost:18559.04,contribution:1317.6,operating_funding:6749.61,delayed_funding:8029.66,break_even_price:2.8171,peak_receivables:5000,exposure:5100,effective_unsecured_limit:1000,protection_gap:4100,inputs:{customer_days:30,supplier_days:0,payment_delay_days:30},months:months.map(r=>({...r,revenue:1600,total_cost:1500,contribution:100}))},readiness:{cost_complete:false,market_dated:true},months};
}

test('customer and internal page counts stay compact for twelve and twenty-four months',()=>{
 for(const term of [12,24])for(const internal of [false,true]){
  const bytes=createProposalPdf(snapshot(term),{internal});
  assert(bytes instanceof Uint8Array);assert(text(bytes).startsWith('%PDF'));
  assert.equal(pageCount(bytes),internal?(term===24?5:4):(term===24?3:2));
 }
});
test('customer PDF suppresses supplier costs, ratios, hedges and all internal strings',()=>{
 const s=snapshot();s.market_source=s.customer;s.delivery_point=s.customer;s.price_label=s.customer;
 const out=text(createProposalPdf(s));
 for(const forbidden of [s.customer,'Target margin','Debt / EBITDA','EBIT / interest','P95','Unsecured limit','Protection gap','Budgeted supplier costs','Henry Hub','6,829.85'])assert(!out.includes(forbidden),forbidden);
 assert(out.includes('Your gas proposal'));assert(out.includes('Proposed monthly blocks'));
 assert(!out.includes('fictional'));assert(!out.includes('invented'));
});
test('internal PDF includes numeric financial/credit/risk data but never arbitrary strings',()=>{
 const s=snapshot();const secret=s.customer;
 s.market_source=secret;s.delivery_point=secret;s.price_label=secret;s.credit.policy_note=secret;s.credit.review_flags=[secret];s.risk.scope=secret;s.risk.limitations=[secret];s.financials.inputs.customer_days=secret;s.readiness.delivery_confirmed=secret;
 const out=text(createProposalPdf(s,{internal:true}));
 assert(!out.includes(secret));
 for(const needed of ['Internal financial review','Target margin','Debt / EBITDA','1,317.60','6,749.61','8,029.66','6,829.85','Protection gap','Pending'])assert(out.includes(needed),needed);
 assert(!out.includes('No collateral required'));
});
test('invalid calendar dates, nonfinite numbers and empty snapshots stay Pending',()=>{
 const s=snapshot();s.market_as_of='2027-02-31';s.quote_valid_until='2027-04-31';s.price=Infinity;s.block_value=NaN;s.months[0].month='2027-13';
 for(const internal of [true,false]){
  const out=text(createProposalPdf(s,{internal}));
  for(const bad of ['2027-02-31','2027-04-31','2027-13','Infinity','$NaN'])assert(!out.includes(bad),bad);
  assert(out.includes('Price unavailable'));assert(out.includes('Pending'));
  assert(text(createProposalPdf({}, {internal})).includes('Pending'));
 }
 s.market_as_of='2027-02-29';assert(!text(createProposalPdf(s)).includes('2027-02-29'));
 s.market_as_of='2028-02-29';assert(text(createProposalPdf(s)).includes('2028-02-29'));
});
test('customer credits never disclose internal finance fields and saved mode uses agreed labels',()=>{
 const s=snapshot(24);s.mode='Existing stress';
 const out=text(createProposalPdf(s));assert(out.includes('Agreed monthly blocks'));assert(out.includes('2028-12'));
});
test('internal hedge schedule uses fuel-inclusive quantities only with a valid fuel convention',()=>{
 const s=snapshot();for(const row of s.months){row.hh_hedge_mmbtu=549/.95;row.basis_hedge_mmbtu=549/.95;}
 s.fuel_pct=5;s.fuel_basis='receipts';
 const known=text(createProposalPdf(s,{internal:true}));assert(known.includes('577.9'));assert(known.includes('fuel-inclusive'));
 s.fuel_basis=null;for(const row of s.months){row.hh_hedge_mmbtu=9999;row.basis_hedge_mmbtu=9999;}
 const pending=text(createProposalPdf(s,{internal:true}));assert(!pending.includes('9,999.0'));assert(pending.includes('Fuel execution quantities: Pending'));
});
