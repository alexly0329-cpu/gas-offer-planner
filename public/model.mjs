/** Browser implementation of the unchanged Python pricing, credit and cash models. */
export const CITIES = ['Tulsa','Omaha','Columbus'];
export const COST_KEYS = ['fuel_pct','fuel_basis','supplier_fee','financing','residual_risk','credit_allowance'];
const ALLOWANCES = ['supplier_fee','financing','residual_risk','credit_allowance'];
const clone = value => structuredClone(value);
const sum = values => {
  let total=0, correction=0;
  for(const value of values){const next=total+value;correction+=Math.abs(total)>=Math.abs(value)?(total-next)+value:(value-next)+total;total=next;}
  return total+correction;
};
function number(value,name,{min=null,max=null,optional=false,days=null}={}){
  if(value==null&&optional)return null;
  if(value==null||typeof value==='boolean'||(typeof value==='string'&&!value.trim())||!['number','string'].includes(typeof value))throw new Error(`${name} must be a finite number`);
  const n=Number(value);
  if(!Number.isFinite(n)||(min!==null&&n<min)||(max!==null&&n>max)||(days!==null&&(!Number.isInteger(n)||n>days)))throw new Error(`${name} is outside its valid range`);
  return n;
}
const finite = value => {if(!Number.isFinite(value))throw new Error('Financial amounts exceed the finite range');return value;};
const option=(options,key,fallback)=>options[key]===undefined?fallback:options[key];
const isMonth=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const monthAt=i=>`${2027+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`;

export function validateCurve(curve,expectedMonths){
  if(!Array.isArray(curve)||!Array.isArray(expectedMonths)||curve.length!==expectedMonths.length)throw new Error('Curve must contain exactly the expected months in chronological order');
  let previous='';
  return curve.map((row,i)=>{
    if(!row||typeof row!=='object'||!isMonth(row.month)||row.month!==expectedMonths[i]||row.month<=previous)throw new Error('Curve must contain exactly the expected months in chronological order');
    previous=row.month;
    const result={month:row.month};
    for(const key of ['forward_usd_mmbtu','basis_usd_mmbtu']){
      if(!Object.hasOwn(row,key))throw new Error('Market curve must contain month, forward and basis columns');
      const value=row[key];
      result[key]=value==null||(typeof value==='string'&&!value.trim())?null:number(value,key);
      if(key==='forward_usd_mmbtu'&&result[key]!==null&&result[key]<=0)throw new Error('Henry Hub must be positive');
    }
    return result;
  });
}

export function loadCase(data,city,term=12){
  if(!CITIES.includes(city)||!data?.cases?.[city])throw new Error('Unsupported city');
  if(!Number.isInteger(term)||![12,24].includes(term))throw new Error('Term must be 12 or 24 months');
  const base=clone(data.cases[city]);
  const months=Array.from({length:term},(_,i)=>monthAt(i));
  const curve=months.map(month=>{
    const found=base.market_curve.find(row=>row.month===month);
    return found?clone(found):{month,forward_usd_mmbtu:null,basis_usd_mmbtu:null};
  });
  return {...base,term,months,reference_hdd:Array.from({length:term},(_,i)=>base.reference_hdd[i%12]),
    reference_blocks:Array.from({length:term},(_,i)=>base.reference_blocks[i%12]),market_curve:validateCurve(curve,months)};
}

export function buildOffer(caseData,curve=null,options={}){
  const annual_gas=number(option(options,'annual_gas',6100),'annual gas',{min:0});
  if(annual_gas===0)throw new Error('Annual gas must be positive');
  const weather_pct=number(option(options,'weather_pct',20),'weather percentage',{min:-100});
  const margin=number(option(options,'margin',.2),'margin',{min:0});
  const supplied=options.costs??{};
  if(typeof supplied!=='object'||Array.isArray(supplied)||Object.keys(supplied).some(key=>!COST_KEYS.includes(key)))throw new Error('Unknown cost input');
  const costs=Object.fromEntries(COST_KEYS.map(key=>[key,supplied[key]??null]));
  for(const key of ['fuel_pct',...ALLOWANCES])if(costs[key]!==null)costs[key]=number(costs[key],key,{min:0});
  if(costs.fuel_basis!==null&&!['receipts','customer'].includes(costs.fuel_basis))throw new Error('Fuel basis must be receipts or customer');
  if(costs.fuel_basis==='receipts'&&costs.fuel_pct!==null&&costs.fuel_pct>=100)throw new Error('Fuel percentage of receipts must be below 100');
  const validated=validateCurve(curve??caseData.market_curve,caseData.months),scale=annual_gas/6100,base=caseData.base_monthly*scale;
  const months=validated.map((row,i)=>{
    const reference=caseData.reference_blocks[i]*scale,q=base+(reference-base)*(1+weather_pct/100);
    if(!Number.isFinite(q)||q<0)throw new Error('Modeled block volumes must be finite and positive in total');
    const regional=row.forward_usd_mmbtu===null||row.basis_usd_mmbtu===null?null:finite(row.forward_usd_mmbtu+row.basis_usd_mmbtu);
    return {month:row.month,reference_block_mmbtu:reference,block_mmbtu:q,modeled_use_mmbtu:q,
      hh_reference:row.forward_usd_mmbtu,basis_reference:row.basis_usd_mmbtu,regional_reference:regional};
  });
  const volume=finite(sum(months.map(row=>row.block_mmbtu)));
  if(volume<=0)throw new Error('Modeled block volumes must be positive in total');
  const complete=months.every(row=>row.regional_reference!==null);
  const commodity=complete?finite(sum(months.map(row=>row.block_mmbtu*row.regional_reference))/volume):null;
  const fuelKnown=costs.fuel_pct!==null&&costs.fuel_basis!==null,f=costs.fuel_pct/100;
  const factor=fuelKnown?(costs.fuel_basis==='receipts'?1/(1-f):1+f):1;
  const fuel_adder=fuelKnown&&commodity!==null?finite(commodity*(factor-1)):null;
  const other=sum(ALLOWANCES.map(key=>costs[key]??0));
  const fixed_price=commodity!==null?finite(commodity+(fuel_adder??0)+margin+other):null;
  for(const row of months){row.hh_hedge_mmbtu=finite(row.block_mmbtu*factor);row.basis_hedge_mmbtu=row.hh_hedge_mmbtu;}
  const missing_inputs=COST_KEYS.filter(key=>costs[key]===null);
  if(!complete)missing_inputs.unshift('market_curve');
  return {case:clone(caseData),city:caseData.city,term:caseData.term,annual_gas,weather_pct,margin,costs,months,volume,
    expected_usage:volume,commodity,fuel_adder,fixed_price,block_value:fixed_price===null?null:finite(fixed_price*volume),
    contribution:finite(volume*margin),missing_inputs,pricing_status:missing_inputs.length?(complete?'Partial subtotal':'Market curve incomplete'):'Complete illustrative estimate'};
}

export function stressOffer(frozen,weatherPct){
  const weather_pct=number(weatherPct,'weather percentage',{min:-100}),result=clone(frozen);
  const base=result.case.base_monthly*result.annual_gas/6100;
  for(const row of result.months){row.modeled_use_mmbtu=finite(base+(row.reference_block_mmbtu-base)*(1+weather_pct/100));if(row.modeled_use_mmbtu<0)throw new Error('Stressed usage must be nonnegative');}
  result.weather_pct=weather_pct;result.expected_usage=finite(sum(result.months.map(row=>row.modeled_use_mmbtu)));
  result.deviation_value=result.months.every(row=>row.regional_reference!==null)?finite(sum(result.months.map(row=>(row.modeled_use_mmbtu-row.block_mmbtu)*row.regional_reference))):null;
  return result;
}

function weightedQuantile(entries,fraction){
  const sorted=entries.slice().sort((a,b)=>a.value-b.value),total=sum(sorted.map(row=>row.count));
  const position=(total-1)*fraction,low=Math.floor(position),high=Math.ceil(position);
  const at=index=>{let cumulative=0;for(const row of sorted){cumulative+=row.count;if(index<cumulative)return row.value;}return sorted.at(-1).value;};
  return at(low)+(at(high)-at(low))*(position-low);
}

export function simulateJointRisk(offer,data){
  const scope='Base commodity only: matched monthly index for deviations and paired HH and basis hedges.';
  const limitations=['Historical paired annual weather and HH spot are proxies; fixed basis.','Two-year terms independently resample annual blocks.','Daily/monthly mismatch, fuel, fees, financing and credit are excluded; total supplier risk premium remains unpriced.'];
  const years=offer.case.source_years;
  const result={available:false,reason:'Complete monthly market curve required',frame:null,loss_p95:null,risk_premium:null,unhedged_loss_p95:null,
    baseline_contribution:null,n_sims:data.n_sims,n_unique_years:years.length,years:clone(years),scope,limitations,histogram:[],weighted_paths:[]};
  if(offer.commodity===null)return result;
  const groups=years.map(year=>offer.case.weather.filter(row=>row.year===year).sort((a,b)=>a.calendar_month-b.calendar_month));
  if(groups.some(rows=>rows.length!==12||rows.some((row,i)=>row.calendar_month!==i+1||!Number.isFinite(row.hdd)||row.hdd<0||!Number.isFinite(row.hh_spot_usd_mmbtu)||row.hh_spot_usd_mmbtu<=0)))throw new Error('Invalid paired history');
  const meanPrices=Array.from({length:12},(_,i)=>sum(groups.map(rows=>rows[i].hh_spot_usd_mmbtu))/years.length);
  const q=offer.months.map(row=>row.block_mmbtu),volume=sum(q),baseline=finite(volume*offer.margin);
  const p=sum(offer.months.map(row=>row.block_mmbtu*row.regional_reference))/volume+offer.margin;
  const combinations=data.draws[`${years.length}_${offer.term}`];
  if(!Array.isArray(combinations)||sum(combinations.map(row=>row.count))!==data.n_sims)throw new Error('Invalid fixed-seed scenario counts');
  const scale=offer.annual_gas/6100,weighted_paths=[];
  for(const combination of combinations){
    if(!Number.isSafeInteger(combination.count)||combination.count<=0||combination.indices.length!==offer.term/12)throw new Error('Invalid scenario weight');
    let physical=0,deviations=0,totalVolume=0,hedge=0;
    for(let i=0;i<offer.term;i++){
      const idx=combination.indices[Math.floor(i/12)],source=groups[idx]?.[i%12],row=offer.months[i];
      if(!source)throw new Error('Invalid scenario source year');
      const actual=scale*(offer.case.base_monthly+offer.case.beta*source.hdd*(1+offer.weather_pct/100));
      const index=row.hh_reference*source.hh_spot_usd_mmbtu/meanPrices[i%12]+row.basis_reference;
      physical+=actual*index;deviations+=(actual-q[i])*index;totalVolume+=actual;hedge+=q[i]*(index-row.regional_reference);
    }
    const unhedged=finite(volume*p+deviations-physical),hedged=finite(unhedged+hedge);
    if(Math.abs(hedged-baseline)>1e-7+Math.abs(baseline)*1e-10)throw new Error('Commodity reconciliation failed');
    weighted_paths.push({hedged_contribution:baseline,unhedged_contribution:unhedged,total_volume_mmbtu:finite(totalVolume),count:combination.count});
  }
  const losses=weighted_paths.map(row=>({value:Math.max(baseline-row.unhedged_contribution,0),count:row.count}));
  const maximum=Math.max(1,...losses.map(row=>row.value)),width=maximum/30;
  const histogram=Array.from({length:30},(_,i)=>({start:i*width,end:(i+1)*width,matched_count:i===0?data.n_sims:0,unhedged_count:0}));
  for(const row of losses)histogram[Math.min(29,Math.floor(row.value/width))].unhedged_count+=row.count;
  return {...result,available:true,reason:null,loss_p95:0,risk_premium:0,unhedged_loss_p95:weightedQuantile(losses,.95),baseline_contribution:baseline,weighted_paths,histogram};
}

const POLICY_NOTE='Illustrative conservative analyst heuristic, not an empirical PD/LGD model or a rating-agency model. Each metric earns 0–2 points: current ratio <1 / 1–<1.5 / ≥1.5; debt/annual EBITDA >4 / >2–4 / ≤2; annual EBIT/annual interest expense <2 / 2–<4 / ≥4. Collateral or prepayment is required unless all three metrics are strong (6/6) with no review flags. The score does not price a default premium or determine a collateral amount.';
function creditNumber(value,label,flags){
  if(value==null||(typeof value==='string'&&!value.trim())){flags.push(`${label} is missing; review required.`);return null;}
  const n=typeof value==='boolean'||!['number','string'].includes(typeof value)?NaN:Number(value);
  if(!Number.isFinite(n)){flags.push(`${label} must be a finite number; review required.`);return null;}
  return n;
}
function divide(numerator,denominator,label,flags){
  if(numerator===null||denominator===null)return null;
  const result=numerator/denominator;
  if(!Number.isFinite(result)){flags.push(`${label} is outside the finite numeric range; review required.`);return null;}
  return result;
}
export function ratiosFromFinancials(amounts={}){
  const flags=[],values={};
  for(const[key,label]of [['current_assets','Current assets'],['current_liabilities','Current liabilities'],['debt','Interest-bearing debt'],['ebitda','Annual EBITDA'],['ebit','Annual EBIT'],['interest_expense','Annual interest expense']]){
    let value=creditNumber(amounts[key],label,flags);
    if(value!==null){
      if(['current_assets','debt'].includes(key)&&value<0){flags.push(`${label} cannot be negative; review required.`);value=null;}
      else if(['current_liabilities','ebitda','interest_expense'].includes(key)&&value<=0){flags.push(`${label} must be positive; ratio unavailable and review required.`);value=null;}
      else if(key==='ebit'&&value<0)flags.push('Annual EBIT is negative; weak interest coverage and review required.');
    }
    values[key]=value;
  }
  return {current_ratio:divide(values.current_assets,values.current_liabilities,'Current ratio',flags),
    debt_ebitda:divide(values.debt,values.ebitda,'Debt/EBITDA',flags),
    interest_coverage:divide(values.ebit,values.interest_expense,'EBIT/interest',flags),flags};
}
export function assessCredit(inputs={}){
  const review_flags=typeof inputs.flags==='string'?[inputs.flags]:Array.from(inputs.flags??[]),ratios={};
  for(const[key,label]of [['current_ratio','Current ratio'],['debt_ebitda','Debt/EBITDA'],['interest_coverage','EBIT/interest']]){
    let value=creditNumber(inputs[key],label,review_flags);
    if(value!==null&&value<0){
      if(key==='interest_coverage')review_flags.push('EBIT/interest is negative; weak coverage and review required.');
      else{review_flags.push(`${label} cannot be negative; review required.`);value=null;}
    }
    ratios[key]=value;
  }
  const {current_ratio:current,debt_ebitda:leverage,interest_coverage:coverage}=ratios;
  const metric_scores={current_ratio:current===null?null:current<1?0:current<1.5?1:2,
    debt_ebitda:leverage===null?null:leverage>4?0:leverage>2?1:2,
    interest_coverage:coverage===null?null:coverage<2?0:coverage<4?1:2};
  const score=Object.values(metric_scores).includes(null)?null:sum(Object.values(metric_scores)),flags=[...new Set(review_flags)];
  const collateral_required=score!==6||flags.length>0;
  return {ratios,metric_scores,score,rating:flags.length?'Review required':score===6?'All three metrics strong':'Payment protection required',collateral_required,
    collateral_policy:collateral_required?'Require collateral or prepayment. Amount requires separate exposure review.':'No collateral required under this illustrative rule; all three metrics are strong with no review flags.',
    review_flags:flags,policy_note:POLICY_NOTE};
}

function invoiceDate(month){const[y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0));}
const addDays=(date,days)=>new Date(date.getTime()+days*86400000);
const isoDay=date=>date.toISOString().slice(0,10);
function cashSchedule(rows,customerDays,supplierDays,delay=0){
  const events=new Map();
  for(const row of rows){
    const invoice=invoiceDate(row.month);
    for(const[due,amount]of [[addDays(invoice,customerDays+delay),row.revenue],[addDays(invoice,supplierDays),-row.total_cost]]){
      const date=isoDay(due),event=events.get(date)??{cash_in:0,cash_out:0};
      event[amount>=0?'cash_in':'cash_out']+=Math.abs(amount);events.set(date,event);
    }
  }
  let balance=0,minimum=0;const monthly=new Map();
  for(const[date,event]of [...events].sort(([a],[b])=>a.localeCompare(b))){
    balance=finite(balance+event.cash_in-event.cash_out);minimum=Math.min(minimum,balance);
    const month=date.slice(0,7),m=monthly.get(month)??{cash_in:0,cash_out:0,net_cash:0};
    m.cash_in=finite(m.cash_in+event.cash_in);m.cash_out=finite(m.cash_out+event.cash_out);m.net_cash=finite(m.net_cash+event.cash_in-event.cash_out);monthly.set(month,m);
  }
  const last=[...monthly.keys()].sort().at(-1),cash_months=[];
  let [y,m]=rows[0].month.split('-').map(Number),closing=0;
  while(true){
    const month=`${y}-${String(m).padStart(2,'0')}`,flow=monthly.get(month)??{cash_in:0,cash_out:0,net_cash:0};
    closing=finite(closing+flow.net_cash);cash_months.push({month,...flow,closing_cash:closing});
    if(month===last)break;if(++m===13){m=1;y++;}
  }
  return {funding:Math.max(0,-minimum),months:cash_months};
}
function receivables(rows,customerDays){
  const events=new Map();
  for(const row of rows){
    const amount=Math.max(row.revenue,0),invoice=invoiceDate(row.month);
    for(const[date,type]of [[isoDay(invoice),'invoice'],[isoDay(addDays(invoice,customerDays)),'collection']]){
      const e=events.get(date)??{invoice:0,collection:0};e[type]+=amount;events.set(date,e);
    }
  }
  let balance=0,peak=0;
  for(const[,event]of [...events].sort(([a],[b])=>a.localeCompare(b))){balance+=event.invoice;peak=Math.max(peak,balance);balance=Math.max(0,balance-event.collection);}
  return finite(peak);
}
export function financialPlan(offer,options={}){
  const inputs={customer_days:number(options.customer_days,'Customer payment days',{min:0,days:365,optional:true}),
    supplier_days:number(options.supplier_days,'Supplier payment days',{min:0,days:365,optional:true}),
    payment_delay_days:number(option(options,'payment_delay_days',0),'Payment delay',{min:0,days:90}),
    unsecured_limit:number(options.unsecured_limit,'Unsecured limit',{min:0,optional:true}),
    additional_exposure:number(options.additional_exposure,'Additional exposure',{min:0,optional:true})};
  const totals=['revenue','cost','contribution','break_even_price','operating_funding','delayed_funding','peak_receivables','exposure','effective_unsecured_limit','protection_gap'];
  const result=Object.fromEntries(totals.map(key=>[key,null]));
  result.inputs=inputs;result.missing=[];result.cash_months=[];
  const original=offer.months;
  result.months=original.map(row=>({month:row.month,revenue:null,commodity_cost:null,cost_allowances:null,total_cost:null,contribution:null}));
  const costs=offer.costs??{},missing=['fuel_pct','fuel_basis',...ALLOWANCES].filter(key=>costs[key]==null);
  if(!original.length||original.some(row=>!Number.isFinite(row.block_mmbtu)||row.block_mmbtu<0||!Number.isFinite(row.modeled_use_mmbtu)||row.modeled_use_mmbtu<0)||sum(original.map(row=>row.block_mmbtu))<=0)throw new Error('Financial plan requires valid positive total blocks and nonnegative usage');
  if(offer.fixed_price==null||!Number.isFinite(offer.fixed_price)||original.some(row=>row.regional_reference==null||!Number.isFinite(row.regional_reference)))missing.push('market_curve');
  const credit=options.credit??{},strong=credit.score===6&&credit.collateral_required===false&&!credit.review_flags?.length;
  result.effective_unsecured_limit=strong?inputs.unsecured_limit:0;
  result.missing=[...missing,...['customer_days','supplier_days','additional_exposure'].filter(key=>inputs[key]===null)];
  if(strong&&inputs.unsecured_limit===null)result.missing.push('unsecured_limit');
  if(missing.length)return result;
  const fuel=number(costs.fuel_pct,'Fuel percentage',{min:0})/100;
  let factor;
  if(costs.fuel_basis==='receipts'&&fuel<1)factor=1/(1-fuel);
  else if(costs.fuel_basis==='customer')factor=1+fuel;
  else throw new Error('Invalid fuel convention or percentage');
  const allowance=sum(ALLOWANCES.map(key=>number(costs[key],key,{min:0}))),deviations=[];
  result.months=original.map(row=>{
    const deviation=(row.modeled_use_mmbtu-row.block_mmbtu)*row.regional_reference;deviations.push(deviation);
    const revenue=finite(offer.fixed_price*row.block_mmbtu+deviation),commodity_cost=finite(row.modeled_use_mmbtu*row.regional_reference*factor),cost_allowances=finite(row.block_mmbtu*allowance);
    const total_cost=finite(commodity_cost+cost_allowances);
    return {month:row.month,revenue,commodity_cost,cost_allowances,total_cost,contribution:finite(revenue-total_cost)};
  });
  result.revenue=finite(sum(result.months.map(row=>row.revenue)));result.cost=finite(sum(result.months.map(row=>row.total_cost)));
  result.contribution=finite(sum(result.months.map(row=>row.contribution)));
  result.break_even_price=finite((result.cost-sum(deviations))/sum(original.map(row=>row.block_mmbtu)));
  if(inputs.customer_days!==null){
    result.peak_receivables=receivables(result.months,inputs.customer_days);
    if(inputs.additional_exposure!==null){
      result.exposure=finite(result.peak_receivables+inputs.additional_exposure);
      if(result.effective_unsecured_limit!==null)result.protection_gap=Math.max(0,result.exposure-result.effective_unsecured_limit);
    }
  }
  if(inputs.customer_days!==null&&inputs.supplier_days!==null){
    const base=cashSchedule(result.months,inputs.customer_days,inputs.supplier_days);
    result.operating_funding=base.funding;result.cash_months=base.months;
    result.delayed_funding=cashSchedule(result.months,inputs.customer_days,inputs.supplier_days,inputs.payment_delay_days).funding;
  }
  return result;
}
