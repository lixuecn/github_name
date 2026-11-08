import { getConnInfo, handle } from "hono/aws-lambda";

import { createApp } from "./app";

export const handler = handle(
	createApp((context) => getConnInfo(context).remote.address)
);
