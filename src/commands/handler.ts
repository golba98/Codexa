import {
  AVAILABLE_APPROVAL_POLICIES,
  AUTH_PREFERENCES,
  AVAILABLE_BACKENDS,
  AVAILABLE_MODELS,
  AVAILABLE_REASONING_LEVELS,
  AVAILABLE_SANDBOX_MODES,
  formatAuthPreferenceLabel,
  formatApprovalPolicyLabel,
  formatBackendLabel,
  formatModeLabel,
  formatReasoningLabel,
  formatRuntimePolicySummary,
  formatSandboxLabel,
  formatThemeLabel,
  formatModeCommandHelp,
  resolveModeCommand,
} from "../config/settings.js";
import { AVAILABLE_THEMES } from "../config/settings.js";
import type { WorkspaceCommandContext } from "../core/launchContext.js";
import type { RuntimePolicy } from "../config/settings.js";

export type CommandAction =
  | "exit"
  | "clear"
  | "login"
  | "logout"
  | "auth_status"
  | "backend"
  | "model"
  | "mode"
  | "auth"
  | "open_backend_picker"
  | "open_model_picker"
  | "open_mode_picker"
  | "reasoning"
  | "open_reasoning_picker"
  | "permissions_approval"
  | "permissions_sandbox"
  | "permissions_status"
  | "open_permissions_picker"
  | "theme"
  | "help"
  | "copy"
  | "backends"
  | "models"
  | "workspace"
  | "workspace_relaunch"
  | "open_auth_panel"
  | "open_theme_picker"
  | "themes"
  | "mouse_toggle"
  | "verbose_toggle"
  | "unknown";

export interface CommandResult {
  action: CommandAction;
  message?: string;
  value?: string;
}

export function handleCommand(
  text: string,
  currentBackend: string,
  currentModel: string,
  currentMode: string,
  currentAuthPreference: string,
  currentReasoningLevel: string,
  currentTheme: string,
  currentRuntimePolicy: RuntimePolicy,
  workspace: WorkspaceCommandContext,
): CommandResult | null {
  if (!text.startsWith("/")) return null;

  const [rawCmd, ...argParts] = text.slice(1).trim().split(/\s+/);
  const cmd = rawCmd!.toLowerCase();
  const arg = argParts.join(" ").trim();
  const normalizedArg = arg.toLowerCase();

  switch (cmd) {
    case "exit":
    case "quit":
      return { action: "exit" };

    case "clear":
      return { action: "clear" };

    case "backend": {
      if (!arg) return { action: "open_backend_picker" };
      if (AVAILABLE_BACKENDS.some((item) => item.id === arg)) {
        return {
          action: "backend",
          value: arg,
          message: `Backend switched to ${formatBackendLabel(arg)}`,
        };
      }
      return {
        action: "unknown",
        message: `Unknown backend: ${arg}. Use /backends to list available backends.`,
      };
    }

    case "model": {
      if (!arg) return { action: "open_model_picker" };
      if ((AVAILABLE_MODELS as readonly string[]).includes(arg)) {
        return { action: "model", value: arg, message: `Model switched to ${arg}` };
      }
      return {
        action: "unknown",
        message: `Unknown model: ${arg}. Use /models to list available models.`,
      };
    }

    case "mode": {
      if (!arg) return { action: "open_mode_picker" };
      const resolvedMode = resolveModeCommand(arg);
      if (resolvedMode) {
        return {
          action: "mode",
          value: resolvedMode,
          message: `Mode switched to ${formatModeLabel(resolvedMode)}`,
        };
      }
      return {
        action: "unknown",
        message: `Unknown mode: ${arg}. Valid: ${formatModeCommandHelp()}`,
      };
    }

    case "reasoning": {
      if (!arg) return { action: "open_reasoning_picker" };
      const reasoningAliasMap: Record<string, string> = {
        "extra high": "xhigh",
        xhigh: "xhigh",
      };
      const normalized = reasoningAliasMap[normalizedArg] ?? normalizedArg;
      const validLevels = AVAILABLE_REASONING_LEVELS.map((item) => item.id) as string[];
      if (validLevels.includes(normalized)) {
        return {
          action: "reasoning",
          value: normalized,
          message: `Reasoning level switched to ${formatReasoningLabel(normalized)}`,
        };
      }
      return {
        action: "unknown",
        message: `Unknown reasoning level: ${arg}. Valid: low, medium, high, extra high`,
      };
    }

    case "permissions": {
      if (!arg) return { action: "open_permissions_picker" };
      if (normalizedArg === "status") {
        return {
          action: "permissions_status",
          message: `Current permissions: ${formatRuntimePolicySummary(currentRuntimePolicy)}`,
        };
      }

      if (normalizedArg.startsWith("approval ")) {
        const approvalValue = arg.slice("approval".length).trim().toLowerCase();
        if (AVAILABLE_APPROVAL_POLICIES.some((item) => item.id === approvalValue)) {
          return {
            action: "permissions_approval",
            value: approvalValue,
            message: `Approval policy switched to ${formatApprovalPolicyLabel(approvalValue)}.`,
          };
        }
        return {
          action: "unknown",
          message: "Unknown approval policy. Valid: untrusted, on-request, never",
        };
      }

      if (normalizedArg.startsWith("sandbox ")) {
        const sandboxValue = arg.slice("sandbox".length).trim().toLowerCase();
        if (AVAILABLE_SANDBOX_MODES.some((item) => item.id === sandboxValue)) {
          return {
            action: "permissions_sandbox",
            value: sandboxValue,
            message: `Sandbox switched to ${formatSandboxLabel(sandboxValue)}.`,
          };
        }
        return {
          action: "unknown",
          message: "Unknown sandbox mode. Valid: read-only, workspace-write, danger-full-access",
        };
      }

      return {
        action: "unknown",
        message: "Unknown permissions command. Use /permissions, /permissions status, /permissions approval <policy>, or /permissions sandbox <mode>.",
      };
    }

    case "theme": {
      if (!arg) return { action: "open_theme_picker" };
      if (AVAILABLE_THEMES.some((item) => item.id === arg)) {
        return {
          action: "theme",
          value: arg,
          message: `Theme switched to ${formatThemeLabel(arg)}`,
        };
      }
      return {
        action: "unknown",
        message: `Unknown theme: ${arg}. Use /themes to list available themes.`,
      };
    }

    case "models": {
      const list = AVAILABLE_MODELS.map((m, i) => `  ${i + 1}. ${m}`).join("\n");
      return {
        action: "models",
        message: `Available models:\n${list}\n\nCurrent: ${currentModel}\nBackend: ${formatBackendLabel(currentBackend)}`,
      };
    }

    case "backends": {
      const list = AVAILABLE_BACKENDS
        .map((item, i) => `  ${i + 1}. ${item.label} (${item.id})`)
        .join("\n");
      return {
        action: "backends",
        message: `Available backends:\n${list}\n\nCurrent: ${formatBackendLabel(currentBackend)}`,
      };
    }

    case "workspace": {
      if (!arg) {
        return {
          action: "workspace",
          message: workspace.summaryMessage,
        };
      }

      if (normalizedArg === "relaunch") {
        return {
          action: "unknown",
          message: "Usage: /workspace relaunch <path>",
        };
      }

      if (normalizedArg.startsWith("relaunch ")) {
        return {
          action: "workspace_relaunch",
          value: arg.slice("relaunch".length).trim(),
        };
      }

      return {
        action: "unknown",
        message: "Unknown workspace command. Use /workspace or /workspace relaunch <path>.",
      };
    }

    case "auth": {
      if (!arg) return { action: "open_auth_panel" };
      if (arg === "status") {
        return { action: "auth_status" };
      }
      if (AUTH_PREFERENCES.some((item) => item.id === arg)) {
        return {
          action: "auth",
          value: arg,
          message: `Auth preference set to ${formatAuthPreferenceLabel(arg)}`,
        };
      }
      return {
        action: "unknown",
        message: "Unknown auth option. Use /auth, /auth status, or one of the documented preference ids.",
      };
    }

    case "login":
      return { action: "login" };

    case "logout":
      return { action: "logout" };

    case "copy":
      return { action: "copy" };

    case "themes": {
      return { action: "open_theme_picker" };
    }

    case "mouse":
      return { action: "mouse_toggle" };

    case "verbose":
    case "debug":
      return { action: "verbose_toggle" };

    case "help":
      return {
        action: "help",
        message: [
          "Shell execution:",
          "  !<command>         Run any shell command directly  e.g. !ls -la",
          "                     Output streams live in a terminal block",
          "                     Esc cancels a running command",
          "",
          "Commands:",
          "  /exit, /quit       Quit the application and cancel active run",
          "  /clear             Clear the chat window and cancel the active run",
          "  /backend [name]    Switch backend (no arg opens picker)",
          "  /model [name]      Switch model (no arg opens picker)",
          `  /mode [name]       Switch execution mode (${formatModeCommandHelp()})`,
          "                     suggest = advisor turn, auto-edit = edit-focused, full-auto = strongest autonomy",
          "  /reasoning [level] Set reasoning level (no arg opens picker)",
          "  /permissions       Open permissions picker",
          "  /permissions status Show current approval policy and sandbox",
          "  /permissions approval <policy> Set approval policy",
          "  /permissions sandbox <mode> Set sandbox mode",
          "  /theme [name]      Switch theme directly (no arg opens picker)",
          "  /themes            Open visual theme picker (Up/Down + Enter)",
          "  /verbose           Toggle verbose mode (shows detailed processing info)",
          "  /mouse             Toggle wheel-scroll mode — on by default; off restores native drag-select",
          "  /auth [option]     Open auth panel or set auth preference",
          "  /auth status       Probe Codexa auth status",
          "  /login             Show guided ChatGPT subscription login steps",
          "  /logout            Show guided logout steps",
          "  /backends          List all available backends",
          "  /models            List all available models",
          "  /workspace         Show the locked workspace for this session",
          "  /workspace relaunch <path> Restart the app in another workspace folder",
          `  Current reasoning: ${formatReasoningLabel(currentReasoningLevel)}`,
          `  Current permissions: ${formatRuntimePolicySummary(currentRuntimePolicy)}`,
          "  /copy              Copy last response to clipboard",
          "  /help              Show this help",
          "",
          "Install on Windows:",
          "  npm link           Make the codexa command available",
          "  where codexa       Verify the command resolves",
          "",
          "Shortcuts:",
          "  Ctrl+B    Open backend picker",
          "  Ctrl+M    Open model picker",
          "  Ctrl+P    Open mode picker",
          "  Ctrl+A    Open auth panel",
          "  Ctrl+L    Clear chat and cancel active run",
          "  Esc       Cancel active run or shell command",
          "  Ctrl+Y    Cycle execution mode",
          "  Ctrl+C / Ctrl+Q    Quit",
          "  ↑ / ↓    Navigate input history",
        ].join("\n"),
      };

    default:
      return {
        action: "unknown",
        message: `Unknown command: /${cmd}. Type /help for available commands.`,
      };
  }
}
