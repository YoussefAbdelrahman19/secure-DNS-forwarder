import path from "node:path";
import { parseArgs } from "node:util";
import { AppConfig } from "./config.js";
import { AppServer } from "./server.js";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    config: { type: "string", short: "c", default: path.join(process.cwd(), "config", "default.yml") },
  },
});

const configPath = path.resolve(values.config ?? path.join(process.cwd(), "config", "default.yml"));
const config = AppConfig.load(configPath);
const server = new AppServer(config);
server.start();
