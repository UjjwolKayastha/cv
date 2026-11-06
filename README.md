# CV

Ujjwol Kayastha's CV. One source file, one web page, and a PDF printed from that same page.

- **Edit:** `cv.yaml` (content), `template/` (design)
- **Build:** `npm ci && npm run build`, output in `dist/`
- **Deploy:** every push to `main` publishes the page to GitHub Pages and the PDF to the `latest` release

The build fails if the PDF stops being exactly two A4 pages.
