import { z } from "zod";

// Lambda supplies these values at runtime; never bundle a developer's .env.
const schema = z.object({
	BETTER_AUTH_SECRET: z.string().min(32),
	BETTER_AUTH_URL: z.url(),
	CORS_ORIGIN: z.url(),
	DATABASE_URL: z.string().min(1),
	NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
});

const result = schema.safeParse(process.env);
if (!result.success) {
	const fields = result.error.issues.map((issue) => issue.path.join("."));
	throw new Error(
		`Missing or invalid Lambda environment variables: ${fields.join(", ")}`
	);
}

export const ENV = result.data;
