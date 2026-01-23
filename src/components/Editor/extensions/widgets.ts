// TODO(003-redesign-plugin-system): Deprecated. Use src/plugins/codemirror/wysiwygDecorationsPlugin.ts instead.
import { WidgetType } from "@codemirror/view";

class InlineMarkerWidget extends WidgetType {
  constructor(private readonly text: string, private readonly className: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = this.className;
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

export const headingWidget = (level: number) =>
  new InlineMarkerWidget(`H${level}`, "wysiwyg-marker wysiwyg-heading");

export const listWidget = (marker: string) =>
  new InlineMarkerWidget(marker, "wysiwyg-marker wysiwyg-list");

export const quoteWidget = () =>
  new InlineMarkerWidget(">", "wysiwyg-marker wysiwyg-quote");

export const codeFenceWidget = () =>
  new InlineMarkerWidget("```", "wysiwyg-marker wysiwyg-code");
