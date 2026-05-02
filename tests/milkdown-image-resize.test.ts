import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  applyImageWidthMarkerToHtml,
  findImageNodePosition,
  getImageResizeDomAttrs,
  getImageWidthPercentFromTitle,
  normalizeImageWidthPercent,
  setImageWidthPercentAtPos,
  stripImageWidthMarker,
  writeImageWidthMarker,
} from "../src/plugins/milkdown/imageResizePlugin";

const ROOT = path.resolve(__dirname, "..");

describe("Milkdown image responsive sizing CSS", () => {
  const css = fs.readFileSync(
    path.join(ROOT, "src/components/Editor/MilkdownEditor.css"),
    "utf8",
  );

  it("constrains WYSIWYG images to the ProseMirror content width", () => {
    expect(css).toMatch(/\.milkdown-editor\s+\.ProseMirror\s+img\s*\{/);
    expect(css).toMatch(/max-width:\s*100%/);
    expect(css).toMatch(/height:\s*auto/);
  });

  it("styles the selected right-click image without global CSS", () => {
    expect(css).toMatch(/img\[data-mdpro-image-selected="true"\]/);
    expect(css).toMatch(/outline:\s*2px\s+solid\s+var\(--color-accent\)/);
  });
});

describe("image width marker helpers", () => {
  it("parses a width marker from the image title", () => {
    expect(getImageWidthPercentFromTitle("{mdpro-width=50%}")).toBe(50);
    expect(getImageWidthPercentFromTitle("Diagram {mdpro-width=75%}")).toBe(75);
    expect(getImageWidthPercentFromTitle("Diagram")).toBeNull();
  });

  it("preserves normal title text when writing and stripping markers", () => {
    expect(writeImageWidthMarker("Diagram", 50)).toBe("Diagram {mdpro-width=50%}");
    expect(writeImageWidthMarker("Diagram {mdpro-width=25%}", 75)).toBe(
      "Diagram {mdpro-width=75%}",
    );
    expect(stripImageWidthMarker("Diagram {mdpro-width=75%}")).toBe("Diagram");
    expect(writeImageWidthMarker("Diagram {mdpro-width=75%}", null)).toBe("Diagram");
  });

  it("normalizes custom percentages inside the supported range", () => {
    expect(normalizeImageWidthPercent("50%")).toBe(50);
    expect(normalizeImageWidthPercent("67.4")).toBe(67);
    expect(normalizeImageWidthPercent(200)).toBe(200);
    expect(normalizeImageWidthPercent("0")).toBeNull();
    expect(normalizeImageWidthPercent("201")).toBeNull();
    expect(normalizeImageWidthPercent("wide")).toBeNull();
  });

  it("returns DOM attrs that make explicit image sizes responsive to the content box", () => {
    expect(
      getImageResizeDomAttrs({
        type: { name: "image" },
        attrs: { title: "Diagram {mdpro-width=50%}" },
      }),
    ).toEqual({
      title: "Diagram",
      "data-mdpro-image-width": "50",
      style: "width: 50%; max-width: none; height: auto;",
    });
  });

  it("strips the bare marker so the editor tooltip never shows it", () => {
    expect(
      getImageResizeDomAttrs({
        type: { name: "image" },
        attrs: { title: "{mdpro-width=75%}" },
      }),
    ).toEqual({
      "data-mdpro-image-width": "75",
      style: "width: 75%; max-width: none; height: auto;",
    });
  });
});

describe("applyImageWidthMarkerToHtml", () => {
  it("rewrites img tags so the marker never reaches preview/export", () => {
    const out = applyImageWidthMarkerToHtml(
      `<p><img src="a.png" alt="a" title="caption {mdpro-width=50%}"></p>`,
    );
    expect(out).not.toContain("{mdpro-width=");
    expect(out).toContain('title="caption"');
    expect(out).toContain('data-mdpro-image-width="50"');
    expect(out).toContain("width: 50%");
  });

  it("removes the title attribute when only the marker was present", () => {
    const out = applyImageWidthMarkerToHtml(
      `<img src="a.png" alt="a" title="{mdpro-width=25%}">`,
    );
    expect(out).not.toMatch(/title=/);
    expect(out).toContain('data-mdpro-image-width="25"');
  });

  it("leaves unrelated images and out-of-range values alone", () => {
    const out = applyImageWidthMarkerToHtml(
      `<img src="a.png" alt="a" title="caption {mdpro-width=999%}">`,
    );
    expect(out).toContain("{mdpro-width=999%}");
    expect(out).not.toContain("data-mdpro-image-width");
  });

  it("is a no-op when no marker is present", () => {
    const html = `<img src="a.png" alt="a" title="caption">`;
    expect(applyImageWidthMarkerToHtml(html)).toBe(html);
  });
});

describe("image resize ProseMirror helpers", () => {
  it("finds the image node position from a right-clicked DOM image", () => {
    const image = document.createElement("img");
    const view = {
      posAtDOM: vi.fn(() => 4),
      state: {
        doc: {
          nodeAt: vi.fn((pos: number) =>
            pos === 4 ? { type: { name: "image" }, attrs: { title: "" } } : null,
          ),
        },
      },
    } as unknown as EditorView;

    expect(findImageNodePosition(view, image)).toBe(4);
  });

  it("updates the selected image title marker through setNodeMarkup", () => {
    const imageNode = {
      type: { name: "image" },
      attrs: { src: "assets/a.png", alt: "a", title: "Old" },
    };
    const tr = {
      setNodeMarkup: vi.fn().mockReturnThis(),
      scrollIntoView: vi.fn().mockReturnThis(),
    };
    const dispatch = vi.fn();
    const view = {
      dispatch,
      state: {
        tr,
        doc: { nodeAt: vi.fn(() => imageNode) },
      },
    } as unknown as EditorView;

    expect(setImageWidthPercentAtPos(view, 3, 25)).toBe(true);
    expect(tr.setNodeMarkup).toHaveBeenCalledWith(3, undefined, {
      src: "assets/a.png",
      alt: "a",
      title: "Old {mdpro-width=25%}",
    });
    expect(dispatch).toHaveBeenCalledWith(tr);
  });
});
