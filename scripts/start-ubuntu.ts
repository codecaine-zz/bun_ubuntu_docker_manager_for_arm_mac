#!/usr/bin/env bun
// @ts-nocheck

import { $ } from "bun";

const CONTAINER_NAME = process.env.CONTAINER_NAME || "ubuntu";
const DRY_RUN = process.env.DRY_RUN === "1";

// Parse command line arguments
function parseArgs(args: string[]) {
  const result = {
    attach: false,
    help: false,
    detach: false,
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--attach" || arg === "-a") {
      result.attach = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--detach" || arg === "-d") {
      result.detach = true;
    }
  }
  
  return result;
}

function msg(text: string) {
  console.log(`\n\x1b[1;34m[+]\x1b[0m ${text}`);
}

function success(text: string) {
  console.log(`\n\x1b[1;32m[✓]\x1b[0m ${text}`);
}

function warn(text: string) {
  console.log(`\n\x1b[1;33m[!]\x1b[0m ${text}`);
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



function showHelp() {
  console.log("\n🐧 Ubuntu Container Start - Help");
  console.log("=================================");
  console.log("");
  console.log("Usage:");
  console.log("  bun run start [options]");
  console.log("");
  console.log("Options:");
  console.log("  --attach, -a      Attach to running container");
  console.log("  --detach, -d      Start container in background");
  console.log("  --help, -h        Show this help");
  console.log("");
  console.log("Examples:");
  console.log("  bun run start                           # Start and enter container");
  console.log("  bun run start --attach                  # Attach to already running container");
  console.log("  bun run start --detach                  # Start in background");
  console.log("");
  console.log("Notes:");
  console.log("  • Container must exist (use 'bun run setup' to create)");
  console.log("  • Data path is set during setup and cannot be changed");
  console.log("  • To change data path, delete and recreate: 'bun run delete && bun run setup --path <path>'");
  console.log("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  if (args.help) {
    showHelp();
    return;
  }

  msg(`🐧 Starting Ubuntu container: ${CONTAINER_NAME}`);

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
    err(`Container '${CONTAINER_NAME}' does not exist. Run 'bun run setup' to create it first.`);
  }

  // Check if container is already running
  if (await containerRunning(CONTAINER_NAME)) {
    warn(`Container '${CONTAINER_NAME}' is already running.`);
    
    if (args.attach) {
      msg("Attaching to running container...");
      if (DRY_RUN) {
        console.log(`[DRY RUN] Would run: docker exec -it ${CONTAINER_NAME} /bin/bash`);
        return;
      }
      
      try {
        await $`docker exec -it ${CONTAINER_NAME} /bin/bash`;
      } catch (e) {
        err(`Failed to attach to container '${CONTAINER_NAME}': ${e}`);
      }
      return;
    }
    
    // Default behavior - show helpful options
    msg("💡 What would you like to do?");
    console.log(`   bun run start --attach    # Attach to running container`);
    console.log(`   bun run attach            # Open new shell in container`);  
    console.log(`   bun run restart           # Restart the container`);
    console.log(`   bun run stop              # Stop the container first`);
    console.log(`   bun run status            # Check container status`);
    console.log(`   bun run start --help      # Show detailed options`);
    return;
  }

  // Start the container
  if (args.detach) {
    msg(`Starting container '${CONTAINER_NAME}' in background...`);
    
    if (DRY_RUN) {
      console.log(`[DRY RUN] Would run: docker start ${CONTAINER_NAME}`);
      return;
    }

    try {
      await $`docker start ${CONTAINER_NAME}`;
      success(`Container '${CONTAINER_NAME}' started in background!`);
      msg("💡 To attach to the container, run:");
      console.log(`   bun run attach`);
      console.log(`   # or`);
      console.log(`   docker exec -it ${CONTAINER_NAME} /bin/bash`);
    } catch (e) {
      err(`Failed to start container '${CONTAINER_NAME}': ${e}`);
    }
  } else {
    msg(`Starting container '${CONTAINER_NAME}'...`);
    
    if (DRY_RUN) {
      console.log(`[DRY RUN] Would run: docker start -ai ${CONTAINER_NAME}`);
      return;
    }

    try {
      await $`docker start -ai ${CONTAINER_NAME}`;
      success(`Container '${CONTAINER_NAME}' started successfully!`);
    } catch (e) {
      err(`Failed to start container '${CONTAINER_NAME}': ${e}`);
    }
  }
}

main().catch((e) => {
  err(e?.message ?? String(e));
});