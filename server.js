const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const { databaseConfig } = require('./scripts/db');
const { registerRouting } = require('./services/routing');
const { registerAuth } = require('./services/auth');
const { registerAdmin } = require('./services/admin');
const { registerData } = require('./services/data');

const app = express();
const pool = new Pool(databaseConfig());
app.locals.pool = pool;
app.use(['/api/diemdulich','/api/ranhgioi','/api/routes','/api/routing/status'],cors());
app.use((req,res,next)=>{
    res.set('X-Content-Type-Options','nosniff');
    res.set('Cross-Origin-Opener-Policy','same-origin-allow-popups');
    res.set('Referrer-Policy',req.hostname==='localhost' ? 'no-referrer-when-downgrade' : 'strict-origin-when-cross-origin');
    next();
});
app.use(express.json({ limit: '16kb' }));
app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Nội dung yêu cầu JSON không hợp lệ.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Nội dung yêu cầu quá lớn.' });
    next(error);
});
registerRouting(app, pool);
const auth=registerAuth(app,pool);
registerAdmin(app,pool,auth);
registerData(app,pool);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/account', (req,res)=>res.sendFile(path.join(__dirname,'public','account.html')));
app.get('/admin', (req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));

if (require.main === module) {
    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => console.log(`Server đang chạy tại http://localhost:${port}`));
}
module.exports = app;
