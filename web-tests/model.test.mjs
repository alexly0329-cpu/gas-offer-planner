import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {loadCase,validateCurve,buildOffer,stressOffer,simulateJointRisk,ratiosFromFinancials,assessCredit,financialPlan} from '../public/model.mjs';
const data=JSON.parse(readFileSync(new URL('../public/data/model.json',import.meta.url)));
const fixtures=JSON.parse(readFileSync(new URL('./fixtures.json',import.meta.url)));
function parity(actual,expected,path='result'){
  if(typeof expected==='number'){
    assert.equal(typeof actual,'number',path);
    assert(Number.isFinite(actual),path+' finite');
    assert(Math.abs(actual-expected)<=1e-7+Math.abs(expected)*1e-11,`${path}: ${actual} != ${expected}`);
  }else if(Array.isArray(expected)){
    assert(Array.isArray(actual),path+' array'); assert.equal(actual.length,expected.length,path+' length');
    expected.forEach((v,i)=>parity(actual[i],v,`${path}[${i}]`));
  }else if(expected&&typeof expected==='object'){
    assert(actual&&typeof actual==='object',path+' object');
    for(const[k,v]of Object.entries(expected))parity(actual[k],v,`${path}.${k}`);
  }else assert.equal(actual,expected,path);
}
for(const f of fixtures.offers)test(`Python parity: ${f.id}`,()=>{
  const c=loadCase(data,f.city,f.term),original=JSON.stringify(c);
  let offer=buildOffer(c,f.curve,f.options);
  assert.equal(JSON.stringify(c),original,'build does not mutate case');
  if(f.stress_weather!==null){const old=JSON.stringify(offer);offer=stressOffer(offer,f.stress_weather);assert.equal(JSON.stringify(buildOffer(c,f.curve,f.options)),old);}
  parity(offer,f.expected);
  const before=JSON.stringify(offer),risk=simulateJointRisk(offer,data);parity(risk,f.risk);
  if(risk.available){
    assert.equal(risk.weighted_paths.reduce((a,b)=>a+b.count,0),100000);
    assert.equal(risk.histogram.reduce((a,b)=>a+b.matched_count,0),100000);
    assert.equal(risk.histogram.reduce((a,b)=>a+b.unhedged_count,0),100000);
    assert.equal(risk.loss_p95,0);
  }
  for(const row of f.financials)parity(financialPlan(offer,row.inputs),row.expected);
  assert.equal(JSON.stringify(offer),before,'risk/finance do not mutate original terms');
});
for(const [i,f]of fixtures.credit.entries())test(`Credit ratios match Python ${i}`,()=>parity(assessCredit(f.inputs),f.expected));
for(const [i,f]of fixtures.amounts.entries())test(`Financial-statement ratios match Python ${i}`,()=>{
 const ratios=ratiosFromFinancials(f.inputs);parity(ratios,f.expected);parity(assessCredit(ratios),f.assessment);
});
test('Curve and input validation rejects invalid finite values and wrong delivery months',()=>{
 const c=loadCase(data,'Tulsa');
 for(const wrong of [0,1.5,36,null,'12',true])assert.throws(()=>loadCase(data,'Tulsa',wrong));
 assert.throws(()=>loadCase(data,'Missing'));
 for(const value of [-1,0,Infinity,'no',true]){const x=structuredClone(c.market_curve);x[0].forward_usd_mmbtu=value;assert.throws(()=>validateCurve(x,c.months));}
 for(const type of ['NaN','Infinity']){const x=structuredClone(c.market_curve);x[0].basis_usd_mmbtu=type;assert.throws(()=>validateCurve(x,c.months));}
 assert.throws(()=>validateCurve(c.market_curve.slice(1),c.months));
 const reversed=structuredClone(c.market_curve).reverse();assert.throws(()=>validateCurve(reversed,c.months));
 const missing=structuredClone(c.market_curve);missing[0].basis_usd_mmbtu=null;assert.equal(buildOffer(c,missing).fixed_price,null);
 for(const opts of [{annual_gas:0},{annual_gas:null},{annual_gas:true},{annual_gas:''},{annual_gas:Infinity},{weather_pct:-101},{margin:-1},{costs:{unknown:0}},{costs:{fuel_pct:100,fuel_basis:'receipts'}}])assert.throws(()=>buildOffer(c,null,opts));
});
test('Financial inputs never turn malformed days or missing exposure into zero',()=>{
 const c=loadCase(data,'Tulsa'),o=buildOffer(c,null,{costs:{fuel_pct:0,fuel_basis:'receipts',supplier_fee:0,financing:0,residual_risk:0,credit_allowance:0}});
 for(const opts of [{customer_days:-1},{supplier_days:366},{customer_days:1.5},{customer_days:true},{customer_days:''},{payment_delay_days:91},{payment_delay_days:null},{unsecured_limit:-1},{additional_exposure:Infinity}])assert.throws(()=>financialPlan(o,opts));
 const strong=assessCredit({current_ratio:1.5,debt_ebitda:2,interest_coverage:4});
 assert.equal(financialPlan(o,{customer_days:30,supplier_days:0,additional_exposure:0,credit:strong}).protection_gap,null);
 assert.equal(financialPlan(o,{customer_days:30,supplier_days:0,unsecured_limit:10000,credit:strong}).protection_gap,null);
});
test('Same-month payment ordering needs funding, runoff is retained, late stress leaves exposure/price unchanged',()=>{
 const c=loadCase(data,'Tulsa');
 const flat=c.market_curve.map(row=>({...row,forward_usd_mmbtu:3,basis_usd_mmbtu:-.2}));
 const o=buildOffer(c,flat,{costs:{fuel_pct:0,fuel_basis:'receipts',supplier_fee:0,financing:0,residual_risk:0,credit_allowance:0}});
 const p=financialPlan(o,{customer_days:10,supplier_days:0,payment_delay_days:30,additional_exposure:0});
 assert(p.operating_funding>0);assert(p.delayed_funding>p.operating_funding);
 assert.equal(p.cash_months.at(-1).month,'2028-01');
 assert.equal(p.peak_receivables,financialPlan(o,{customer_days:10,supplier_days:0,additional_exposure:0}).peak_receivables);
 assert.equal(financialPlan(o,{customer_days:0,supplier_days:10,additional_exposure:0}).operating_funding,0);
});

test('Signed invoice/price cases preserve refunds rather than turning them into receivables',()=>{
 for(const id of ['refund_entered','negative_regional_entered']){
  const f=fixtures.offers.find(row=>row.id===id),c=loadCase(data,f.city,f.term);
  let o=buildOffer(c,f.curve,f.options);if(f.stress_weather!==null)o=stressOffer(o,f.stress_weather);
  const p=financialPlan(o,{customer_days:10,supplier_days:0,additional_exposure:0});
  assert(p.months.some(row=>row.revenue<0),'negative customer bills retained');
  assert(p.cash_months.every(row=>row.cash_in>=0&&row.cash_out>=0),'refunds use cash-out side');
  if(id==='negative_regional_entered'){assert(o.fixed_price<0);assert.equal(p.peak_receivables,0);assert.equal(p.protection_gap,0);}
 }
});
