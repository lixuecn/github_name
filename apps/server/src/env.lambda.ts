import { z } from "zod";

// Lambda supplies these values at runtime; never bundle a developer's .env.
// With GO_API_URL every profile read/write goes to the Go service and no Prisma
// client is created, so DATABASE_URL is only required without it.
const schema = z
	.object({
		CORS_ORIGIN: z.url(),
		DATABASE_URL: z.string().min(1).optional(),
		GITHUB_TOKEN: z.string().min(1).optional(),
		GO_API_URL: z.url().optional(),
		NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
	})
	.refine((env) => env.GO_API_URL !== undefined || env.DATABASE_URL !== undefined, {
		message: "DATABASE_URL is required when GO_API_URL is not set",
		path: ["DATABASE_URL"],
	});

const result = schema.safeParse(process.env);
if (!result.success) {
	const fields = result.error.issues.map((issue) => issue.path.join("."));
	throw new Error(
		`Missing or invalid Lambda environment variables: ${fields.join(", ")}`
	);
}

export const ENV = result.data;
