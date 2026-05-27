// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  output: "static",
  site: "https://el-humboldtiano2.vercel.app",
  integrations: [
    sitemap({
      // Exclude the client-side search page — no static SEO value.
      filter: (page) => !page.includes("/buscar"),
      // The integration strips non-HTML pages by default.
      // Add RSS feed explicitly since it's a valid crawl target.
      customPages: ["https://el-humboldtiano2.vercel.app/rss.xml"],
    }),
  ],
});
