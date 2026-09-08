// Seed script. Usage: npm run db:seed
// Inserts a few sample articles so the SSR pages have data immediately.
//
// Prereqs: 1) npm run db:push  2) TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in .env
import 'dotenv/config';
import { articles } from './schema.ts';
import { getDb } from './client.ts';

const db = getDb();

const samples = [
  {
    title: 'Global markets steady as central banks hold rates',
    slug: 'global-markets-steady',
    content:
      'Markets opened cautiously this morning as major central banks signalled a pause on rate adjustments.\n\nThe tone in equities was stable, with technology shares leading modest gains in Asia and Europe. Analysts said the calm reflects confidence that inflation pressures are cooling across the largest economies.\n\nTrading desks expect the focus to shift to employment data later this week, which could set the direction into the next quarter.',
    author: 'Jane Reporter',
    category: 'business',
    featured_image: 'https://images.example.com/markets.jpg',
    image_width: 1200,
    image_height: 630
  },
  {
    title: 'Scientists detail breakthrough in fusion energy research',
    slug: 'fusion-energy-breakthrough',
    content:
      'A research consortium reported a new milestone in controlled fusion, sustaining a high-energy plasma for over an hour.\n\nThe experiment, conducted in a magnetic confinement facility, produced a stable reaction that generation projects say could be scaled. Researchers cautioned that commercial power remains years away, but the result narrows the engineering gap significantly.\n\nFunding agencies described the result as repeatable and independently verified.',
    author: 'Dr. Alex Chen',
    category: 'science',
    featured_image: 'https://images.example.com/fusion.jpg',
    image_width: 1200,
    image_height: 630
  },
  {
    title: 'City leaders approve new public transport corridor',
    slug: 'city-transport-corridor',
    content:
      'Councillors voted to approve a new light-rail corridor connecting the airport with the central business district.\n\nConstruction is expected to begin next spring, with completion targeted in four years. The route will add eleven stations and is projected to cut peak-hour travel across the city by a quarter.\n\nFunding combines national grants and a regional transport levy agreed earlier this year.',
    author: 'Ministry Correspondent',
    category: 'politics',
    featured_image: null,
    image_width: null,
    image_height: null
  }
];

await db.insert(articles).values(samples).onConflictDoNothing({ target: articles.slug });
const all = await db.select({ id: articles.id, slug: articles.slug, title: articles.title }).from(articles);
console.log(`Done. ${all.length} article(s) in the articles table:`);
for (const a of all) console.log(`  ${a.slug} — ${a.title}`);