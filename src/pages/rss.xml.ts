import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getArticles } from "../content/utils";

export const GET: APIRoute = async (context) => {
  const articles = await getArticles();
  articles.sort(
    (a, b) => b.data.publishDate.getTime() - a.data.publishDate.getTime(),
  );

  return rss({
    title: "El Humboldtiano",
    description:
      "Periódico Virtual de la Universidad Alejandro de Humboldt",
    site: context.site ?? "https://el-humboldtiano2.vercel.app",
    items: articles.map((article) => ({
      title: article.data.title,
      description:
        article.data.resumen ||
        `Artículo de ${article.data.author} en la categoría ${article.data.category}.`,
      pubDate: article.data.publishDate,
      link: `/articulo/${article.id}`,
      categories: [article.data.category, ...article.data.tags],
      author: article.data.author,
    })),
    customData: `<language>es</language>`,
  });
};
