import { useEffect, useState } from "react";
import { exportService } from "../services/exportService";

export function usePreview(markdown: string, delay = 100) {
  const [html, setHtml] = useState("");
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    let active = true;
    setIsRendering(true);

    const handle = window.setTimeout(() => {
      exportService
        .renderMarkdown(markdown)
        .then((result) => {
          if (active) {
            setHtml(result);
          }
        })
        .finally(() => {
          if (active) {
            setIsRendering(false);
          }
        });
    }, delay);

    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [markdown, delay]);

  return { html, isRendering };
}
