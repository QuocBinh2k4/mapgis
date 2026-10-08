(() => {
    const byId=id=>document.getElementById(id), auth=window.MapAuth;
    const message=text=>{byId('account-message').textContent=text;byId('account-message').hidden=!text;};
    const element=(tag,text,className)=>{const node=document.createElement(tag);node.textContent=text || '';if(className)node.className=className;return node;};
    function returnTo() {
        const path=new URLSearchParams(location.search).get('return');
        if (!path || !path.startsWith('/') || path.startsWith('//')) return null;
        const url=new URL(path,location.origin);
        return url.origin===location.origin ? url.pathname+url.search : null;
    }
    async function favorites() {
        const list=byId('favorite-list'); list.replaceChildren(element('p','Đang tải điểm đến…','muted'));
        try {
            const data=await auth.request('/api/me/favorites');
            list.replaceChildren();
            if (!data.items.length) {list.append(element('p','Chưa có địa điểm yêu thích. Mở một địa điểm trên bản đồ và chọn “Thêm vào yêu thích”.','muted'));return;}
            data.items.forEach(place=>{
                const card=element('article','','favorite-item'), info=element('div');
                const link=element('a',place.ten_dia_diem);link.href=`/?place=${place.id}`;
                info.append(link,element('p',place.ten_tinh || 'Việt Nam','muted'));
                const remove=element('button','Bỏ lưu','text-button');remove.type='button';
                remove.addEventListener('click',async()=>{remove.disabled=true;try{await auth.request(`/api/me/favorites/${place.id}`,{method:'DELETE'});await favorites();}catch(error){message(error.message);remove.disabled=false;}});
                card.append(info,remove);list.append(card);
            });
        } catch(error) {list.replaceChildren(element('p',error.message,'notice'));}
    }
    async function loadGoogle() {
        if (window.google?.accounts?.id) return;
        await new Promise((resolve,reject)=>{
            const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client?hl=vi';script.async=true;
            script.onload=resolve;script.onerror=()=>reject(new Error('Không tải được đăng nhập Google. Vui lòng kiểm tra kết nối.'));document.head.append(script);
        });
    }
    async function login() {
        byId('login-retry').hidden=true;byId('google-button').replaceChildren();
        try {
            const config=await auth.request('/api/auth/config');
            if (!config.configured) {message('Đăng nhập Google chưa được thiết lập. Vui lòng liên hệ quản trị viên.');return;}
            await loadGoogle();
            window.google.accounts.id.initialize({client_id:config.clientId,nonce:config.nonce,auto_select:false,callback:async response=>{
                message('Đang xác minh tài khoản Google…');
                try {
                    const data=await auth.request('/api/auth/google',{method:'POST',headers:{'X-CSRF-Token':config.csrfToken},body:{credential:response.credential}});
                    auth.setSession(data);
                    const path=returnTo();if(path){location.assign(path);return;}
                    await render();message('Đăng nhập thành công. Chào mừng bạn trở lại!');
                } catch(error) {message(error.message);byId('login-retry').hidden=false;}
            }});
            const width=Math.min(280,byId('google-button').clientWidth || 280);
            window.google.accounts.id.renderButton(byId('google-button'),{theme:'outline',size:'large',text:'continue_with',shape:'pill',locale:'vi',width});
            message('Chọn Google để đăng nhập hoặc tạo tài khoản.');
        } catch(error) {message(error.message);byId('login-retry').hidden=false;}
    }
    async function render() {
        const user=auth.user;
        byId('login-section').hidden=!!user;byId('member-section').hidden=!user;
        if (!user) {await login();return;}
        byId('profile-name').value=user.display_name;byId('profile-email').value=user.email;
        byId('account-role').textContent=user.role==='admin' ? 'Tài khoản quản trị viên' : 'Thành viên Việt Nam Ơi';
        byId('account-admin').hidden=user.role!=='admin';message('');await favorites();
    }
    byId('login-retry').addEventListener('click',login);
    byId('profile-form').addEventListener('submit',async event=>{
        event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
        try {const data=await auth.request('/api/me/profile',{method:'PATCH',body:{display_name:byId('profile-name').value}});auth.setSession(data);message('Đã lưu thông tin tài khoản.');}catch(error){message(error.message);}finally{button.disabled=false;}
    });
    let signingOut=false;
    window.addEventListener('mapgis-auth-change',()=>{
        if(!auth.user && !byId('member-section').hidden && !signingOut){
            byId('member-section').hidden=true;
            byId('favorite-list').replaceChildren();
            byId('profile-form').reset();
            render();
        }
    });
    byId('account-logout').addEventListener('click',async()=>{signingOut=true;try{await auth.logout();window.google?.accounts?.id?.disableAutoSelect();byId('favorite-list').replaceChildren();byId('profile-form').reset();await render();}catch(error){message(error.message);}finally{signingOut=false;}});
    auth.ready.then(render);
})();
