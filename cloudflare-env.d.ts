declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OWNER_EMAIL?: string;
    TAGGER_TOKEN?: string;
    RESULT_IMAGE_TOKEN?: string;
  }
}
