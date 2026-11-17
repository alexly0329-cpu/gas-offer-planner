import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluate,templateInputs,editable,SAMPLE_INPUTS,impact,changedFields,IMPACT_METRICS} from '../public/book.mjs';
import {simulateJointRisk} from '../public/model.mjs';
import {EXPLAIN,explain} from '../public/explain.mjs';
const data=JSON.parse(readFileSync(new URL('../public/data/model.json',import.meta.url)));
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}`);

test('template statement amounts reproduce Example A ratios and a 6/6 score',()=>{
  const {credit}=evaluate(data,templateInputs(new Date(2026,10,16)));
  close(credit.ratios.current_ratio,1.8);close(credit.ratios.debt_ebitda,1.5);close(credit.ratios.interest_coverage,6);
  assert.equal(credit.score,6);assert.equal(credit.collateral_required,false);
});

test('template offer is complete: 4,536 MMBtu, price built from the cost stack',()=>{
  const {offer,financials}=evaluate(data,templateInputs(new Date(2026,10,16)));
  close(offer.volume,4536,1e-6);
  assert.equal(offer.missing_inputs.length,0);
  const expected=offer.commodity+offer.commodity*(1/.98-1)+.05+.03+.04+.02+.18;
  close(offer.fixed_price,expected,1e-9);
  close(offer.contribution,4536*.18,1e-6);
  assert.ok(financials.exposure>1500,'exposure includes receivables plus the $1,500 estimate');
  close(financials.exposure,financials.peak_receivables+1500,1e-6);
  close(financials.protection_gap,Math.max(0,financials.exposure-20000),1e-6);
});

test('template quote date is 45 days out and the template matches itself only',()=>{
  const t=templateInputs(new Date(2026,10,16));
  assert.equal(t.commercial.quote_valid_until,'2026-12-31');
  assert.equal(editable(t),editable(templateInputs(new Date(2026,10,16))));
  assert.notEqual(editable(t),editable({...t,weather_pct:0}));
  assert.equal(SAMPLE_INPUTS[0].credit_format,'ratios','Offer-book Example A is unchanged');
});

test('every credit and payment input has an explanation with what, use and template value',()=>{
  for(const key of ['current_assets','current_liabilities','debt','ebitda','ebit','interest_expense','current_ratio','debt_ebitda','interest_coverage','unsecured_limit','additional_exposure','customer_days','supplier_days','credit_reviewed']){
    const e=EXPLAIN[key];assert.ok(e&&e.what&&e.use&&e.template,`missing explanation: ${key}`);
    assert.match(explain(key),/Template:/);
  }
});

test('every explanation key used by the page exists, and every entry is complete',()=>{
  const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
  const used=new Set([...source.matchAll(/(?:explain|why)\('([a-z_0-9]+)'\)/g)].map(m=>m[1]));
  for(const key of ['out_price','out_volume','out_usage','out_commodity','out_fuel_adder','out_block_value','out_contribution','out_revenue','out_cost','out_budget_contribution','out_operating_cash','out_break_even','out_delayed','out_peak_receivables','out_exposure','out_protection_gap','out_p95_loss','out_premium','out_unhedged','out_bands','out_monthly','out_profile','out_cash_table','out_deviation','out_costs_entered','credit_score'])used.add(key);
  assert.ok(used.size>40,'page should use many explanations');
  for(const key of used){const e=EXPLAIN[key];assert.ok(e&&e.what&&e.use&&e.template,`missing explanation: ${key}`);}
  for(const [key,e] of Object.entries(EXPLAIN))for(const part of ['what','use','template'])assert.ok(/[.%)×$\d]$/.test(e[part].trim()),`${key}.${part} should end like a sentence`);
});

test('the template values quoted in the output explanations match the model',()=>{
  const {offer:o,financials:f}=evaluate(data,templateInputs(new Date(2026,10,16)));
  const r=simulateJointRisk(o,data);
  const usd=(v,d=2)=>'$'+v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
  const n=v=>v.toLocaleString('en-US',{maximumFractionDigits:0});
  const checks={
    out_volume:n(o.volume),out_price:usd(o.fixed_price,4),out_commodity:usd(o.commodity,4),out_fuel_adder:usd(o.fuel_adder,4),
    out_block_value:usd(o.block_value),out_contribution:usd(o.contribution),out_revenue:usd(f.revenue),out_cost:usd(f.cost),
    out_budget_contribution:usd(f.contribution),out_monthly:usd(f.months[0].contribution).replace('$-','−$').replace('-$','−$'),
    out_operating_cash:usd(f.operating_funding),out_break_even:usd(f.break_even_price,4),out_delayed:usd(f.delayed_funding),
    out_peak_receivables:usd(f.peak_receivables),out_exposure:usd(f.exposure),out_unhedged:usd(r.unhedged_loss_p95),
    out_cash_table:String(f.cash_months.length)};
  for(const [key,expected] of Object.entries(checks)){
    const text=EXPLAIN[key].template.replace('-','−');
    assert.ok(text.includes(expected.replace('-','−')),`${key}: expected “${expected}” in “${EXPLAIN[key].template}”`);
  }
  assert.ok(EXPLAIN.out_profile.template.includes(`January ${n(o.months[0].block_mmbtu)} MMBtu, July ${n(o.months[6].block_mmbtu)} MMBtu`));
  const m=f.months,neg=v=>'−$'+Math.abs(v).toFixed(2);
  for(const i of [0,1,11])assert.ok(EXPLAIN.out_monthly.template.includes(neg(m[i].contribution)),`month ${i}`);
  assert.deepEqual(m.map(x=>x.contribution<0),[true,true,false,false,false,false,false,false,false,false,false,true]);
  close(r.loss_p95,0);close(r.risk_premium,0);assert.equal(r.n_sims,100000);assert.equal(r.n_unique_years,9);
  close(o.fixed_price-o.contribution/o.volume,f.break_even_price,1e-9);
});

const T=()=>templateInputs(new Date(2026,10,16));
const row=(rows,key)=>rows.find(r=>r.key===key);

test('impact: an unedited template has zero change everywhere',()=>{
  const rows=impact(data,T(),T());
  assert.equal(rows.length,IMPACT_METRICS.length);
  for(const r of rows){assert.equal(r.delta,0,r.key);assert.equal(r.pct,null);}
  assert.deepEqual(changedFields(T(),T()),[]);
});

test('impact: a higher margin moves price and contribution, not volume or credit',()=>{
  const mine={...T(),margin:.30};
  const rows=impact(data,mine,T());
  close(row(rows,'price').delta,.12,1e-9);
  close(row(rows,'target').delta,4536*.12,1e-6);
  close(row(rows,'breakeven').delta,0,1e-9);
  assert.equal(row(rows,'volume').delta,0);assert.equal(row(rows,'score').delta,0);
  assert.deepEqual(changedFields(mine,T()).map(c=>c.key),['margin']);
});

test('impact: more debt cuts the score to 4 and the permitted limit to $0, leaving a protection gap',()=>{
  const mine={...T(),amounts:{...T().amounts,debt:900000}};
  const rows=impact(data,mine,T());
  assert.equal(row(rows,'score').after,4);assert.equal(row(rows,'score').delta,-2);assert.equal(row(rows,'score').pct,null);
  assert.equal(row(rows,'exposure').delta,0);
  close(row(rows,'gap').after,row(rows,'exposure').after,1e-9);
  assert.ok(row(rows,'gap').delta>5000);
  assert.deepEqual(changedFields(mine,T()).map(c=>c.key),['debt']);
});

test('impact: weather and gas quantity move blocks; a city without prices turns price Pending and its delta n/a',()=>{
  const rows=impact(data,{...T(),weather_pct:0},T());
  close(row(rows,'volume').after,4200,1e-6);close(row(rows,'volume').delta,-336,1e-6);
  const omaha=impact(data,{...T(),city:'Omaha',curve:null},T());
  assert.equal(row(omaha,'price').after,null);assert.equal(row(omaha,'price').delta,null);
});

test('impact: invalid inputs return null instead of throwing',()=>{
  assert.equal(impact(data,{...T(),annual_gas:-5},T()),null);
});

test('every impact row says what drives it',()=>{
  for(const m of IMPACT_METRICS)assert.ok(m.drivers&&m.label&&m.get,m.key);
  assert.ok(EXPLAIN.impact.what&&EXPLAIN.impact.use&&EXPLAIN.impact.template);
});
