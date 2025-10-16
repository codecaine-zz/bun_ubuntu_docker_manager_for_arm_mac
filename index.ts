#!/usr/bin/env bun

import { 
  Logger, 
  ManagerError, 
  handleError, 
  getSystemInfo, 
  ProgressIndicator 
} from "./scripts/shared/utils.ts";
import { ConfigManager, handleConfigCommand } from "./scripts/shared/config.ts";
import { 
  handleLogsCommand, 
  handleExecCommand, 
  handleRestartCommand,
  handleInspectCommand,
  handleUpdateCommand,
  handleBackupCommand,
  handleCleanupCommand,
  handleListCommand
} from "./scripts/advanced-commands.ts";

async function showHelp(): Promise<void> {
  const configManager = new ConfigManager();
  const config = configManager.current;
  
  console.log("\n🐧 Ubuntu Docker Manager for macOS ARM");
  console.log("=======================================");
  console.log("");
  console.log("📋 Core Commands:");
  console.log("  📦 bun run setup      - Create and setup Ubuntu container");
  console.log("     • Auto-installs Python 3.14, Node.js, Bun, V language"); 
  console.log("     • Creates persistent data directory");
  console.log("     • Example: Create a full development environment");
  console.log("");
  console.log("  ▶️  bun run start      - Start existing Ubuntu container"); 
  console.log("     • Launches into bash shell with all your files");
  console.log("     • Mounts data directory as /data inside container");
  console.log("     • Data path is set during setup, cannot be changed");
  console.log("     • Example: Resume work on your projects");
  console.log("");
  console.log("  ⏹️  bun run stop       - Stop running Ubuntu container");
  console.log("     • Gracefully shuts down container");
  console.log("     • All data in /data is preserved");
  console.log("     • Example: Clean shutdown before system sleep");
  console.log("");
  console.log("  📊 bun run status     - Check container status");
  console.log("     • Shows detailed running/stopped state and system info");
  console.log("     • Use --compact for brief status, --watch for live updates");
  console.log("     • Example: bun run status --watch");
  console.log("");
  console.log("  🗑️  bun run delete     - Delete container and data");
  console.log("     • Interactive deletion with confirmation prompts");
  console.log("     • Option to keep or remove data directory");
  console.log("     • Example: Clean slate restart or free up disk space");
  console.log("");
  
  console.log("🔧 Advanced Commands:");
  console.log("  🔗 bun run attach     - Attach to running container");
  console.log("  📜 bun run logs       - View container logs (--follow, --tail=N)");
  console.log("  ⚡ bun run exec       - Execute command in container");
  console.log("  🔄 bun run restart    - Restart container (--force, --timeout=N)");
  console.log("  🔍 bun run inspect    - Inspect container details");
  console.log("  📋 bun run list       - List all Docker containers");
  console.log("  🆙 bun run update     - Update to latest Ubuntu image");
  console.log("  💾 bun run backup     - Backup data directory");
  console.log("  🧹 bun run cleanup    - Clean unused Docker resources");
  console.log("  ⚙️  bun run config     - Manage configuration");
  console.log("");
  
  console.log("⚙️ Configuration:");
  console.log(`  Container Name: ${config.containerName}`);
  console.log(`  Data Path: ${config.dataPath}`);
  console.log(`  Auto Start: ${config.autoStart ? "Enabled" : "Disabled"}`);
  console.log("  Use 'bun run config' to modify settings");
  console.log("");
  
  console.log("🌍 Environment Variables:");
  console.log("  CONTAINER_NAME   - Custom container name");
  console.log("  DATA_PATH        - Custom data directory path");
  console.log("  DRY_RUN=1        - Show what would happen without executing");
  console.log("  FORCE=1          - Skip confirmation prompts");
  console.log("  DEBUG=1          - Enable debug logging");
  console.log("");
  
  console.log("💡 Example Usage:");
  console.log("  bun run setup                          - Initial setup");
  console.log("  bun run setup --path /custom/data      - Setup with custom data path");
  console.log("  bun run status --compact --watch       - Live compact status");
  console.log("  bun run logs --follow --tail=100       - Follow recent logs");
  console.log("  bun run exec 'python3 --version'       - Check Python version");
  console.log("  CONTAINER_NAME=dev bun run setup       - Named container");
  console.log("  bun run backup --include-container      - Full backup");
  console.log("");
  
  console.log("📁 Data Persistence:");
  console.log("  • Everything in /data inside the container persists");
  console.log(`  • Data is stored in: ${config.dataPath}`);
  console.log("  • External volumes can be mounted automatically");
  console.log("");
  
  console.log("🚀 Quick Start:");
  console.log("  1. bun run setup    (create container)");
  console.log("  2. bun run start    (start and enter container)");
  console.log("  3. cd /data         (go to persistent data directory)");
  console.log("  4. Start coding!    (python3, node, bun, etc.)");
  console.log("");
  
  console.log("📖 For detailed help on any command:");
  console.log("  bun run <command> --help");
  console.log("  See README.md for complete documentation");
}

async function showSystemOverview(): Promise<void> {
  const progress = new ProgressIndicator();
  progress.start("Gathering system overview...");
  
  try {
    const [systemInfo] = await Promise.all([
      getSystemInfo()
    ]);

    progress.stop("System overview ready");

    console.log("\n🖥️ System Overview:");
    console.log("==================");
    console.log(`OS: ${systemInfo.os} ${systemInfo.arch}`);
    console.log(`Memory: ${systemInfo.memory}`);
    console.log(`Docker: ${systemInfo.docker.running ? 
      `✅ Running (${systemInfo.docker.version})` : 
      "❌ Not running"}`);
    console.log("");
  } catch (error) {
    progress.stop();
    Logger.warn(`Could not gather system info: ${error}`);
  }
}

async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    
    // Handle special flags
    if (args.includes("--version") || args.includes("-v")) {
      const packageInfo = await Bun.file("package.json").json();
      console.log(`Ubuntu Docker Manager v${packageInfo.version}`);
      return;
    }

    if (args.includes("--help") || args.includes("-h")) {
      await showHelp();
      await showSystemOverview();
      return;
    }

    if (args.length === 0) {
      await showHelp();
      await showSystemOverview();
      return;
    }

    const command = args[0];
    const commandArgs = args.slice(1);

    // Route to appropriate handlers
    switch (command) {
      case "config":
        await handleConfigCommand(commandArgs);
        break;
        
      case "logs":
        await handleLogsCommand(commandArgs);
        break;
        
      case "exec":
        await handleExecCommand(commandArgs);
        break;
        
      case "restart":
        await handleRestartCommand(commandArgs);
        break;
        
      case "inspect":
        await handleInspectCommand(commandArgs);
        break;
        
      case "update":
        await handleUpdateCommand(commandArgs);
        break;
        
      case "backup":
        await handleBackupCommand(commandArgs);
        break;
        
      case "cleanup":
        await handleCleanupCommand(commandArgs);
        break;
        
      case "list":
        await handleListCommand();
        break;
        
      // Core commands handled by existing scripts
      case "setup":
        Logger.info("Delegating to setup script...");
        await import("./scripts/install-ubuntu-docker-persistent.ts");
        break;
        
      case "start":
        Logger.info("Delegating to start script...");
        await import("./scripts/start-ubuntu.ts");
        break;
        
      case "stop":
        Logger.info("Delegating to stop script...");
        await import("./scripts/stop-ubuntu.ts");
        break;
        
      case "status":
        Logger.info("Delegating to enhanced status script...");
        await import("./scripts/enhanced-status.ts");
        break;
        
      case "delete":
        Logger.info("Delegating to delete script...");
        await import("./scripts/delete-ubuntu.ts");
        break;
        
      case "attach":
        Logger.info("Delegating to attach script...");
        await import("./scripts/attach-ubuntu.ts");
        break;
        
      default:
        Logger.error(`Unknown command: ${command}`);
        console.log("\nUse 'bun run --help' to see available commands");
        process.exit(1);
    }

  } catch (error) {
    handleError(error, { command: process.argv[2] });
  }
}

main();