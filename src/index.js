import 'dotenv/config';
import express from 'express'; import cors from 'cors'; import rateLimit from 'express-rate-limit'; import {createClient} from '@supabase/supabase-js'; import {Resend} from 'resend'; import bcrypt from 'bcryptjs'; import {v4 as uuid} from 'uuid';
const app=express(); const PORT=process.env.PORT||4000; app.use(cors({origin:process.env.FRONTEND_URL||'http://localhost:3000'})); app.use(express.json({limit:'4mb'})); app.use(rateLimit({windowMs:60_000,max:120}));
const supa=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY):null; const resend=process.env.RESEND_API_KEY?new Resend(process.env.RESEND_API_KEY):null; const otps=new Map();
const ok=(res,data)=>res.json({ok:true,data}); const fail=(res,msg,code=400)=>res.status(code).json({ok:false,error:msg});
app.get('/api/health',(req,res)=>ok(res,{service:'A.U SHOP API',supabase:!!supa,resend:!!resend}));
app.post('/api/auth/send-code',async(req,res)=>{const {email}=req.body||{};if(!email)return fail(res,'Email is required');const code=String(Math.floor(100000+Math.random()*900000));otps.set(email,{code,expires:Date.now()+10*60*1000});if(resend){const r=await resend.emails.send({from:process.env.EMAIL_FROM,to:email,subject:'A.U SHOP verification code',html:`<div style="font-family:Arial"><h2>A.U SHOP</h2><p>Your verification code is <b>${code}</b>.</p><p>This code expires in 10 minutes.</p></div>`});if(r.error)return fail(res,r.error.message,502)}else console.log(`[DEV OTP] ${email}: ${code}`);ok(res,{message:'Verification code sent'});});
app.post('/api/auth/verify-code',(req,res)=>{const {email,code}=req.body||{};const x=otps.get(email);if(!x||x.expires<Date.now()||x.code!==String(code))return fail(res,'Invalid or expired code',401);otps.delete(email);ok(res,{verified:true,user:{email}})});
app.post('/api/admin/login',async(req,res)=>{const {username,password}=req.body||{};const validUser=username===process.env.ADMIN_USERNAME||username===process.env.ADMIN_EMAIL;const validPass=password===process.env.ADMIN_PASSWORD;if(!validUser||!validPass)return fail(res,'Invalid admin credentials',401);const code=String(Math.floor(100000+Math.random()*900000));otps.set(process.env.ADMIN_EMAIL,{code,expires:Date.now()+10*60*1000});if(resend){const r=await resend.emails.send({from:process.env.EMAIL_FROM,to:process.env.ADMIN_EMAIL,subject:'A.U SHOP admin verification',html:`<h2>Admin verification</h2><p>Your code: <b>${code}</b></p>`});if(r.error)return fail(res,r.error.message,502)}else console.log(`[DEV ADMIN OTP] ${code}`);ok(res,{challenge:true})});
app.post('/api/admin/verify',(req,res)=>{const {code}=req.body||{};const x=otps.get(process.env.ADMIN_EMAIL);if(!x||x.expires<Date.now()||x.code!==String(code))return fail(res,'Invalid or expired code',401);otps.delete(process.env.ADMIN_EMAIL);ok(res,{token:uuid(),role:'admin'})});
app.get('/api/products',async(req,res)=>{if(!supa)return ok(res,{source:'static',items:[]});const {data,error}=await supa.from('products').select('*').order('id');if(error)return fail(res,error.message,500);ok(res,{source:'supabase',items:data})});
app.post('/api/products',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('products').insert(req.body).select().single();if(error)return fail(res,error.message,400);ok(res,data)});
app.patch('/api/products/:id',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('products').update(req.body).eq('id',req.params.id).select().single();if(error)return fail(res,error.message,400);ok(res,data)});
app.delete('/api/products/:id',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {error}=await supa.from('products').delete().eq('id',req.params.id);if(error)return fail(res,error.message,400);ok(res,{deleted:true})});
app.get('/api/categories',async(req,res)=>{if(!supa)return ok(res,{items:[]});const {data,error}=await supa.from('categories').select('*,category_products(product_id)').order('name');if(error)return fail(res,error.message,500);ok(res,data)});
app.post('/api/categories',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('categories').insert(req.body).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.post('/api/categories/:id/products',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {product_id,enabled}=req.body;const q=enabled?supa.from('category_products').upsert({category_id:req.params.id,product_id}):supa.from('category_products').delete().match({category_id:req.params.id,product_id});const {error}=await q;if(error)return fail(res,error.message);ok(res,{updated:true})});
// =============================
// HOME PAGE CONFIGURATION
// =============================

app.get('/api/home-config', async (req, res) => {
  if (!supa) {
    return fail(res, 'Supabase is not configured', 503);
  }

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

    if (catResult.error) {
      return fail(res, catResult.error.message, 500);
    }

    if (productResult.error) {
      return fail(res, productResult.error.message, 500);
    }

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


// =============================
// HOME CATEGORIES
// =============================

app.get('/api/home-categories', async (req, res) => {
  if (!supa) {
    return fail(res, 'Supabase is not configured', 503);
  }

  const { data, error } = await supa
    .from('home_categories')
    .select('*')
    .order('sort_order');

  if (error) {
    return fail(res, error.message, 500);
  }

  return ok(res, data || []);
});


app.post('/api/home-categories', async (req, res) => {
  if (!supa) {
    return fail(res, 'Supabase is not configured', 503);
  }

  const {
    category_id,
    enabled = true,
    sort_order = 0
  } = req.body || {};

  if (!category_id) {
    return fail(res, 'category_id is required');
  }

  const { data, error } = await supa
    .from('home_categories')
    .upsert(
      {
        category_id,
        enabled,
        sort_order
      },
      {
        onConflict: 'category_id'
      }
    )
    .select()
    .single();

  if (error) {
    return fail(res, error.message, 400);
  }

  return ok(res, data);
});


app.post('/api/home-categories/order', async (req, res) => {
  if (!supa) {
    return fail(res, 'Supabase is not configured', 503);
  }

  const items = Array.isArray(req.body?.items)
    ? req.body.items
    : [];

  if (!items.length) {
    return ok(res, []);
  }

  try {
    for (const item of items) {
      if (!item.category_id) continue;

      const { error } = await supa
        .from('home_categories')
        .upsert(
          {
            category_id: item.category_id,
            enabled: true,
            sort_order: Number(item.sort_order) || 0
          },
          {
            onConflict: 'category_id'
          }
        );

      if (error) {
        return fail(res, error.message, 400);
      }
    }

    return ok(res, { updated: true });
  } catch (e) {
    return fail(
      res,
      e instanceof Error ? e.message : 'Unable to save category order',
      500
    );
  }
});


// =============================
// HOME CATEGORY PRODUCTS
// =============================

app.post('/api/home-category-products', async (req, res) => {
  if (!supa) {
    return fail(res, 'Supabase is not configured', 503);
  }

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
      .match({
        category_id,
        product_id
      });

    if (error) {
      return fail(res, error.message, 400);
    }

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
      {
        onConflict: 'category_id,product_id'
      }
    )
    .select()
    .single();

  if (error) {
    return fail(res, error.message, 400);
  }

  return ok(res, data);
});


app.post('/api/home-category-products/order', async (req, res) => {
  if (!supa) {
    return fail(res, 'Supabase is not configured', 503);
  }

  const items = Array.isArray(req.body?.items)
    ? req.body.items
    : [];

  if (!items.length) {
    return ok(res, []);
  }

  try {
    for (const item of items) {
      if (!item.category_id || item.product_id === undefined) {
        continue;
      }

      const { error } = await supa
        .from('home_category_products')
        .upsert(
          {
            category_id: item.category_id,
            product_id: item.product_id,
            enabled: true,
            sort_order: Number(item.sort_order) || 0
          },
          {
            onConflict: 'category_id,product_id'
          }
        );

      if (error) {
        return fail(res, error.message, 400);
      }
    }

    return ok(res, { updated: true });
  } catch (e) {
    return fail(
      res,
      e instanceof Error ? e.message : 'Unable to save product order',
      500
    );
  }
});



app.get('/api/reviews',async(req,res)=>{if(!supa)return ok(res,{items:[]});const {data,error}=await supa.from('reviews').select('*').order('created_at',{ascending:false});if(error)return fail(res,error.message,500);ok(res,data)});
app.post('/api/reviews',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('reviews').insert(req.body).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.patch('/api/reviews/:id',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('reviews').update(req.body).eq('id',req.params.id).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.delete('/api/reviews/:id',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {error}=await supa.from('reviews').delete().eq('id',req.params.id);if(error)return fail(res,error.message);ok(res,{deleted:true})});
app.get('/api/orders',async(req,res)=>{if(!supa)return ok(res,{items:[]});const {data,error}=await supa.from('orders').select('*,order_items(*)').order('created_at',{ascending:false});if(error)return fail(res,error.message,500);ok(res,data)});
app.post('/api/orders',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const order={...req.body,order_id:req.body.order_id||`AU-${Date.now().toString(36).toUpperCase()}`};const {data,error}=await supa.from('orders').insert(order).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.patch('/api/orders/:id/status',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const allowed=['in progress','in shipping','delivered'];if(req.body.delivery_status&&!allowed.includes(req.body.delivery_status))return fail(res,'Invalid delivery status');const payment=['COD','in review','rejected','approved'];if(req.body.payment_status&&!payment.includes(req.body.payment_status))return fail(res,'Invalid payment status');const {data,error}=await supa.from('orders').update(req.body).eq('id',req.params.id).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.post('/api/orders/:id/cancel',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {data,error}=await supa.from('orders').update({cancelled:true,delivery_status:'cancelled'}).eq('id',req.params.id).select().single();if(error)return fail(res,error.message);ok(res,data)});
app.delete('/api/orders/:id',async(req,res)=>{if(!supa)return fail(res,'Supabase is not configured',503);const {error}=await supa.from('orders').delete().eq('id',req.params.id);if(error)return fail(res,error.message);ok(res,{deleted:true})});
app.get('/api/track',(req,res)=>{res.status(501).json({ok:false,error:'Use /api/orders with Supabase filters for production tracking.'})});
app.listen(PORT,()=>console.log(`A.U SHOP API running on http://localhost:${PORT}`));
