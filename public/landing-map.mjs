export const PLACES = {
 Tulsa:{state:'Oklahoma',coordinates:[-95.9928,36.1540],bounds:[-106,30.875,-93,39]},
 Omaha:{state:'Nebraska',coordinates:[-95.9345,41.2565],bounds:[-106,36.875,-93,45]},
 Columbus:{state:'Ohio',coordinates:[-82.9988,39.9612],bounds:[-87,36.875,-78,42.5]}
};
export function projectPoint([lon,lat],[west,south,east,north]){
 return [(lon-west)/(east-west)*1280,(north-lat)/(north-south)*800];
}
export function statePath(geometry,bounds){
 const rings=geometry.type==='Polygon'?geometry.coordinates:geometry.coordinates.flat();
 return rings.map(r=>r.map((p,i)=>(i?'L':'M')+projectPoint(p,bounds).join(',')).join(' ')+'Z').join(' ');
}
export function initLandingMap(onRegion){
 const $=id=>document.getElementById(id);
 const buttons=[...document.querySelectorAll('[data-region]')];
 let states=[],selected='',locked=false;
 function showRegion(region,refresh=false){
  if(region!=='US'&&!Object.hasOwn(PLACES,region))return;
  if(region===selected&&!refresh)return;
  selected=region;
  const place=PLACES[region],bounds=place?.bounds??[-129,16.375,-64,57];
  const imageURL=new URL('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export');
  imageURL.search=new URLSearchParams({bbox:bounds.join(','),bboxSR:'4326',imageSR:'4326',size:'1280,800',format:'jpg',f:'image'});
  const aerial=$('aerial');
  aerial.style.opacity='0';
  aerial.onload=()=>{aerial.style.opacity='1';$('imagery-status').hidden=true;};
  aerial.onerror=()=>{$('imagery-status').hidden=false;};
  aerial.setAttribute('href',imageURL.href);
  const features=place?states.filter(s=>s.name===place.state):states;
  let markup=features.map(s=>{
   const focus=place||Object.values(PLACES).some(p=>p.state===s.name);
   return '<path d="'+statePath(s.geometry,bounds)+'" fill="'+(focus?'#e9fc8208':'none')+'" stroke="'+(focus?'#ecefd4':'#ecefd450')+'" stroke-width="'+(focus?1.7:.7)+'"/>';
  }).join('');
  for(const [city,p] of place?[[region,place]]:Object.entries(PLACES)){
   const [x,y]=projectPoint(p.coordinates,bounds);
   markup+='<g class="map-point" data-city="'+city+'" role="button" tabindex="0" aria-label="Explore '+city+', '+p.state+'"><title>'+city+', '+p.state+'</title><circle cx="'+x+'" cy="'+y+'" r="22" fill="transparent" stroke="none"/><circle cx="'+x+'" cy="'+y+'" r="14" fill="none" stroke="#f4f2e9"/><circle cx="'+x+'" cy="'+y+'" r="3" fill="#e9fc82"/><text x="'+(x+22)+'" y="'+(y+4)+'" fill="#f4f2e9" font-family="Arial,sans-serif" font-size="18" letter-spacing="1">'+city.toUpperCase()+'</text>'+(place?'<text x="'+(x+22)+'" y="'+(y+27)+'" fill="#f4f2e9" font-family="monospace" font-size="12">GEOGRAPHIC FOCUS</text>':'')+'</g>';
  }
  $('map-lines').innerHTML=markup;
  $('map').setAttribute('aria-label',place?place.state+' state boundary with '+region+' marked':'Contiguous United States with Oklahoma, Nebraska and Ohio highlighted');
  $('map-label').innerHTML=place?place.coordinates[1].toFixed(4)+'° N / '+(-place.coordinates[0]).toFixed(4)+'° W<br>'+place.state.toUpperCase()+' / UNITED STATES':'THREE CITIES / ONE CLEARER PLAN<br>CONTIGUOUS UNITED STATES';
  $('hero-region').textContent=place?region+', '+place.state+' / Natural gas research':'Commercial natural gas / Three-region study';
  $('hero-note').innerHTML=place?region+' is the geographic focus.<br>Utility service territory is not shown.':'Select a city to explore its state.<br>Geography, not utility service territory.';
  buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.region===region)));
  applyLock();
 }
 function applyLock(){
  for(const b of buttons)b.disabled=locked&&b.dataset.region!=='US';
  for(const p of $('map-lines').querySelectorAll('.map-point')){
   p.setAttribute('aria-disabled',String(locked));p.setAttribute('tabindex',locked?'-1':'0');
  }
 }
 function choose(region){
  if(region==='US'){showRegion(region);return;}
  if(locked||!Object.hasOwn(PLACES,region))return;
  if(onRegion(region)!==false)showRegion(region);
 }
 buttons.forEach(b=>b.addEventListener('click',()=>choose(b.dataset.region)));
 $('map-lines').addEventListener('click',e=>{const p=e.target.closest('[data-city]');if(p)choose(p.dataset.city);});
 $('map-lines').addEventListener('keydown',e=>{const p=e.target.closest('[data-city]');if(p&&['Enter',' '].includes(e.key)){e.preventDefault();choose(p.dataset.city);}});
 showRegion('US');
 // Boundary downloads must not hold up the planning workspace.
 void (async()=>{try{
  const response=await fetch(new URL('./data/states.json',import.meta.url));
  if(!response.ok)throw new Error('Boundary data unavailable');
  states=await response.json();
  showRegion(selected,true);
 }catch{
  $('map-status').textContent='State outlines could not load. City selection and the planner still work.';
 }})();
 return {showRegion,setLocked(value){locked=value;applyLock();}};
}
