import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Articles table — the single content model for the news platform (SQLite/libSQL).
export const articles = sqliteTable(
  'articles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title', { length: 300 }).notNull(),
    slug: text('slug', { length: 220 }).notNull().unique(),
    content: text('content').notNull(),
    author: text('author', { length: 150 }).notNull().default('Editorial'),
    published_at: integer('published_at', { mode: 'timestamp' }).notNull().defaultNow(),
    category: text('category', { length: 80 }).notNull().default('news'),
    featured_image: text('featured_image'),
    // Optional: store <img> width/height so the SSR page can reserve space
    // (CLS-friendly even with zero client JavaScript).
    image_width: integer('image_width'),
    image_height: integer('image_height')
  },
  (t) => [index('articles_slug_idx').on(t.slug), index('articles_published_at_idx').on(t.published_at)]
);

export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;