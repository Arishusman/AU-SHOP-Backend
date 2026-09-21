import "dotenv/config";

import express from 'express'; import cors from 'cors'; import rateLimit from 'express-rate-limit'; import {createClient} from '@supabase/supabase-js'; import bcrypt from 'bcryptjs'; import {v4 as uuid} from 'uuid'; import multer from 'multer'; import crypto from 'node:crypto';
const sendBrevoEmail=async(to,subject,html)=>{if(!process.env.BREVO_API_KEY)return {error:'Brevo is not configured'};const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{accept:'application/json','api-key':process.env.BREVO_API_KEY.trim(),'content-type':'application/json'},body:JSON.stringify({sender:{name:'AU SHOP',email:'arishusm12an@gmail.com'},to:[{email:to}],subject,htmlContent:html})});if(!r.ok){let e='Brevo email failed';try{const j=await r.json();e=j.message||e}catch{}return {error:e}}return {ok:true}};
const app=express();
app.use(cors({origin:process.env.FRONTEND_URL||'https://au-shop-ruby.vercel.app'}));
app.use(express.json({limit:'4mb'}));
app.use(rateLimit({windowMs:60_000,max:120}));
const authRateLimit=rateLimit({windowMs:10*60_000,max:10,standardHeaders:true,legacyHeaders:false,message:{ok:false,error:'Too many authentication attempts. Please try again later.'}});
const reviewRateLimit=rateLimit({windowMs:10*60_000,max:10,standardHeaders:true,legacyHeaders:false,message:{ok:false,error:'Too many reviews submitted. Please try again later.'}});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024}});
const supa=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY):null;
const otps=new Map();
const authSecret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.ADMIN_PASSWORD||process.env.BREVO_API_KEY;
const signAuth=(payload)=>{const raw=Buffer.from(JSON.stringify(payload)).toString("base64url");const sig=crypto.createHmac("sha256",authSecret).update(raw).digest("base64url");return raw+"."+sig};
const verifyAuth=(token)=>{try{const [raw,sig]=String(token||"").split(".");if(!raw||!sig)return null;const expected=crypto.createHmac("sha256",authSecret).update(raw).digest("base64url");if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;const payload=JSON.parse(Buffer.from(raw,"base64url").toString());if(!payload.exp||payload.exp<Date.now())return null;return payload}catch{return null}};
const ok=(res,data)=>res.json({ok:true,data}); const fail=(res,msg,code=400)=>res.status(code).json({ok:false,error:msg});
app.get('/api/health',(req,res)=>ok(res,{service:'A.U SHOP API',supabase:!!supa,brevo:!!process.env.BREVO_API_KEY}));
app.post('/api/auth/send-code',authRateLimit,async(req,res)=>{
const {email}=req.body||{};
if(!email)return fail(res,'Email is required');
const code=String(crypto.randomInt(100000,1000000));
const exp=Date.now()+10*60*1000;
const codeHash=crypto.createHash('sha256').update(code).digest('hex');
const challenge=signAuth({type:'user_otp',email,codeHash,exp});
const r=await sendBrevoEmail(email,'A.U SHOP verification code',`<div style="font-family:Arial"><h2>A.U SHOP</h2><p>Your verification code is <b>${code}</b>.</p><p>This code expires in 10 minutes.</p></div>`);
if(r.error)return fail(res,r.error,502);
ok(res,{message:'Verification code sent',challenge});
});
app.post('/api/auth/verify-code',authRateLimit,async(req,res)=>{
  const {email,code,challenge}=req.body||{};
  const normalizedEmail=String(email||'').trim().toLowerCase();
  const x=verifyAuth(challenge);
  const hash=crypto.createHash('sha256').update(String(code||'')).digest('hex');

  if(!x || x.type!=='user_otp' || x.email!==normalizedEmail || x.codeHash!==hash){
    return fail(res,'Invalid or expired code',401);
  }

  if(!supa)return fail(res,'Supabase is not configured',503);

  const {data:profile,error}=await supa
    .from('profiles')
    .upsert(
      {email:normalizedEmail,updated_at:new Date().toISOString()},
      {onConflict:'email'}
    )
    .select()
    .single();

  if(error)return fail(res,error.message,500);

  const token=signAuth({
    type:'user_session',
    role:'customer',
    email:normalizedEmail,
    profile_id:profile.id,
    exp:Date.now()+30*24*60*60*1000
  });

  ok(res,{
    verified:true,
    token,
    user:{
      email:normalizedEmail,
      profile_id:profile.id
    }
  });
});
app.post('/api/admin/login',authRateLimit,async(req,res)=>{const {username,password}=req.body||{};const validUser=username===process.env.ADMIN_USERNAME||username===process.env.ADMIN_EMAIL;const validPass=password===process.env.ADMIN_PASSWORD;if(!validUser||!validPass)return fail(res,'Invalid admin credentials',401);const code=String(crypto.randomInt(100000,1000000));const exp=Date.now()+10*60*1000;const codeHash=crypto.createHash('sha256').update(code).digest('hex');const challenge=signAuth({type:'admin_otp',email:process.env.ADMIN_EMAIL,codeHash,exp});const r=await sendBrevoEmail(process.env.ADMIN_EMAIL,'A.U SHOP admin verification',`<h2>Admin verification</h2><p>Your code: <b>${code}</b></p>`);if(r.error)return fail(res,r.error,502);ok(res,{challenge});});
app.post('/api/admin/verify',authRateLimit,(req,res)=>{const {code,challenge}=req.body||{};const x=verifyAuth(challenge);const hash=crypto.createHash('sha256').update(String(code||'')).digest('hex');if(!x||x.type!=='admin_otp'||x.email!==process.env.ADMIN_EMAIL||x.codeHash!==hash)return fail(res,'Invalid or expired code',401);const token=signAuth({type:'admin_session',role:'admin',exp:Date.now()+7*24*60*60*1000});ok(res,{token,role:'admin'});});
const requireAdmin=(req,res,next)=>{const h=req.headers.authorization||'';const token=h.startsWith('Bearer ')?h.slice(7):'';const session=verifyAuth(token);if(!session||session.type!=='admin_session'||session.role!=='admin')return fail(res,'Admin authentication required',401);next()};
app.post('/api/upload/product-image',requireAdmin,upload.single('image'),async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);if(!req.file)return fail(res,'Image is required');if(!req.file.mimetype.startsWith('image/'))return fail(res,'Only image files are allowed');const ext=(req.file.originalname.split('.').pop()||'jpg').toLowerCase();const path=`products/${Date.now()}-${uuid()}.${ext}`;const {error}=await supa.storage.from('product-images').upload(path,req.file.buffer,{contentType:req.file.mimetype,upsert:false});if(error)return fail(res,error.message,400);const {data}=supa.storage.from('product-images').getPublicUrl(path);ok(res,{path,url:data.publicUrl})});

app.post('/api/upload/payment-screenshot',upload.single('image'),async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);if(!req.file)return fail(res,'Payment screenshot is required');const allowed={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};const ext=allowed[req.file.mimetype];if(!ext)return fail(res,'Only JPG, PNG and WebP images are allowed');const path=`payments/${Date.now()}-${uuid()}.${ext}`;const {error}=await supa.storage.from('payment-screenshots').upload(path,req.file.buffer,{contentType:req.file.mimetype,upsert:false});if(error)return fail(res,error.message,400);const {data}=supa.storage.from('payment-screenshots').getPublicUrl(path);ok(res,{path,url:data.publicUrl})});app.post('/api/upload/blog-image',requireAdmin,upload.single('image'),async(req,res)=>{
if(!supa)return fail(res,'Supabase is not configured',503);
if(!req.file)return fail(res,'Image is required');
if(!req.file.mimetype.startsWith('image/'))return fail(res,'Only image files are allowed');
const ext=(req.file.originalname.split('.').pop()||'jpg').toLowerCase();
const path='blogs/'+Date.now()+'-'+uuid()+'.'+ext;
const {error}=await supa.storage.from('product-images').upload(path,req.file.buffer,{contentType:req.file.mimetype,upsert:false});
if(error)return fail(res,error.message,400);
const {data}=supa.storage.from('product-images').getPublicUrl(path);
ok(res,{path,url:data.publicUrl});
});

// =============================
// HOME CONFIG
// =============================

app.get('/api/home-config', async (req, res) => {
  if (!supa) return fail(res, 'Supabase is not configured', 503);

  try {
    const [catResult, productResult] = await Promise.all([
      supa
        .from('home_categories')
        .select('category_id,enabled,sort_order')
        .eq('enabled', true)
        .order('sort_order'),

      supa
        .from('home_category_products')
        .select('category_id,product_id,enabled,sort_order')
        .eq('enabled', true)
        .order('sort_order')
    ]);

    if (catResult.error) return fail(res, catResult.error.message, 500);
    if (productResult.error) return fail(res, productResult.error.message, 500);

    return ok(res, {
      categories: catResult.data || [],
      products: productResult.data || []
    });
  } catch (e) {
    return fail(
      res,
      e instanceof Error ? e.message : 'Unable to load home configuration',
      500
    );
  }
});

app.get('/api/home-categories', async (req, res) => {
  if (!supa) return fail(res, 'Supabase is not configured', 503);

  const { data, error } = await supa
    .from('home_categories')
    .select('*')
    .order('sort_order');

  if (error) return fail(res, error.message, 500);

  return ok(res, data || []);
});

app.post('/api/home-categories', requireAdmin, async (req, res) => {
  if (!supa) return fail(res, 'Supabase is not configured', 503);

  const {
    category_id,
    enabled = true,
    sort_order = 0
  } = req.body || {};

  if (!category_id) return fail(res, 'category_id is required');

  const { data, error } = await supa
    .from('home_categories')
    .upsert(
      { category_id, enabled, sort_order },
      { onConflict: 'category_id' }
    )
    .select()
    .single();

  if (error) return fail(res, error.message, 400);

  return ok(res, data);
});

app.post('/api/home-category-products', requireAdmin, async (req, res) => {
  if (!supa) return fail(res, 'Supabase is not configured', 503);

  const {
    category_id,
    product_id,
    enabled = true,
    sort_order = 0
  } = req.body || {};

  if (!category_id || product_id === undefined || product_id === null) {
    return fail(res, 'category_id and product_id are required');
  }

  if (enabled === false) {
    const { error } = await supa
      .from('home_category_products')
      .delete()
      .match({ category_id, product_id });

    if (error) return fail(res, error.message, 400);

    return ok(res, { updated: true });
  }

  const { data, error } = await supa
    .from('home_category_products')
    .upsert(
      {
        category_id,
        product_id,
        enabled: true,
        sort_order: Number(sort_order) || 0
      },
      { onConflict: 'category_id,product_id' }
    )
    .select()
    .single();

  if (error) return fail(res, error.message, 400);

  return ok(res, data);
});

app.get('/api/products',async(req,res)=>{if(!supa)return ok(res,{source:'static',items:[]});const {data,error}=await supa.from('products').select('*').order('id');if(error)return fail(res,error.message,500);ok(res,{source:'supabase',items:data})});
app.post('/api/products',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('products').insert(req.body).select().single();if(error)return fail(res,error.message,400);ok(res,data)});
app.patch('/api/products/:id',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('products').update(req.body).eq('id',req.params.id).select().single();if(error)return fail(res,error.message,400);ok(res,data)});
app.delete('/api/products/:id',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {error}=await supa.from('products').delete().eq('id',req.params.id);if(error)return fail(res,error.message,400);ok(res,{deleted:true})});
app.get('/api/categories',async(req,res)=>{if(!supa)return ok(res,{items:[]});const {data,error}=await supa.from('categories').select('*,category_products(product_id)').order('name');if(error)return fail(res,error.message,500);ok(res,data)});
app.post('/api/categories',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('categories').insert(req.body).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.get('/api/categories/:id/products',async(req,res)=>{
  if(!supa)return ok(res,{items:[]});

  const {data,error}=await supa
    .from('category_products')
    .select('product_id, products(*)')
    .eq('category_id',req.params.id);

  if(error)return fail(res,error.message,500);

  ok(res,{items:data||[]});
});

app.post('/api/categories/:id/products',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {product_id,enabled}=req.body;const q=enabled?supa.from('category_products').upsert({category_id:req.params.id,product_id}):supa.from('category_products').delete().match({category_id:req.params.id,product_id});const {error}=await q;if(error)return fail(res,error.message);ok(res,{updated:true})});
app.delete('/api/categories/:id',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {error}=await supa.from('categories').delete().eq('id',req.params.id);if(error)return fail(res,error.message,400);ok(res,{deleted:true})});

app.get('/api/reviews',async(req,res)=>{if(!supa)return ok(res,{items:[]});const {data,error}=await supa.from('reviews').select('*').order('created_at',{ascending:false});if(error)return fail(res,error.message,500);ok(res,data)});
app.post('/api/reviews',reviewRateLimit,async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);

  const body=req.body||{};
  const productId=Number(body.product_id);
  const name=String(body.name||'').trim();
  const email=String(body.email||'').trim();
  const rating=Number(body.rating);
  const comment=String(body.comment||'').trim();

  if(!Number.isInteger(productId)||productId<1)return fail(res,'Invalid product');
  if(!name||name.length>80)return fail(res,'Name is required and must be 80 characters or less');
  if(email.length>160)return fail(res,'Email is too long');
  if(!Number.isInteger(rating)||rating<1||rating>5)return fail(res,'Rating must be between 1 and 5');
  if(!comment||comment.length>2000)return fail(res,'Review is required and must be 2000 characters or less');

  let profileId=String(body.profile_id||'').trim();

  const authHeader=req.headers.authorization||'';
  const customerToken=authHeader.startsWith('Bearer ')
    ?authHeader.slice(7)
    :'';

  if(customerToken){
    const session=verifyAuth(customerToken);

    if(
      !session ||
      session.type!=='user_session' ||
      session.role!=='customer' ||
      !session.profile_id
    ){
      return fail(res,'Customer authentication required',401);
    }

    profileId=session.profile_id;
  }

  if(profileId){
    const {data:profile,error:profileError}=await supa
      .from('profiles')
      .select('id')
      .eq('id',profileId)
      .maybeSingle();

    if(profileError)return fail(res,profileError.message,500);
    if(!profile)return fail(res,'Invalid customer profile',400);
  }

  const review={
    product_id:productId,
    profile_id:profileId||null,
    name,
    email:email||null,
    rating,
    comment,
    approved:true
  };

  const {data,error}=await supa.from('reviews').insert(review).select().single();
  if(error)return fail(res,error.message,400);

  ok(res,data);
});
app.patch('/api/reviews/:id',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('reviews').update(req.body).eq('id',req.params.id).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.delete('/api/reviews/:id',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {error}=await supa.from('reviews').delete().eq('id',req.params.id);if(error)return fail(res,error.message);ok(res,{deleted:true})});

app.get('/api/blogs',async(req,res)=>{
  if(!supa)return ok(res,[]);
  const {data,error}=await supa.from('blogs').select('*').order('created_at',{ascending:false});
  if(error)return fail(res,error.message,500);
  ok(res,data);
});
app.post('/api/blogs',requireAdmin,async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);
  const {data,error}=await supa.from('blogs').insert(req.body).select().single();
  if(error)return fail(res,error.message,400);
  ok(res,data);
});
app.patch('/api/blogs/:id',requireAdmin,async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);
  const {data,error}=await supa.from('blogs').update({...req.body,updated_at:new Date().toISOString()}).eq('id',req.params.id).select().single();
  if(error)return fail(res,error.message,400);
  ok(res,data);
});
app.delete('/api/blogs/:id',requireAdmin,async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);
  const {error}=await supa.from('blogs').delete().eq('id',req.params.id);
  if(error)return fail(res,error.message,400);
  ok(res,{deleted:true});
});
app.get('/api/payment-screenshot',requireAdmin,async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);

  const raw=String(req.query.url||'').trim();
  if(!raw)return fail(res,'Payment screenshot URL is required');

  let path='';
  try{
    const url=new URL(raw);
    const prefix='/storage/v1/object/public/payment-screenshots/';
    if(!url.pathname.startsWith(prefix))return fail(res,'Invalid payment screenshot');
    path=decodeURIComponent(url.pathname.slice(prefix.length));
  }catch{
    return fail(res,'Invalid payment screenshot URL');
  }

  if(!path.startsWith('payments/'))return fail(res,'Invalid payment screenshot path');

  const {data,error}=await supa
    .storage
    .from('payment-screenshots')
    .createSignedUrl(path,60*10);

  if(error||!data?.signedUrl)return fail(res,error?.message||'Unable to create secure screenshot URL',400);

  ok(res,{url:data.signedUrl});
});

app.get('/api/orders',requireAdmin,async(req,res)=>{if(!supa)return ok(res,{items:[]});const {data,error}=await supa.from('orders').select('*,order_items(*)').order('created_at',{ascending:false});if(error)return fail(res,error.message,500);ok(res,data)});
app.get('/api/admin/profiles',requireAdmin,async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);

  const {data,error}=await supa
    .from('profiles')
    .select('id,email,created_at')
    .order('created_at',{ascending:false});

  if(error)return fail(res,error.message,500);

  ok(res,data||[]);
});

app.get('/api/admin/profiles/:id',requireAdmin,async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);

  const profileId=String(req.params.id||'').trim();

  const {data:profile,error:profileError}=await supa
    .from('profiles')
    .select('id,email,name,phone,address,created_at,updated_at')
    .eq('id',profileId)
    .maybeSingle();

  if(profileError)return fail(res,profileError.message,500);
  if(!profile)return fail(res,'Customer profile not found',404);

  const {data:orders,error:ordersError}=await supa
    .from('orders')
    .select('*,order_items(*)')
    .eq('profile_id',profileId)
    .order('created_at',{ascending:false});

  if(ordersError)return fail(res,ordersError.message,500);

  const {data:reviews,error:reviewsError}=await supa
    .from('reviews')
    .select('*')
    .eq('profile_id',profileId)
    .order('created_at',{ascending:false});

  if(reviewsError)return fail(res,reviewsError.message,500);

  ok(res,{
    profile,
    orders:orders||[],
    reviews:reviews||[]
  });
});

const requireCustomer=(req,res,next)=>{
  const h=req.headers.authorization||'';
  const token=h.startsWith('Bearer ')?h.slice(7):'';
  const session=verifyAuth(token);

  if(
    !session ||
    session.type!=='user_session' ||
    session.role!=='customer' ||
    !session.profile_id
  ){
    return fail(res,'Customer authentication required',401);
  }

  req.customerSession=session;
  next();
};
app.get('/api/customer/reviews',requireCustomer,async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);

  const profileId=req.customerSession.profile_id;

  const {data,error}=await supa
    .from('reviews')
    .select('*')
    .eq('profile_id',profileId)
    .order('created_at',{ascending:false});

  if(error)return fail(res,error.message,500);

  ok(res,data||[]);
});

app.get('/api/customer/orders',requireCustomer,async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);

  const profileId=req.customerSession.profile_id;

  const {data,error}=await supa
    .from('orders')
    .select('*,order_items(*)')
    .eq('profile_id',profileId)
    .order('created_at',{ascending:false});

  if(error)return fail(res,error.message,500);

  ok(res,data||[]);
});



app.get('/api/profile/:id',requireCustomer,async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);

  const profileId=String(req.params.id||'').trim();

  if(!profileId)return fail(res,'Profile ID is required');

  if(profileId!==req.customerSession.profile_id){
    return fail(res,'You can only access your own profile',403);
  }

  const {data,error}=await supa
    .from('profiles')
    .select('id,email,name,phone,address')
    .eq('id',profileId)
    .maybeSingle();

  if(error)return fail(res,error.message,500);
  if(!data)return fail(res,'Customer profile not found',404);

  ok(res,data);
});

app.patch('/api/profile',requireCustomer,async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);

  const body=req.body||{};
  const profileId=String(body.profile_id||'').trim();
  const hasName=Object.prototype.hasOwnProperty.call(body,'name');
  const hasPhone=Object.prototype.hasOwnProperty.call(body,'phone');
  const hasAddress=Object.prototype.hasOwnProperty.call(body,'address');

  const name=String(body.name??'').trim();
  const phone=String(body.phone??'').trim();
  const address=String(body.address??'').trim();

  if(!profileId)return fail(res,'Profile ID is required');

  if(profileId!==req.customerSession.profile_id){
    return fail(res,'You can only update your own profile',403);
  }

  if(!hasName&&!hasPhone&&!hasAddress){
    return fail(res,'Nothing to update');
  }

  if(hasName&&!name)return fail(res,'Name is required');
  if(hasPhone&&!phone)return fail(res,'Phone is required');
  if(hasAddress&&!address)return fail(res,'Address is required');

  if(hasName&&name.length>100)return fail(res,'Name is too long');
  if(hasPhone&&phone.length>40)return fail(res,'Phone is too long');
  if(hasAddress&&address.length>500)return fail(res,'Address is too long');

  const updates={
    ...(hasName?{name}:{}),
    ...(hasPhone?{phone}:{}),
    ...(hasAddress?{address}:{}),
    updated_at:new Date().toISOString()
  };

  const {data,error}=await supa
    .from('profiles')
    .update(updates)
    .eq('id',profileId)
    .select('id,email,name,phone,address,created_at,updated_at')
    .maybeSingle();

  if(error)return fail(res,error.message,500);
  if(!data)return fail(res,'Customer profile not found',404);

  ok(res,data);
});

app.post('/api/orders',async(req,res)=>{
  if(!supa)return fail(res,'Supabase is not configured',503);

  const body=req.body||{};
  const items=Array.isArray(body.items)?body.items:[];

  const name=String(body.name||'').trim();
  const phone=String(body.phone||'').trim();
  const address=String(body.address||'').trim();

  if(!name||!phone||!address)return fail(res,'Name, phone and address are required');
  if(!items.length)return fail(res,'At least one product is required');

  const ids=[...new Set(items.map(p=>Number(p.id)).filter(Number.isInteger))];
  if(ids.length!==items.length)return fail(res,'Invalid product');

  const {data:products,error:productError}=await supa
    .from('products')
    .select('id,name,price,available,stock')
    .in('id',ids);

  if(productError)return fail(res,productError.message,500);
  if(!products||products.length!==ids.length)return fail(res,'One or more products were not found');

  const productMap=new Map(products.map(p=>[Number(p.id),p]));

  let subtotal=0;
  const rows=[];

  for(const item of items){
    const product=productMap.get(Number(item.id));
    const quantity=Math.floor(Number(item.qty||item.quantity||1));

    if(!product)return fail(res,'Product not found');
    if(!Number.isInteger(quantity)||quantity<1)return fail(res,'Invalid quantity');
    if(product.available===false)return fail(res,`${product.name} is currently unavailable`);
    if(Number.isFinite(Number(product.stock))&&Number(product.stock)<quantity){
      return fail(res,`${product.name} does not have enough stock`);
    }

    const price=Number(product.price)||0;
    subtotal+=price*quantity;

    rows.push({
      product_id:product.id,
      name:product.name,
      price,
      quantity
    });
  }

  const delivery=255;
  const total=subtotal+delivery;

  const paymentStatus=body.payment_status==='COD'?'COD':'in review';

  let profileId=String(body.profile_id||'').trim();

  const authHeader=req.headers.authorization||'';
  const customerToken=authHeader.startsWith('Bearer ')
    ?authHeader.slice(7)
    :'';

  if(customerToken){
    const session=verifyAuth(customerToken);

    if(
      !session ||
      session.type!=='user_session' ||
      session.role!=='customer' ||
      !session.profile_id
    ){
      return fail(res,'Customer authentication required',401);
    }

    profileId=session.profile_id;
  }

  if(profileId){
    const {data:profile,error:profileError}=await supa
      .from('profiles')
      .select('id')
      .eq('id',profileId)
      .maybeSingle();

    if(profileError)return fail(res,profileError.message,500);
    if(!profile)return fail(res,'Invalid customer profile',400);
  }

  const order={
    order_id:String(body.order_id||`AU-${Date.now().toString(36).toUpperCase()}`),
    profile_id:profileId||null,
    name,
    phone,
    address,
    total,
    payment_status:paymentStatus,
    delivery_status:'in progress',
    cancelled:false,
    transaction_id:body.transaction_id?String(body.transaction_id).trim():null,
    payment_screenshot:body.payment_screenshot?String(body.payment_screenshot):null
  };

  const {data,error}=await supa.from('orders').insert(order).select().single();
  if(error)return fail(res,error.message);

  const orderRows=rows.map(p=>({...p,order_id:data.id}));

  const {error:itemError}=await supa.from('order_items').insert(orderRows);

  if(itemError){
    await supa.from('orders').delete().eq('id',data.id);
    return fail(res,itemError.message,400);
  }

  const {data:full,error:fullError}=await supa
    .from('orders')
    .select('*,order_items(*)')
    .eq('id',data.id)
    .single();

  if(fullError)return fail(res,fullError.message,500);

  ok(res,full);
});
app.post('/api/upload/review-image',requireAdmin,upload.single('image'),async(req,res)=>{
if(!supa)return fail(res,'Supabase is not configured',503);
if(!req.file)return fail(res,'Image is required');
if(!req.file.mimetype.startsWith('image/'))return fail(res,'Only image files are allowed');
const ext=(req.file.originalname.split('.').pop()||'jpg').toLowerCase();
const path='reviews/'+Date.now()+'-'+uuid()+'.'+ext;
const {error}=await supa.storage.from('product-images').upload(path,req.file.buffer,{contentType:req.file.mimetype,upsert:false});
if(error)return fail(res,error.message,400);
const {data}=supa.storage.from('product-images').getPublicUrl(path);
ok(res,{path,url:data.publicUrl});
});

app.patch('/api/orders/:id/status',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const allowed=['in progress','in shipping','delivered'];if(req.body.delivery_status&&!allowed.includes(req.body.delivery_status))return fail(res,'Invalid delivery status');const payment=['COD','in review','rejected','approved'];if(req.body.payment_status&&!payment.includes(req.body.payment_status))return fail(res,'Invalid payment status');const {data,error}=await supa.from('orders').update(req.body).eq('id',req.params.id).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.post('/api/orders/:id/cancel',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('orders').update({cancelled:true,delivery_status:'cancelled'}).eq('id',req.params.id).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.delete('/api/orders/:id',requireAdmin,async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {error}=await supa.from('orders').delete().eq('id',req.params.id);if(error)return fail(res,error.message);ok(res,{deleted:true})});
app.get('/api/track',(req,res)=>{res.status(501).json({ok:false,error:'Use /api/orders with Supabase filters for production tracking.'})});
export default app;

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`A.U SHOP API running on port ${PORT}`);
});
