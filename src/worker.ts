import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";

process.env.SUPABASE_URL = env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
process.env.RESEND_API_KEY = env.RESEND_API_KEY;
process.env.ADMIN_USERNAME = env.ADMIN_USERNAME;
process.env.ADMIN_PASSWORD = env.ADMIN_PASSWORD;
process.env.ADMIN_EMAIL = env.ADMIN_EMAIL;
process.env.EMAIL_FROM = env.EMAIL_FROM;
process.env.FRONTEND_URL = env.FRONTEND_URL;
process.env.WHATSAPP_NUMBER = env.WHATSAPP_NUMBER;

const { default: app } = await import("./app.js");

app.listen(3000);

export default httpServerHandler({ port: 3000 });
