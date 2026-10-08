const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function setup(fetchRoute) {
    class Element {
        constructor() { this.children=[]; this.events={}; this.value=''; this.hidden=false; this.classList={add(){},remove(){},toggle(){}}; }
        addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
        async emit(type) { for(const fn of this.events[type] || []) await fn({preventDefault(){},key:''}); }
        replaceChildren(...children) { this.children=children; }
        append(...children) { this.children.push(...children); }
        setAttribute() {} focus() {}
        get firstChild() { return this.children[0]; }
    }
    const elements=new Map();
    const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
    const mode=new Element(); mode.value='car';
    get('route-form').querySelectorAll=()=>[mode];
    get('route-form').querySelector=()=>mode;
    const document={getElementById:get,querySelector:()=>get('sidebar-header'),createElement:()=>new Element(),addEventListener(){}};
    const layer=()=>({addTo(){return this;},bindTooltip(){return this;},clearLayers(){},on(){return this;},getBounds(){return {isValid:()=>true};}});
    const map={on(){},getContainer:()=>get('map'),removeLayer(){},closePopup(){},fitBounds(){},setView(){}};
    const window={matchMedia:()=>({matches:false})};
    let success, failure;
    const navigator={geolocation:{getCurrentPosition(ok,error){success=ok;failure=error;}}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/routing.js'),'utf8'),{
        window,document,navigator,L:{layerGroup:layer,circleMarker:layer,geoJSON:layer,polyline:layer},fetch:fetchRoute,AbortController,setTimeout,clearTimeout
    });
    const origin={type:'Feature',properties:{id:2,ten_dia_diem:'Bảo tàng',ten_tinh:'Hà Nội'},geometry:{type:'Point',coordinates:[105.84,21.02]}};
    const ui=window.createRoutingUI(map,{showSidebar(){},findOrigins:()=>[origin]});
    ui.open({properties:{id:1,ten_dia_diem:'Điểm đến'}});
    return {get,ui,mode,geolocation:{success:()=>success,failure:()=>failure}};
}
function response(body) {
    return {ok:true,json:async()=>({start:body.start,destination:{lat:21.03,lng:105.85,name:'Điểm đến'},
        snaps:{start:{coordinates:[body.start.lng,body.start.lat],gapMeters:0},end:{coordinates:[105.85,21.03],gapMeters:0}},
        routes:[{distanceMeters:1000,durationSeconds:240,geometry:{type:'LineString',coordinates:[[body.start.lng,body.start.lat],[105.85,21.03]]},steps:[]}]})};
}
test('selecting an origin suggestion sends its coordinates and destination ID',async()=>{
    let payload;
    const {get}=setup(async(url,options)=>{payload=JSON.parse(options.body);return response(payload);});
    get('route-start').value='bao tang'; await get('route-start').emit('input');
    assert.equal(get('route-start-results').hidden,false);
    await get('route-start-results').firstChild.emit('click');
    await get('route-form').emit('submit');
    assert.deepEqual(payload,{start:{lat:21.02,lng:105.84},destinationId:1,mode:'car'});
    assert.equal(get('route-options').children.length,1);
    assert.equal(get('route-submit').disabled,false);
});
test('changing origin discards an old route response and pending geolocation',async()=>{
    let finish;
    const {get,geolocation}=setup((url,options)=>new Promise(resolve=>{finish=()=>resolve(response(JSON.parse(options.body)));}));
    get('route-start').value='21.02, 105.84';
    const pending=get('route-form').emit('submit');
    get('route-start').value='21.01, 105.83'; await get('route-start').emit('input');
    finish(); await pending;
    assert.equal(get('route-options').children.length,0);
    await get('route-location').emit('click');
    get('route-start').value='21, 105'; await get('route-start').emit('input');
    geolocation.success()({coords:{latitude:20,longitude:104}});
    geolocation.failure()();
    assert.equal(get('route-start').value,'21, 105');
    assert.doesNotMatch(get('route-status').textContent,/Không lấy được vị trí/);
});
