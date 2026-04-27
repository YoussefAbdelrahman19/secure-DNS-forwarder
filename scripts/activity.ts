import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(bin: string, args: string[]) {
  execFileSync(bin, args, { stdio: "inherit" });
}

function ensureDirs() {
  const dirs = [
    path.join("docs"),
    path.join("docs", "devlog"),
    path.join(".activity"),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayIso(): string {
  return nowIso().slice(0, 10);
}

function appendFileSafe(filePath: string, content: string) {
  fs.appendFileSync(filePath, content, { encoding: "utf8" });
}

function writeActivity(project: string, note: string) {
  const date = todayIso();
  const stamp = nowIso();

  const dailyFile = path.join("docs", "devlog", `${date}.md`);
  const summaryFile = path.join("docs", "devlog", "SUMMARY.md");
  const rawLogFile = path.join(".activity", `${date}.log`);

  appendFileSafe(dailyFile, `- [${stamp}] ${project}: ${note}\n`);
  appendFileSafe(summaryFile, `- ${stamp} :: ${project} :: ${note}\n`);
  appendFileSafe(rawLogFile, `${stamp} | ${project} | ${note}\n`);

  return {
    trackedFiles: [dailyFile, summaryFile],
    localOnlyFiles: [rawLogFile],
  };
}

function gitCommit(message: string, trackedFiles: string[]) {
  run("git", ["add", ...trackedFiles]);
  run("git", ["commit", "-m", message]);
}

function main() {
  const [, , projectArg, ...noteParts] = process.argv;

  const project = projectArg?.trim() || "dns-server";
  const note = noteParts.join(" ").trim() || "update";

  ensureDirs();

  const { trackedFiles } = writeActivity(project, note);

  const commitMessage = `chore(activity): ${project} ${note}`;
  gitCommit(commitMessage, trackedFiles);

  console.log("");
  console.log("Activity commit created successfully.");
  console.log(`Project: ${project}`);
  console.log(`Note: ${note}`);
  console.log(`Tracked files: ${trackedFiles.join(", ")}`);
}

main();