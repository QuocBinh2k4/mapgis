const {createClient}=require('./db');
const {ensureSchema}=require('./schema');
async function main() {
    const byId=process.argv[2]==='--id', value=byId ? process.argv[3] : process.argv[2];
    if (!value || (byId ? !/^[0-9a-f-]{36}$/i.test(value) : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new Error('Dùng: npm run users:admin -- email@gmail.com (sau khi người dùng đã đăng nhập), hoặc -- --id UUID.');
    const client=createClient();
    try {
        await client.connect();await client.query('BEGIN');await ensureSchema(client);
        await client.query("SELECT pg_advisory_xact_lock(hashtext('mapgis-admin-write'))");
        const rows=(await client.query(byId ? 'SELECT * FROM app_users WHERE id=$1 FOR UPDATE' : 'SELECT * FROM app_users WHERE lower(email)=$1 FOR UPDATE',[byId?value:value.toLowerCase()])).rows;
        if (rows.length!==1) throw new Error('Cần đúng một tài khoản Google đã đăng nhập. Nếu trùng email, hãy dùng --id UUID.');
        const user=rows[0];
        if (user.status!=='active') throw new Error('Tài khoản chưa hoạt động; cần khôi phục hoặc mở khóa trước.');
        await client.query("UPDATE app_users SET role='admin',updated_at=now(),version=version+1 WHERE id=$1",[user.id]);
        await client.query('DELETE FROM app_sessions WHERE user_id=$1',[user.id]);
        await client.query(`INSERT INTO admin_audit_logs(actor_id,action,resource_type,resource_id,changes) VALUES(NULL,'bootstrap_admin','user',$1,$2::jsonb)`,[user.id,JSON.stringify({before:user.role,after:'admin',method:'database_owner_cli'})]);
        await client.query('COMMIT');
        console.log(`Đã cấp quyền admin cho ${user.email}. Người dùng cần đăng nhập lại.`);
    } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally {await client.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
