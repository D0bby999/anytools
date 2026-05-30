export { getDb, closeDb, type Db } from './client';
export * as schema from './schema';
export {
  blogs,
  blogProducts,
  affiliateProducts,
  analyticsEvents,
  type Blog,
  type NewBlog,
  type BlogProduct,
  type AffiliateProduct,
  type NewAffiliateProduct,
  type AnalyticsEvent,
  type NewAnalyticsEvent,
} from './schema';
