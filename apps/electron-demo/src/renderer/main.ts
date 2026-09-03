import { renderStartupFailure } from "./startup-failure";

void import("./app").then(({ boot }) => boot()).catch(() => {
  console.error("Nexus renderer failed to start [renderer-startup-failed]");
  renderStartupFailure();
});
