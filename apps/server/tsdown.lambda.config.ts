import { fileURLToPath } from "node:url";

import { defineConfig } from "tsdown";

export default defineConfig({
	alias: {
		"./env.server": fileURLToPath(
			new URL("./src/env.lambda.ts", import.meta.url)
		),
	},
	clean: true,
	deps: { alwaysBundle: [/.*/] },
	entry: { lambda: "./src/lambda.ts" },
	format: "esm",
	outDir: "./dist/lambda",
	platform: "node",
	target: "node22",
});
