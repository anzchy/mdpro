import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H3 logs startup non-write IPC with its arguments', async () => {
  const journey = await createAppJourney();
  try {
    expect(journey.boundary.calls).toContainEqual({ command: 'get_preferences', args: {} });
    expect(journey.boundary.writeLog).toEqual([]);
  } finally { await journey.cleanup(); }
}, 15_000);

it('H6 rejects an unmodelled IPC command and records the attempt', async () => {
  const journey = await createAppJourney();
  await expect(journey.boundary.invoke('unexpected_command', { id: 'x' })).rejects.toThrow('unmodelled App IPC: unexpected_command');
  expect(journey.boundary.calls).toContainEqual({ command: 'unexpected_command', args: { id: 'x' } });
  expect(journey.boundary.writeLog).toEqual([]);
  await expect(journey.cleanup()).rejects.toThrow(/unmodelled App IPC attempts: unexpected_command/);
}, 15_000);
