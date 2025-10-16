#!/usr/bin/env bun
// @ts-nocheck

import { $ } from "bun";

const CONTAINER_NAME = process.env.CONTAINER_NAME || "ubuntu";
const DRY_RUN = process.env.DRY_RUN === "1";

function msg(text: string) {
  console.log(`\n\x1b[1;34m[+]\x1b[0m ${text}`);
}

function success(text: string) {
  console.log(`\n\x1b[1;32m[✓]\x1b[0m ${text}`);
}

function warn(text: string) {
  console.log(`\n\x1b[1;33m[!]\x1b[0m ${text}`);
}

function info(text: string) {
  console.log(`\n\x1b[1;36m[i]\x1b[0m ${text}`);
}

function err(text: string): never {
  console.error(`\n\x1b[1;31m[x]\x1b[0m ${text}`);
  process.exit(1);
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const p = await Promise.race([
      $`command -v ${cmd}`.quiet().nothrow(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))
    ]);
    return p.exitCode === 0;
  } catch {
    return false;
  }
}

async function containerExists(name: string): Promise<boolean> {
  try {
    const p = await $`docker ps -a --format "{{.Names}}" | grep -x ${name}`.quiet().nothrow();
    return p.exitCode === 0;
  } catch {
    return false;
  }
}

async function containerRunning(name: string): Promise<boolean> {
  try {
    const p = await $`docker ps --format "{{.Names}}" | grep -x ${name}`.quiet().nothrow();
    return p.exitCode === 0;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.length > 0 ? args.join(" ") : "/bin/bash";
  const showHelp = args.includes("--help") || args.includes("-h");
  
  if (showHelp) {
    console.log("\n🔗 Ubuntu Container Attach");
    console.log("==========================");
    console.log("\nUsage:");
    console.log("  bun run attach [command]");
    console.log("  bun run attach --help");
    console.log("\nExamples:");
    console.log("  bun run attach              # Open bash shell");
    console.log("  bun run attach python3      # Open Python REPL");
    console.log("  bun run attach 'ls -la'     # Run a command");
    console.log("  bun run attach htop         # Run htop");
    console.log("\nEnvironment Variables:");
    console.log("  CONTAINER_NAME  Container name (default: ubuntu)");
    console.log("  DRY_RUN=1       Show what would run without executing");
    return;
  }

  msg(`🔗 Attaching to Ubuntu container: ${CONTAINER_NAME}`);

  // Check if Docker is available
  if (!(await commandExists("docker"))) {
    err("Docker is not installed or not in PATH. Please install Docker Desktop.");
  }

  // Check if Docker daemon is running
  try {
    await $`docker info`.quiet();
  } catch {
    err("Docker daemon is not running. Please start Docker Desktop.");
  }

  // Check if container exists
  if (!(await containerExists(CONTAINER_NAME))) {
    err(`Container '${CONTAINER_NAME}' does not exist.`);
    console.log("\n💡 Quick fixes:");
    console.log("   • Run 'bun run setup' to create the container");
    console.log("   • Check if you meant a different container name");
    console.log("   • Use 'bun run status' to see available containers");
    process.exit(1);
  }

  // Check if container is running
  if (!(await containerRunning(CONTAINER_NAME))) {
    warn(`Container '${CONTAINER_NAME}' is not running.`);
    console.log("\n💡 Quick fixes:");
    console.log("   • Run 'bun run start' to start the container");
    console.log("   • Use 'bun run status' to check container state");
    
    // Offer to start it automatically
    const autoStart = process.env.AUTO_START === "1" || args.includes("--start");
    if (autoStart) {
      msg("Auto-starting container...");
      if (DRY_RUN) {
        console.log(`[DRY RUN] Would run: docker start ${CONTAINER_NAME}`);
        console.log(`[DRY RUN] Would run: docker exec -it ${CONTAINER_NAME} ${command}`);
        return;
      }
      
      try {
        await $`docker start ${CONTAINER_NAME}`;
        success("Container started successfully!");
        // Continue to attach...
      } catch (e) {
        err(`Failed to start container: ${e}`);
      }
    } else {
      console.log("\nTip: Use '--start' to automatically start the container");
      process.exit(1);
    }
  }

  // Attach to the running container
  msg(`Executing: ${command}`);
  info("Press Ctrl+D or type 'exit' to detach from container");
  
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would run: docker exec -it ${CONTAINER_NAME} ${command}`);
    return;
  }

  try {
    // Use different approaches based on command type
    if (command === "/bin/bash" || command === "bash" || command === "sh") {
      // For shell commands, maintain interactive session
      await $`docker exec -it ${CONTAINER_NAME} ${command}`;
    } else if (command.includes(" ")) {
      // For complex commands, use shell -c
      await $`docker exec -it ${CONTAINER_NAME} /bin/bash -c "${command}"`;
    } else {
      // For simple commands
      await $`docker exec -it ${CONTAINER_NAME} ${command}`;
    }
    
    success("Session ended successfully");
    
  } catch (e) {
    // Don't treat normal exit as an error
    if (e?.exitCode === 0 || e?.message?.includes("exit code 0")) {
      success("Session ended successfully");
    } else if (e?.exitCode === 130) {
      info("Session interrupted (Ctrl+C)");
    } else {
      err(`Failed to attach to container '${CONTAINER_NAME}': ${e}`);
    }
  }
}

main().catch((e) => {
  // Handle graceful exits
  if (e?.exitCode === 0) {
    process.exit(0);
  }
  err(e?.message ?? String(e));
});