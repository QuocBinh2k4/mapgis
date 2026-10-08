(() => {
    const byId=id=>document.getElementById(id), auth=window.MapAuth;
    const pages={tourism:1,users:1,audit:1}, serials={tourism:0,users:0,audit:0};
    let selectedPlace=null, selectedUser=null, editorMap=null, editorMarker=null;
    const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;};
    const dates=value=>value ? new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(value)) : '—';
    function message(text,error=false,target='admin-message') {const node=byId(target);node.textContent=text;node.hidden=!text;node.classList.toggle('error',error);}
    function denied(error) {
        if (![401,403].includes(error.status)) return false;
        byId('admin-layout').hidden=true;byId('admin-access').hidden=false;byId('admin-access-message').textContent=error.message;
        byId('admin-signin').hidden=false;
        ['user-editor','tourism-editor'].forEach(id=>{if(byId(id).open)byId(id).close();});return true;
    }
    function badge(text,status='active') {return element('span',text,`badge ${status}`);}
    function button(text,action) {const node=element('button',text);node.type='button';node.addEventListener('click',async()=>{node.disabled=true;try{await action();}catch(error){if(!denied(error))message(error.message,true);}finally{node.disabled=false;}});return node;}
    function emptyRows(id,columns,text) {const cell=element('td',text);cell.colSpan=columns;const row=element('tr');row.append(cell);byId(id).replaceChildren(row);}
    function paginator(tab,data) {
        const totalPages=Math.max(1,Math.ceil(data.total/data.limit));
        byId(`${tab}-page`).textContent=`${data.total.toLocaleString('vi-VN')} bản ghi · Trang ${data.page}/${totalPages}`;
        byId(`${tab}-prev`).disabled=data.page<=1;byId(`${tab}-next`).disabled=data.page>=totalPages;
    }
    async function stats() {
        const data=await auth.request('/api/admin/stats');
        for(const [id,key] of [['users','users'],['tourism','tourism'],['archived','archived_tourism'],['favorites','favorites']])byId(`stat-${id}`).textContent=data[key].toLocaleString('vi-VN');
    }
    async function load(tab) {
        const serial=++serials[tab];
        const parameters=new URLSearchParams({page:pages[tab],limit:25});
        if(tab==='tourism'){parameters.set('q',byId('tourism-query').value);parameters.set('state',byId('tourism-state').value);parameters.set('province',byId('tourism-province').value);}
        if(tab==='users'){parameters.set('q',byId('users-query').value);parameters.set('status',byId('users-status').value);}
        emptyRows(`${tab}-rows`,tab==='users'?5:4,'Đang tải dữ liệu…');
        try {
            const data=await auth.request(`/api/admin/${tab}?${parameters}`);
            if(serial!==serials[tab])return;
            const rows=byId(`${tab}-rows`);rows.replaceChildren();paginator(tab,data);
            if(!data.items.length){emptyRows(`${tab}-rows`,tab==='users'?5:4,'Chưa có dữ liệu phù hợp.');return;}
            data.items.forEach(item=>{
                const row=element('tr');
                if(tab==='tourism'){
                    const name=element('td');name.append(element('strong',item.ten_dia_diem),element('small',item.dia_chi || `Mã #${item.id}`));
                    const type=element('td');type.append(element('span',item.ten_tinh || 'Chưa xác định tỉnh'),element('small',item.ten_loai || 'Chưa phân loại'));
                    const status=element('td');status.append(badge(item.deleted_at?'Đang ẩn':'Đang hiển thị',item.deleted_at?'archived':'active'));
                    const actions=element('td'), group=element('div','','row-actions');
                    group.append(button('Sửa',()=>openPlace(item)),button(item.deleted_at?'Khôi phục':'Ẩn',async()=>{
                        await auth.request(`/api/admin/tourism/${item.id}/visibility`,{method:'PATCH',body:{archived:!item.deleted_at,version:item.version}});
                        message(item.deleted_at?'Đã khôi phục điểm du lịch.':'Đã ẩn điểm du lịch khỏi bản đồ.');await Promise.all([load('tourism'),stats()]);
                    }));actions.append(group);row.append(name,type,status,actions);
                } else if(tab==='users'){
                    const name=element('td');name.append(element('strong',item.display_name),element('small',item.email));
                    const role=element('td',item.role==='admin'?'Quản trị viên':'Người dùng'),status=element('td');status.append(badge(({active:'Hoạt động',blocked:'Đang khóa',archived:'Đã lưu trữ'})[item.status],item.status));
                    const favorites=element('td',item.favorites_count),actions=element('td'),group=element('div','','row-actions');group.append(button('Quản lý',()=>openUser(item.id)));actions.append(group);row.append(name,role,status,favorites,actions);
                } else {
                    const labels={create_tourism:'Thêm điểm du lịch',update_tourism:'Sửa điểm du lịch',archive_tourism:'Ẩn điểm du lịch',restore_tourism:'Khôi phục điểm du lịch',update_user:'Cập nhật tài khoản',revoke_sessions:'Kết thúc phiên đăng nhập',remove_favorite:'Bỏ lưu điểm đến',bootstrap_admin:'Cấp quyền quản trị ban đầu'};
                    row.append(element('td',dates(item.created_at)),element('td',item.actor_name),element('td',labels[item.action] || item.action),element('td',`${item.resource_type==='user'?'Tài khoản':'Điểm du lịch'} · ${item.resource_id}`));
                }
                rows.append(row);
            });
        }catch(error){if(!denied(error)) {emptyRows(`${tab}-rows`,tab==='users'?5:4,error.message);message(error.message,true);}}
    }
    function editorPosition() {
        if(!editorMap)return;
        const lat=Number(byId('place-lat').value),lng=Number(byId('place-lng').value);
        if(!byId('place-lat').value || !byId('place-lng').value || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180)return;
        if(editorMarker)editorMarker.setLatLng([lat,lng]);else editorMarker=L.marker([lat,lng]).addTo(editorMap);
        editorMap.setView([lat,lng],13);
    }
    function openPlace(place=null) {
        selectedPlace=place;byId('tourism-form').reset();message('',false,'tourism-editor-message');
        byId('tourism-editor-title').textContent=place?'Sửa điểm du lịch':'Thêm điểm du lịch';
        for(const [id,key] of [['name','ten_dia_diem'],['category','loai_id'],['address','dia_chi'],['description','mo_ta_ngan'],['image','hinh_anh_url'],['lat','lat'],['lng','lng']])byId(`place-${id}`).value=place?.[key] ?? '';
        byId('tourism-editor').showModal();
        requestAnimationFrame(()=>{
            if(!window.L)return;
            if(!editorMap){editorMap=L.map('tourism-editor-map').setView([16,106],5);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap',maxZoom:19}).addTo(editorMap);editorMap.on('click',event=>{byId('place-lat').value=event.latlng.lat.toFixed(6);byId('place-lng').value=event.latlng.lng.toFixed(6);editorPosition();});}
            editorMap.invalidateSize();if(editorMarker){editorMap.removeLayer(editorMarker);editorMarker=null;}
            if(place)editorPosition();else editorMap.setView([16,106],5);
        });
    }
    async function openUser(id) {
        const data=await auth.request(`/api/admin/users/${id}`);selectedUser=data.user;
        byId('user-email').value=data.user.email;byId('user-name').value=data.user.display_name;byId('user-role').value=data.user.role;byId('user-status').value=data.user.status;
        byId('user-role').disabled=id===auth.user.id;byId('user-status').disabled=id===auth.user.id;byId('user-revoke').disabled=id===auth.user.id;
        message('',false,'user-editor-message');
        const list=byId('user-favorites');list.replaceChildren();
        if(!data.favorites.length)list.append(element('p','Người dùng chưa lưu điểm đến nào.','muted'));
        data.favorites.forEach(place=>{
            const row=element('article','','favorite-item'), info=element('div');info.append(element('strong',place.ten_dia_diem),element('p',`${place.ten_tinh || 'Việt Nam'}${place.deleted_at?' · Đang ẩn':''}`,'muted'));
            const remove=button('Bỏ lưu',async()=>{await auth.request(`/api/admin/users/${id}/favorites/${place.id}`,{method:'DELETE'});await openUser(id);await stats();});remove.className='text-button';row.append(info,remove);list.append(row);
        });
        if(!byId('user-editor').open)byId('user-editor').showModal();
    }
    byId('tourism-add').addEventListener('click',()=>openPlace());
    document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>byId(button.dataset.close).close()));
    document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
        document.querySelectorAll('[data-tab]').forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-pressed',String(active));byId(`${tab.dataset.tab}-section`).hidden=!active;});load(button.dataset.tab);
    }));
    for(const tab of ['tourism','users','audit']){
        byId(`${tab}-prev`).addEventListener('click',()=>{if(pages[tab]>1){pages[tab]--;load(tab);}});
        byId(`${tab}-next`).addEventListener('click',()=>{pages[tab]++;load(tab);});
        if(tab!=='audit')byId(`${tab}-search`).addEventListener('submit',event=>{event.preventDefault();pages[tab]=1;load(tab);});
    }
    ['tourism-state','tourism-province'].forEach(id=>byId(id).addEventListener('change',()=>{pages.tourism=1;load('tourism');}));
    byId('users-status').addEventListener('change',()=>{pages.users=1;load('users');});
    ['place-lat','place-lng'].forEach(id=>byId(id).addEventListener('change',editorPosition));
    byId('tourism-form').addEventListener('submit',async event=>{
        event.preventDefault();const submit=event.currentTarget.querySelector('[type=submit]');submit.disabled=true;
        const body={ten_dia_diem:byId('place-name').value,loai_id:Number(byId('place-category').value),dia_chi:byId('place-address').value,mo_ta_ngan:byId('place-description').value,hinh_anh_url:byId('place-image').value,lat:Number(byId('place-lat').value),lng:Number(byId('place-lng').value),...(selectedPlace?{version:selectedPlace.version}:{})};
        try{await auth.request(selectedPlace?`/api/admin/tourism/${selectedPlace.id}`:'/api/admin/tourism',{method:selectedPlace?'PATCH':'POST',body});byId('tourism-editor').close();message('Đã lưu điểm du lịch.');await Promise.all([load('tourism'),stats()]);}catch(error){if(!denied(error))message(error.message,true,'tourism-editor-message');}finally{submit.disabled=false;}
    });
    byId('user-form').addEventListener('submit',async event=>{
        event.preventDefault();const submit=event.currentTarget.querySelector('[type=submit]');submit.disabled=true;
        try{
            const data=await auth.request(`/api/admin/users/${selectedUser.id}`,{method:'PATCH',body:{display_name:byId('user-name').value,role:byId('user-role').value,status:byId('user-status').value,version:selectedUser.version}});
            if(selectedUser.id===auth.user.id)auth.setSession(data);
            byId('user-editor').close();message('Đã cập nhật tài khoản.');await Promise.all([load('users'),stats()]);
        }catch(error){if(!denied(error))message(error.message,true,'user-editor-message');}finally{submit.disabled=false;}
    });
    byId('user-revoke').addEventListener('click',async()=>{const button=byId('user-revoke');button.disabled=true;try{await auth.request(`/api/admin/users/${selectedUser.id}/revoke-sessions`,{method:'POST'});message('Đã kết thúc các phiên đăng nhập.',false,'user-editor-message');}catch(error){if(!denied(error))message(error.message,true,'user-editor-message');}finally{button.disabled=false;}});
    window.addEventListener('mapgis-auth-change',()=>{if(auth.user?.role!=='admin' && !byId('admin-layout').hidden)denied({status:403,message:'Phiên quản trị đã hết hạn hoặc quyền truy cập đã thay đổi.'});});
    auth.ready.then(async()=>{
        if(auth.user?.role!=='admin'){byId('admin-access-message').textContent=auth.user?'Tài khoản chưa có quyền quản trị. Hãy liên hệ người quản lý website.':'Vui lòng đăng nhập bằng tài khoản quản trị để tiếp tục.';byId('admin-signin').hidden=!!auth.user;return;}
        byId('admin-access').hidden=true;byId('admin-layout').hidden=false;
        try{
            const data=await auth.request('/api/admin/options');
            data.provinces.forEach(p=>{const option=element('option',p.ten_tinh);option.value=p.ma_tinh;byId('tourism-province').append(option);});
            data.categories.forEach(c=>{const option=element('option',c.ten_loai);option.value=c.id;byId('place-category').append(option);});
            await Promise.all([stats(),load('tourism')]);
        }catch(error){if(!denied(error))message(error.message,true);}
    });
})();
