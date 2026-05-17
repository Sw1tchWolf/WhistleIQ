import { getLiveSyncDefaults, syncLiveDataset } from "../data/liveSync.js";

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    const trimmed = arg.replace(/^--/, "");
    const [key, rawValue] = trimmed.split("=");
    args[key] = rawValue ?? "true";
  });
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const defaults = getLiveSyncDefaults();
  const from = args.from || defaults.from;
  const to = args.to || defaults.to;
  const maxGames = args["max-games"] === undefined ? defaults.maxGames : Number(args["max-games"]);
  await syncLiveDataset({ from, to, maxGames });
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
