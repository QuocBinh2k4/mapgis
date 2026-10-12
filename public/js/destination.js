(() => {
    const slides=[...document.querySelectorAll('[data-gallery-slide]')];
    let index=0;
    function show(next) {
        if(!slides.length)return;
        index=(next+slides.length)%slides.length;
        slides.forEach((slide,i)=>{slide.hidden=i!==index;});
        document.getElementById('gallery-position').textContent=`${index+1} / ${slides.length}`;
    }
    document.getElementById('gallery-prev')?.addEventListener('click',()=>show(index-1));
    document.getElementById('gallery-next')?.addEventListener('click',()=>show(index+1));
    document.querySelector('.destination-gallery')?.addEventListener('keydown',event=>{
        if(event.key==='ArrowLeft'){event.preventDefault();show(index-1);}
        if(event.key==='ArrowRight'){event.preventDefault();show(index+1);}
    });
    document.querySelectorAll('.destination-gallery img,.related-card img').forEach(image=>image.addEventListener('error',()=>{
        const fallback=image.dataset.coverFallback;
        if(fallback&&image.src!==new URL(fallback,location.href).href){image.src=fallback;image.alt='Hình minh họa theo loại địa điểm';return;}
        image.hidden=true;
        const note=document.createElement('p');note.className='muted';note.textContent='Ảnh hiện không tải được.';image.after(note);
    }));
    document.getElementById('share-destination')?.addEventListener('click',async()=>{
        const url=document.querySelector('link[rel="canonical"]').href,status=document.getElementById('destination-status');
        try {
            if(navigator.share)await navigator.share({title:document.title,url});
            else {await navigator.clipboard.writeText(url);status.textContent='Đã sao chép link điểm đến.';}
        }catch(error) {
            if(error.name==='AbortError')return;
            const input=document.getElementById('destination-share-url');input.hidden=false;input.focus();input.select();status.textContent='Hãy sao chép link trong ô đã chọn.';
        }
    });
    const community=document.getElementById('community-photos'),auth=globalThis.MapAuth;
    if(community&&auth){
        const placeId=community.dataset.tourismId,form=document.getElementById('community-photo-form'),login=document.getElementById('community-photo-login');
        const grid=document.getElementById('community-photo-grid'),status=document.getElementById('community-photo-status');
        const announce=text=>{status.textContent=text;};
        async function loadCommunityPhotos(){
            if(!auth.user){form.hidden=true;login.hidden=false;grid.replaceChildren();return;}
            form.hidden=false;login.hidden=true;
            try{
                const data=await auth.request(`/api/tourism/${placeId}/photos`);
                grid.replaceChildren();
                data.items.forEach(photo=>{
                    const card=document.createElement('article');card.className='community-photo-card';
                    const image=document.createElement('img');image.src=photo.image_url;image.alt=photo.caption||'Ảnh do người dùng đăng';image.loading='lazy';
                    const detail=document.createElement('p');detail.textContent=[photo.caption,photo.uploader].filter(Boolean).join(' · ');
                    card.append(image,detail);grid.append(card);
                });
                if(!data.items.length)announce('Bạn chưa gửi ảnh nào cho địa điểm này.');
            }catch(error){announce(error.message);}
        }
        form.addEventListener('submit',async event=>{
            event.preventDefault();
            const file=document.getElementById('community-photo-file').files[0],caption=document.getElementById('community-photo-caption').value.trim();
            if(!file)return;
            if(!['image/jpeg','image/png','image/webp'].includes(file.type)){announce('Chọn ảnh JPEG, PNG hoặc WebP.');return;}
            if(file.size>4*1024*1024){announce('Ảnh tải lên tối đa 4 MB.');return;}
            const submit=form.querySelector('[type=submit]');submit.disabled=true;
            try{
                await auth.upload(file,`/api/tourism/${placeId}/photos?caption=${encodeURIComponent(caption)}`);
                form.reset();announce('Ảnh đã gửi. Chỉ bạn và quản trị viên có thể xem ảnh này.');await loadCommunityPhotos();
            }catch(error){announce(error.message);}
            finally{submit.disabled=false;}
        });
        auth.ready.then(loadCommunityPhotos);
        window.addEventListener('mapgis-auth-change',loadCommunityPhotos);
    }
})();
