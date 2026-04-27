#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

function ensureGitRepo() {
  run("git", ["rev-parse", "--is-inside-work-tree"]);
}

function ensureCleanTree() {
  const status = run("git", ["status", "--porcelain"]);
  if (status) {
    throw new Error("Working tree is not clean. Commit or stash current changes first.");
  }
}

function ensureDirs() {
  const dirs = ["docs", "docs/devlog", ".activity"];
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowISO(): string {
  return new Date().toISOString();
}

function branchName(): string {
  return run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
}

function appendActivity(projectName: string, note: string) {
  const day = todayISO();
  const stamp = nowISO();

  const daily = join("docs", "devlog", `${day}.md`);
  const summary = join("docs", "devlog", "SUMMARY.md");
  const raw = join(".activity", `${day}.log`);

  appendFileSync(daily, `- [${stamp}] ${projectName}: ${note}\n`, "utf8");
  appendFileSync(summary, `- ${stamp} :: ${projectName} :: ${note}\n`, "utf8");
  appendFileSync(raw, `${stamp} | ${projectName} | ${note}\n`, "utf8");

  return [daily, summary, raw];
}

function main() {
  const [, , projectName = "my-project", ...noteParts] = process.argv;
  const note = noteParts.join(" ").trim() || "maintenance update";

  ensureGitRepo();
  ensureCleanTree();
  ensureDirs();

  const files = appendActivity(projectName, note);
  run("git", ["add", ...files]);

  const msg = `chore(activity): ${projectName} - ${note}`;
  run("git", ["commit", "-m", msg]);

  console.log(`Committed on branch: ${branchName()}`);
  console.log(`Message: ${msg}`);
}

main();