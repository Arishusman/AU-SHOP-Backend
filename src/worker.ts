import { httpServerHandler } from "cloudflare:node";
import app from "./app.js";

export default httpServerHandler({
  port: 3000,
  handler: app,
});
