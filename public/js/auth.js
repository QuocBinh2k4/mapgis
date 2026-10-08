(() => {
    let user=null, csrfToken=null;
    function announce() {
        const link=document.getElementById('auth-link');
        if (link) link.textContent=user ? user.display_name : 'Đăng nhập';
        const admin=document.getElementById('admin-link');
        if (admin) admin.hidden=user?.role!=='admin';
        window.dispatchEvent(new CustomEvent('mapgis-auth-change',{detail:{user}}));
    }
    async function request(url,options={}) {
        const method=options.method || 'GET';
        const headers={...(options.body ? {'Content-Type':'application/json'} : {}),...(method!=='GET' && csrfToken ? {'X-CSRF-Token':csrfToken} : {}),...options.headers};
        const response=await fetch(url,{...options,method,headers,credentials:'same-origin',body:options.body ? JSON.stringify(options.body) : undefined});
        const data=await response.json().catch(()=>({error:'Máy chủ trả về dữ liệu không hợp lệ.'}));
        if (!response.ok) {
            if (response.status===401 && user) { user=null; csrfToken=null; announce(); }
            const error=new Error(data.error || 'Không thể xử lý yêu cầu.'); error.status=response.status; throw error;
        }
        return data;
    }
    async function refresh() {
        const data=await request('/api/auth/me'); user=data.user; csrfToken=data.csrfToken; announce(); return user;
    }
    window.MapAuth={request,refresh,get user(){return user;},setSession(data){user=data.user;csrfToken=data.csrfToken || csrfToken;announce();},async logout(){await request('/api/auth/logout',{method:'POST'});user=null;csrfToken=null;announce();}};
    window.MapAuth.ready=refresh().catch(()=>{announce();return null;});
})();
