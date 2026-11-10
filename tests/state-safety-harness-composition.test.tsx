import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H13 commits composition text through the real editor before save', async () => {
  const journey = await createAppJourney();
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    await journey.compose('文');
    await journey.menu('file.save');
    await journey.advance(1_000);
    const expected = content.replace(/b\n$/, 'b文\n');
    expect(journey.boundary.writeLog.filter(write => write.command === 'save_file')).toMatchObject([
      { documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)] },
    ]);
  } finally { await journey.cleanup(); }
}, 15_000);
