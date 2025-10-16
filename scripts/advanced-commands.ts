#!/usr/bin/env bun
// @ts-nocheck

import { $ } from "bun";
import { Logger, ManagerError, handleError, getContainerStatus, safeExec } from "./shared/utils.ts";
import { ConfigManager } from "./shared/config.ts";

export async function handleLogsCommand(args: string[]): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const config = configManager.current;
    
    const follow = args.includes("--follow") || args.includes("-f");
    const tail = args.find(arg => arg.startsWith("--tail="))?.split("=")[1] || "50";
    const since = args.find(arg => arg.startsWith("--since="))?.split("=")[1];
    
    const containerStatus = await getContainerStatus(config.containerName);
    
    if (!containerStatus.exists) {
      Logger.error(`Container '${config.containerName}' does not exist`);
      Logger.info("💡 Quick fixes:");
      Logger.info("   • Run 'bun run setup' to create the container");
      Logger.info("   • Use 'bun run status' to see current state");
      process.exit(1);
    }

    Logger.info(`Fetching logs for container: ${config.containerName}`);
    
    let command = `docker logs`;
    if (follow) command += " -f";
    command += ` --tail ${tail}`;
    if (since) command += ` --since ${since}`;
    command += ` ${config.containerName}`;

    if (process.env.DRY_RUN === "1") {
      Logger.info(`DRY_RUN: Would execute: ${command}`);
      return;
    }

    // For logs, we want to stream output directly
    const result = await safeExec(command, { quiet: false, nothrow: false });
    
  } catch (error) {
    handleError(error, { command: "logs", args });
  }
}

export async function handleExecCommand(args: string[]): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const config = configManager.current;
    
    if (args.length === 0) {
      args = ["/bin/bash"]; // Default to bash
    }
    
    const containerStatus = await getContainerStatus(config.containerName);
    
    if (!containerStatus.exists) {
      Logger.error(`Container '${config.containerName}' does not exist`);
      Logger.info("💡 Quick fixes:");
      Logger.info("   • Run 'bun run setup' to create the container");
      Logger.info("   • Check if you meant a different container name");
      Logger.info("   • Use 'bun run status' to see available containers");
      process.exit(1);
    }
    
    if (!containerStatus.running) {
      Logger.error(`Container '${config.containerName}' is stopped`);
      Logger.info("💡 Quick fixes:");
      Logger.info("   • Run 'bun run start' to start the container");
      Logger.info("   • Use 'bun run status' to check container state");
      process.exit(1);
    }

    const command = args.join(" ");
    Logger.info(`Executing in container '${config.containerName}': ${command}`);
    
    // For simple command execution, don't use TTY to avoid duplicate output
    // Only use TTY for interactive shells
    const needsTTY = command.includes("bash") || command.includes("sh") || args.includes("--interactive");
    const dockerFlags = needsTTY ? "-it" : "";
    const dockerCommand = `docker exec ${dockerFlags} ${config.containerName} ${command}`;

    if (process.env.DRY_RUN === "1") {
      Logger.info(`DRY_RUN: Would execute: ${dockerCommand}`);
      return;
    }

    // Execute the command and show output
    Logger.debug(`Executing: ${dockerCommand}`);
    
    // Use a different approach - execute without shell wrapping
    const { spawn } = await import("child_process");
    const dockerArgs = ["exec"];
    if (needsTTY) {
      dockerArgs.push("-it");
    }
    dockerArgs.push(config.containerName, "sh", "-c", command);
    
    const result = await new Promise<{exitCode: number, stdout: string, stderr: string}>((resolve) => {
      const child = spawn("docker", dockerArgs);
      let stdout = "";
      let stderr = "";
      
      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      
      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      
      child.on("close", (code) => {
        resolve({ exitCode: code || 0, stdout, stderr });
      });
    });
    
    const stdout = result.stdout?.toString().trim();
    const stderr = result.stderr?.toString().trim();
    
    // Show stdout if available
    if (stdout) {
      console.log(stdout);
    }
    
    // Only show stderr if there's an error or no stdout
    if (result.exitCode !== 0) {
      if (stderr) {
        console.error(stderr);
      }
      Logger.error(`Command failed with exit code: ${result.exitCode}`);
      process.exit(result.exitCode);
    } else if (!stdout && stderr) {
      // Some commands only output to stderr even on success
      console.log(stderr);
    }
    
  } catch (error) {
    handleError(error, { command: "exec", args });
  }
}

export async function handleRestartCommand(args: string[]): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const config = configManager.current;
    
    const force = args.includes("--force") || process.env.FORCE === "1";
    const timeout = args.find(arg => arg.startsWith("--timeout="))?.split("=")[1] || "10";
    
    const containerStatus = await getContainerStatus(config.containerName);
    
    if (!containerStatus.exists) {
      throw new ManagerError(`Container '${config.containerName}' does not exist`);
    }

    Logger.info(`Restarting container: ${config.containerName}`);
    
    if (containerStatus.running) {
      Logger.info("Stopping container...");
      const stopCommand = force ? 
        `docker kill ${config.containerName}` : 
        `docker stop --time ${timeout} ${config.containerName}`;
      
      if (process.env.DRY_RUN === "1") {
        Logger.info(`DRY_RUN: Would execute: ${stopCommand}`);
      } else {
        await safeExec(stopCommand);
        Logger.success("Container stopped");
      }
    }

    Logger.info("Starting container...");
    const startCommand = `docker start ${config.containerName}`;
    
    if (process.env.DRY_RUN === "1") {
      Logger.info(`DRY_RUN: Would execute: ${startCommand}`);
    } else {
      await safeExec(startCommand);
      Logger.success("Container restarted successfully");
    }
    
  } catch (error) {
    handleError(error, { command: "restart" });
  }
}

export async function handleInspectCommand(args: string[]): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const config = configManager.current;
    
    const format = args.find(arg => arg.startsWith("--format="))?.split("=")[1];
    const pretty = args.includes("--pretty") || !format;
    
    const containerStatus = await getContainerStatus(config.containerName);
    
    if (!containerStatus.exists) {
      throw new ManagerError(`Container '${config.containerName}' does not exist`);
    }

    Logger.info(`Inspecting container: ${config.containerName}`);
    
    let command = `docker inspect ${config.containerName}`;
    if (format) {
      command += ` --format '${format}'`;
    }

    if (process.env.DRY_RUN === "1") {
      Logger.info(`DRY_RUN: Would execute: ${command}`);
      return;
    }

    const result = await safeExec(command);
    
    if (result.exitCode === 0) {
      const output = result.stdout?.toString() || '';
      
      if (pretty && !format) {
        try {
          const parsed = JSON.parse(output);
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log(output);
        }
      } else {
        console.log(output);
      }
    } else {
      throw new ManagerError(`Failed to inspect container: ${result.stderr}`);
    }
    
  } catch (error) {
    handleError(error, { command: "inspect" });
  }
}

export async function handleUpdateCommand(args: string[]): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const config = configManager.current;
    
    const containerStatus = await getContainerStatus(config.containerName);
    
    if (!containerStatus.exists) {
      throw new ManagerError(`Container '${config.containerName}' does not exist`);
    }

    Logger.info(`Updating container: ${config.containerName}`);
    Logger.info("This will pull the latest image and recreate the container...");
    
    if (!process.env.FORCE && !args.includes("--force")) {
      Logger.warn("This operation will recreate your container!");
      Logger.warn("Make sure your data is backed up in the data directory.");
      
      // Simple confirmation (in a real implementation, you'd want proper prompting)
      Logger.info("Use --force to skip this confirmation");
      return;
    }

    // Pull latest image
    Logger.info("Pulling latest Ubuntu image...");
    const pullCommand = "docker pull ubuntu:latest";
    
    if (process.env.DRY_RUN === "1") {
      Logger.info(`DRY_RUN: Would execute: ${pullCommand}`);
      Logger.info(`DRY_RUN: Would recreate container with latest image`);
      return;
    }

    await safeExec(pullCommand);
    Logger.success("Latest image pulled");

    // Stop and remove current container
    if (containerStatus.running) {
      Logger.info("Stopping current container...");
      await safeExec(`docker stop ${config.containerName}`);
    }
    
    Logger.info("Removing current container...");
    await safeExec(`docker rm ${config.containerName}`);
    
    Logger.success("Container updated! Run 'bun run setup' to recreate with latest image");
    
  } catch (error) {
    handleError(error, { command: "update" });
  }
}

export async function handleBackupCommand(args: string[]): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const config = configManager.current;
    
    const outputPath = args.find(arg => !arg.startsWith("--")) || 
      `ubuntu-backup-${new Date().toISOString().split('T')[0]}.tar.gz`;
    
    const compress = !args.includes("--no-compress");
    const includeContainer = args.includes("--include-container");
    
    Logger.info(`Creating backup: ${outputPath}`);
    
    // Backup data directory
    if (await Bun.file(config.dataPath).exists()) {
      Logger.info(`Backing up data directory: ${config.dataPath}`);
      
      const tarCommand = compress ? 
        `tar -czf "${outputPath}" -C "${config.dataPath}" .` :
        `tar -cf "${outputPath}" -C "${config.dataPath}" .`;
      
      if (process.env.DRY_RUN === "1") {
        Logger.info(`DRY_RUN: Would execute: ${tarCommand}`);
      } else {
        await safeExec(tarCommand);
        Logger.success(`Data backup created: ${outputPath}`);
      }
    } else {
      Logger.warn(`Data directory does not exist: ${config.dataPath}`);
    }

    // Optionally backup container
    if (includeContainer) {
      const containerStatus = await getContainerStatus(config.containerName);
      
      if (containerStatus.exists) {
        Logger.info("Creating container snapshot...");
        const snapshotName = `${config.containerName}-backup-${Date.now()}`;
        const commitCommand = `docker commit ${config.containerName} ${snapshotName}`;
        
        if (process.env.DRY_RUN === "1") {
          Logger.info(`DRY_RUN: Would execute: ${commitCommand}`);
        } else {
          await safeExec(commitCommand);
          Logger.success(`Container snapshot created: ${snapshotName}`);
        }
      }
    }
    
  } catch (error) {
    handleError(error, { command: "backup" });
  }
}

export async function handleCleanupCommand(args: string[]): Promise<void> {
  try {
    const all = args.includes("--all");
    const images = args.includes("--images");
    const volumes = args.includes("--volumes"); 
    const force = args.includes("--force") || process.env.FORCE === "1";
    
    Logger.info("Docker cleanup starting...");
    
    if (!force) {
      Logger.warn("This will remove unused Docker resources!");
      Logger.warn("Use --force to skip this confirmation");
      return;
    }

    const commands = [];
    
    if (all) {
      commands.push("docker system prune -a -f");
    } else {
      commands.push("docker system prune -f");
    }
    
    if (images) {
      commands.push("docker image prune -a -f");
    }
    
    if (volumes) {
      commands.push("docker volume prune -f");
    }

    for (const command of commands) {
      Logger.info(`Executing: ${command}`);
      
      if (process.env.DRY_RUN === "1") {
        Logger.info(`DRY_RUN: Would execute: ${command}`);
      } else {
        const result = await safeExec(command);
        if (result.stdout) {
          console.log(result.stdout);
        }
      }
    }
    
    Logger.success("Docker cleanup completed");
    
  } catch (error) {
    handleError(error, { command: "cleanup" });
  }
}

export async function handleListCommand(): Promise<void> {
  try {
    Logger.info("Listing all Docker containers...");
    
    const result = await safeExec("docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}\t{{.Image}}'");
    
    if (result.exitCode === 0) {
      const output = result.stdout?.toString() || '';
      
      if (output.trim()) {
        console.log("\n📦 Docker Containers:");
        console.log(output);
      } else {
        Logger.info("No Docker containers found");
        Logger.info("💡 Create your first container with: bun run setup");
      }
    } else {
      Logger.warn("Could not list containers - is Docker running?");
      Logger.info("💡 Start Docker Desktop and try again");
    }
    
  } catch (error) {
    handleError(error, { command: "list" });
  }
}