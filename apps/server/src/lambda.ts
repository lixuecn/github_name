import { getConnInfo, handle } from "hono/aws-lambda";

import { createApp } from "./app";

const app = createApp((context) => getConnInfo(context).remote.address);

export const handler = handle(app);
