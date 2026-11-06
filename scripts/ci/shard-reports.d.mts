/** Types for shard-reports.mjs exports used by strict TypeScript tests. */
export interface ShardMeta { os: string; shard: number; count: number; attempt: number; profile: string; sha: string }
export interface SelectedShard { shard: number; attempt: number; dir: string; meta: ShardMeta }
export declare function artifactName(os: string, shard: number | string, attempt: number | string): string;
export declare function describeShard(fields: Record<string, string>): ShardMeta;
export declare function selectShards(downloads: string, count: number, os: string): SelectedShard[];
export declare function collect(downloads: string, dest: string, count: number, os: string, sha: string): string;
export declare function checkMerged(downloads: string, count: number, os: string, merged: unknown, listed: unknown, root: string): { files: number; tests: number };
export declare function checkCollected(merged: unknown, collected: unknown, root: string): { files: number; tests: number };
export declare function checkShardLists(downloads: string, count: number, os: string, merged: unknown, root: string): { files: number; tests: number };
