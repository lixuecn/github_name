import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";

import { createApp } from "./app";

const app = createApp((context) => getConnInfo(context).remote.address);

serve({ fetch: app.fetch, port: 3000 }, (info) => {
	console.info(`Server is running on http://localhost:${info.port}`);
});
