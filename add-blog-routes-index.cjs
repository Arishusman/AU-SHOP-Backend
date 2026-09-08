const fs = require('fs');

const file = 'src/index.js';
let f = fs.readFileSync(file, 'utf8');

const marker = "app.get('/api/orders'";

const routes = `
app.get('/api/blogs',async(req,res)=>{
 if(!supa)return ok(res,[]);
 const {data,error}=await supa.from('blogs').select('*').order('created_at',{ascending:false});
 if(error)return fail(res,error.message,500);
 ok(res,data);
});
app.post('/api/blogs',async(req,res)=>{
 if(!supa)return fail(res,'Supabase is not configured',503);
 const {data,error}=await supa.from('blogs').insert(req.body).select().single();
 if(error)return fail(res,error.message,400);
 ok(res,data);
});
app.patch('/api/blogs/:id',async(req,res)=>{
 if(!supa)return fail(res,'Supabase is not configured',503);
 const {data,error}=await supa.from('blogs').update({...req.body,updated_at:new Date().toISOString()}).eq('id',req.params.id).select().single();
 if(error)return fail(res,error.message,400);
 ok(res,data);
});
app.delete('/api/blogs/:id',async(req,res)=>{
 if(!supa)return fail(res,'Supabase is not configured',503);
 const {error}=await supa.from('blogs').delete().eq('id',req.params.id);
 if(error)return fail(res,error.message,400);
 ok(res,{deleted:true});
});
`;

if (!f.includes("app.get('/api/blogs'")) {
  f = f.replace(marker, routes + marker);
  fs.writeFileSync(file, f);
  console.log('Blog API routes added to index.js successfully.');
} else {
  console.log('Blog API routes already exist in index.js.');
}
