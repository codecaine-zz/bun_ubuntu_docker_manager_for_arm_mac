#!/usr/bin/env bun
// @ts-nocheck

import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { join } from "path";

// Enhanced logging with timestamps and better formatting
export class Logger {
  private static getTimestamp(): string {
    return new Date().toLocaleTimeString();
  }

  static msg(text: string) {
    console.log(`\n\x1b[1;34m[${this.getTimestamp()}]\x1b[0m \x1b[1;34m[+]\x1b[0m ${text}`);
  }

  static success(text: string) {
    console.log(`\n\x1b[1;32m[${this.getTimestamp()}]\x1b[0m \x1b[1;32m[✓]\x1b[0m ${text}`);
  }

  static warn(text: string) {
    console.log(`\n\x1b[1;33m[${this.getTimestamp()}]\x1b[0m \x1b[1;33m[!]\x1b[0m ${text}`);
  }

  static info(text: string) {
    console.log(`\n\x1b[1;36m[${this.getTimestamp()}]\x1b[0m \x1b[1;36m[i]\x1b[0m ${text}`);
  }

  static error(text: string) {
    console.error(`\n\x1b[1;31m[${this.getTimestamp()}]\x1b[0m \x1b[1;31m[x]\x1b[0m ${text}`);
  }

  static debug(text: string) {
    if (process.env.DEBUG === "1") {
      console.log(`\n\x1b[1;35m[${this.getTimestamp()}]\x1b[0m \x1b[1;35m[D]\x1b[0m ${text}`);
    }
  }
}

// Enhanced error handling with context
export class ManagerError extends Error {
  constructor(
    message: string,
    public context?: Record<string, any>,
    public code?: string
  ) {
    super(message);
    this.name = 'ManagerError';
  }
}

export function handleError(error: unknown, context?: Record<string, any>): never {
  if (error instanceof ManagerError) {
    Logger.error(`${error.message}`);
    if (error.context || context) {
      Logger.debug(`Context: ${JSON.stringify({ ...error.context, ...context }, null, 2)}`);
    }
  } else if (error instanceof Error) {
    Logger.error(`Unexpected error: ${error.message}`);
    Logger.debug(`Stack: ${error.stack}`);
  } else {
    Logger.error(`Unknown error: ${String(error)}`);
  }
  
  if (context) {
    Logger.debug(`Additional context: ${JSON.stringify(context, null, 2)}`);
  }
  
  process.exit(1);
}

// Enhanced command utilities with better error handling
export async function commandExists(cmd: string, timeout = 3000): Promise<boolean> {
  try {
    const p = await Promise.race([
      $`command -v ${cmd}`.quiet().nothrow(),
      new Promise<any>((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), timeout)
      )
    ]);
    return p.exitCode === 0;
  } catch (error) {
    Logger.debug(`Command check failed for '${cmd}': ${error}`);
    return false;
  }
}

export async function safeExec(command: string, options: { 
  timeout?: number, 
  quiet?: boolean,
  nothrow?: boolean 
} = {}): Promise<any> {
  const { timeout = 10000, quiet = true, nothrow = true } = options;
  
  try {
    Logger.debug(`Executing: ${command}`);
    
    // Use the native $ execution but properly handle shell commands
    const result = await Promise.race([
      $`sh -c ${command}`.quiet().nothrow(),
      new Promise<any>((_, reject) => 
        setTimeout(() => reject(new Error(`Command timeout after ${timeout}ms`)), timeout)
      )
    ]);
    
    Logger.debug(`Command completed with exit code: ${result.exitCode}`);
    return result;
  } catch (error) {
    Logger.debug(`Command execution failed: ${error}`);
    if (!nothrow) throw error;
    return { exitCode: 1, stdout: '', stderr: String(error) };
  }
}

// Docker utilities
export async function containerExists(name: string): Promise<boolean> {
  try {
    const result = await safeExec(`docker ps -a --format "{{.Names}}" | grep -x ${name}`);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function containerRunning(name: string): Promise<boolean> {
  try {
    const result = await safeExec(`docker ps --format "{{.Names}}" | grep -x ${name}`);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function getContainerStatus(name: string): Promise<{
  exists: boolean;
  running: boolean;
  status?: string;
  created?: string;
  ports?: string;
}> {
  try {
    const result = await safeExec(`docker ps -a --filter name=^${name}$ --format "table {{.Status}}\t{{.CreatedAt}}\t{{.Ports}}" | tail -n +2`);
    
    if (result.exitCode !== 0) {
      return { exists: false, running: false };
    }

    const output = result.stdout?.toString().trim();
    if (!output) {
      return { exists: false, running: false };
    }

    const [status, created, ports] = output.split('\t');
    const running = status?.toLowerCase().includes('up') || false;

    return {
      exists: true,
      running,
      status: status?.trim(),
      created: created?.trim(),
      ports: ports?.trim()
    };
  } catch {
    return { exists: false, running: false };
  }
}

// Configuration management
export interface ManagerConfig {
  containerName: string;
  dataPath: string;
  autoStart: boolean;
  defaultVolumes: string[];
  preferences: {
    showTimestamps: boolean;
    verboseLogging: boolean;
    autoCleanup: boolean;
  };
}

export function getDefaultConfig(): ManagerConfig {
  return {
    containerName: process.env.CONTAINER_NAME || "ubuntu",
    dataPath: process.env.DATA_PATH || join(process.env.HOME || "/tmp", "ubuntu"),
    autoStart: process.env.AUTO_START === "1",
    defaultVolumes: [],
    preferences: {
      showTimestamps: process.env.SHOW_TIMESTAMPS !== "0",
      verboseLogging: process.env.VERBOSE === "1" || process.env.DEBUG === "1",
      autoCleanup: process.env.AUTO_CLEANUP === "1"
    }
  };
}

export function loadConfigSync(): ManagerConfig {
  const configPath = join(process.env.HOME || "/tmp", ".ubuntu-manager.json");
  
  try {
    // Use Node.js fs to read synchronously - if file doesn't exist, this will throw
    const fs = require('fs');
    const configText = fs.readFileSync(configPath, 'utf8');
    const savedConfig = JSON.parse(configText);
    return { ...getDefaultConfig(), ...savedConfig };
  } catch (error) {
    // File doesn't exist or other error - use defaults
    Logger.debug(`Config file not found or invalid, using defaults: ${error}`);
  }
  
  return getDefaultConfig();
}

export async function loadConfig(): Promise<ManagerConfig> {
  const configPath = join(process.env.HOME || "/tmp", ".ubuntu-manager.json");
  
  try {
    const configFile = Bun.file(configPath);
    if (await configFile.exists()) {
      const configText = await configFile.text();
      const savedConfig = JSON.parse(configText);
      return { ...getDefaultConfig(), ...savedConfig };
    }
  } catch (error) {
    Logger.warn(`Failed to load config from ${configPath}: ${error}`);
  }
  
  return getDefaultConfig();
}

export async function saveConfig(config: ManagerConfig): Promise<void> {
  const configPath = join(process.env.HOME || "/tmp", ".ubuntu-manager.json");
  
  try {
    await Bun.write(configPath, JSON.stringify(config, null, 2));
    Logger.success(`Configuration saved to ${configPath}`);
  } catch (error) {
    Logger.warn(`Failed to save config to ${configPath}: ${error}`);
  }
}

// Progress indicators
export class ProgressIndicator {
  private interval?: Timer;
  private current = 0;
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  start(message: string) {
    process.stdout.write(`\n\x1b[1;36m[i]\x1b[0m ${message} `);
    this.interval = setInterval(() => {
      process.stdout.write(`\r\x1b[1;36m[i]\x1b[0m ${message} ${this.frames[this.current]}`);
      this.current = (this.current + 1) % this.frames.length;
    }, 100);
  }

  stop(finalMessage?: string) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    if (finalMessage) {
      process.stdout.write(`\r\x1b[1;32m[✓]\x1b[0m ${finalMessage}\n`);
    } else {
      process.stdout.write('\n');
    }
  }
}

// System information
export async function getSystemInfo(): Promise<{
  os: string;
  arch: string;
  memory: string;
  docker: {
    version?: string;
    running: boolean;
  };
}> {
  const progress = new ProgressIndicator();
  progress.start("Gathering system information...");

  try {
    const [osResult, archResult, memResult] = await Promise.all([
      safeExec("uname -s"),
      safeExec("uname -m"), 
      safeExec("sysctl -n hw.memsize | awk '{print $1/1024/1024/1024 \" GB\"}'")
    ]);

    let dockerVersion;
    let dockerRunning = false;
    
    try {
      const dockerResult = await safeExec("docker version --format '{{.Server.Version}}'", { timeout: 3000 });
      if (dockerResult.exitCode === 0) {
        dockerVersion = dockerResult.stdout?.toString().trim();
        dockerRunning = true;
      }
    } catch {
      // Docker not running or not installed
    }

    progress.stop("System information gathered");

    return {
      os: osResult.stdout?.toString().trim() || "Unknown",
      arch: archResult.stdout?.toString().trim() || "Unknown", 
      memory: memResult.stdout?.toString().trim() || "Unknown",
      docker: {
        version: dockerVersion,
        running: dockerRunning
      }
    };
  } catch (error) {
    progress.stop();
    throw new ManagerError("Failed to gather system information", { error });
  }
}

// Validation utilities
export function validateContainerName(name: string): void {
  if (!name || name.length === 0) {
    throw new ManagerError("Container name cannot be empty");
  }
  
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new ManagerError(
      "Container name must start with alphanumeric character and contain only letters, numbers, underscores, periods, and hyphens"
    );
  }
  
  if (name.length > 63) {
    throw new ManagerError("Container name cannot exceed 63 characters");
  }
}

export async function ensureDirectory(path: string): Promise<void> {
  try {
    if (!await Bun.file(path).exists()) {
      await mkdir(path, { recursive: true });
      Logger.success(`Created directory: ${path}`);
    }
  } catch (error) {
    throw new ManagerError(`Failed to create directory: ${path}`, { error, path });
  }
}