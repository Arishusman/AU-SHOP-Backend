import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";

for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string") {
    process.env[key] ??= value;
  }
}

const { default: app } = await import("./app.js");

app.listen(3000);

export default httpServerHandler({ port: 3000 });
