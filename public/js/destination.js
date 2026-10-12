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
        image.hidden=true;
        const note=document.createElement('p');note.className='muted';note.textContent='Ảnh hiện không tải được.';image.after(note);
    },{once:true}));
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
})();
