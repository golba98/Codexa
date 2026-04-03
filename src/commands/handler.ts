import {
  AUTH_PREFERENCES,
  AVAILABLE_BACKENDS,
  AVAILABLE_MODELS,
  AVAILABLE_REASONING_LEVELS,
  formatAuthPreferenceLabel,
  formatBackendLabel,
  formatModeLabel,
  formatReasoningLabel,
  formatThemeLabel,
  formatModeCommandHelp,
  resolveModeCommand,
} from "../config/settings.js";
import { AVAILABLE_THEMES } from "../config/settings.js";
import type { WorkspaceCommandContext } from "../core/launchContext.js";

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
          "                     suggest = read-only, auto-edit = writes files, full-auto = maximum autonomy",
          "  /reasoning [level] Set reasoning level (no arg opens picker)",
          "  /theme [name]      Switch theme directly (no arg opens picker)",
          "  /themes            Open visual theme picker (Up/Down + Enter)",
          "  /auth [option]     Open auth panel or set auth preference",
          "  /auth status       Probe Codexa auth status",
          "  /login             Show guided ChatGPT subscription login steps",
          "  /logout            Show guided logout steps",
          "  /backends          List all available backends",
          "  /models            List all available models",
          "  /workspace         Show the locked workspace for this session",
          "  /workspace relaunch <path> Restart the app in another workspace folder",
          `  Current reasoning: ${formatReasoningLabel(currentReasoningLevel)}`,
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
