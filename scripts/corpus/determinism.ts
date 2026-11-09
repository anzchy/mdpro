/** Independent generation validates twice without merging either run into the authored fixture tree. */
import { join } from 'node:path';
import { generateCorpus, type GenerationOptions, type GenerationDependencies } from './generation.ts';
import { compareScratchTrees } from './scratch.ts';
export async function determinismCorpus(options: GenerationOptions = {}, dependencies: GenerationDependencies = {}): Promise<void> {
  const first = await generateCorpus({ ...options, scratch: options.scratch ? join(options.scratch, 'first') : undefined, merge: false }, dependencies);
  const second = await generateCorpus({ ...options, scratch: options.scratch ? join(options.scratch, 'second') : undefined, merge: false }, dependencies);
  compareScratchTrees(first.scratch, second.scratch);
}
