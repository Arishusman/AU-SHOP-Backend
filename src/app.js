import express from 'express'; import cors from 'cors'; import rateLimit from 'express-rate-limit'; import {createClient} from '@supabase/supabase-js'; import bcrypt from 'bcryptjs'; import {v4 as uuid} from 'uuid'; import multer from 'multer'; import crypto from 'node:crypto';
const sendBrevoEmail=async(to,subject,html)=>{if(!process.env.BREVO_API_KEY)return {error:'Brevo is not configured'};const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{accept:'application/json','api-key':process.env.BREVO_API_KEY.trim(),'content-type':'application/json'},body:JSON.stringify({sender:{name:'AU SHOP',email:'arishusm12an@gmail.com'},to:[{email:to}],subject,htmlContent:html})});if(!r.ok){let e='Brevo email failed';try{const j=await r.json();e=j.message||e}catch{}return {error:e}}return {ok:true}};
const app=express(); app.use(cors({origin:process.env.FRONTEND_URL||'http://localhost:3000'})); app.use(express.json({limit:'4mb'})); app.use(rateLimit({windowMs:60_000,max:120}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024}});
const supa=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY):null; const otps=new Map(); const adminTokens=new Map();
const ok=(res,data)=>res.json({ok:true,data}); const fail=(res,msg,code=400)=>res.status(code).json({ok:false,error:msg});
app.get('/api/health',(req,res)=>ok(res,{service:'A.U SHOP API',supabase:!!supa,brevo:!!process.env.BREVO_API_KEY}));
app.post('/api/auth/send-code',async(req,res)=>{
const {email}=req.body||{};
if(!email)return fail(res,'Email is required');
const code=String(Math.floor(100000+Math.random()*900000));
otps.set(email,{code,expires:Date.now()+10*60*1000});
const r=await sendBrevoEmail(email,'A.U SHOP verification code',`<div style="font-family:Arial"><h2>A.U SHOP</h2><p>Your verification code is <b>${code}</b>.</p><p>This code expires in 10 minutes.</p></div>`);
if(r.error)return fail(res,r.error,502);
ok(res,{message:'Verification code sent'});
});
app.post('/api/auth/verify-code',(req,res)=>{const {email,code}=req.body||{};const x=otps.get(email);if(!x||x.expires<Date.now()||x.code!==String(code))return fail(res,'Invalid or expired code',401);otps.delete(email);ok(res,{verified:true,user:{email}})});
app.post('/api/admin/login',async(req,res)=>{
const {username,password}=req.body||{};
const validUser=username===process.env.ADMIN_USERNAME||username===process.env.ADMIN_EMAIL;
const validPass=password===process.env.ADMIN_PASSWORD;
if(!validUser||!validPass)return fail(res,'Invalid admin credentials',401);
const code=String(Math.floor(100000+Math.random()*900000));
otps.set(process.env.ADMIN_EMAIL,{code,expires:Date.now()+10*60*1000});
const r=await sendBrevoEmail(process.env.ADMIN_EMAIL,'A.U SHOP admin verification',`<h2>Admin verification</h2><p>Your code: <b>${code}</b></p>`);
if(r.error)return fail(res,r.error,502);
ok(res,{challenge:true});
});
app.post('/api/admin/verify',(req,res)=>{const {code}=req.body||{};const x=otps.get(process.env.ADMIN_EMAIL);if(!x||x.expires<Date.now()||x.code!==String(code))return fail(res,'Invalid or expired code',401);otps.delete(process.env.ADMIN_EMAIL);const token=crypto.randomBytes(32).toString('hex');adminTokens.set(token,Date.now()+12*60*60*1000);ok(res,{token,role:'admin'})});
const requireAdmin=(req,res,next)=>{const h=req.headers.authorization||'';const token=h.startsWith('Bearer ')?h.slice(7):'';const expires=adminTokens.get(token);if(!expires||expires<Date.now()){if(token)adminTokens.delete(token);return fail(res,'Admin authentication required',401)}next()};
app.post('/api/upload/product-image',requireAdmin,upload.single('image'),async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);if(!req.file)return fail(res,'Image is required');if(!req.file.mimetype.startsWith('image/'))return fail(res,'Only image files are allowed');const ext=(req.file.originalname.split('.').pop()||'jpg').toLowerCase();const path=`products/${Date.now()}-${uuid()}.${ext}`;const {error}=await supa.storage.from('product-images').upload(path,req.file.buffer,{contentType:req.file.mimetype,upsert:false});if(error)return fail(res,error.message,400);const {data}=supa.storage.from('product-images').getPublicUrl(path);ok(res,{path,url:data.publicUrl})});

app.post('/api/upload/payment-screenshot',upload.single('image'),async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);if(!req.file)return fail(res,'Payment screenshot is required');if(!req.file.mimetype.startsWith('image/'))return fail(res,'Only image files are allowed');const ext=(req.file.originalname.split('.').pop()||'jpg').toLowerCase();const path=`payments/${Date.now()}-${uuid()}.${ext}`;const {error}=await supa.storage.from('payment-screenshots').upload(path,req.file.buffer,{contentType:req.file.mimetype,upsert:false});if(error)return fail(res,error.message,400);const {data}=supa.storage.from('payment-screenshots').getPublicUrl(path);ok(res,{path,url:data.publicUrl})});app.get('/api/products',async(req,res)=>{if(!supa)return ok(res,{source:'static',items:[]});const {data,error}=await supa.from('products').select('*').order('id');if(error)return fail(res,error.message,500);ok(res,{source:'supabase',items:data})});
app.post('/api/products',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('products').insert(req.body).select().single();if(error)return fail(res,error.message,400);ok(res,data)});
app.patch('/api/products/:id',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('products').update(req.body).eq('id',req.params.id).select().single();if(error)return fail(res,error.message,400);ok(res,data)});
app.delete('/api/products/:id',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {error}=await supa.from('products').delete().eq('id',req.params.id);if(error)return fail(res,error.message,400);ok(res,{deleted:true})});
app.get('/api/categories',async(req,res)=>{if(!supa)return ok(res,{items:[]});const {data,error}=await supa.from('categories').select('*,category_products(product_id)').order('name');if(error)return fail(res,error.message,500);ok(res,data)});
app.post('/api/categories',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('categories').insert(req.body).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.post('/api/categories/:id/products',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {product_id,enabled}=req.body;const q=enabled?supa.from('category_products').upsert({category_id:req.params.id,product_id}):supa.from('category_products').delete().match({category_id:req.params.id,product_id});const {error}=await q;if(error)return fail(res,error.message);ok(res,{updated:true})});
app.get('/api/reviews',async(req,res)=>{if(!supa)return ok(res,{items:[]});const {data,error}=await supa.from('reviews').select('*').order('created_at',{ascending:false});if(error)return fail(res,error.message,500);ok(res,data)});
app.post('/api/reviews',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('reviews').insert(req.body).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.patch('/api/reviews/:id',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('reviews').update(req.body).eq('id',req.params.id).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.delete('/api/reviews/:id',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {error}=await supa.from('reviews').delete().eq('id',req.params.id);if(error)return fail(res,error.message);ok(res,{deleted:true})});
app.get('/api/orders',async(req,res)=>{if(!supa)return ok(res,{items:[]});const {data,error}=await supa.from('orders').select('*,order_items(*)').order('created_at',{ascending:false});if(error)return fail(res,error.message,500);ok(res,data)});
app.post('/api/orders',async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);
  const {items=[],...body}=req.body||{};
  const order={
    ...body,
    order_id:body.order_id||`AU-${Date.now().toString(36).toUpperCase()}`
  };
  const {data,error}=await supa.from('orders').insert(order).select().single();
  if(error)return fail(res,error.message);

  if(Array.isArray(items)&&items.length){
    const rows=items.map(p=>({
      order_id:data.id,
      product_id:p.id,
      name:p.name,
      price:Number(p.price)||0,
      quantity:Number(p.qty||p.quantity||1)
    }));
    const {error:itemError}=await supa.from('order_items').insert(rows);
    if(itemError){
      await supa.from('orders').delete().eq('id',data.id);
      return fail(res,itemError.message,400);
    }
  }

  const {data:full,error:fullError}=await supa.from('orders').select('*,order_items(*)').eq('id',data.id).single();
  if(fullError)return fail(res,fullError.message,500);
  ok(res,full);
});
app.patch('/api/orders/:id/status',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const allowed=['in progress','in shipping','delivered'];if(req.body.delivery_status&&!allowed.includes(req.body.delivery_status))return fail(res,'Invalid delivery status');const payment=['COD','in review','rejected','approved'];if(req.body.payment_status&&!payment.includes(req.body.payment_status))return fail(res,'Invalid payment status');const {data,error}=await supa.from('orders').update(req.body).eq('id',req.params.id).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.post('/api/orders/:id/cancel',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('orders').update({cancelled:true,delivery_status:'cancelled'}).eq('id',req.params.id).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.delete('/api/orders/:id',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {error}=await supa.from('orders').delete().eq('id',req.params.id);if(error)return fail(res,error.message);ok(res,{deleted:true})});
app.get('/api/track',(req,res)=>{res.status(501).json({ok:false,error:'Use /api/orders with Supabase filters for production tracking.'})});
export default app;
