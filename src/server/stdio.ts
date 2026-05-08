export function installStdioGuards(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") throw error;
    });
  }
  process.on("uncaughtException", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") return;
    throw error;
  });
}
