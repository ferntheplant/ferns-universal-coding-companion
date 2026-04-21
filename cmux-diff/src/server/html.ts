export function renderViewerHtml(bootstrapJson: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>cmux-diff review</title>
    <link rel="stylesheet" href="/assets/viewer.css" />
  </head>
  <body>
    <div id="root">Loading cmux-diff review…</div>
    <script>
      window.__CMUX_DIFF_BOOTSTRAP__ = ${bootstrapJson};
    </script>
    <script type="module" src="/assets/viewer.js"></script>
  </body>
</html>`;
}
