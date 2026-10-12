const { createClient } = require('./db');
const { ensureSchema } = require('./schema');
const { slugify, contentInput, safeUrl } = require('../services/destination-content');

const chuaCau={
    story:'Giữa phố cổ Hội An, Chùa Cầu nối hai bờ của một lạch nước nhỏ và nối cả những lớp ký ức của thương cảng xưa. Phần cầu gắn với cộng đồng người Nhật; không gian thờ tự được cộng đồng Minh Hương bổ sung về sau. Qua nhiều lần tu bổ, hai phần hợp thành một công trình mang dấu ấn giao lưu Việt Nam, Nhật Bản và Trung Hoa. Dừng lại dưới mái cầu, bạn có thể bắt đầu câu chuyện Hội An từ chính cuộc gặp gỡ ấy.',
    transport:'Chùa Cầu nối đường Trần Phú với đường Nguyễn Thị Minh Khai trong khu phố cổ. Bạn có thể đi bộ tới cầu từ các điểm tham quan quanh phố cổ; mở bản đồ để tìm tuyến từ nơi xuất phát.',
    cultural_notes:'Đây vừa là một cây cầu vừa là không gian thờ tự. Hãy giữ yên lặng, không chạm vào đồ thờ và tuân thủ hướng dẫn tham quan tại di tích.',
    gallery:[
        {url:'https://upload.wikimedia.org/wikipedia/commons/3/3b/Japanese_covered-bridge_of_Hoi_An_in_2015_02.jpg',caption:'Chùa Cầu Hội An — ảnh tư liệu năm 2015',credit:'Vuong Tri Binh / Wikimedia Commons / CC BY-SA 4.0; ảnh gốc'},
        {url:'https://commons.wikimedia.org/wiki/Special:FilePath/H%E1%BB%99i_An%2C_Ch%C3%B9a_C%E1%BA%A7u%2C_2020-01_CN-02.jpg?width=1280',caption:'Chùa Cầu nhìn từ phía nam — ảnh tư liệu tháng 1/2020',credit:'© Steffen Schmitz (Carschten) / Wikimedia Commons / CC BY-SA 4.0'}
    ],
    sources:[
        {url:'https://hoianheritage.danang.gov.vn/vi/di-san-van-hoa/Cau/Chua-Cau-134.html',label:'Trung tâm Quản lý Bảo tồn Di sản Văn hóa Hội An — Chùa Cầu'},
        {url:'https://commons.wikimedia.org/wiki/File:Japanese_covered-bridge_of_Hoi_An_in_2015_02.jpg',label:'Ảnh 2015: Vuong Tri Binh — Wikimedia Commons'},
        {url:'https://commons.wikimedia.org/wiki/File:H%E1%BB%99i_An,_Ch%C3%B9a_C%E1%BA%A7u,_2020-01_CN-02.jpg',label:'Ảnh 2020: Steffen Schmitz — Wikimedia Commons'},
        {url:'https://creativecommons.org/licenses/by-sa/4.0/',label:'Giấy phép ảnh CC BY-SA 4.0'}
    ]
};
function osmContent(tags,source) {
    const result={};
    if(typeof tags?.opening_hours==='string' && tags.opening_hours.length<=400)result.opening_hours=`Theo dữ liệu OpenStreetMap (chưa xác minh): ${tags.opening_hours}`;
    if(typeof tags?.fee==='string' && tags.fee.length<=100) {
        const fee={yes:'Có thu phí, chưa có mức giá',no:'Không thu phí theo dữ liệu nguồn'}[tags.fee] || tags.fee;
        result.ticket_price=`Theo dữ liệu OpenStreetMap (chưa xác minh): ${fee}`;
    }
    if(Object.keys(result).length && safeUrl(source))result.sources=[{url:source,label:'OpenStreetMap — thông tin cộng đồng, chưa xác minh'}];
    return result;
}
async function seed(client) {
    const hasSource=(await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='diem_du_lich' AND column_name='thong_tin_nguon'")).rows.length;
    const rows=(await client.query(`SELECT id,ten_dia_diem,chi_tiet,ST_X(geom) AS lng,ST_Y(geom) AS lat${hasSource?',thong_tin_nguon,nguon_url':''} FROM diem_du_lich WHERE deleted_at IS NULL`)).rows;
    const changes=[];
    for(const row of rows) {
        const details={...row.chi_tiet}, fromOsm=osmContent(row.thong_tin_nguon?.tags,row.nguon_url);
        for(const [key,value] of Object.entries(fromOsm))if(!details[key])details[key]=value;
        if(slugify(row.ten_dia_diem)==='chua-cau' && row.lng>108.32 && row.lng<108.34 && row.lat>15.87 && row.lat<15.89) {
            for(const [key,value] of Object.entries(chuaCau))if(!details[key] || (Array.isArray(details[key]) && !details[key].length))details[key]=value;
            if(!row.chi_tiet.sources?.length)details.sources=[...chuaCau.sources,...(fromOsm.sources || [])].slice(0,5);
        }
        if(JSON.stringify(details)!==JSON.stringify(row.chi_tiet))changes.push({id:row.id,details:contentInput(details)});
    }
    for(let i=0;i<changes.length;i+=500)await client.query(`UPDATE diem_du_lich d SET chi_tiet=x.details,updated_at=now(),version=version+1
        FROM jsonb_to_recordset($1::jsonb) AS x(id int,details jsonb) WHERE d.id=x.id`,[JSON.stringify(changes.slice(i,i+500))]);
    return changes.length;
}
if(require.main===module)(async()=>{
    const client=createClient();
    try{await client.connect();await client.query('BEGIN');await ensureSchema(client);const count=await seed(client);await client.query('COMMIT');console.log(`Đã bổ sung nội dung cho ${count} điểm đến; giữ nguyên nội dung đã biên tập.`);}
    catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{await client.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={seed,osmContent};
