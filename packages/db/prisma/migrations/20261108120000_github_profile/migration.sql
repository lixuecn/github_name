-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "github_profile" (
    "id" TEXT NOT NULL,
    "githubId" INTEGER NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "bio" TEXT,
    "company" TEXT,
    "location" TEXT,
    "blog" TEXT,
    "twitterUsername" TEXT,
    "avatarUrl" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "publicRepos" INTEGER NOT NULL,
    "followers" INTEGER NOT NULL,
    "following" INTEGER NOT NULL,
    "githubCreatedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_profile_githubId_key" ON "github_profile"("githubId");

-- CreateIndex
CREATE INDEX "github_profile_login_idx" ON "github_profile"("login");

-- CreateIndex
CREATE INDEX "github_profile_createdAt_idx" ON "github_profile"("createdAt");

-- CreateIndex
CREATE INDEX "github_profile_followers_idx" ON "github_profile"("followers");

-- CreateIndex
CREATE INDEX "github_profile_publicRepos_idx" ON "github_profile"("publicRepos");

