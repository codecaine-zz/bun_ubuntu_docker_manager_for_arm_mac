#!/usr/bin/env bun
// @ts-nocheck

import { $ } from "bun";
import { 
  Logger, 
  ManagerError, 
  handleError, 
  getContainerStatus, 
  getSystemInfo,
  ProgressIndicator,
  safeExec,
  commandExists
} from "./shared/utils.ts";
import { ConfigManager } from "./shared/config.ts";
import { join } from "path";

const DRY_RUN = process.env.DRY_RUN === "1";

interface DetailedStatus {
  container: {
    name: string;
    exists: boolean;
    running: boolean;
    status?: string;
    created?: string;
    ports?: string;
    image?: string;
    size?: string;
  };
  data: {
    path: string;
    exists: boolean;
    size?: string;
    permissions?: string;
  };
  system: {
    os: string;
    arch: string;
    memory: string;
    docker: {
      version?: string;
      running: boolean;
    };
  };
  tools: {
    [key: string]: {
      available: boolean;
      version?: string;
    };
  };
}

async function getDetailedContainerInfo(name: string): Promise<DetailedStatus['container']> {
  const basicStatus = await getContainerStatus(name);
  
  if (!basicStatus.exists) {
    return {
      name,
      exists: false,
      running: false
    };
  }

  try {
    const [imageResult, sizeResult] = await Promise.all([
      safeExec(`docker inspect ${name} --format '{{.Config.Image}}'`),
      safeExec(`docker system df | grep ${name} | awk '{print $3}'`)
    ]);

    return {
      name,
      exists: basicStatus.exists,
      running: basicStatus.running,
      status: basicStatus.status,
      created: basicStatus.created,
      ports: basicStatus.ports,
      image: imageResult.exitCode === 0 ? imageResult.stdout?.toString().trim() : undefined,
      size: sizeResult.exitCode === 0 ? sizeResult.stdout?.toString().trim() : undefined
    };
  } catch (error) {
    Logger.debug(`Failed to get detailed container info: ${error}`);
    return {
      name,
      exists: basicStatus.exists,
      running: basicStatus.running,
      status: basicStatus.status,
      created: basicStatus.created,
      ports: basicStatus.ports
    };
  }
}

async function getDataDirectoryInfo(path: string): Promise<DetailedStatus['data']> {
  const exists = await Bun.file(path).exists();
  
  if (!exists) {
    return { path, exists };
  }

  try {
    const [sizeResult, permResult] = await Promise.all([
      safeExec(`du -sh "${path}" | cut -f1`),
      safeExec(`ls -ld "${path}" | awk '{print $1}'`)
    ]);

    return {
      path,
      exists,
      size: sizeResult.exitCode === 0 ? sizeResult.stdout?.toString().trim() : undefined,
      permissions: permResult.exitCode === 0 ? permResult.stdout?.toString().trim() : undefined
    };
  } catch (error) {
    Logger.debug(`Failed to get data directory info: ${error}`);
    return { path, exists };
  }
}

async function getToolsStatus(): Promise<DetailedStatus['tools']> {
  const tools = {
    docker: "docker --version",
    bun: "bun --version", 
    node: "node --version",
    python3: "python3 --version",
    git: "git --version"
  };

  const results: DetailedStatus['tools'] = {};
  
  for (const [tool, versionCmd] of Object.entries(tools)) {
    try {
      const available = await commandExists(tool);
      
      if (available) {
        const versionResult = await safeExec(versionCmd, { timeout: 2000 });
        results[tool] = {
          available: true,
          version: versionResult.exitCode === 0 ? 
            versionResult.stdout?.toString().trim().replace(/^[^\d]*/, '') : 
            undefined
        };
      } else {
        results[tool] = { available: false };
      }
    } catch (error) {
      Logger.debug(`Failed to check tool ${tool}: ${error}`);
      results[tool] = { available: false };
    }
  }

  return results;
}

async function getDetailedStatus(): Promise<DetailedStatus> {
  const progress = new ProgressIndicator();
  progress.start("Gathering detailed status information...");

  try {
    const configManager = new ConfigManager();
    const config = configManager.current;
    
    const [containerInfo, dataInfo, systemInfo, toolsInfo] = await Promise.all([
      getDetailedContainerInfo(config.containerName),
      getDataDirectoryInfo(config.dataPath),
      getSystemInfo(),
      getToolsStatus()
    ]);

    progress.stop("Status information gathered successfully");

    return {
      container: containerInfo,
      data: dataInfo,
      system: systemInfo,
      tools: toolsInfo
    };
  } catch (error) {
    progress.stop();
    throw new ManagerError("Failed to gather status information", { error });
  }
}

function displayDetailedStatus(status: DetailedStatus): void {
  const { container, data, system, tools } = status;

  // Header
  console.log("\n" + "=".repeat(60));
  console.log("🐧 Ubuntu Docker Manager - Detailed Status");
  console.log("=".repeat(60));

  // Container Status
  console.log("\n📦 Container Information:");
  console.log(`   Name: ${container.name}`);
  
  if (container.exists) {
    const statusIcon = container.running ? "🟢" : "🔴";
    const statusText = container.running ? "Running" : "Stopped";
    console.log(`   Status: ${statusIcon} ${statusText}`);
    
    if (container.status) {
      console.log(`   Details: ${container.status}`);
    }
    
    if (container.image) {
      console.log(`   Image: ${container.image}`);
    }
    
    if (container.created) {
      console.log(`   Created: ${container.created}`);
    }
    
    if (container.ports && container.ports !== "") {
      console.log(`   Ports: ${container.ports}`);
    }
    
    if (container.size) {
      console.log(`   Size: ${container.size}`);
    }
  } else {
    console.log(`   Status: ❌ Container does not exist`);
  }

  // Data Directory Status
  console.log("\n💾 Data Directory:");
  console.log(`   Path: ${data.path}`);
  
  if (data.exists) {
    console.log(`   Status: ✅ Directory exists`);
    
    if (data.size) {
      console.log(`   Size: ${data.size}`);
    }
    
    if (data.permissions) {
      console.log(`   Permissions: ${data.permissions}`);
    }
  } else {
    console.log(`   Status: ❌ Directory does not exist`);
  }

  // System Information
  console.log("\n🖥️ System Information:");
  console.log(`   OS: ${system.os}`);
  console.log(`   Architecture: ${system.arch}`);
  console.log(`   Memory: ${system.memory}`);
  
  if (system.docker.running) {
    console.log(`   Docker: ✅ Running (${system.docker.version || "unknown version"})`);
  } else {
    console.log(`   Docker: ❌ Not running or not installed`);
  }

  // Development Tools
  console.log("\n🛠️ Development Tools:");
  Object.entries(tools).forEach(([tool, info]) => {
    const icon = info.available ? "✅" : "❌";
    const version = info.version ? ` (${info.version})` : "";
    console.log(`   ${tool}: ${icon} ${info.available ? "Available" : "Not found"}${version}`);
  });

  // Quick Actions
  console.log("\n🚀 Quick Actions:");
  if (!container.exists) {
    console.log("   • Run 'bun run setup' to create the container");
  } else if (!container.running) {
    console.log("   • Run 'bun run start' to start the container");
  } else {
    console.log("   • Container is running and ready to use");
    console.log("   • Run 'bun run attach' to open a new shell session");
  }

  if (!data.exists) {
    console.log("   • Data directory will be created automatically when needed");
  }

  if (!system.docker.running) {
    console.log("   • Start Docker Desktop to enable container operations");
  }

  console.log("\n" + "=".repeat(60));
}

function displayCompactStatus(status: DetailedStatus): void {
  const { container, data, system } = status;
  
  // Compact single-line status
  const containerStatus = container.exists ? 
    (container.running ? "🟢 Running" : "🔴 Stopped") : 
    "❌ Not Created";
  
  const dataStatus = data.exists ? "✅" : "❌";
  const dockerStatus = system.docker.running ? "✅" : "❌";
  
  console.log(`\n📊 Status: Container: ${containerStatus} | Data: ${dataStatus} | Docker: ${dockerStatus}`);
  
  if (container.running) {
    console.log(`💡 Quick: Run 'bun run attach' to connect, or check logs with 'docker logs ${container.name}'`);
  } else if (container.exists) {
    console.log(`💡 Quick: Run 'bun run start' to launch the container`);
  } else {
    console.log(`💡 Quick: Run 'bun run setup' to create and configure the container`);
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const compact = args.includes("--compact") || args.includes("-c");
    const watch = args.includes("--watch") || args.includes("-w");
    
    if (DRY_RUN) {
      Logger.info("DRY_RUN mode: Would check container status");
      return;
    }

    if (watch) {
      Logger.info("Watch mode: Press Ctrl+C to stop");
      const watchStatus = async () => {
        try {
          const status = await getDetailedStatus();
          console.clear();
          
          if (compact) {
            displayCompactStatus(status);
          } else {
            displayDetailedStatus(status);
          }
          
          console.log(`\n⏰ Last updated: ${new Date().toLocaleTimeString()} (refreshing every 5s)`);
        } catch (error) {
          Logger.error(`Watch error: ${error}`);
        }
      };

      // Initial display
      await watchStatus();
      
      // Set up interval
      const interval = setInterval(watchStatus, 5000);
      
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        clearInterval(interval);
        Logger.info("\nWatch mode stopped");
        process.exit(0);
      });
      
      // Keep the process alive
      return new Promise(() => {});
    }

    const status = await getDetailedStatus();
    
    if (compact) {
      displayCompactStatus(status);
    } else {
      displayDetailedStatus(status);
    }

    // Exit with appropriate code
    const { container, system } = status;
    if (!system.docker.running) {
      process.exit(2); // Docker not running
    } else if (!container.exists) {
      process.exit(3); // Container doesn't exist
    } else if (!container.running) {
      process.exit(1); // Container exists but not running
    } else {
      process.exit(0); // All good
    }

  } catch (error) {
    handleError(error, { command: "status" });
  }
}

// Show usage if called with --help
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("\nUsage: bun run status [options]");
  console.log("\nOptions:");  
  console.log("  -c, --compact    Compact status display");
  console.log("  -w, --watch      Watch mode (refresh every 5s)");
  console.log("  -h, --help       Show this help");
  console.log("\nExit codes:");
  console.log("  0 - Container running normally");
  console.log("  1 - Container exists but not running"); 
  console.log("  2 - Docker not running");
  console.log("  3 - Container doesn't exist");
  process.exit(0);
}

main();
}

  // Check if Docker is available
  if (!(await commandExists("docker"))) {
    err("Docker is not installed or not in PATH. Please install Docker Desktop.");
  }

  // Check if Docker daemon is running
  let dockerRunning = true;
  try {
    await $`docker info`.quiet();
  } catch {
    dockerRunning = false;
    warn("Docker daemon is not running. Please start Docker Desktop.");
  }

  if (!dockerRunning) {
    return;
  }

  // Check container status
  const exists = await containerExists(CONTAINER_NAME);
  const running = await containerRunning(CONTAINER_NAME);
  
  console.log("\n" + "=".repeat(50));
  console.log(`Container Name: ${CONTAINER_NAME}`);
  console.log("=".repeat(50));

  if (!exists) {
    warn("Container does not exist");
    info("To create it, run: bun run setup");
    return;
  }

  // Get detailed container information
  const containerInfo = await getContainerInfo(CONTAINER_NAME);
  
  if (running) {
    success("Container is RUNNING");
  } else {
    warn("Container is STOPPED");
  }

  if (containerInfo) {
    console.log(`Status: ${containerInfo.Status}`);
    console.log(`Image: ${containerInfo.Image}`);
    console.log(`Created: ${formatDate(containerInfo.CreatedAt)}`);
    
    if (containerInfo.Ports) {
      console.log(`Ports: ${containerInfo.Ports}`);
    }
  }

  // Check data directory
  const UBUNTU_ROOT = `${Bun.env.HOME}/${CONTAINER_NAME}`;
  console.log(`\nData Directory: ${UBUNTU_ROOT}`);
  
  try {
    // Check if directory exists using stat
    const stats = await Bun.file(UBUNTU_ROOT).stat();
    if (stats && stats.isDirectory()) {
      success("Data directory exists");
      console.log(`Modified: ${stats.mtime.toLocaleString()}`);
      
      // Check for setup completion marker
      const setupComplete = Bun.file(`${UBUNTU_ROOT}/.setup-complete`);
      if (await setupComplete.exists()) {
        success("Container setup is complete");
      } else {
        warn("Container setup may be incomplete");
      }
    } else {
      warn("Data directory does not exist or is not a directory");
    }
  } catch (e) {
    warn("Data directory does not exist");
  }

  // Show available commands
  console.log("\n" + "=".repeat(50));
  console.log("Available Commands:");
  console.log("=".repeat(50));
  
  if (!exists) {
    console.log("  bun run setup    - Create and setup container");
  } else if (running) {
    console.log("  bun run stop     - Stop the container");
    console.log(`  docker exec -it ${CONTAINER_NAME} /bin/bash  - Attach to container`);
  } else {
    console.log("  bun run start    - Start the container");
  }
  
  if (exists) {
    console.log("  bun run delete   - Delete the container");
  }
  
  console.log("  bun run status   - Show this status");
}

main().catch((e) => {
  err(e?.message ?? String(e));
});