#!/usr/bin/env node

/**
 * audit-codexa-capabilities.mjs
 * 
 * Lightweight Codexa capability audit checker.
 * Performs static analysis on source to report feature availability.
 * 
 * Usage: node scripts/audit-codexa-capabilities.mjs
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = import.meta.dirname ?? 
  resolve(new URL(import.meta.url).pathname, "..", "..");

const repoRoot = resolve(__dirname, "..");

const checks = {
  entrypoint() {
    const path = join(repoRoot, "bin", "codexa.js");
    const exists = existsSync(path);
    return {
      pass: exists,
      evidence: exists ? [path] : [],
      reason: exists 
        ? "Entry wrapper spawns Bun runtime to execute app"
        : "Entry wrapper not found"
    };
  },

  cliHelpVersion() {
    const path = join(repoRoot, "src", "config", "launchArgs.ts");
    if (!existsSync(path)) {
      return { pass: false, evidence: [], reason: "launchArgs.ts not found" };
    }
    
    const content = readFileSync(path, "utf-8");
    const hasHelp = /--help|-h/.test(content);
    const hasVersion = /--version|-v/.test(content);
    
    return {
      pass: hasHelp && hasVersion,
      evidence: [path],
      reason: hasHelp && hasVersion
        ? "--help and --version flags parsed"
        : `Only ${hasHelp ? "--help" : hasVersion ? "--version" : "neither"} parsed`
    };
  },

  initialPromptArgument() {
    const path = join(repoRoot, "src", "config", "launchArgs.ts");
    const appPath = join(repoRoot, "src", "app.tsx");
    
    if (!existsSync(path) || !existsSync(appPath)) {
      return { pass: false, evidence: [], reason: "Required files not found" };
    }

    const launchContent = readFileSync(path, "utf-8");
    const appContent = readFileSync(appPath, "utf-8");
    
    const hasExtraction = /passthroughArgs|initialPrompt/.test(launchContent);
    const hasUsage = /launchArgs.*prompt|initialPrompt/.test(appContent);
    
    return {
      pass: hasExtraction && hasUsage,
      evidence: [path, appPath],
      reason: hasExtraction && hasUsage
        ? "Initial prompt support present"
        : "Passthrough args stored but not used for initial prompt"
    };
  },

  interactiveMode() {
    const indexPath = join(repoRoot, "src", "index.tsx");
    if (!existsSync(indexPath)) {
      return { pass: false, evidence: [], reason: "src/index.tsx not found" };
    }

    const content = readFileSync(indexPath, "utf-8");
    const hasTTY = /isTTY|TTY|isatty/.test(content);
    const hasInk = /render\(|<App/.test(content);
    
    return {
      pass: hasTTY && hasInk,
      evidence: [indexPath],
      reason: hasTTY && hasInk
        ? "Interactive mode with TTY detection and Ink UI present"
        : "TTY or UI setup missing"
    };
  },

  modelPicker() {
    const paths = [
      join(repoRoot, "src", "ui", "ModelPicker.tsx"),
      join(repoRoot, "src", "config", "settings.ts")
    ];
    
    const exist = paths.filter(p => existsSync(p));
    const hasModels = exist.some(p => 
      /AVAILABLE_MODELS/.test(readFileSync(p, "utf-8"))
    );
    
    return {
      pass: exist.length === 2 && hasModels,
      evidence: exist,
      reason: exist.length === 2 && hasModels
        ? "Model picker UI and model enumeration present"
        : `Missing components: ${exist.length}/2`
    };
  },

  configLoading() {
    const paths = [
      join(repoRoot, "src", "config", "layeredConfig.ts"),
      join(repoRoot, "src", "config", "persistence.ts"),
      join(repoRoot, "src", "config", "runtimeConfig.ts")
    ];
    
    const exist = paths.filter(p => existsSync(p));
    return {
      pass: exist.length === paths.length,
      evidence: exist,
      reason: exist.length === 3
        ? "Layered config resolution, persistence, and runtime config present"
        : `Found ${exist.length}/3 config modules`
    };
  },

  agentsmdSupport() {
    const agentsPath = join(repoRoot, "AGENTS.md");
    const appPath = join(repoRoot, "src", "app.tsx");
    
    const agentsExists = existsSync(agentsPath);
    let agentsLoaded = false;
    
    if (agentsExists && existsSync(appPath)) {
      const appContent = readFileSync(appPath, "utf-8");
      agentsLoaded = /AGENTS|agents\.md|project.*instruction/.test(appContent);
    }
    
    return {
      pass: agentsExists && agentsLoaded,
      evidence: agentsExists ? [agentsPath, appPath] : [],
      reason: agentsLoaded
        ? "AGENTS.md file exists and is loaded by app"
        : agentsExists
        ? "AGENTS.md exists but NOT loaded by app"
        : "AGENTS.md file not found"
    };
  },

  commandExecution() {
    const path = join(repoRoot, "src", "core", "process", "CommandRunner.ts");
    if (!existsSync(path)) {
      return { pass: false, evidence: [], reason: "CommandRunner.ts not found" };
    }

    const content = readFileSync(path, "utf-8");
    const hasRun = /runCommand|spawn/.test(content);
    const hasOutput = /stdout|stderr/.test(content);
    
    return {
      pass: hasRun && hasOutput,
      evidence: [path],
      reason: hasRun && hasOutput
        ? "Shell command execution with output capture present"
        : "Command execution incomplete"
    };
  },

  fileEditingLayer() {
    const paths = [
      join(repoRoot, "src", "core", "workspaceActivity.ts"),
      join(repoRoot, "src", "core", "workspaceGuard.ts")
    ];
    
    const exist = paths.filter(p => existsSync(p));
    const content = exist.map(p => readFileSync(p, "utf-8")).join("");
    const hasTracking = /createWorkspaceActivityTracker|modified|created|deleted/.test(content);
    const hasGuard = /isPathInsideWorkspace|workspaceGuard/.test(content);
    
    return {
      pass: exist.length === 2 && hasTracking && hasGuard,
      evidence: exist,
      reason: hasTracking && hasGuard
        ? "File activity tracking and workspace guard present"
        : exist.length < 2 ? "Activity or guard module missing" : "Tracking/guard logic incomplete"
    };
  },

  diffRenderer() {
    const uiPath = join(repoRoot, "src", "ui");
    if (!existsSync(uiPath)) {
      return { pass: false, evidence: [], reason: "src/ui not found" };
    }

    const hasDiffComponent = existsSync(join(uiPath, "DiffViewer.tsx")) ||
                           existsSync(join(uiPath, "FileDiff.tsx"));
    
    return {
      pass: hasDiffComponent,
      evidence: hasDiffComponent ? [uiPath] : [],
      reason: hasDiffComponent ? "Diff rendering component found" : "Diff renderer not found"
    };
  },

  approvalSandboxLogic() {
    const paths = [
      join(repoRoot, "src", "core", "workspaceGuard.ts"),
      join(repoRoot, "src", "config", "runtimeConfig.ts")
    ];
    
    const exist = paths.filter(p => existsSync(p));
    const content = exist.map(p => readFileSync(p, "utf-8")).join("");
    const hasSandbox = /sandbox|approval|permission|writable.*root/.test(content);
    
    return {
      pass: exist.length === 2 && hasSandbox,
      evidence: exist,
      reason: hasSandbox
        ? "Sandbox configuration and approval logic present"
        : "Approval or sandbox logic missing"
    };
  },

  sessionHistoryPersistence() {
    const paths = [
      join(repoRoot, "src", "session", "types.ts"),
      join(repoRoot, "src", "session", "appSession.ts"),
      join(repoRoot, "src", "config", "persistence.ts")
    ];
    
    const exist = paths.filter(p => existsSync(p));
    return {
      pass: exist.length === 3,
      evidence: exist,
      reason: exist.length === 3
        ? "Session event types, state management, and persistence present"
        : `Found ${exist.length}/3 session modules`
    };
  },

  debugLogging() {
    const debugPath = join(repoRoot, "src", "core", "inputDebug.ts");
    const envPath = join(repoRoot, "bin", "codexa.js");
    
    const debugExists = existsSync(debugPath);
    const envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
    const hasEnvDebug = /CODEXA_DEBUG|debug/.test(envContent);
    
    return {
      pass: debugExists || hasEnvDebug,
      evidence: [debugExists ? debugPath : envPath].filter(p => existsSync(p)),
      reason: debugExists && hasEnvDebug
        ? "Debug logging module and environment variable support present"
        : debugExists || hasEnvDebug
        ? "Partial debug support"
        : "Debug logging not found"
    };
  },

  windowsPowerShellHandling() {
    const launcherPath = join(repoRoot, "bin", "codexa.js");
    if (!existsSync(launcherPath)) {
      return { pass: false, evidence: [], reason: "Launcher not found" };
    }

    const content = readFileSync(launcherPath, "utf-8");
    const hasWinDetect = /win32|platform|windows/i.test(content);
    const hasExeResolution = /bun\.exe|bun\.cmd|shell|spawn/.test(content);
    
    return {
      pass: hasWinDetect && hasExeResolution,
      evidence: [launcherPath],
      reason: hasWinDetect && hasExeResolution
        ? "Windows platform detection and executable resolution present"
        : "Windows-specific handling incomplete"
    };
  },

  resizeHandling() {
    const indexPath = join(repoRoot, "src", "index.tsx");
    if (!existsSync(indexPath)) {
      return { pass: false, evidence: [], reason: "src/index.tsx not found" };
    }

    const content = readFileSync(indexPath, "utf-8");
    const hasResize = /resize|onResize|RESIZE/.test(content);
    const hasRepaint = /repaint|recalculate|calculateLayout/.test(content);
    
    return {
      pass: hasResize && hasRepaint,
      evidence: [indexPath],
      reason: hasResize && hasRepaint
        ? "Terminal resize event handling and UI recalculation present"
        : "Resize handling incomplete"
    };
  },

  streamingHandler() {
    const paths = [
      join(repoRoot, "src", "core", "providers", "codexSubprocess.ts"),
      join(repoRoot, "src", "core", "codex.ts")
    ];
    
    const exist = paths.filter(p => existsSync(p));
    const content = exist.map(p => readFileSync(p, "utf-8")).join("");
    const hasStreaming = /stream|emit|chunk|line|onLine/.test(content);
    
    return {
      pass: exist.length > 0 && hasStreaming,
      evidence: exist,
      reason: hasStreaming
        ? "Streaming response handler present"
        : "Streaming implementation not found"
    };
  },

  interruptCancelHandling() {
    const indexPath = join(repoRoot, "src", "index.tsx");
    const appPath = join(repoRoot, "src", "app.tsx");
    
    const paths = [indexPath, appPath].filter(p => existsSync(p));
    const content = paths.map(p => readFileSync(p, "utf-8")).join("");
    const hasSignals = /SIGINT|SIGTERM|signal|cancel/.test(content);
    const hasCancel = /cancel|abort|kill/.test(content);
    
    return {
      pass: hasSignals && hasCancel,
      evidence: paths,
      reason: hasSignals && hasCancel
        ? "Signal handling and cancellation logic present"
        : "Interrupt/cancel handling incomplete"
    };
  }
};

function statusSymbol(pass) {
  return pass ? "✓" : "✗";
}

function statusLabel(pass) {
  return pass ? "PASS" : "MISSING";
}

function formatName(name) {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, str => str.toUpperCase());
}

console.log("\n" + "=".repeat(80));
console.log("CODEXA CAPABILITY AUDIT REPORT");
console.log("=".repeat(80));
console.log(`Repository: ${repoRoot}\n`);

const results = [];

for (const [name, checkFn] of Object.entries(checks)) {
  const result = checkFn();
  results.push({ name, ...result });
  
  const symbol = statusSymbol(result.pass);
  const status = statusLabel(result.pass);
  const formattedName = formatName(name);
  
  console.log(`${symbol} ${status.padEnd(8)} | ${formattedName}`);
  console.log(`           ${result.reason}`);
  if (result.evidence.length > 0) {
    console.log(`           Evidence: ${result.evidence.map(e => e.replace(repoRoot, ".")).join(", ")}`);
  }
  console.log();
}

const total = results.length;
const passed = results.filter(r => r.pass).length;
const missing = total - passed;
const pctComplete = Math.round((passed / total) * 100);

console.log("=".repeat(80));
console.log("CAPABILITY SUMMARY");
console.log("=".repeat(80));
console.log(`Total checks:        ${total}`);
console.log(`Passed:              ${passed} (${pctComplete}%)`);
console.log(`Missing/Partial:     ${missing} (${100 - pctComplete}%)`);
console.log();

const missingFeatures = results.filter(r => !r.pass).map(r => formatName(r.name));

if (missingFeatures.length > 0) {
  console.log("TOP MISSING FEATURES:");
  missingFeatures.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f}`);
  });
  console.log();
}

console.log("=".repeat(80));
console.log();

process.exit(passed === total ? 0 : 1);
