import { generateCorpus } from './generation.ts';
import { parseArguments } from './arguments.ts';
try {
  const result = await generateCorpus(parseArguments(process.argv.slice(2)));
  process.stdout.write(`corpus generated: ${result.changed.length} changed cases; scratch ${result.scratch}\n`);
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
