import fs from "fs";
import path from "path";

export class SyncLogger {
  private logFilePath: string;

  constructor() {
    // In production Docker, this is usually /app/data
    const dbPath = process.env.DATABASE_PATH || "./data/shelflife.db";
    const dataDir = path.dirname(dbPath);
    this.logFilePath = path.join(dataDir, "sync.log");

    // Ensure directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  public log(level: "INFO" | "WARN" | "ERROR", layer: string, message: string) {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] [${layer}] ${message}\n`;

    // Also log to stdout for Docker container logs
    if (level === "ERROR") {
      console.error(formattedMessage.trim());
    } else if (level === "WARN") {
      console.warn(formattedMessage.trim());
    }

    try {
      fs.appendFileSync(this.logFilePath, formattedMessage);
    } catch (e) {
      console.error("Failed to write to sync.log", e);
    }
  }

  public info(layer: string, message: string) {
    this.log("INFO", layer, message);
  }

  public warn(layer: string, message: string) {
    this.log("WARN", layer, message);
  }

  public error(layer: string, message: string) {
    this.log("ERROR", layer, message);
  }

  public clear() {
    try {
      if (fs.existsSync(this.logFilePath)) {
        fs.unlinkSync(this.logFilePath);
      }
    } catch (e) {
      console.error("Failed to clear sync.log", e);
    }
  }

  public getLogs(): string {
    try {
      if (fs.existsSync(this.logFilePath)) {
        return fs.readFileSync(this.logFilePath, "utf8");
      }
    } catch (e) {
      console.error("Failed to read sync.log", e);
    }
    return "";
  }
}

export const syncLogger = new SyncLogger();
