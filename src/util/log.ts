export const color = {
  dim: (text: string) => `\u001b[2m${text}\u001b[0m`,
  cyan: (text: string) => `\u001b[36m${text}\u001b[0m`,
  green: (text: string) => `\u001b[32m${text}\u001b[0m`,
  yellow: (text: string) => `\u001b[33m${text}\u001b[0m`,
  bold: (text: string) => `\u001b[1m${text}\u001b[0m`,
};

let stepIndex = 0;
let stepStartedAt = 0;

export function banner(title: string, subtitle: string): void {
  console.log("");
  console.log(color.bold(color.cyan(`  ${title}`)));
  console.log(color.dim(`  ${subtitle}`));
  console.log("");
}

export function step(label: string): void {
  stepIndex += 1;
  stepStartedAt = Date.now();
  process.stdout.write(color.dim(`  ${stepIndex}. `) + label + " ");
}

export function done(summary: string): void {
  const seconds = ((Date.now() - stepStartedAt) / 1000).toFixed(1);
  console.log(`${color.green("✓")} ${summary} ${color.dim(`(${seconds}s)`)}`);
}

export function note(text: string): void {
  console.log(color.dim(`     ${text}`));
}

export function warn(text: string): void {
  console.log(`     ${color.yellow("!")} ${color.dim(text)}`);
}

export function result(label: string, value: string): void {
  console.log(`  ${color.dim(label)} ${color.bold(value)}`);
}
