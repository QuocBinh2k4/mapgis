(() => {
    'use strict';
    const auth = window.MapAuth, $ = id => document.getElementById(id);
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().trim();
    let places = new Map(), collections = new Map(), trips = [], draft = null;
    let dirty = false, busy = false, ready = false, generation = 0, owner = null, limit = 20, dragged = null;
    const shareToken = new URLSearchParams(location.search).get('share');
    const selectedPlace = Number(new URLSearchParams(location.search).get('place'));
    const node = (tag,text,className) => { const el=document.createElement(tag); if(text!==undefined) el.textContent=text; if(className) el.className=className; return el; };
    const status = text => { $('journey-status').textContent=text; };
    function button(text, action, className='secondary-button') {
        const el=node('button',text,className); el.type='button'; el.disabled=busy;
        el.addEventListener('click',()=>run(action)); return el;
    }
    async function run(action) {
        if (busy || !ready) return;
        const epoch=generation;
        busy=true; render();
        try { await action(epoch); }
        catch(error) { if(epoch===generation) status(error.message); }
        finally { if(epoch===generation) { busy=false; render(); } }
    }
    function changed() { dirty=true; renderEditor(); }
    function canReplace() { return !dirty || window.confirm('Bỏ các thay đổi chưa lưu của lịch trình hiện tại?'); }
    function openTrip(item) {
        draft=JSON.parse(JSON.stringify(item)); dirty=false;
        $('journey-title').value=draft.title; render();
    }
    function newTrip() { if(canReplace()) openTrip({title:'Chuyến đi của tôi',days:[{places:[]}],version:1}); }
    function placeLink(id) {
        const place=places.get(id), a=node('a',place?.ten_dia_diem || 'Điểm đến đã bị xóa');
        if(place) a.href=`/?place=${id}`;
        return a;
    }
    function renderLibrary() {
        const mode=$('collection-view').value, term=normalize($('place-search').value);
        const found=[...places.values()].filter(p=>(mode==='all' || collections.get(p.id)===mode) && normalize(`${p.ten_dia_diem} ${p.ten_tinh}`).includes(term));
        const list=$('collection-list'); list.replaceChildren();
        if(!found.length) list.append(node('p',mode==='all'?'Không tìm thấy điểm đến.':'Danh sách còn trống. Chọn “Tìm mọi điểm đến” để lưu địa điểm.'));
        for(const p of found.slice(0,limit)) {
            const row=node('div',undefined,'collection-place'); row.append(placeLink(p.id),node('small',p.ten_tinh || ''));
            const actions=node('div',undefined,'journey-actions');
            const select=node('select'); select.setAttribute('aria-label',`Bộ sưu tập của ${p.ten_dia_diem}`);
            for(const [value,label] of [['','Chưa lưu'],['want','Muốn đi'],['visited','Đã đi']]) {const option=node('option',label);option.value=value;select.append(option);}
            select.value=collections.get(p.id) || ''; select.disabled=busy;
            select.addEventListener('change',()=>{const value=select.value;run(async epoch=>{
                await auth.request(`/api/me/favorites/${p.id}`,{method:value?'PUT':'DELETE',...(value?{body:{collection:value}}:{})});
                if(epoch!==generation)return;
                if(value)collections.set(p.id,value);else collections.delete(p.id);
                status('Đã đồng bộ bộ sưu tập với tài khoản.');
            });});
            actions.append(select);
            if(draft) {
                const day=node('select'); day.setAttribute('aria-label',`Ngày thêm ${p.ten_dia_diem}`); day.disabled=busy;
                draft.days.forEach((_,i)=>{const option=node('option',`Ngày ${i+1}`);option.value=i;day.append(option);});
                actions.append(day,button('Thêm vào ngày',()=>{
                    const ids=draft.days[Number(day.value)].places;
                    if(ids.includes(p.id))return status('Điểm này đã có trong ngày được chọn.');
                    if(ids.length>=30 || draft.days.flatMap(d=>d.places).length>=150)return status('Mỗi ngày tối đa 30 điểm, lịch trình tối đa 150 điểm.');
                    ids.push(p.id);changed();status('Đã thêm điểm đến. Nhấn “Lưu lịch trình” để đồng bộ.');
                }));
            }
            row.append(actions);list.append(row);
        }
        $('more-places').hidden=found.length<=limit;
        $('journey-list').replaceChildren();
        for(const trip of trips) {
            const el=button(`${trip.title} · ${trip.days.length} ngày`,()=>{if(canReplace())openTrip(trip);},'saved-journey');
            el.setAttribute('aria-pressed',String(trip.id===draft?.id)); $('journey-list').append(el);
        }
        if(!trips.length)$('journey-list').append(node('p','Chưa có lịch trình đã lưu.'));
    }
    function move(fromDay,fromIndex,toDay,toIndex) {
        const source=draft.days[fromDay]?.places,target=draft.days[toDay]?.places;
        if(!source || !target || source[fromIndex]===undefined)return;
        const id=source[fromIndex];
        if(fromDay!==toDay && target.includes(id))return status('Điểm này đã có trong ngày đích.');
        if(fromDay!==toDay && target.length>=30)return status('Mỗi ngày tối đa 30 điểm đến.');
        source.splice(fromIndex,1);
        if(fromDay===toDay && fromIndex<toIndex)toIndex--;
        target.splice(toIndex,0,id); changed();
    }
    function dropZone(el,day,index) {
        el.addEventListener('dragover',event=>{if(busy || !dragged)return;event.preventDefault();el.classList.add('drop-target');});
        el.addEventListener('dragleave',()=>el.classList.remove('drop-target'));
        el.addEventListener('drop',event=>{
            event.preventDefault();event.stopPropagation();el.classList.remove('drop-target');
            if(busy || !dragged)return;
            const from=dragged;dragged=null;move(from.day,from.index,day,index);
        });
    }
    function renderEditor() {
        if(!draft)return;
        $('journey-title').disabled=busy;
        $('save-state').textContent=dirty?'Có thay đổi chưa lưu.':draft.id?'Đã lưu với tài khoản.':'Lịch trình mới — chưa lưu.';
        $('delete-journey').hidden=!draft.id;
        $('share-panel').hidden=!draft.share_token;
        $('share-url').value=draft.share_token?`${location.origin}/journeys?share=${draft.share_token}`:'';
        const root=$('journey-days');root.replaceChildren();
        draft.days.forEach((day,di)=>{
            const section=node('section',undefined,'itinerary-day'), header=node('div',undefined,'day-heading');
            header.append(node('h3',`Ngày ${di+1}`));
            if(draft.days.length>1)header.append(button('Xóa ngày',()=>{if(day.places.length && !window.confirm('Xóa ngày và các điểm trong ngày này?'))return;draft.days.splice(di,1);changed();} ,'text-button'));
            const stops=node('ol',undefined,'day-stops');dropZone(stops,di,day.places.length);
            if(!day.places.length)stops.append(node('li','Thêm điểm đến hoặc kéo điểm vào ngày này.','muted'));
            day.places.forEach((id,index)=>{
                const row=node('li',undefined,'itinerary-stop');row.draggable=!busy;
                row.append(node('span',`${index+1}. `),placeLink(id));
                row.addEventListener('dragstart',event=>{dragged={day:di,index};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(id));});
                row.addEventListener('dragend',()=>{dragged=null;document.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));});
                dropZone(row,di,index);
                const actions=node('div',undefined,'journey-actions');
                const up=button('↑',()=>move(di,index,di,index-1));up.setAttribute('aria-label','Đưa điểm lên');up.disabled=busy || index===0;
                const down=button('↓',()=>move(di,index,di,index+2));down.setAttribute('aria-label','Đưa điểm xuống');down.disabled=busy || index===day.places.length-1;
                const target=node('select');target.setAttribute('aria-label','Chuyển sang ngày');target.disabled=busy;
                draft.days.forEach((_,i)=>{const option=node('option',`Ngày ${i+1}`);option.value=i;target.append(option);});target.value=di;
                target.addEventListener('change',()=>run(()=>move(di,index,Number(target.value),draft.days[Number(target.value)].places.length)));
                actions.append(up,down,target,button('Bỏ điểm',()=>{day.places.splice(index,1);changed();},'text-button'));
                row.append(actions);stops.append(row);
            });
            section.append(header,stops);root.append(section);
        });
        $('add-day').disabled=busy || draft.days.length>=30;
    }
    function render() {
        if(!ready || shareToken)return;
        document.querySelectorAll('#journey-workspace button').forEach(el=>{el.disabled=busy;});
        renderLibrary();renderEditor();
    }
    async function save(epoch) {
        draft.title=$('journey-title').value.trim();
        const data=await auth.request(draft.id?`/api/me/itineraries/${draft.id}`:'/api/me/itineraries',{method:draft.id?'PUT':'POST',body:{title:draft.title,days:draft.days,version:draft.version}});
        if(epoch!==generation)return;
        trips=[data.item,...trips.filter(item=>item.id!==data.item.id)];openTrip(data.item);status('Đã lưu lịch trình với tài khoản.');
    }
    function print(item) {
        const root=$('journey-print');root.replaceChildren(node('h1',item.title),node('p','Việt Nam Ơi · Lịch trình tham khảo'));
        item.days.forEach((day,i)=>{
            const section=node('section'), list=node('ol');section.append(node('h2',`Ngày ${i+1}`));
            for(const id of day.places) { const p=places.get(id);list.append(node('li',p?`${p.ten_dia_diem}${p.ten_tinh?' — '+p.ten_tinh:''}`:'Điểm đến đã bị xóa')); }
            if(!day.places.length)section.append(node('p','Chưa có điểm đến.'));
            section.append(list);root.append(section);
        });
        window.print();
    }
    const templates={
        hagiang:{title:'3 ngày Hà Giang',region:['ha giang','tuyen quang'],bounds:[104.7,22.5,106,23.6],days:[[['cổng trời quản bạ','quan ba heaven'],['núi đôi quản bạ','twin mountains']], [['dinh vua mèo','dinh thự họ vương','dinh họ vương','vuong'],['cột cờ lũng cú','lung cu flag']], [['mã pí lèng','ma pi leng'],['sông nho quế','nho que river']]]},
        hoian:{title:'2 ngày Hội An',region:['hoi an','da nang','quang nam'],bounds:[108.2,15.75,108.5,16],days:[[['phố cổ hội an','hoi an ancient'],['chùa cầu','japanese covered bridge'],['hội quán phúc kiến','fujian']], [['làng rau trà quế','vườn rau trà quế','tra que vegetable'],['biển an bàng','an bang beach']]]}
    };
    function useTemplate(key) {
        if(!canReplace())return;
        const template=templates[key],missing=[];
        const days=template.days.map(names=>({places:names.flatMap(aliases=>{
            const match=[...places.values()].find(p=>{
                const [west,south,east,north]=template.bounds, [lng,lat]=p.coordinates || [];
                const inRegion=p.coordinates?lng>=west && lng<=east && lat>=south && lat<=north:template.region.some(region=>normalize(p.ten_tinh).includes(region));
                return inRegion && aliases.some(name=>normalize(p.ten_dia_diem).includes(normalize(name)));
            });
            if(!match){missing.push(aliases[0]);return [];}
            return [match.id];
        }).filter((id,i,all)=>all.indexOf(id)===i)}));
        openTrip({title:template.title,days,version:1});dirty=true;render();
        status(missing.length?`Đã tạo bản nháp. Chưa có trên bản đồ: ${missing.join(', ')}. Bạn có thể tìm và bổ sung điểm khác.`:'Đã tạo bản nháp từ mẫu. Nhấn “Lưu lịch trình” để đồng bộ.');
    }
    async function load() {
        const epoch=++generation;owner=auth.user?.id || null;ready=false;busy=false;draft=null;trips=[];collections.clear();places.clear();dirty=false;
        $('journey-workspace').hidden=true;$('journey-access').hidden=!!owner;
        if(!owner){status('Đăng nhập để lưu và đồng bộ hành trình.');return;}
        status('Đang tải bộ sưu tập và lịch trình…');
        try {
            const [geo,favorites,journeys]=await Promise.all([auth.request('/api/diemdulich'),auth.request('/api/me/favorites'),auth.request('/api/me/itineraries')]);
            if(epoch!==generation)return;
            places=new Map(geo.features.map(f=>[f.properties.id,{...f.properties,coordinates:f.geometry?.coordinates}]));collections=new Map(favorites.items.map(p=>[p.id,p.collection || 'want']));trips=journeys.items;
            ready=true;$('journey-workspace').hidden=false;openTrip(trips[0] || {title:'Chuyến đi của tôi',days:[{places:[]}],version:1});
            if(selectedPlace && places.has(selectedPlace)){$('collection-view').value='all';$('place-search').value=places.get(selectedPlace).ten_dia_diem;render();}
            status('Sẵn sàng. Chọn điểm đến để chuẩn bị lịch trình.');
        }catch(error){if(epoch!==generation)return;status(error.message);$('journey-access').hidden=false;$('journey-login').textContent='Thử tải lại';$('journey-login').href=location.href;}
    }
    async function loadShared() {
        $('journey-workspace').hidden=true;$('journey-access').hidden=true;
        try {
            const data=await auth.request(`/api/shared/itineraries/${encodeURIComponent(shareToken)}`);
            places=new Map(data.places.map(p=>[p.id,p]));$('shared-title').textContent=data.item.title;
            data.item.days.forEach((day,i)=>{const section=node('section',undefined,'itinerary-day'),list=node('ol');section.append(node('h2',`Ngày ${i+1}`));for(const id of day.places){const row=node('li');row.append(placeLink(id));list.append(row);}if(!day.places.length)section.append(node('p','Chưa có điểm đến.'));section.append(list);$('shared-days').append(section);});
            $('shared-journey').hidden=false;$('print-shared').addEventListener('click',()=>print(data.item));status('Lịch trình được chia sẻ, chỉ xem.');
        }catch(error){status(error.message);}
    }
    $('journey-title').addEventListener('input',()=>{if(draft){draft.title=$('journey-title').value;dirty=true;$('save-state').textContent='Có thay đổi chưa lưu.';}});
    for(const id of ['place-search','collection-view'])$(id).addEventListener(id==='place-search'?'input':'change',()=>{limit=20;renderLibrary();});
    $('more-places').addEventListener('click',()=>{limit+=20;renderLibrary();});
    $('new-journey').addEventListener('click',()=>run(newTrip));
    $('reload-journeys').addEventListener('click',()=>{if(!busy && canReplace())load();});
    $('add-day').addEventListener('click',()=>run(()=>{if(draft.days.length<30){draft.days.push({places:[]});changed();}}));
    $('save-journey').addEventListener('click',()=>run(save));
    $('delete-journey').addEventListener('click',()=>run(async epoch=>{
        if(!window.confirm('Xóa lịch trình này? Link chia sẻ cũng sẽ ngừng hoạt động.'))return;
        await auth.request(`/api/me/itineraries/${draft.id}`,{method:'DELETE'});if(epoch!==generation)return;
        trips=trips.filter(item=>item.id!==draft.id);dirty=false;newTrip();status('Đã xóa lịch trình.');
    }));
    $('share-journey').addEventListener('click',()=>run(async epoch=>{
        if(dirty || !draft.id)await save(epoch);if(epoch!==generation)return;
        const data=await auth.request(`/api/me/itineraries/${draft.id}/share`,{method:'PUT',body:{enabled:true}});if(epoch!==generation)return;
        draft.share_token=data.item.share_token;trips=trips.map(item=>item.id===draft.id?data.item:item);status('Link chia sẻ đã sẵn sàng. Ai có link đều có thể xem.');
    }));
    $('stop-share').addEventListener('click',()=>run(async epoch=>{
        const data=await auth.request(`/api/me/itineraries/${draft.id}/share`,{method:'PUT',body:{enabled:false}});if(epoch!==generation)return;
        draft.share_token=null;trips=trips.map(item=>item.id===draft.id?data.item:item);status('Đã ngừng chia sẻ. Link cũ không còn hoạt động.');
    }));
    $('copy-share').addEventListener('click',()=>run(async()=>{try{await navigator.clipboard.writeText($('share-url').value);status('Đã sao chép link.');}catch{$('share-url').focus();$('share-url').select();status('Hãy sao chép link trong ô đã chọn.');}}));
    $('print-journey').addEventListener('click',()=>{if(draft)print(draft);});
    document.querySelectorAll('[data-template]').forEach(el=>el.addEventListener('click',()=>run(()=>useTemplate(el.dataset.template))));
    window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
    window.addEventListener('mapgis-auth-change',()=>{if(!shareToken && (auth.user?.id || null)!==owner)load();});
    $('journey-login').href='/account?return='+encodeURIComponent(location.pathname+location.search);
    if(shareToken)loadShared();else auth.ready.then(()=>{if(generation===0)load();});
})();
