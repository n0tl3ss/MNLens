import { installStdioGuards } from "./stdio.js";

installStdioGuards();

const { startServer } = await import("./app.js");

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
