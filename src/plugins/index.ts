import { pluginRegistry } from "./core/pluginRegistry";
import { highlightPlugin } from "./codemirror/highlightPlugin";
import { headingPlugin } from "./codemirror/headingPlugin";
import { linkPlugin } from "./codemirror/linkPlugin";
import { wysiwygDecorationsPlugin } from "./codemirror/wysiwygDecorationsPlugin";
import { focusModePlugin } from "./codemirror/focusModePlugin";
import { typewriterModePlugin } from "./codemirror/typewriterModePlugin";
import { spellCheckPlugin } from "./codemirror/spellCheckPlugin";
import { inlineEditPlugin } from "./milkdown/inlineEditPlugin";
import { typoraKeymapPlugin } from "./milkdown/typoraKeymapPlugin";
import { imagePastePlugin } from "./milkdown/imagePastePlugin";

pluginRegistry.register(highlightPlugin);
pluginRegistry.register(headingPlugin);
pluginRegistry.register(linkPlugin);
pluginRegistry.register(wysiwygDecorationsPlugin);
pluginRegistry.register(focusModePlugin);
pluginRegistry.register(typewriterModePlugin);
pluginRegistry.register(spellCheckPlugin);
pluginRegistry.register(inlineEditPlugin);
pluginRegistry.register(typoraKeymapPlugin);
pluginRegistry.register(imagePastePlugin);

export { pluginRegistry };
