import { test } from "node:test";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { GoApiImageStack } from "../lib/go-api-image-stack";

function imageTemplate(githubRepository: string, sourceDir: string): Template {
	const stack = new GoApiImageStack(new App(), "TestImage", {
		env: { account: "123456789012", region: "ap-southeast-2" },
		githubActionsPushUser: false,
		githubBranch: "main",
		githubConnectionReady: true,
		githubRepository,
		repositoryName: "go-api",
		sourceDir,
	});
	return Template.fromStack(stack);
}

test("standalone Go repository: builds from the root on every push to main", () => {
	const template = imageTemplate("lixuecn/go-api", ".");
	template.hasResourceProperties("AWS::CodeBuild::Project", {
		Environment: Match.objectLike({
			EnvironmentVariables: Match.arrayWith([Match.objectLike({ Name: "GO_API_DIR", Value: "." })]),
		}),
		Source: Match.objectLike({ Location: "https://github.com/lixuecn/go-api.git" }),
		Triggers: {
			FilterGroups: [
				[
					{ Pattern: "PUSH", Type: "EVENT" },
					{ Pattern: "refs/heads/main", Type: "HEAD_REF" },
				],
			],
			Webhook: true,
		},
	});
});

test("Go module in a subdirectory: only pushes touching it trigger a build", () => {
	const template = imageTemplate("lixuecn/github_name", "apps/go-api/");
	template.hasResourceProperties("AWS::CodeBuild::Project", {
		Environment: Match.objectLike({
			EnvironmentVariables: Match.arrayWith([Match.objectLike({ Name: "GO_API_DIR", Value: "apps/go-api" })]),
		}),
		Triggers: Match.objectLike({
			FilterGroups: [Match.arrayWith([{ Pattern: "^apps/go-api/.*", Type: "FILE_PATH" }])],
		}),
	});
});
