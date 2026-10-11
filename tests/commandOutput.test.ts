import { describe, expect, it, vi } from "vitest";
import { appendTerminalOutput, formatElapsed, formatTimeout, silenceHeartbeat } from "../src/server/command.js";

describe("terminal-style log appends", () => {
  it("replaces the current line on a bare carriage return (git progress)", () => {
    let log = appendTerminalOutput("", "Cloning into 'x'...\n");
    log = appendTerminalOutput(log, "Receiving objects:  10% (1/10)\rReceiving objects:  50% (5/10)\r");
    expect(log).toBe("Cloning into 'x'...\nReceiving objects:  50% (5/10)\r");
    log = appendTerminalOutput(log, "Receiving objects: 100% (10/10), done.\n");
    expect(log).toBe("Cloning into 'x'...\nReceiving objects: 100% (10/10), done.\n");
  });

  it("treats CRLF as a newline and survives chunks split mid-sequence", () => {
    let log = appendTerminalOutput("", "a\r\nb");
    log = appendTerminalOutput(log, "\rc\n");
    expect(log).toBe("a\nc\n");
  });

  it("formats timeouts and elapsed time for humans", () => {
    expect(formatTimeout(600_000)).toBe("10 min");
    expect(formatTimeout(90_000)).toBe("1.5 min");
    expect(formatTimeout(20_000)).toBe("20 s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(4_000)).toBe("4s");
  });

  it("reports silence only while no output arrives", () => {
    vi.useFakeTimers();
    const silent: number[] = [];
    const beat = silenceHeartbeat((elapsed) => silent.push(elapsed), 1000);
    vi.advanceTimersByTime(1000);
    expect(silent).toHaveLength(1);
    vi.advanceTimersByTime(500);
    beat.touch();
    vi.advanceTimersByTime(500);
    expect(silent).toHaveLength(1); // output arrived 500 ms ago; not a full interval of silence
    vi.advanceTimersByTime(1000);
    expect(silent).toHaveLength(2);
    beat.stop();
    vi.advanceTimersByTime(5000);
    expect(silent).toHaveLength(2);
    vi.useRealTimers();
  });
});
