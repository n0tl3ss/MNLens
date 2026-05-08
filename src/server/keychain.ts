import { CommandError, runCommand } from "./command.js";

const keychainAccount = "github-mcp-token";
const keychainService = "multicode.github";
const windowsCredentialTypeGeneric = "1";

export async function readGithubToken(): Promise<string | undefined> {
  if (process.platform === "darwin") return readMacosToken();
  if (process.platform === "win32") return readWindowsToken();
  if (process.platform === "linux") return readLinuxToken();
  return undefined;
}

export async function storeGithubToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("GitHub token cannot be empty.");
  if (process.platform === "darwin") {
    await runCommand("security", ["add-generic-password", "-U", "-a", keychainAccount, "-s", keychainService, "-w", trimmed], { redact: [trimmed] });
    return;
  }
  if (process.platform === "linux") {
    await runCommand("secret-tool", ["store", "--label", "GitHub token for MNLens", "service", keychainService, "account", keychainAccount], {
      input: trimmed,
      redact: [trimmed]
    });
    return;
  }
  if (process.platform === "win32") {
    await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsWriteScript()], { input: trimmed, redact: [trimmed] });
    return;
  }
  throw new Error(`Secure GitHub token setup is not supported on ${process.platform}.`);
}

export function tokenStoreInfo(): {
  tokenStore: "macos-keychain" | "windows-credential-manager" | "linux-secret-service" | "unsupported";
  setupSupported: boolean;
  setupHint: string;
} {
  if (process.platform === "darwin") {
    return {
      tokenStore: "macos-keychain",
      setupSupported: true,
      setupHint: keychainHint()
    };
  }
  if (process.platform === "win32") {
    return {
      tokenStore: "windows-credential-manager",
      setupSupported: true,
      setupHint: "The app stores the token as a Generic Credential named multicode.github in Windows Credential Manager."
    };
  }
  if (process.platform === "linux") {
    return {
      tokenStore: "linux-secret-service",
      setupSupported: true,
      setupHint: [
        "The app stores the token with libsecret Secret Service using secret-tool.",
        "Install libsecret/secret-tool if setup fails, for example: sudo apt install libsecret-tools"
      ].join("\n")
    };
  }
  return {
    tokenStore: "unsupported",
    setupSupported: false,
    setupHint: `Secure token setup is not supported automatically on ${process.platform}. Set up gh authentication manually.`
  };
}

export function missingGithubTokenMessage(): string {
  const store = tokenStoreInfo();
  return `Missing GitHub token in ${tokenStoreLabel(store.tokenStore)}.\n\n${store.setupHint}`;
}

export function tokenStoreLabel(store: ReturnType<typeof tokenStoreInfo>["tokenStore"]): string {
  if (store === "macos-keychain") return "macOS Keychain";
  if (store === "windows-credential-manager") return "Windows Credential Manager";
  if (store === "linux-secret-service") return "Linux Secret Service";
  return "a supported secure store";
}

async function readMacosToken(): Promise<string | undefined> {
  try {
    const result = await runCommand("security", [
      "find-generic-password",
      "-a",
      keychainAccount,
      "-s",
      keychainService,
      "-w"
    ]);
    const token = result.stdout.trim();
    return token.length > 0 ? token : undefined;
  } catch (error) {
    if (error instanceof CommandError) return undefined;
    throw error;
  }
}

async function readLinuxToken(): Promise<string | undefined> {
  try {
    const result = await runCommand("secret-tool", ["lookup", "service", keychainService, "account", keychainAccount]);
    const token = result.stdout.trim();
    return token.length > 0 ? token : undefined;
  } catch (error) {
    if (error instanceof CommandError || isCommandMissing(error)) return undefined;
    throw error;
  }
}

async function readWindowsToken(): Promise<string | undefined> {
  try {
    const result = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsReadScript()]);
    const token = result.stdout.trim();
    return token.length > 0 ? token : undefined;
  } catch (error) {
    if (error instanceof CommandError || isCommandMissing(error)) return undefined;
    throw error;
  }
}

export function keychainHint(): string {
  return [
    "security add-generic-password -U \\",
    "  -a github-mcp-token \\",
    "  -s multicode.github \\",
    "  -w 'YOUR_GITHUB_PAT'"
  ].join("\n");
}

function isCommandMissing(error: unknown): boolean {
  return error instanceof Error && ("code" in error ? (error as NodeJS.ErrnoException).code === "ENOENT" : /ENOENT|not found/i.test(error.message));
}

function windowsReadScript(): string {
  return `
$signature = @"
using System;
using System.Runtime.InteropServices;
public class CredMan {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError=true)]
  public static extern void CredFree(IntPtr buffer);
}
"@
Add-Type $signature
$ptr = [IntPtr]::Zero
if ([CredMan]::CredRead("${keychainService}", ${windowsCredentialTypeGeneric}, 0, [ref]$ptr)) {
  $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredMan+CREDENTIAL])
  if ($cred.CredentialBlobSize -gt 0) {
    [Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, $cred.CredentialBlobSize / 2)
  }
  [CredMan]::CredFree($ptr)
}
`;
}

function windowsWriteScript(): string {
  return `
$signature = @"
using System;
using System.Runtime.InteropServices;
public class CredMan {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
}
"@
Add-Type $signature
$secret = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($secret)) { throw "GitHub token cannot be empty." }
$bytes = [Text.Encoding]::Unicode.GetBytes($secret.Trim())
$blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
try {
  [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
  $cred = New-Object CredMan+CREDENTIAL
  $cred.Type = ${windowsCredentialTypeGeneric}
  $cred.TargetName = "${keychainService}"
  $cred.UserName = "${keychainAccount}"
  $cred.CredentialBlobSize = $bytes.Length
  $cred.CredentialBlob = $blob
  $cred.Persist = 2
  if (-not [CredMan]::CredWrite([ref]$cred, 0)) {
    throw ([ComponentModel.Win32Exception][Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message
  }
} finally {
  [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
}
`;
}
