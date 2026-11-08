import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../dist/lambda/", import.meta.url));
const archive = fileURLToPath(new URL("../dist/lambda.zip", import.meta.url));
rmSync(archive, { force: true });
execFileSync("zip", ["-q", "-r", archive, "."], {
	cwd: directory,
	stdio: "inherit",
});
process.stdout.write(`Lambda package: ${archive}\n`);
