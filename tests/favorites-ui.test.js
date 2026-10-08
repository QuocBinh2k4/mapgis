const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../public/js', name), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup(user, request) {
    const events = new Map(), calls = [];
    const window = {
        MapAuth: { user, ready: Promise.resolve(), request: async (url, options) => { calls.push({url,options}); return request(url,options); } },
        addEventListener(name, handler) { if (!events.has(name)) events.set(name,[]); events.get(name).push(handler); },
        dispatchEvent(event) { for (const handler of events.get(event.type) || []) handler(event); }
    };
    const context = vm.createContext({window, CustomEvent: class { constructor(type) { this.type=type; } }, console});
    vm.runInContext(source('favorites.js'),context);
    const changeUser = value => { window.MapAuth.user=value; window.dispatchEvent({type:'mapgis-auth-change'}); };
    return {window,context,calls,changeUser,favorites:window.MapFavorites};
}

test('guest favorites never fetch another account and signed-in favorites persist through the API',async()=>{
    const guest=setup(null,()=>{throw Error('Unexpected request');});
    await guest.favorites.ready; assert.equal(guest.favorites.status,'guest'); assert.equal(guest.calls.length,0);
    const page=setup({id:'member'},async()=>({items:[{id:2},{id:1}]}));
    await page.favorites.ready;
    assert.equal(page.favorites.has(2),true); assert.equal(page.favorites.count,2);
    await page.favorites.setSaved(3,true);
    assert.equal(page.calls.at(-1).options.method,'PUT');
    assert.deepEqual(Array.from(page.favorites.orderedIds),[3,2,1]);
    await page.favorites.setSaved(2,false);
    assert.equal(page.calls.at(-1).options.method,'DELETE'); assert.equal(page.favorites.has(2),false);
});

test('failed removal preserves the saved place and releases the busy state',async()=>{
    const page=setup({id:'member'},async(url,options)=>{
        if(options)throw Error('Offline');return {items:[{id:1}]};
    });
    await page.favorites.ready;
    await assert.rejects(page.favorites.setSaved(1,false),/Offline/);
    assert.equal(page.favorites.has(1),true);assert.equal(page.favorites.isPending(1),false);
});

test('responses from a previous account cannot populate favorites after logout or switching accounts',async()=>{
    let finish;
    const page=setup({id:'first'},()=>new Promise(resolve=>{finish=resolve;}));
    await settle(); page.changeUser(null);
    finish({items:[{id:99}]});await page.favorites.ready;
    assert.equal(page.favorites.status,'guest');assert.equal(page.favorites.count,0);
    page.window.MapAuth.request=async()=>({items:[{id:2}]});page.changeUser({id:'second'});await settle();
    assert.equal(page.favorites.has(2),true);assert.equal(page.favorites.has(99),false);
});

test('an in-flight save cannot leak a previous account favorite into the next account',async()=>{
    let finish;
    const page=setup({id:'first'},async(url,options)=>options ? new Promise(resolve=>{finish=resolve;}) : {items:[]});
    await page.favorites.ready;
    const saving=page.favorites.setSaved(99,true);
    page.window.MapAuth.request=async()=>({items:[{id:2}]});page.changeUser({id:'second'});await settle();
    finish({saved:true});await saving;
    assert.equal(page.favorites.has(99),false);assert.equal(page.favorites.has(2),true);
});

function mapPage(page) {
    class Element {
        constructor(tag='div') { this.tag=tag;this.children=[];this.events={};this.attributes={};this.value='';this.hidden=false;this.style={};this.dataset={};this.textContent=''; const classes=new Set();this.classList={contains:v=>classes.has(v),toggle:(v,on)=>on?classes.add(v):classes.delete(v)}; }
        addEventListener(name,handler) { (this.events[name] ||= []).push(handler); }
        async emit(name) { for(const handler of this.events[name] || [])await handler({preventDefault(){}}); }
        append(...nodes) { this.children.push(...nodes); }
        replaceChildren(...nodes) { this.children=nodes; }
        setAttribute(name,value) { this.attributes[name]=value; }
        focus() {} remove() {} showModal() {} close() {}
        get firstChild() { return this.children[0]; }
    }
    const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
    const nodes=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],new Element()]));
    const tags=['all','DI_TICH','DANH_LAM'].map(type=>{const tag=new Element('button');tag.dataset.type=type;return tag;});
    nodes.get('route-panel').hidden=true;
    const get=id=>{assert.ok(nodes.has(id),`Missing HTML element: ${id}`);return nodes.get(id);};
    const document={getElementById:get,baseURI:'http://localhost:3000/',createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),querySelector:()=>new Element(),querySelectorAll:()=>tags,addEventListener(){}};
    const layers=new Set(),markers=[];
    const group={addTo(){return this;},clearLayers(){layers.clear();},hasLayer:marker=>layers.has(marker),addLayer:marker=>layers.add(marker),addLayers:items=>items.forEach(item=>layers.add(item)),removeLayer:marker=>layers.delete(marker),removeLayers:items=>items.forEach(item=>layers.delete(item)),zoomToShowLayer:(marker,callback)=>callback()};
    const map={invalidateSize(){},setView(){},fitBounds(){},closePopup(){},attributionControl:{addAttribution(){}}};
    const layer=()=>({addTo(){return this;},getBounds:()=>({isValid:()=>false})});
    const L={map:()=>map,tileLayer:layer,featureGroup:()=>group,control:{zoom:layer,layers:layer},geoJSON:layer,divIcon:()=>({}),marker(coords){const marker={coords,bindPopup(popup){this.popup=popup;return this;},bindTooltip(){return this;},on(){},getLatLng:()=>coords,openPopup(){this.open=true;},isPopupOpen(){return !!this.open;}};markers.push(marker);return marker;}};
    const features=[1,2,3].map(id=>({type:'Feature',geometry:{type:'Point',coordinates:[105+id/100,21]},properties:{id,ten_dia_diem:`Điểm ${id}`,ma_loai:'DI_TICH',ten_tinh:'Hà Nội'}}));
    Object.assign(page.window,{matchMedia:()=>({matches:false,addEventListener(){}})});
    Object.assign(page.context,{document,L,URL,URLSearchParams,AbortController,setTimeout:()=>0,clearTimeout(){},location:{search:'',assign(){}} ,fetch:async route=>({ok:true,json:async()=>({type:'FeatureCollection',features:route==='/api/diemdulich'?features:[]})})});
    vm.runInContext(source('app.js'),page.context);
    return {get,layers,markers};
}

test('map favorites filter markers, open a saved point and remove it from both list and popup',async()=>{
    const page=setup({id:'member'},async()=>({items:[{id:2}]}));await page.favorites.ready;
    const ui=mapPage(page);await settle();
    assert.equal(ui.layers.size,3);
    await ui.get('view-favorites').emit('click');
    assert.equal(ui.layers.size,1);assert.equal(ui.get('result-list').children.length,1);
    assert.equal(ui.get('results-heading').textContent,'Địa điểm yêu thích của bạn');
    const row=ui.get('result-list').children[0];await row.children[0].emit('click');assert.equal(ui.markers[1].open,true);
    await row.children[1].emit('click');
    assert.equal(ui.layers.size,0);assert.equal(ui.get('favorites-count').textContent,0);
    assert.equal(ui.markers[1].popup.children.at(-1).textContent,'Thêm vào yêu thích');
    await ui.get('view-explore').emit('click');assert.equal(ui.layers.size,3);
    await ui.markers[0].popup.children.at(-1).emit('click');assert.equal(page.favorites.has(1),true);
    await ui.get('view-favorites').emit('click');assert.equal(ui.layers.size,1);
});

test('guest favorites show a login link and logout clears the visible private list',async()=>{
    const page=setup({id:'member'},async()=>({items:[{id:1}]}));await page.favorites.ready;
    const ui=mapPage(page);await settle();await ui.get('view-favorites').emit('click');
    page.changeUser(null);
    assert.equal(ui.layers.size,0);assert.equal(ui.get('result-count').textContent,'Chưa đăng nhập');
    const state=ui.get('result-list').children[0];
    assert.ok(state.children.at(-1).href.startsWith('/account?return='));
});
