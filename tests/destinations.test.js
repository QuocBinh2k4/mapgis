const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {slugify,safeUrl,imageUrl,contentInput,backfillSlugs}=require('../services/destination-content');
const {renderDestination,gallery}=require('../services/destinations');
const {osmContent}=require('../scripts/seed-destination-content');

test('slugs support Vietnamese and backfill collisions without changing existing links',async()=>{
    assert.equal(slugify('  Hồ Gươm & Đền Ngọc Sơn  '),'ho-guom-den-ngoc-son');
    assert.equal(slugify('★'),'diem-den');
    const rows=[{id:1,ten_dia_diem:'Hồ Gươm',slug:'ho-guom'},{id:2,ten_dia_diem:'Hồ Gươm',slug:null},{id:3,ten_dia_diem:'Hồ Gươm 2',slug:null},{id:4,ten_dia_diem:'Hồ Gươm',slug:null}];
    const writes=[];
    const db={query:async(sql,params)=>{
        if(sql.startsWith('SELECT id,'))return {rows};
        if(sql.startsWith('UPDATE'))writes.push(...JSON.parse(params[0]));
        return {rows:[]};
    }};
    await backfillSlugs(db);
    assert.deepEqual(writes,[{id:2,slug:'ho-guom-2'},{id:3,slug:'ho-guom-2-3'},{id:4,slug:'ho-guom-4'}]);
    writes.forEach(change=>{rows.find(row=>row.id===change.id).slug=change.slug;});writes.length=0;
    await backfillSlugs(db);assert.equal(writes.length,0);
});

test('detailed content validates gallery, sources and text without accepting unsafe URLs',()=>{
    const good={story:'  Câu chuyện  ',gallery:[{url:'https://images.example/a.jpg',caption:'Ảnh'}],sources:[{url:'https://example.com',label:'Nguồn'}]};
    assert.equal(contentInput(good).story,'Câu chuyện');
    for(const url of ['javascript:alert(1)','data:image/svg+xml,test','https://user:password@example.com/a','/relative']) {
        assert.equal(safeUrl(url),null);assert.throws(()=>contentInput({gallery:[{url}]}),{status:400});
    }
    for(const value of [null,[],{story:'a'.repeat(4001)},{gallery:Array(9).fill(good.gallery[0])},{sources:Array(6).fill(good.sources[0])}])assert.throws(()=>contentInput(value),{status:400});
    assert.equal(contentInput(undefined),undefined);
});

test('SSR includes story, practical content, canonical, images, crawlable suggestions and safe JSON-LD',()=>{
    const place={id:1,slug:'ho-guom',ten_dia_diem:'Hồ Gươm',ten_tinh:'Hà Nội',lat:21,lng:105,chi_tiet:{story:'Câu chuyện </script><script>alert(1)</script>',opening_hours:'06:00–18:00',ticket_price:'20.000 đồng',best_season:'Mùa thu',transport:'Đi bộ',cultural_notes:'Giữ yên lặng',gallery:[{url:'https://images.example/a.jpg',caption:'Ảnh thứ nhất'},{url:'https://images.example/b.jpg',caption:'Ảnh thứ hai'}]}};
    const nearby=[{id:2,slug:'den-ngoc-son',ten_dia_diem:'Đền Ngọc Sơn',distance_m:500}];
    const html=renderDestination(place,nearby,[{id:3,slug:'van-mieu',ten_dia_diem:'Văn Miếu'}],'https://mapgis.example');
    assert.match(html,/<link rel="canonical" href="https:\/\/mapgis.example\/diem-den\/ho-guom">/);
    for(const value of ['06:00–18:00','20.000 đồng','Mùa thu','Đi bộ','Giữ yên lặng','href="/diem-den/den-ngoc-son"','href="/diem-den/van-mieu"'])assert.ok(html.includes(value));
    assert.ok(!html.includes('</script><script>alert(1)</script>'));
    const json=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(json['@type'],'TouristAttraction');assert.equal(json.geo.latitude,21);assert.equal(json.image.length,2);
    assert.equal((html.match(/data-gallery-slide/g) || []).length,2);
    const empty=renderDestination({...place,chi_tiet:{},mo_ta_ngan:'Mô tả đã có'},[],[],'https://mapgis.example');
    assert.match(empty,/Mô tả đã có/);assert.match(empty,/Đang cập nhật/);assert.match(empty,/Ảnh thật đang được cập nhật/);assert.match(empty,/\/images\/covers\/nature\.svg/);
});

test('gallery filters invalid URLs and duplicates while preserving the current cover',()=>{
    const images=gallery({ten_dia_diem:'Hồ Gươm',hinh_anh_url:'https://example.com/a.jpg',chi_tiet:{gallery:[{url:'javascript:alert(1)'},{url:'https://example.com/a.jpg',caption:'Ảnh'}]}});
    assert.equal(images.length,1);assert.equal(images[0].caption,'Ảnh');
});

test('cover links convert Wikimedia file pages and reject Google Photos share pages',()=>{
    assert.equal(imageUrl('https://en.wikipedia.org/wiki/File:Example_photo.jpg'),'https://commons.wikimedia.org/wiki/Special:FilePath/Example_photo.jpg');
    assert.equal(imageUrl('https://photos.app.goo.gl/example'),null);
    assert.equal(imageUrl('https://images.example/place.jpg'),'https://images.example/place.jpg');
});

test('OSM opening hours and fees remain labelled as unverified and do not invent a price',()=>{
    const data=osmContent({opening_hours:'Mo-Su 08:00-17:00',fee:'yes'},'https://www.openstreetmap.org/node/1');
    assert.match(data.opening_hours,/chưa xác minh/);assert.match(data.ticket_price,/chưa có mức giá/);
    assert.equal(data.sources.length,1);assert.deepEqual(osmContent({},'https://example.com'),{});
});

test('gallery cycles images and sharing falls back to a selectable canonical URL',async()=>{
    const element=()=>({hidden:false,textContent:'',events:{},addEventListener(name,action){this.events[name]=action;},focus(){this.focused=true;},select(){this.selected=true;}});
    const nodes=new Map(['gallery-position','gallery-prev','gallery-next','share-destination','destination-status','destination-share-url'].map(id=>[id,element()]));
    const slides=[element(),element(),element()], container=element();
    const canonical={href:'https://mapgis.example/diem-den/ho-guom'};
    const document={title:'Hồ Gươm',getElementById:id=>nodes.get(id),querySelectorAll:selector=>selector==='[data-gallery-slide]'?slides:[],querySelector:selector=>selector==='.destination-gallery'?container:canonical};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/destination.js'),'utf8'),{document,navigator:{clipboard:{writeText:async()=>{throw Error('denied');}}}});
    nodes.get('gallery-next').events.click();assert.equal(slides[1].hidden,false);assert.equal(slides[0].hidden,true);
    nodes.get('gallery-prev').events.click();assert.equal(slides[0].hidden,false);
    container.events.keydown({key:'ArrowLeft',preventDefault(){}});assert.equal(slides[2].hidden,false);
    await nodes.get('share-destination').events.click();assert.equal(nodes.get('destination-share-url').selected,true);assert.equal(nodes.get('destination-share-url').hidden,false);
});
