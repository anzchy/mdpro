import type { MdproPluginConfig } from "./pluginTypes";

export const defaultPluginConfig: MdproPluginConfig = {
  "source-format": { enabled: true },
  "highlight": {
    enabled: true,
    options: {
      openTag: "<mark style=\"background: #FF5582A6;\">",
      closeTag: "</mark>",
    },
  },
  "heading": {
    enabled: true,
  },
  "link": {
    enabled: true,
  },
  "wysiwyg-decorations": {
    enabled: true,
    options: {
      hideHeadings: true,
      hideLists: true,
      hideQuotes: true,
      hideCodeFences: true,
    },
  },
  "inline-edit": {
    enabled: true,
  },
  "typora-keymap": {
    enabled: true,
  },
  "focus-mode": {
    enabled: false,
    options: {
      dimOpacity: 0.3,
    },
  },
  "typewriter-mode": {
    enabled: false,
    options: {
      scrollOffset: 0.5,
    },
  },
  "spell-check": {
    enabled: false,
    options: {
      language: "en-US",
    },
  },
  "image-paste": {
    enabled: true,
  },
};
