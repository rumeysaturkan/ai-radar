import { runResearchAgent } from "./agent/research-agent.js";

async function main() {
  const query = process.argv.slice(2).join(" ") || "AI agent memory";

  console.log(`Researching: ${query}\n`);

  const report = await runResearchAgent(query);

  console.log("\n=== Research Report ===\n");
  console.log(report);
}

main();
