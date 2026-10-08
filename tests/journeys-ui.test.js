const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {itineraryInput}=require('../services/journeys');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function setup({user={id:'member'},search='',request}={}) {
    class Element {
        constructor(tag='div') {this.tag=tag;this.children=[];this.events={};this.attributes={};this.value='';this.hidden=false;this.disabled=false;this.dataset={};this.textContent='';this.classList={add(){},remove(){}};}
        append(...items){this.children.push(...items);}
        replaceChildren(...items){this.children=items;}
        setAttribute(key,value){this.attributes[key]=value;}
        addEventListener(name,action){(this.events[name] ||= []).push(action);}
        async emit(name,event={}) {for(const action of this.events[name] || [])await action({preventDefault(){},stopPropagation(){},...event});await settle();}
        focus(){} select(){}
    }
    const html=fs.readFileSync(path.join(__dirname,'../public/journeys.html'),'utf8');
    const nodes=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
    nodes.get('collection-view').value='want';
    const get=id=>{assert.ok(nodes.has(id),id);return nodes.get(id);};
    const templates=['hagiang','hoian'].map(key=>{const el=new Element('button');el.dataset.template=key;return el;});
    const walk=el=>[el,...el.children.flatMap(child=>walk(child))];
    const document={getElementById:get,createElement:tag=>new Element(tag),querySelectorAll:selector=>selector==='[data-template]'?templates:selector==='#journey-workspace button'?[...nodes.values()].flatMap(walk).filter(el=>el.tag==='button'):[]};
    let trips=[],favorites=[],printed=0;
    const calls=[],events={};
    const fixture=[{id:1,ten_dia_diem:'Chùa Cầu',ten_tinh:'Hội An'},{id:2,ten_dia_diem:'Làng rau Trà Quế',ten_tinh:'Hội An'},{id:3,ten_dia_diem:'Cột cờ Lũng Cú',ten_tinh:'Hà Giang'}];
    const auth={user,ready:Promise.resolve(),request:async(url,options)=>{
        calls.push({url,options});
        if(request)return request(url,options);
        if(url==='/api/diemdulich')return {features:fixture.map(properties=>({properties}))};
        if(url==='/api/me/favorites')return {items:favorites};
        if(url==='/api/me/itineraries' && !options)return {items:trips};
        if(url==='/api/me/itineraries' && options?.method==='POST'){
            const item={...JSON.parse(JSON.stringify(options.body)),id:'trip',version:1,share_token:null};trips=[item];return {item};
        }
        if(url==='/api/me/itineraries/trip' && options?.method==='PUT'){
            const item={...JSON.parse(JSON.stringify(options.body)),id:'trip',version:options.body.version+1,share_token:trips[0].share_token};trips=[item];return {item};
        }
        if(url==='/api/me/itineraries/trip/share') {trips[0].share_token=options.body.enabled?'public-token':null;return {item:JSON.parse(JSON.stringify(trips[0]))};}
        if(url.startsWith('/api/me/favorites/')){favorites=[{id:Number(url.split('/').at(-1)),collection:options.body?.collection}];return {saved:true};}
        throw Error(`Unexpected ${url}`);
    }};
    const window={MapAuth:auth,confirm:()=>true,print:()=>printed++,addEventListener:(name,action)=>{events[name]=action;}};
    const context=vm.createContext({window,document,location:{search,pathname:'/journeys',origin:'http://localhost:3000',href:'http://localhost:3000/journeys'+search},navigator:{clipboard:{writeText:async()=>{}}},URLSearchParams,console});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/journeys.js'),'utf8'),context);
    return {get,calls,auth,templates,events,window,printed:()=>printed,trips:()=>trips,all:()=>[...nodes.values()].flatMap(walk)};
}

test('itinerary validation rejects oversized, duplicate and malformed place lists',()=>{
    const good={title:'  Đi Hội An  ',days:[{places:[1,2]}]};
    assert.equal(itineraryInput(good).title,'Đi Hội An');
    for(const body of [{...good,title:''},{...good,days:[]},{...good,days:Array(31).fill({places:[]})},{...good,days:[{places:[1,1]}]},{...good,days:[{places:['1']}]},{...good,days:[{places:Array.from({length:31},(_,i)=>i+1)}]},{...good,days:Array(6).fill({places:Array.from({length:30},(_,i)=>i+1)})}])assert.throws(()=>itineraryInput(body),{status:400});
});

test('guest planner offers login and never reads private collections or itineraries',async()=>{
    const ui=setup({user:null});await settle();
    assert.equal(ui.get('journey-access').hidden,false);
    assert.equal(ui.get('journey-workspace').hidden,true);
    assert.equal(ui.calls.length,0);
});

test('planner saves collections, reorders points, moves between days, shares, revokes and prints',async()=>{
    const ui=setup();await settle();
    assert.equal(ui.get('journey-workspace').hidden,false);
    ui.get('collection-view').value='all';await ui.get('collection-view').emit('change');
    let row=ui.get('collection-list').children[0];
    let actions=row.children.at(-1);actions.children[0].value='visited';await actions.children[0].emit('change');
    assert.equal(ui.calls.at(-1).options.body.collection,'visited');
    for(let index=0;index<2;index++){
        row=ui.get('collection-list').children[index];await row.children.at(-1).children.at(-1).emit('click');
    }
    const days=()=>ui.get('journey-days').children;
    let stops=days()[0].children[1];
    await stops.children[0].children.at(-1).children[1].emit('click');
    await ui.get('add-day').emit('click');
    stops=days()[0].children[1];
    const daySelect=stops.children[0].children.at(-1).children[2];daySelect.value='1';await daySelect.emit('change');
    await ui.get('save-journey').emit('click');
    assert.deepEqual(JSON.parse(JSON.stringify(ui.trips()[0].days)),[{places:[1]},{places:[2]}]);
    assert.match(ui.get('save-state').textContent,/Đã lưu/);
    await ui.get('share-journey').emit('click');
    assert.match(ui.get('share-url').value,/share=public-token/);
    assert.equal(ui.get('share-panel').hidden,false);
    await ui.get('print-journey').emit('click');assert.equal(ui.printed(),1);
    assert.equal(ui.get('journey-print').children[2].children[1].children[0].textContent,'Chùa Cầu — Hội An');
    await ui.get('stop-share').emit('click');assert.equal(ui.get('share-panel').hidden,true);
});

test('dragging across days persists the new order and a template reports missing places',async()=>{
    const ui=setup();await settle();
    ui.get('collection-view').value='all';await ui.get('collection-view').emit('change');
    await ui.get('collection-list').children[0].children.at(-1).children.at(-1).emit('click');
    await ui.get('add-day').emit('click');
    const days=ui.get('journey-days').children;
    await days[0].children[1].children[0].emit('dragstart',{dataTransfer:{setData(){}}});
    await days[1].children[1].emit('drop');
    await ui.get('save-journey').emit('click');
    assert.deepEqual(JSON.parse(JSON.stringify(ui.trips()[0].days)),[{places:[]},{places:[1]}]);
    await ui.templates[0].emit('click');assert.match(ui.get('journey-status').textContent,/Chưa có trên bản đồ/);
    assert.equal(ui.get('journey-days').children.length,3);
});

test('public share reads only shared itinerary and can print without an account',async()=>{
    const ui=setup({user:null,search:'?share=test',request:async()=>({item:{title:'Hội An',days:[{places:[1]}]},places:[{id:1,ten_dia_diem:'Chùa Cầu'}]})});await settle();
    assert.equal(ui.get('shared-journey').hidden,false);
    assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].url,'/api/shared/itineraries/test');
    await ui.get('print-shared').emit('click');assert.equal(ui.printed(),1);
});

test('failed saves preserve the draft and permit retry',async()=>{
    const ui=setup();await settle();const original=ui.auth.request;
    ui.auth.request=async(url,options)=>{if(options?.method==='POST')throw Error('Offline');return original(url,options);};
    ui.get('journey-title').value='Bản nháp giữ lại';await ui.get('journey-title').emit('input');
    await ui.get('save-journey').emit('click');assert.equal(ui.get('journey-title').value,'Bản nháp giữ lại');assert.equal(ui.get('save-journey').disabled,false);assert.match(ui.get('journey-status').textContent,/Offline/);
    ui.auth.request=original;await ui.get('save-journey').emit('click');assert.equal(ui.trips()[0].title,'Bản nháp giữ lại');
});

test('logout hides private drafts and late saves cannot populate another account',async()=>{
    const ui=setup();await settle();
    let finish;const original=ui.auth.request;
    ui.auth.request=(url,options)=>options?.method==='POST'?new Promise(resolve=>{finish=resolve;}):original(url,options);
    const saving=ui.get('save-journey').emit('click');await settle();
    ui.auth.user=null;ui.events['mapgis-auth-change']();
    finish({item:{id:'old',title:'Private',days:[{places:[1]}],version:1}});await saving;await settle();
    assert.equal(ui.get('journey-workspace').hidden,true);
    assert.equal(ui.get('journey-access').hidden,false);
    ui.auth.user={id:'second'};ui.events['mapgis-auth-change']();await settle();
    assert.equal(ui.trips().length,0);assert.equal(ui.get('journey-title').value,'Chuyến đi của tôi');
});
