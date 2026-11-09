import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {loadCase,buildOffer,priceBuild,priceBuildBars} from '../public/model.mjs';
import {createProposalPdf} from '../public/reports.mjs';
const require=createRequire(import.meta.url);
globalThis.jspdf=require('../public/vendor/jspdf.umd.min.js');
const data=JSON.parse(readFileSync(new URL('../public/data/model.json',import.meta.url)));
const text=bytes=>new TextDecoder('latin1').decode(bytes);
const pages=bytes=>(text(bytes).match(/\/Type \/Page\b/g)||[]).length;
const COSTS={fuel_pct:2,fuel_basis:'receipts',supplier_fee:.05,financing:.03,residual_risk:.04,credit_allowance:.02};
const tulsa=(options={},term=12,curve=null)=>buildOffer(loadCase(data,'Tulsa',term),curve,options);
const total=build=>build.steps.reduce((a,s)=>a+(s.pending?0:s.value),0);

function snapshot(offer){
  return {customer:'Secret-Client-493176',city:'Tulsa',term:offer.term,delivery_start:offer.months[0].month,delivery_end:offer.months.at(-1).month,market_as_of:'2026-10-29',
    price:offer.fixed_price,volume:offer.volume,expected_usage:offer.expected_usage,block_value:offer.block_value,margin:offer.margin,commodity:offer.commodity,fuel_adder:offer.fuel_adder,
    fuel_pct:offer.costs.fuel_pct,fuel_basis:offer.costs.fuel_basis,additional_components:Object.fromEntries(['supplier_fee','financing','residual_risk','credit_allowance'].map(k=>[k,offer.costs[k]])),
    missing_inputs:offer.missing_inputs,mode:'New offer',weather_pct:20,weather_reference_hdd:3172,demand_basis:'benchmark',reference_annual_gas:6100,
    credit:{score:null,collateral_required:true,ratios:{},review_flags:[]},risk:{available:false},financials:{months:[],inputs:{}},readiness:{},months:offer.months,price_build:priceBuild(offer)};
}

test('default Tulsa case: components sum to the offer price shown elsewhere',()=>{
  const offer=tulsa(),build=priceBuild(offer);
  assert.equal(build.steps.map(s=>s.key).join(),'hh,basis,fuel,supplier_fee,financing,residual_risk,credit_allowance,margin');
  assert(Math.abs(total(build)-offer.fixed_price)<1e-9,`${total(build)} != ${offer.fixed_price}`);
  assert.equal(build.total,offer.fixed_price,'final bar is the offer price itself, not a second calculation');
  assert.equal(total(build).toFixed(4),offer.fixed_price.toFixed(4),'same rounding as the displayed price');
  const bars=priceBuildBars(build);
  assert.equal(bars.at(-1).to,offer.fixed_price);
  assert(Math.abs(bars.at(-2).to-offer.fixed_price)<1e-9,'last running level meets the final bar');
});

test('complete costs: every component known, all counted, labeled Offer price',()=>{
  const offer=tulsa({costs:COSTS}),build=priceBuild(offer);
  assert(build.steps.every(s=>!s.pending&&s.value!==null));
  assert.equal(build.total_label,'Offer price');
  assert(Math.abs(total(build)-offer.fixed_price)<1e-9);
  assert(offer.fuel_adder>0);
});

test('pending components are null, not zero, and the final bar says Partial subtotal',()=>{
  const build=priceBuild(tulsa());
  for(const key of ['fuel','supplier_fee','financing','residual_risk','credit_allowance']){
    const step=build.steps.find(s=>s.key===key);assert.equal(step.pending,true,key);assert.equal(step.value,null,key);
  }
  assert.equal(build.total_label,'Partial subtotal');
  const bars=priceBuildBars(build);
  assert(bars.filter(b=>b.pending).length>=5);
  for(const b of bars.filter(b=>b.pending&&!b.total))assert.equal(b.from,b.to,'pending adds nothing to the running level');
});

test('negative basis draws downward',()=>{
  const build=priceBuild(tulsa()),basis=priceBuildBars(build).find(b=>b.key==='basis');
  assert(basis.value<0);assert(basis.to<basis.from);
  const negative=tulsa({},12,loadCase(data,'Tulsa',12).market_curve.map(r=>({...r,basis_usd_mmbtu:-1})));
  const bar=priceBuildBars(priceBuild(negative)).find(b=>b.key==='basis');
  assert(Math.abs(bar.value+1)<1e-12);assert(bar.to<bar.from);
});

test('incomplete market curve leaves Henry Hub, basis and the final price Pending',()=>{
  const curve=loadCase(data,'Tulsa',12).market_curve.map((r,i)=>i===3?{...r,basis_usd_mmbtu:null}:r);
  const offer=tulsa({},12,curve),build=priceBuild(offer);
  assert.equal(offer.fixed_price,null);
  assert.equal(build.steps.find(s=>s.key==='basis').value,null);
  assert.notEqual(build.steps.find(s=>s.key==='hh').value,null,'Henry Hub is still known');
  assert.equal(build.total,null);assert.equal(build.total_label,'Pending');
  assert.equal(priceBuildBars(build).at(-1).pending,true);
});

test('a 24-month offer sums the same way',()=>{
  const offer=tulsa({costs:COSTS},24,[...loadCase(data,'Tulsa',12).market_curve,...Array.from({length:12},(_,i)=>({month:`2028-${String(i+1).padStart(2,'0')}`,forward_usd_mmbtu:3.5,basis_usd_mmbtu:-.2}))]);
  const build=priceBuild(offer);assert(Math.abs(total(build)-offer.fixed_price)<1e-9);
});

test('internal PDF carries the price build table; the customer PDF contains none of it',()=>{
  const s=snapshot(tulsa());
  const internal=text(createProposalPdf(s,{internal:true})),customer=text(createProposalPdf(s));
  for(const needed of ['Henry Hub, volume-weighted','Regional basis, volume-weighted','Partial subtotal','-$0.2690','$3.0171'])assert(internal.includes(needed),needed);
  for(const forbidden of ['volume-weighted','Henry Hub','Regional basis','Target margin','-$0.2690','Price build','Residual risk','Credit allowance'])assert(!customer.includes(forbidden),forbidden);
  assert(!internal.includes(s.customer));
});

test('internal PDF with the price build keeps its page count',()=>{
  for(const term of [12,24]){
    const curve=term===24?[...loadCase(data,'Tulsa',12).market_curve,...Array.from({length:12},(_,i)=>({month:`2028-${String(i+1).padStart(2,'0')}`,forward_usd_mmbtu:3.5,basis_usd_mmbtu:-.2}))]:null;
    const s=snapshot(tulsa({costs:COSTS},term,curve));
    assert.equal(pages(createProposalPdf(s,{internal:true})),term===24?5:4);
    assert.equal(pages(createProposalPdf(s)),term===24?3:2);
  }
});
