import {
  AUTH_PREFERENCES,
  AVAILABLE_BACKENDS,
  DIRECTORY_DISPLAY_MODES,
  AVAILABLE_MODELS,
  AVAILABLE_REASONING_LEVELS,
  formatDirectoryDisplayModeLabel,
  formatAuthPreferenceLabel,
  formatBackendLabel,
  formatModeCommandHelp,
  formatModeLabel,
  formatReasoningLabel,
  formatThemeLabel,
  resolveModeCommand,
  type DirectoryDisplayMode,
} from "../config/settings.js";
import { AVAILABLE_THEMES } from "../config/settings.js";
import {
  formatLayeredConfigStatus,
  type LayeredConfigResult,
} from "../config/layeredConfig.js";
import {
  formatApprovalPolicyLabel,
  formatNetworkAccessLabel,
  formatPermissionsStatus,
  formatPersonalityLabel,
  formatRuntimeStatus,
  formatSandboxModeLabel,
  formatServiceTierLabel,
  type ResolvedRuntimeConfig,
  type RuntimeApprovalPolicy,
  type RuntimeConfig,
  type RuntimeNetworkAccess,
  type RuntimePersonality,
  type RuntimeSandboxMode,
  type RuntimeServiceTier,
} from "../config/runtimeConfig.js";
import {
  findModelCapability,
  formatModelCapabilitiesList,
  getSelectableModelCapabilities,
  type CodexModelCapabilities,
} from "../core/codexModelCapabilities.js";
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
  | "plan_mode"
  | "open_settings_panel"
  | "setting_status"
  | "setting_directory"
  | "theme"
  | "help"
  | "copy"
  | "backends"
  | "models"
  | "workspace"
  | "workspace_relaunch"
  | "config_status"
  | "config_trust_status"
  | "config_trust_set"
  | "open_auth_panel"
  | "open_theme_picker"
  | "open_permissions_panel"
  | "themes"
  | "mouse_toggle"
  | "verbose_toggle"
  | "status"
  | "permissions_status"
  | "runtime_approval_policy"
  | "runtime_sandbox_mode"
  | "runtime_network_access"
  | "runtime_writable_roots_add"
  | "runtime_writable_roots_remove"
  | "runtime_writable_roots_clear"
  | "runtime_writable_roots_list"
  | "runtime_service_tier"
  | "runtime_personality"
  | "unknown";

export interface CommandResult {
  action: CommandAction;
  message?: string;
  value?: string;
}

export interface CommandContext {
  config: LayeredConfigResult;
  runtime: RuntimeConfig;
  resolvedRuntime: ResolvedRuntimeConfig;
  settings: {
    directoryDisplayMode: DirectoryDisplayMode;
  };
  workspace: WorkspaceCommandContext;
  tokensUsed?: number;
  modelCapabilities?: CodexModelCapabilities | null;
}

const APPROVAL_POLICY_VALUES = ["inherit", "untrusted", "on-request", "never"] as const;
const SANDBOX_MODE_VALUES = ["inherit", "read-only", "workspace-write", "danger-full-access"] as const;
const NETWORK_ACCESS_VALUES = ["inherit", "on", "off"] as const;
const SERVICE_TIER_VALUES = ["flex", "fast"] as const;
const PERSONALITY_VALUES = ["none", "friendly", "pragmatic"] as const;

function isOneOf<T extends string>(value: string, list: readonly T[]): value is T {
  return (list as readonly string[]).includes(value);
}

function formatWritableRoots(roots: readonly string[]): string {
  return roots.length > 0
    ? roots.map((root) => `  - ${root}`).join("\n")
    : "  - none";
}

function normalizeReasoningCommandArg(arg: string): string {
  const normalized = arg.toLowerCase();
  const reasoningAliasMap: Record<string, string> = {
    "extra high": "xhigh",
    xhigh: "xhigh",
  };
  return reasoningAliasMap[normalized] ?? normalized;
}

function isKnownFallbackReasoning(value: string): boolean {
  return AVAILABLE_REASONING_LEVELS.some((item) => item.id === value);
}

function handlePolicyCommand(
  commandPrefix: "/runtime" | "/permissions",
  arg: string,
  context: CommandContext,
  includeExtendedControls = true,
): CommandResult {
  const [subcommandRaw, ...restParts] = arg.split(/\s+/);
  const subcommand = subcommandRaw?.toLowerCase() ?? "";
  const rest = restParts.join(" ").trim();
  const normalizedRest = rest.toLowerCase();

  switch (subcommand) {
    case "approval-policy": {
      if (!rest || normalizedRest === "status") {
        return {
          action: "runtime_approval_policy",
          message: `Approval policy: configured ${formatApprovalPolicyLabel(context.runtime.policy.approvalPolicy)}; effective ${formatApprovalPolicyLabel(context.resolvedRuntime.policy.approvalPolicy)}.`,
        };
      }
      if (isOneOf(normalizedRest, APPROVAL_POLICY_VALUES)) {
        const value = normalizedRest as RuntimeApprovalPolicy;
        return {
          action: "runtime_approval_policy",
          value,
          message: `Approval policy set to ${formatApprovalPolicyLabel(value)}.`,
        };
      }
      return {
        action: "unknown",
        message: `Usage: ${commandPrefix} approval-policy [status|inherit|untrusted|on-request|never]`,
      };
    }

    case "sandbox": {
      if (!rest || normalizedRest === "status") {
        return {
          action: "runtime_sandbox_mode",
          message: `Sandbox mode: configured ${formatSandboxModeLabel(context.runtime.policy.sandboxMode)}; effective ${formatSandboxModeLabel(context.resolvedRuntime.policy.sandboxMode)}.`,
        };
      }
      if (isOneOf(normalizedRest, SANDBOX_MODE_VALUES)) {
        const value = normalizedRest as RuntimeSandboxMode;
        return {
          action: "runtime_sandbox_mode",
          value,
          message: `Sandbox mode set to ${formatSandboxModeLabel(value)}.`,
        };
      }
      return {
        action: "unknown",
        message: `Usage: ${commandPrefix} sandbox [status|inherit|read-only|workspace-write|danger-full-access]`,
      };
    }

    case "network": {
      if (!rest || normalizedRest === "status") {
        return {
          action: "runtime_network_access",
          message: `Network access: configured ${formatNetworkAccessLabel(context.runtime.policy.networkAccess)}; effective ${formatNetworkAccessLabel(context.resolvedRuntime.policy.networkAccess)}.`,
        };
      }
      if (isOneOf(normalizedRest, NETWORK_ACCESS_VALUES)) {
        const value: RuntimeNetworkAccess = normalizedRest === "on"
          ? "enabled"
          : normalizedRest === "off"
            ? "disabled"
            : "inherit";
        return {
          action: "runtime_network_access",
          value,
          message: `Network access set to ${formatNetworkAccessLabel(value)}.`,
        };
      }
      return {
        action: "unknown",
        message: `Usage: ${commandPrefix} network [status|inherit|on|off]`,
      };
    }

    case "writable-roots": {
      if (!rest || normalizedRest === "list" || normalizedRest === "status") {
        return {
          action: "runtime_writable_roots_list",
          message: `Writable roots:\n${formatWritableRoots(context.runtime.policy.writableRoots)}`,
        };
      }

      if (normalizedRest === "clear") {
        return {
          action: "runtime_writable_roots_clear",
          message: "Writable roots cleared.",
        };
      }

      if (normalizedRest.startsWith("add ")) {
        const pathValue = rest.slice("add".length).trim();
        if (!pathValue) {
          return {
            action: "unknown",
            message: `Usage: ${commandPrefix} writable-roots add <path>`,
          };
        }
        return {
          action: "runtime_writable_roots_add",
          value: pathValue,
          message: `Writable root added: ${pathValue}`,
        };
      }

      if (normalizedRest.startsWith("remove ")) {
        const pathValue = rest.slice("remove".length).trim();
        if (!pathValue) {
          return {
            action: "unknown",
            message: `Usage: ${commandPrefix} writable-roots remove <path>`,
          };
        }
        return {
          action: "runtime_writable_roots_remove",
          value: pathValue,
          message: `Writable root removed: ${pathValue}`,
        };
      }

      return {
        action: "unknown",
        message: `Usage: ${commandPrefix} writable-roots [list|add <path>|remove <path>|clear]`,
      };
    }

    case "service-tier": {
      if (!includeExtendedControls) {
        return {
          action: "unknown",
          message: `Unknown ${commandPrefix.slice(1)} command. Use ${commandPrefix} <approval-policy|sandbox|network|writable-roots>.`,
        };
      }
      if (!rest || normalizedRest === "status") {
        return {
          action: "runtime_service_tier",
          message: `Service tier: ${formatServiceTierLabel(context.runtime.policy.serviceTier)}.`,
        };
      }
      if (isOneOf(normalizedRest, SERVICE_TIER_VALUES)) {
        const value = normalizedRest as RuntimeServiceTier;
        return {
          action: "runtime_service_tier",
          value,
          message: `Service tier set to ${formatServiceTierLabel(value)}.`,
        };
      }
      return {
        action: "unknown",
        message: `Usage: ${commandPrefix} service-tier [status|flex|fast]`,
      };
    }

    case "personality": {
      if (!includeExtendedControls) {
        return {
          action: "unknown",
          message: `Unknown ${commandPrefix.slice(1)} command. Use ${commandPrefix} <approval-policy|sandbox|network|writable-roots>.`,
        };
      }
      if (!rest || normalizedRest === "status") {
        return {
          action: "runtime_personality",
          message: `Personality: ${formatPersonalityLabel(context.runtime.policy.personality)}.`,
        };
      }
      if (isOneOf(normalizedRest, PERSONALITY_VALUES)) {
        const value = normalizedRest as RuntimePersonality;
        return {
          action: "runtime_personality",
          value,
          message: `Personality set to ${formatPersonalityLabel(value)}.`,
        };
      }
      return {
        action: "unknown",
        message: `Usage: ${commandPrefix} personality [status|none|friendly|pragmatic]`,
      };
    }

    default:
      return {
        action: "unknown",
        message: includeExtendedControls
          ? `Unknown ${commandPrefix.slice(1)} command. Use /status or ${commandPrefix} <approval-policy|sandbox|network|writable-roots|service-tier|personality>.`
          : `Unknown ${commandPrefix.slice(1)} command. Use /permissions <approval-policy|sandbox|network|writable-roots>.`,
      };
  }
}

export function handleCommand(text: string, context: CommandContext): CommandResult | null {
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
      const detectedModels = context.modelCapabilities
        ? getSelectableModelCapabilities(context.modelCapabilities)
        : [];
      const detectedModel = detectedModels.find((model) => model.model === arg || model.id === arg);
      if (detectedModel) {
        return { action: "model", value: detectedModel.model, message: `Model switched to ${detectedModel.model}` };
      }
      if (!context.modelCapabilities && (AVAILABLE_MODELS as readonly string[]).includes(arg)) {
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
      const normalized = normalizeReasoningCommandArg(arg);
      const modelCapability = findModelCapability(context.modelCapabilities, context.runtime.model);
      const detectedLevels = modelCapability?.supportedReasoningLevels;
      if (detectedLevels && detectedLevels.some((item) => item.id === normalized)) {
        return {
          action: "reasoning",
          value: normalized,
          message: `Reasoning level switched to ${formatReasoningLabel(normalized)}`,
        };
      }
      if (detectedLevels) {
        const valid = detectedLevels.map((item) => item.id).join(", ");
        return {
          action: "unknown",
          message: `Unknown reasoning level for ${context.runtime.model}: ${arg}. Valid: ${valid}`,
        };
      }
      if (isKnownFallbackReasoning(normalized)) {
        return {
          action: "reasoning",
          value: normalized,
          message: `Reasoning level switched to ${formatReasoningLabel(normalized)} (runtime metadata unavailable)`,
        };
      }
      return {
        action: "unknown",
        message: `Unknown reasoning level: ${arg}. Runtime reasoning metadata is unavailable for ${context.runtime.model}.`,
      };
    }

    case "plan": {
      if (!arg || normalizedArg === "status") {
        return {
          action: "plan_mode",
          message: `Plan mode: ${context.runtime.planMode ? "Enabled" : "Disabled"}.`,
        };
      }

      if (normalizedArg === "on" || normalizedArg === "off") {
        return {
          action: "plan_mode",
          value: normalizedArg,
          message: `Plan mode ${normalizedArg === "on" ? "enabled" : "disabled"}.`,
        };
      }

      return {
        action: "unknown",
        message: "Usage: /plan [on|off]",
      };
    }

    case "setting": {
      if (!arg) {
        return { action: "open_settings_panel" };
      }

      if (normalizedArg === "directory") {
        return {
          action: "setting_directory",
          message: [
            `Directory display: ${formatDirectoryDisplayModeLabel(context.settings.directoryDisplayMode)} (${context.settings.directoryDisplayMode})`,
            "Allowed values: normal, simple",
            "normal = show the full workspace path",
            "simple = show only the final folder name",
          ].join("\n"),
        };
      }

      if (normalizedArg.startsWith("directory ")) {
        const nextValue = normalizedArg.slice("directory ".length).trim();
        if (DIRECTORY_DISPLAY_MODES.includes(nextValue as DirectoryDisplayMode)) {
          const value = nextValue as DirectoryDisplayMode;
          return {
            action: "setting_directory",
            value,
            message: `Directory display set to ${formatDirectoryDisplayModeLabel(value)} (${value}).`,
          };
        }

        return {
          action: "unknown",
          message: "Usage: /setting directory [normal|simple]",
        };
      }

      return {
        action: "unknown",
        message: "Usage: /setting or /setting directory [normal|simple]",
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
      const list = context.modelCapabilities
        ? formatModelCapabilitiesList(context.modelCapabilities, context.runtime.model)
        : AVAILABLE_MODELS.map((model, index) => `  ${index + 1}. ${model}`).join("\n");
      const prefix = context.modelCapabilities
        ? "Available models"
        : "Available models (legacy fallback while runtime discovery is pending)";
      return {
        action: "models",
        message: `${prefix}:\n${list}\n\nCurrent: ${context.runtime.model}\nBackend: ${formatBackendLabel(context.runtime.provider)}`,
      };
    }

    case "backends": {
      const list = AVAILABLE_BACKENDS
        .map((item, index) => `  ${index + 1}. ${item.label} (${item.id})`)
        .join("\n");
      return {
        action: "backends",
        message: `Available backends:\n${list}\n\nCurrent: ${formatBackendLabel(context.runtime.provider)}`,
      };
    }

    case "workspace": {
      if (!arg) {
        return {
          action: "workspace",
          message: context.workspace.summaryMessage,
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

    case "config": {
      if (!arg || normalizedArg === "status") {
        return {
          action: "config_status",
          message: formatLayeredConfigStatus(context.config),
        };
      }

      if (normalizedArg === "trust" || normalizedArg === "trust status") {
        return {
          action: "config_trust_status",
          message: [
            "Project trust:",
            `  Root: ${context.config.diagnostics.projectRoot}`,
            `  Status: ${context.config.diagnostics.projectTrusted ? "Trusted" : "Untrusted"}`,
          ].join("\n"),
        };
      }

      if (normalizedArg === "trust on" || normalizedArg === "trust off") {
        return {
          action: "config_trust_set",
          value: normalizedArg.endsWith("on") ? "on" : "off",
          message: `Project trust ${normalizedArg.endsWith("on") ? "enabled" : "disabled"}.`,
        };
      }

      return {
        action: "unknown",
        message: "Unknown config command. Use /config, /config status, or /config trust [status|on|off].",
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

    case "status":
      return {
        action: "status",
        message: formatRuntimeStatus(context.resolvedRuntime, {
          workspaceRoot: context.workspace.root,
          tokensUsed: context.tokensUsed,
        }),
      };

    case "permissions": {
      if (!arg) {
        return { action: "open_permissions_panel" };
      }

      if (normalizedArg === "status") {
        return {
          action: "permissions_status",
          message: formatPermissionsStatus(
            context.runtime,
            context.resolvedRuntime,
            context.workspace.root,
          ),
        };
      }

      return handlePolicyCommand("/permissions", arg, context, false);
    }

    case "runtime": {
      if (!arg) {
        return {
          action: "status",
          message: formatRuntimeStatus(context.resolvedRuntime, {
            workspaceRoot: context.workspace.root,
            tokensUsed: context.tokensUsed,
          }),
        };
      }
      return handlePolicyCommand("/runtime", arg, context, true);
    }

    case "login":
      return { action: "login" };

    case "logout":
      return { action: "logout" };

    case "copy":
      return { action: "copy" };

    case "themes":
      return { action: "open_theme_picker" };

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
          "                     suggest = read-only-style prompting, auto-edit = file edits, full-auto = strongest autonomy",
          "  /reasoning [level] Set reasoning level (no arg opens picker)",
          "  /plan [on|off]     Show or toggle session plan mode",
          "  /setting           Open the settings picker",
          "  /setting directory [normal|simple] Control how the workspace path is displayed",
          "  /status            Show the effective runtime configuration",
          "  /config            Show layered config sources and winning values",
          "  /config trust [status|on|off] Manage whether project config is allowed to load",
          "  /permissions       Open or update permissions and sandbox controls",
          "  /permissions status",
          "  /permissions approval-policy [status|inherit|untrusted|on-request|never]",
          "  /permissions sandbox [status|inherit|read-only|workspace-write|danger-full-access]",
          "  /permissions network [status|inherit|on|off]",
          "  /permissions writable-roots [list|add <path>|remove <path>|clear]",
          "  /runtime ...       Inspect or update runtime policy controls",
          "                     Compatibility surface; /permissions is the primary entry point",
          "  /runtime approval-policy [status|inherit|untrusted|on-request|never]",
          "  /runtime sandbox [status|inherit|read-only|workspace-write|danger-full-access]",
          "  /runtime network [status|inherit|on|off]",
          "  /runtime writable-roots [list|add <path>|remove <path>|clear]",
          "  /runtime service-tier [status|flex|fast]",
          "  /runtime personality [status|none|friendly|pragmatic]",
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
          `  Current reasoning: ${formatReasoningLabel(context.runtime.reasoningLevel)}`,
          `  Current plan mode: ${context.runtime.planMode ? "Enabled" : "Disabled"}`,
          "  /copy              Copy last response to clipboard",
          "  /help              Show this help",
          "",
          "Install on Windows:",
          "  npm link           Make the codexa command available",
          "  where codexa       Verify the command resolves",
          "",
          "Shortcuts:",
          "  Ctrl+B    Open backend picker",
          "  Ctrl+O    Open model picker",
          "  Shift+Tab Toggle plan mode",
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
