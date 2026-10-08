(() => {
    'use strict';
    window.createRoutingUI = (map, { showSidebar, findOrigins = () => [] }) => {
        const byId = id => document.getElementById(id);
        const panel = byId('route-panel');
        const form = byId('route-form');
        const input = byId('route-start');
        const status = byId('route-status');
        const options = byId('route-options');
        const submit = byId('route-submit');
        const suggestions = byId('route-start-results');
        const group = L.layerGroup().addTo(map);
        let destination = null, picking = false, originMarker = null, controller = null, result = null, serial = 0;
        let chosenOrigin = null, locationSerial = 0;
        const nodes = ['explore-tools','destinations'].map(byId);
        const header = document.querySelector('.sidebar-header');
        const compact = window.matchMedia('(max-width: 760px), (max-height: 500px) and (pointer: coarse)');
        const distance = meters => meters < 1000 ? `${Math.round(meters)} m` : `${(meters/1000).toLocaleString('vi-VN',{maximumFractionDigits:1})} km`;
        const duration = seconds => {
            if (seconds === 0) return '0 phút';
            if (seconds < 60) return 'dưới 1 phút';
            const minutes = Math.max(1, Math.round(seconds/60));
            return minutes < 60 ? `${minutes} phút` : `${Math.floor(minutes/60)} giờ ${minutes%60} phút`;
        };
        function clearResult() {
            result = null; group.clearLayers(); options.replaceChildren();
            byId('route-steps').hidden = true;
            byId('route-connection-note').hidden = true;
        }
        function cancelRequest() {
            serial++;
            if (controller) controller.abort();
            controller = null;
            submit.disabled = false;
            submit.textContent = 'Tìm đường đi';
            panel.setAttribute('aria-busy','false');
        }
        function cancelPicking() {
            picking = false;
            map.getContainer().classList.remove('picking-route-start');
            byId('route-pick').classList.remove('active');
            byId('map-message').hidden = true;
        }
        function setOrigin(latlng, label) {
            cancelRequest(); clearResult();
            locationSerial++;
            chosenOrigin = { lat: latlng.lat, lng: latlng.lng };
            input.value = label || `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
            suggestions.replaceChildren(); suggestions.hidden = true;
            if (originMarker) map.removeLayer(originMarker);
            originMarker = L.circleMarker(latlng,{radius:8,color:'#fff',weight:3,fillColor:'#2563eb',fillOpacity:1}).addTo(map).bindTooltip('Điểm xuất phát');
            status.textContent = 'Đã chọn điểm xuất phát. Nhấn “Tìm đường đi” để xem các tuyến.';
        }
        function pickStart(latlng) {
            if (!picking) return false;
            cancelPicking(); setOrigin(latlng); showSidebar(true);
            return true;
        }
        map.on('click', event => pickStart(event.latlng));
        byId('route-pick').addEventListener('click', () => {
            if (picking) { cancelPicking(); return; }
            locationSerial++; cancelRequest(); clearResult(); suggestions.hidden = true;
            picking = true;
            map.getContainer().classList.add('picking-route-start');
            byId('route-pick').classList.add('active');
            const tip = byId('map-message');
            tip.textContent = 'Chạm lên bản đồ để chọn điểm xuất phát. Nhấn Esc để hủy.';
            tip.hidden = false;
            if (compact.matches) showSidebar(false);
        });
        document.addEventListener('keydown', event => {
            if(event.key==='Escape' && picking){cancelPicking();showSidebar(true);}
        });
        byId('route-location').addEventListener('click', () => {
            if (!navigator.geolocation) { status.textContent = 'Trình duyệt chưa hỗ trợ vị trí. Hãy chọn trên bản đồ.'; return; }
            cancelPicking(); cancelRequest(); clearResult(); suggestions.hidden = true;
            const requestLocation = ++locationSerial;
            status.textContent = 'Đang lấy vị trí của bạn…';
            navigator.geolocation.getCurrentPosition(position => {
                if (requestLocation !== locationSerial || panel.hidden) return;
                setOrigin({lat:position.coords.latitude,lng:position.coords.longitude});
                map.setView([position.coords.latitude,position.coords.longitude],14);
            }, () => {if (requestLocation === locationSerial && !panel.hidden) status.textContent='Không lấy được vị trí. Hãy cho phép quyền vị trí hoặc chọn trên bản đồ.';}, {enableHighAccuracy:true,timeout:15000,maximumAge:30000});
        });
        input.addEventListener('input', () => {
            locationSerial++; chosenOrigin = null;
            cancelRequest(); cancelPicking(); clearResult();
            if(originMarker){map.removeLayer(originMarker);originMarker=null;}
            suggestions.replaceChildren();
            const matches = findOrigins(input.value.trim());
            matches.forEach(feature => {
                const button = document.createElement('button'); button.type = 'button';
                const props = feature.properties;
                button.textContent = `${props.ten_dia_diem} · ${props.ten_tinh || 'Việt Nam'}`;
                button.addEventListener('click', () => {
                    const [lng, lat] = feature.geometry.coordinates;
                    setOrigin({ lat, lng }, button.textContent); input.focus();
                });
                suggestions.append(button);
            });
            suggestions.hidden = !matches.length;
            status.textContent = matches.length ? 'Chọn một điểm xuất phát trong các gợi ý.' : 'Nhập tọa độ hoặc chọn điểm xuất phát trên bản đồ.';
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' && !suggestions.hidden) { event.preventDefault(); suggestions.firstChild?.focus(); }
            if (event.key === 'Escape') suggestions.hidden = true;
        });
        form.querySelectorAll('input[name="route-mode"]').forEach(radio => radio.addEventListener('change', () => {
            cancelRequest(); clearResult();
            if (input.value.trim()) form.requestSubmit();
        }));
        function selectRoute(index, fit = true) {
            if (!result) return;
            group.clearLayers();
            const selected = result.routes[index];
            result.routes.forEach((route,i) => {
                if(i===index) return;
                L.geoJSON(route.geometry,{style:{color:'#8a98a6',weight:5,opacity:.7}}).addTo(group).on('click',()=>selectRoute(i,false));
            });
            const line = L.geoJSON(selected.geometry,{style:{color:'#087f70',weight:7,opacity:.95}}).addTo(group);
            const connect = (from,to) => L.polyline([from,to],{color:'#52677c',weight:3,dashArray:'5 7',opacity:.8,interactive:false}).addTo(group);
            const snaps=selected.snaps || result.snaps;
            const a=snaps.start.coordinates,b=snaps.end.coordinates;
            if(snaps.start.gapMeters>5) connect([result.start.lat,result.start.lng],[a[1],a[0]]);
            if(snaps.end.gapMeters>5) connect([b[1],b[0]],[result.destination.lat,result.destination.lng]);
            L.circleMarker([result.destination.lat,result.destination.lng],{radius:8,color:'#fff',weight:3,fillColor:'#c45332',fillOpacity:1}).addTo(group).bindTooltip(result.destination.name);
            [...options.children].forEach((button,i)=>{button.classList.toggle('selected',i===index);button.setAttribute('aria-pressed',String(i===index));});
            const steps=byId('route-step-list'); steps.replaceChildren();
            selected.steps.forEach(step=>{
                const li=document.createElement('li');
                const name=document.createElement('strong');name.textContent=step.name;
                const length=document.createElement('span');length.textContent=distance(step.distance);
                li.append(name,length);steps.append(li);
            });
            byId('route-steps').hidden=!selected.steps.length;
            const note=byId('route-connection-note');
            const gap=snaps.start.gapMeters+snaps.end.gapMeters;
            note.hidden=gap<=10;
            note.textContent=`Ngoài tuyến đường: điểm xuất phát cách đường ${distance(snaps.start.gapMeters)}, điểm đến cách đường ${distance(snaps.end.gapMeters)}. Nét đứt chỉ vị trí nối, chưa xác minh lối đi; không tính vào thời gian di chuyển.`;
            if(fit && line.getBounds().isValid()) map.fitBounds(line.getBounds(),{padding:[55,80],maxZoom:17});
        }
        form.addEventListener('submit', async event => {
            event.preventDefault(); cancelRequest(); cancelPicking(); clearResult();
            const rawParts=input.value.split(',');
            const parts=chosenOrigin ? [chosenOrigin.lat, chosenOrigin.lng] : rawParts.map(value=>Number(value.trim()));
            if(parts.length!==2 || (!chosenOrigin && rawParts.some(value=>!value.trim())) || parts.some(value=>!Number.isFinite(value)) || Math.abs(parts[0])>90 || Math.abs(parts[1])>180 || !input.value.trim()) {
                status.textContent='Chọn một điểm gợi ý, nhập “vĩ độ, kinh độ” hoặc chọn điểm trên bản đồ.';input.focus();return;
            }
            if (!destination) { status.textContent = 'Hãy chọn điểm du lịch muốn đến.'; return; }
            locationSerial++; suggestions.hidden = true;
            const mode=form.querySelector('input[name="route-mode"]:checked').value;
            const requestSerial=serial;
            controller=new AbortController();
            const requestController=controller;
            const timeout=setTimeout(()=>requestController.abort(),150000);
            if(originMarker)map.removeLayer(originMarker);
            originMarker=L.circleMarker([parts[0],parts[1]],{radius:8,color:'#fff',weight:3,fillColor:'#2563eb',fillOpacity:1}).addTo(map).bindTooltip('Điểm xuất phát');
            submit.disabled=true;submit.textContent='Đang tìm tuyến…';panel.setAttribute('aria-busy','true');
            status.textContent='Đang tính đường và tìm các lựa chọn thay thế…';
            try {
                const response=await fetch('/api/routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:{lat:parts[0],lng:parts[1]},destinationId:destination.properties.id,mode}),signal:controller.signal});
                const data=await response.json();
                if(requestSerial!==serial)return;
                if(!response.ok)throw new Error(data.error||'Không thể tính tuyến đường.');
                result=data;
                result.routes.forEach((route,index)=>{
                    const button=document.createElement('button');button.type='button';button.className='route-option';
                    const title=document.createElement('strong');title.textContent=index===0?(data.provider==='valhalla'?'Tuyến đề xuất':'Tuyến ngắn nhất tìm được'):`Lựa chọn ${index+1}`;
                    const summary=document.createElement('span');summary.textContent=`${distance(route.distanceMeters)} · khoảng ${duration(route.durationSeconds)}`;
                    button.append(title,summary);button.addEventListener('click',()=>{selectRoute(index);if(compact.matches)showSidebar(false);});options.append(button);
                });
                status.textContent=result.routes.length>1?`Tìm thấy ${result.routes.length} tuyến. Chọn tuyến bạn muốn đi.`:'Tìm thấy 1 tuyến phù hợp. Chưa có tuyến thay thế đủ khác biệt.';
                selectRoute(0);
            } catch(error) {
                if(requestSerial!==serial)return;
                status.textContent=error.name==='AbortError'?'Tính tuyến mất quá nhiều thời gian. Hãy thử lại hoặc chọn điểm gần hơn.':error.message;
            } finally {
                clearTimeout(timeout);
                if(requestSerial===serial){controller=null;submit.disabled=false;submit.textContent='Tìm đường đi';panel.setAttribute('aria-busy','false');}
            }
        });
        byId('route-back').addEventListener('click', () => {
            locationSerial++; chosenOrigin = null; input.value = ''; suggestions.hidden = true;
            cancelRequest();cancelPicking();clearResult();panel.hidden=true;header.hidden=false;nodes.forEach(node=>node.hidden=false);
            if(originMarker){map.removeLayer(originMarker);originMarker=null;}
        });
        byId('route-hide').addEventListener('click',()=>showSidebar(false));
        return {pickStart,open(feature){
            locationSerial++;
            cancelRequest();cancelPicking();clearResult();destination=feature;
            byId('route-destination').value=feature.properties.ten_dia_diem||'Điểm du lịch';
            panel.hidden=false;header.hidden=true;nodes.forEach(node=>node.hidden=true);
            status.textContent='Chọn điểm xuất phát và phương tiện để tìm đường.';
            map.closePopup();showSidebar(true);input.focus();
        }};
    };
})();
