/* eslint-disable no-console */
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env");
const envExamplePath = path.join(process.cwd(), ".env.example");

if (!fs.existsSync(envPath)) {
  console.info("No .env found, copying from .env.example...");
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.info(
      "Created .env file. Update it with your API keys if needed for external connections!"
    );
  } else {
    console.warn("Could not find .env.example. Please create a .env file.");
  }
}

// Extract PORT from .env if present
let port = 3000;
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const portMatch = envContent.match(/^PORT=(\d+)/m);
  if (portMatch) {
    port = parseInt(portMatch[1], 10);
  }
}

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  console.info("Creating data directory...");
  fs.mkdirSync(dataDir, { recursive: true });
}

console.info("Pushing database schema with Drizzle...");
try {
  execSync("bun run db:push", { stdio: "inherit" });
} catch (error) {
  console.error(
    "Failed to push database schema. Check if your DATABASE_PATH is correctly configured in .env",
    error
  );
  process.exit(1);
}

console.info(`Setup complete! The Next.js dev server will start now on port ${port}...`);
try {
  execSync(`bun run next dev -p ${port}`, { stdio: "inherit" });
} catch {
  process.exit(1);
}
