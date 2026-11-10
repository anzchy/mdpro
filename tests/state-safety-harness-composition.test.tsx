import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H13 commits composition text through the real editor before save', async () => {
  const journey = await createAppJourney();
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    const composition = await journey.compose('文');
    expect(composition).toEqual({ wasComposing: true, ended: true });
    await journey.menu('file.save');
    const expected = content.replace(/b\n$/, 'b文\n');
    const expectedWrites = [
      { command: 'save_file', documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)] },
      { command: 'delete_draft', documentId: id, content: '', bytes: [] },
    ];
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
    await journey.advance(250);
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
  } finally {
    const writesBeforeToastExpiry = [...journey.boundary.writeLog];
    try {
      await journey.advance(3_000);
      expect(journey.boundary.writeLog).toEqual(writesBeforeToastExpiry);
    } finally {
      await journey.cleanup();
    }
  }
}, 15_000);

it('H13 composes the supplied multi-character CJK text once', async () => {
  const journey = await createAppJourney();
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    expect(await journey.compose('漢字')).toEqual({ wasComposing: true, ended: true });
    await journey.menu('file.save');
    const expected = content.replace(/b\n$/, 'b漢字\n');
    const expectedWrites = [
      { command: 'save_file', documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)] },
      { command: 'delete_draft', documentId: id, content: '', bytes: [] },
    ];
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
    await journey.advance(250);
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
  } finally {
    const writesBeforeToastExpiry = [...journey.boundary.writeLog];
    try {
      await journey.advance(3_000);
      expect(journey.boundary.writeLog).toEqual(writesBeforeToastExpiry);
    } finally {
      await journey.cleanup();
    }
  }
}, 15_000);

it('H13 leaves the editor unchanged for an empty composition input', async () => {
  const journey = await createAppJourney();
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    expect(await journey.compose('')).toEqual({ wasComposing: true, ended: true });
    await journey.menu('file.save');
    const expectedWrites = [
      { command: 'save_file', documentId: id, path, content, bytes: [...new TextEncoder().encode(content)] },
      { command: 'delete_draft', documentId: id, content: '', bytes: [] },
    ];
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
    await journey.advance(250);
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
  } finally {
    const writesBeforeToastExpiry = [...journey.boundary.writeLog];
    try {
      await journey.advance(3_000);
      expect(journey.boundary.writeLog).toEqual(writesBeforeToastExpiry);
    } finally {
      await journey.cleanup();
    }
  }
}, 15_000);
