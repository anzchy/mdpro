/** Parse literal flags only; child commands always use argv arrays, never a shell command string. */
import type { GenerationOptions } from './generation.ts';
export function parseArguments(args: readonly string[], allowed = ['--root', '--scratch', '--cases', '--observations', '--bootstrap-serialized']): GenerationOptions {
  const options: GenerationOptions = {}, seen = new Set<string>(), observations: Record<string, string[]> = {}, bootstrapSerialized: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!allowed.includes(flag)) throw new Error(`unknown argument ${flag}`);
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag !== '--observations' && flag !== '--bootstrap-serialized' && seen.has(flag)) throw new Error(`duplicate argument ${flag}`);
    seen.add(flag);
    if (flag === '--root') options.root = value;
    else if (flag === '--scratch') options.scratch = value;
    else if (flag === '--cases') options.caseIds = value.split(',');
    else if (flag === '--bootstrap-serialized') bootstrapSerialized.push(value);
    else {
      const parts = value.split(':');
      if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('--observations requires caseId:kind');
      (observations[parts[0]] ??= []).push(parts[1]);
    }
  }
  if (Object.keys(observations).length) options.observations = observations as NonNullable<GenerationOptions['observations']>;
  if (bootstrapSerialized.length) options.bootstrapSerialized = bootstrapSerialized;
  return options;
}
