const fs = require('fs');

const file = 'src/app.js';
let f = fs.readFileSync(file, 'utf8');

const marker = "app.get('/api/products'";

const route = `app.post('/api/upload/blog-image',requireAdmin,upload.single('image'),async(req,res)=>{
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
`;

if (!f.includes("app.post('/api/upload/blog-image'")) {
  f = f.replace(marker, route + marker);
  fs.writeFileSync(file, f);
  console.log('Blog image upload route added successfully.');
} else {
  console.log('Blog image upload route already exists.');
}
