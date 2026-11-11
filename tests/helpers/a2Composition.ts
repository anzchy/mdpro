import { act, fireEvent } from '@testing-library/react';
import type { createAppJourney } from './appJourneyHarness';

type Journey = Awaited<ReturnType<typeof createAppJourney>>;

/** Emulate the browser's contenteditable insertion while jsdom dispatches IME events. */
export async function beginA2Composition(j: Journey, text: string, targetSelector: string): Promise<() => Promise<void>> {
  const editor = j.view.container.querySelector<HTMLElement>('[contenteditable="true"]');
  const target = editor?.querySelector<HTMLElement>(targetSelector);
  if (!editor || !target) throw new Error(`composition target absent: ${targetSelector}`);
  await act(async () => {
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    editor.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: text }));
    editor.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, inputType: 'insertCompositionText', data: text, isComposing: true,
    }));
    fireEvent.input(target, {
      target: { textContent: `${target.textContent ?? ''}${text}` },
      bubbles: true, inputType: 'insertCompositionText', data: text, isComposing: true,
    });
  });
  return async () => {
    await act(async () => {
      editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
    });
  };
}
