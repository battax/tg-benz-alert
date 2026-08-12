import { runCheck } from "./job.js";

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
