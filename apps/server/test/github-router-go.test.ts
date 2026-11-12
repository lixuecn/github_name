import { createGoApiProfileStore } from "@my-better-t-app/api/profile-store";

import { goApiSkipReason, type RunningGoApi, startGoApi } from "./go-api-server";
import { registerGithubRouterSuite } from "./github-router-suite";
import { testDatabaseUrl } from "./helpers";

// The same router tests against the real Go service (production mode), sharing
// the test database. Skipped when no go-api checkout or Go toolchain exists.
let goApi: RunningGoApi | undefined;

registerGithubRouterSuite({
  label: "go-api",
  skip: goApiSkipReason(),
  setup: async () => {
    goApi = await startGoApi(testDatabaseUrl());
  },
  teardown: () => goApi?.stop(),
  createStore: () => {
    if (!goApi) {
      throw new Error("go-api is not running");
    }
    return createGoApiProfileStore({ baseUrl: goApi.baseUrl });
  },
});
