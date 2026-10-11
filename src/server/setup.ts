import type { AgentId, DependencyCheck, SetupStatus } from "../shared/types.js";
import { agentIds, readAgentSettings, updateAgentSettings } from "./agentSettings.js";
import { CommandError, runCommand } from "./command.js";

interface DependencySpec {
  id: string;
  name: string;
  required: boolean;
  command: string;
  args: string[];
  installHint: string;
  versionFrom?: "stdout" | "stderr" | "both";
  input?: string;
  timeoutMs?: number;
  /** Agent CLI group. Readiness needs every check of at least one agent group to pass. */
  group?: AgentId;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const dependencies = await Promise.all(dependencySpecs().map(checkDependency));
  // An auth probe cannot pass when its CLI is missing; say that instead of "installed but not signed in".
  for (const agent of agentIds) {
    const cli = dependencies.find((item) => item.id === agent);
    const auth = dependencies.find((item) => item.id === `${agent}-auth`);
    if (cli && auth && !cli.installed && !auth.installed) {
      auth.details = `Not checked: the \`${agent}\` CLI is not installed or not on PATH.`;
      auth.installHint = `Install the ${cli.name} first (see above), then sign in.`;
    }
  }
  let settings = await readAgentSettings();
  const availableAgents = agentIds.filter((agent) => agentReady(dependencies, agent));
  // Never-configured install: prefer an agent that is actually installed and signed in over the default.
  if (availableAgents.length > 0 && !availableAgents.includes(settings.agent) && settings.updatedAt === new Date(0).toISOString()) {
    settings = await updateAgentSettings({ agent: availableAgents[0] });
  }
  return {
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    ready: dependencies.filter((item) => item.required && !item.group).every((item) => item.installed) && availableAgents.length > 0,
    dependencies,
    availableAgents,
    selectedAgent: settings.agent
  };
}

export function agentReady(dependencies: DependencyCheck[], agent: AgentId): boolean {
  const members = dependencies.filter((item) => item.group === agent);
  return members.length > 0 && members.every((item) => item.installed);
}

function dependencySpecs(): DependencySpec[] {
  return [
    {
      id: "git",
      name: "Git",
      required: true,
      command: "git",
      args: ["--version"],
      installHint: platformHint({
        darwin: "Install Xcode Command Line Tools with `xcode-select --install`, or install Git with Homebrew: `brew install git`.",
        win32: "Install Git for Windows, then reopen the app so `git` is on PATH.",
        linux: "Install Git with your package manager, for example `sudo apt install git`."
      })
    },
    {
      id: "gh",
      name: "GitHub CLI",
      required: true,
      command: "gh",
      args: ["--version"],
      installHint: platformHint({
        darwin: "Install with Homebrew: `brew install gh`.",
        win32: "Install with Winget: `winget install GitHub.cli`, or download GitHub CLI for Windows.",
        linux: "Install GitHub CLI from your distro package manager or GitHub's official package repository."
      })
    },
    {
      id: "codex",
      name: "Codex CLI",
      required: true,
      group: "codex",
      command: "codex",
      args: ["--version"],
      installHint: platformHint({
        darwin: "Install the Codex CLI, for example with Homebrew (`brew install codex`) or npm, and make sure `codex` is on PATH. Then verify it can authenticate before analyzing or fixing PRs.",
        win32: "Install the Codex CLI with npm or your preferred package manager, then reopen MNLens so `codex` is on PATH. Then verify it can authenticate before analyzing or fixing PRs.",
        linux: "Install the Codex CLI with npm, Homebrew/Linuxbrew, or your preferred package manager, and make sure `codex` is on PATH. Then verify it can authenticate before analyzing or fixing PRs."
      })
    },
    {
      id: "codex-auth",
      name: "Codex authentication",
      required: true,
      group: "codex",
      command: "codex",
      args: ["--ask-for-approval", "never", "exec", "--skip-git-repo-check", "--sandbox", "read-only", "-"],
      input: "Reply with exactly: OK",
      timeoutMs: 20000,
      installHint: "Codex is installed, but a live auth/model check failed. Re-authenticate Codex (`codex login`) or fix the configured provider credentials before using Analyze or Fix with Codex."
    },
    {
      id: "claude",
      name: "Claude Code CLI",
      required: true,
      group: "claude",
      command: "claude",
      args: ["--version"],
      installHint: platformHint({
        darwin: "Install Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`, `brew install --cask claude-code`, or `npm install -g @anthropic-ai/claude-code`) and make sure `claude` is on PATH, then run `claude auth login`.",
        win32: "Install Claude Code (`npm install -g @anthropic-ai/claude-code` or the native installer), reopen MNLens so `claude` is on PATH, then run `claude auth login`.",
        linux: "Install Claude Code (`curl -fsSL https://claude.ai/install.sh | bash` or `npm install -g @anthropic-ai/claude-code`) and make sure `claude` is on PATH, then run `claude auth login`."
      })
    },
    {
      id: "claude-auth",
      name: "Claude Code authentication",
      required: true,
      group: "claude",
      command: "claude",
      args: ["auth", "status"],
      timeoutMs: 20000,
      installHint: "Claude Code is installed but not signed in. Run `claude auth login` (subscription) or `claude auth login --console` / set ANTHROPIC_API_KEY (API billing) before using Analyze or Fix with Claude."
    },
    credentialStoreSpec(),
    {
      id: "java",
      name: "Java",
      required: false,
      command: "java",
      args: ["-version"],
      versionFrom: "stderr",
      installHint: platformHint({
        darwin: "Install a JDK, for example with SDKMAN or Homebrew: `brew install openjdk`.",
        win32: "Install a JDK such as Eclipse Temurin or Oracle JDK, then reopen the app so `java` is on PATH.",
        linux: "Install a JDK with your package manager, for example `sudo apt install openjdk-21-jdk`."
      })
    },
    {
      id: "gradle",
      name: "Gradle",
      required: false,
      command: "gradle",
      args: ["--version"],
      installHint: "Optional when a repo has `./gradlew`. Install Gradle with SDKMAN, Homebrew, Winget, or your package manager if you review Gradle repos without wrappers."
    },
    {
      id: "maven",
      name: "Maven",
      required: false,
      command: "mvn",
      args: ["--version"],
      installHint: "Optional when a repo has `./mvnw`. Install Maven with SDKMAN, Homebrew, Winget, or your package manager if you review Maven repos without wrappers."
    },
    {
      id: "agent-browser",
      name: "Agent Browser CLI",
      required: false,
      command: "agent-browser",
      args: ["--version"],
      installHint: platformHint({
        darwin: "Install with npm: `npm install -g agent-browser`. Required for Build docs + screenshot artifacts.",
        win32: "Install with npm: `npm install -g agent-browser`. Required for Build docs + screenshot artifacts.",
        linux: "Install with npm: `npm install -g agent-browser`. Required for Build docs + screenshot artifacts."
      })
    }
  ];
}

async function checkDependency(spec: DependencySpec): Promise<DependencyCheck> {
  try {
    const result = await runCommand(spec.command, spec.args, { timeoutMs: spec.timeoutMs ?? 5000, input: spec.input });
    const output = spec.versionFrom === "stderr" ? result.stderr : spec.versionFrom === "both" ? `${result.stdout}\n${result.stderr}` : result.stdout;
    return {
      id: spec.id,
      name: spec.name,
      required: spec.required,
      installed: true,
      version: spec.id === "claude-auth" ? summarizeClaudeAuth(output) : firstUsefulLine(output),
      installHint: spec.installHint,
      group: spec.group
    };
  } catch (error) {
    const details = error instanceof CommandError ? failureDetails(spec, `${error.result.stdout}\n${error.result.stderr}`) : error instanceof Error ? error.message : String(error);
    return {
      id: spec.id,
      name: spec.name,
      required: spec.required,
      installed: false,
      details,
      installHint: spec.installHint,
      group: spec.group
    };
  }
}

function credentialStoreSpec(): DependencySpec {
  if (process.platform === "darwin") {
    return {
      id: "secure-store",
      name: "macOS Keychain",
      required: true,
      command: "security",
      args: ["list-keychains"],
      installHint: "macOS Keychain is built in. If this fails, check that the `security` command is available in `/usr/bin`."
    };
  }
  if (process.platform === "win32") {
    return {
      id: "secure-store",
      name: "Windows Credential Manager",
      required: true,
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", "Get-Command cmdkey | Out-Null; Write-Output 'Windows Credential Manager available'"],
      installHint: "Windows Credential Manager is built in. If this fails, make sure PowerShell is available."
    };
  }
  if (process.platform === "linux") {
    return {
      id: "secure-store",
      name: "Linux Secret Service",
      required: true,
      command: "secret-tool",
      args: ["--version"],
      installHint: "Install libsecret tools and make sure a Secret Service provider is running, for example `sudo apt install libsecret-tools gnome-keyring`."
    };
  }
  return {
    id: "secure-store",
    name: "Secure credential store",
    required: true,
    command: "__unsupported_secure_store__",
    args: ["--version"],
    installHint: `Automatic secure token setup is not supported on ${process.platform}. Use GitHub CLI authentication manually.`
  };
}

function platformHint(hints: Partial<Record<NodeJS.Platform, string>>): string {
  return hints[process.platform] ?? "Install this command and make sure it is available on PATH, then restart the app.";
}

export function summarizeClaudeAuth(output: string): string | undefined {
  try {
    const parsed = JSON.parse(output.trim()) as { loggedIn?: boolean; authMethod?: string; email?: string; subscriptionType?: string };
    if (parsed && typeof parsed === "object") {
      const parts = [parsed.authMethod ? `auth: ${parsed.authMethod}` : undefined, parsed.email, parsed.subscriptionType].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : "signed in";
    }
  } catch {
    // Older CLI versions print text; fall through.
  }
  return firstUsefulLine(output) ?? "signed in";
}

function firstUsefulLine(value: string): string | undefined {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !/^-+$/.test(line))
    .find(Boolean);
}

function failureDetails(spec: DependencySpec, output: string): string | undefined {
  const lines = usefulLines(output);
  if (spec.id !== "codex-auth" && spec.id !== "claude-auth") return lines[0];
  const priority = lines.filter((line) => /\b(ERROR|Unauthorized|NotAuthenticated|authentication|auth|credential|provider)\b/i.test(line));
  return (priority.length > 0 ? priority : lines).slice(0, 6).join("\n");
}

function usefulLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^-+$/.test(line));
}
