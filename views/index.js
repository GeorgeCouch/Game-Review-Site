//#region Imports
import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import axios from "axios";
import Pool from "pg-pool";
import bcrypt from "bcrypt";
import env from "dotenv";
import passport from "passport";
import PGStore from "connect-pg-simple";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import multer from "multer";
import sharp from "sharp";
import webpush from "web-push";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
//#endregion

//#region Configs
env.config();
const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 10;

// Web Push (optional — set VAPID keys in .env)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@gamecouch.local";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}


// Username rules: 3-30 chars, starts with letter, only a-z 0-9 _
function isValidUsername(u) {
  return typeof u === "string" && /^[a-z][a-z0-9_]{2,29}$/.test(u);
}
const RESERVED_USERNAMES = new Set([
  "admin", "login", "register", "logout", "api", "profile", "u", "settings",
  "edit", "add", "feed", "explore", "search", "notifications", "about", "help", "mod", "moderation", "report"
]);
//#endregion

//#region Database Connection Config
const db = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false },
    })
  : new Pool({
      user: process.env.PG_USER,
      host: process.env.PG_HOST,
      database: process.env.PG_DATABASE,
      password: process.env.PG_PASSWORD,
      port: process.env.PG_PORT,
    });
//#endregion

// Ensure profile customization columns exist (safe to run every boot)
async function ensureProfileColumns() {
  const stmts = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color VARCHAR(7) DEFAULT '#4f8cff'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS pronouns VARCHAR(40)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(80)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_game VARCHAR(120)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_game_id INTEGER`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_game_cover TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_style VARCHAR(20) DEFAULT 'default'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`,
  ];
  for (const sql of stmts) {
    try {
      await db.query(sql);
    } catch (e) {
      console.warn("ensureProfileColumns:", e.message);
    }
  }
}
ensureProfileColumns().then(() => console.log("Profile columns checked.")).catch(() => {});

//#region body parser and static public middlewares
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
//#endregion

//#region Uploads (avatars)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const avatarDir = path.join(__dirname, "public", "uploads", "avatars");
fs.mkdirSync(avatarDir, { recursive: true });

// Keep file in memory so we can resize with sharp before writing to disk
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB original; we compress on save
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error("Only JPEG, PNG, GIF, or WebP images are allowed"), ok);
  },
});

const AVATAR_SIZE = 256; // square output
const bannerDir = path.join(__dirname, "public", "uploads", "banners");
fs.mkdirSync(bannerDir, { recursive: true });

const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error("Only JPEG, PNG, GIF, or WebP images are allowed"), ok);
  },
});

async function processAndSaveAvatar(userId, fileBuffer) {
  const filename = `user-${userId}-${Date.now()}.webp`;
  const outPath = path.join(avatarDir, filename);

  await sharp(fileBuffer)
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, {
      fit: "cover",
      position: "centre",
    })
    .webp({ quality: 82 })
    .toFile(outPath);

  return `/uploads/avatars/${filename}`;
}

async function processAndSaveBanner(userId, fileBuffer) {
  const filename = `banner-${userId}-${Date.now()}.webp`;
  const outPath = path.join(bannerDir, filename);

  // Flatten animated/gif frames; fail clearly if sharp cannot decode
  await sharp(fileBuffer, { failOn: "none" })
    .rotate()
    .resize(1500, 500, {
      fit: "cover",
      position: "centre",
      withoutEnlargement: false,
    })
    .webp({ quality: 80 })
    .toFile(outPath);

  if (!fs.existsSync(outPath)) {
    throw new Error("Banner file was not written to disk");
  }
  return `/uploads/banners/${filename}`;
}
//#endregion


//#region Session creation
// Needed behind Railway/Render/Fly reverse proxies for secure cookies
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(
  session({
    store: new (PGStore(session))({
      pool: db,
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "dev-only-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
    },
  })
);
//#endregion

//#region Passport initialization middleware
app.use(passport.initialize());
app.use(passport.session());

// Unread notification count for nav badges (after passport so req.user exists)
app.use(async (req, res, next) => {
  res.locals.unreadNotifications = 0;
  res.locals.isAdmin = false;
  try {
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      if (req.user.is_banned) {
        req.logout(() => {});
        return res.status(403).send("Your account has been suspended. Contact support if you believe this is a mistake.");
      }
      res.locals.isAdmin = !!req.user.is_admin;
      const r = await db.query(
        "SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read = FALSE",
        [req.user.id]
      );
      res.locals.unreadNotifications = r.rows[0].c;
    }
  } catch (e) {
    // table may not exist yet
  }
  next();
});

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.is_admin) {
    return next();
  }
  return res.status(403).send("Admin access required");
}
//#endregion

//#region default vars for home page display and post editing
let activeEdit = 0;
let sortMethod = "released";
//#endregion

//#region Helper: load reviews + comments + covers
async function loadReviews(whereClause, params, sortCol, currentUserId = null) {
  const allowedSorts = ["released", "rating", "title", "completed", "id"];
  if (!allowedSorts.includes(sortCol)) sortCol = "released";

  const dbResult = await db.query(
    `SELECT games.*, users.email AS author_email,
            users.username AS author_username, users.display_name AS author_display_name
     FROM games
     LEFT JOIN users ON games.user_id = users.id
     ${whereClause}
     ORDER BY games.${sortCol} DESC NULLS LAST, games.id DESC`,
    params
  );
  const userInfo = dbResult.rows;

  let commentsByReview = {};
  let likeCountByReview = {};
  let likedByUser = new Set();

  if (userInfo.length > 0) {
    const reviewIds = userInfo.map((g) => g.id);

    // Comments
    const commentsResult = await db.query(
      `SELECT comments.*, users.email AS author_email,
              users.username AS author_username, users.display_name AS author_display_name
       FROM comments
       JOIN users ON comments.user_id = users.id
       WHERE comments.review_id = ANY($1)
       ORDER BY comments.created_at ASC`,
      [reviewIds]
    );
    for (const c of commentsResult.rows) {
      if (!commentsByReview[c.review_id]) commentsByReview[c.review_id] = [];
      commentsByReview[c.review_id].push(c);
    }

    // Like counts
    const likesResult = await db.query(
      `SELECT review_id, COUNT(*)::int AS count
       FROM likes
       WHERE review_id = ANY($1)
       GROUP BY review_id`,
      [reviewIds]
    );
    for (const row of likesResult.rows) {
      likeCountByReview[row.review_id] = row.count;
    }

    // Which ones the current user liked
    if (currentUserId) {
      const userLikes = await db.query(
        `SELECT review_id FROM likes WHERE user_id = $1 AND review_id = ANY($2)`,
        [currentUserId, reviewIds]
      );
      for (const row of userLikes.rows) {
        likedByUser.add(row.review_id);
      }
    }
  }

  return { userInfo, commentsByReview, likeCountByReview, likedByUser };
}
//#endregion

//#region get and display home feed + explore
app.get("/", async (req, res) => {
  const allowedSorts = ["released", "rating", "title", "completed"];
  if (!allowedSorts.includes(sortMethod)) sortMethod = "released";

  let whereClause = "";
  let params = [];
  let feedMode = "explore"; // default for logged-out

  if (req.isAuthenticated()) {
    // Personalized feed: own reviews + people you follow (excluding blocks)
    whereClause = `WHERE (
                     games.user_id = $1
                     OR games.user_id IN (
                       SELECT following_id FROM follows WHERE follower_id = $1
                     )
                   )
                   AND games.user_id NOT IN (
                     SELECT blocked_id FROM blocks WHERE blocker_id = $1
                   )
                   AND games.user_id NOT IN (
                     SELECT blocker_id FROM blocks WHERE blocked_id = $1
                   )`;
    params = [req.user.id];
    feedMode = "feed";
  }

  try {
    const { userInfo, commentsByReview, likeCountByReview, likedByUser } = await loadReviews(
      whereClause,
      params,
      sortMethod,
      req.user ? req.user.id : null
    );

    res.render("index.ejs", {
      userInfo,
      userlog: req.user,
      commentsByReview,
      feedMode,
      likeCountByReview,
      likedByUser,
    });
  } catch (err) {
    console.error("Home feed error:", err);
    res.status(500).send("Something went wrong loading the feed");
  }
});

// Explore = all reviews (discovery)
app.get("/explore", async (req, res) => {
  const allowedSorts = ["released", "rating", "title", "completed"];
  if (!allowedSorts.includes(sortMethod)) sortMethod = "released";

  try {
    const { userInfo, commentsByReview, likeCountByReview, likedByUser } = await loadReviews(
      "",
      [],
      sortMethod,
      req.user ? req.user.id : null
    );

    res.render("index.ejs", {
      userInfo,
      userlog: req.user,
      commentsByReview,
      feedMode: "explore",
      likeCountByReview,
      likedByUser,
    });
  } catch (err) {
    console.error("Explore error:", err);
    res.status(500).send("Something went wrong");
  }
});
//#endregion

//#region Game search (IGDB via Twitch)
let igdbToken = null;
let igdbTokenExpiresAt = 0;

async function getIgdbToken() {
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("IGDB_CLIENT_ID and IGDB_CLIENT_SECRET must be set in .env");
  }

  // Reuse token if still valid (refresh 60s early)
  if (igdbToken && Date.now() < igdbTokenExpiresAt - 60_000) {
    return { token: igdbToken, clientId };
  }

  const tokenUrl =
    `https://id.twitch.tv/oauth2/token` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    `&grant_type=client_credentials`;

  const tokenRes = await axios.post(tokenUrl);
  igdbToken = tokenRes.data.access_token;
  // expires_in is seconds
  igdbTokenExpiresAt = Date.now() + (tokenRes.data.expires_in || 5000000) * 1000;
  return { token: igdbToken, clientId };
}

// Same Twitch app token works for Helix (streams, games, users)
async function getTwitchToken() {
  return getIgdbToken();
}

async function getTwitchStreamByLogin(login) {
  if (!login) return null;
  const { token, clientId } = await getTwitchToken();
  const res = await axios.get(
    `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`,
    {
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${token}`,
      },
    }
  );
  const stream = res.data?.data?.[0] || null;
  return stream;
}

async function getTopTwitchStreamForGame(gameName) {
  if (!gameName) return null;
  const { token, clientId } = await getTwitchToken();

  // Resolve Twitch category/game id by name
  const gamesRes = await axios.get(
    `https://api.twitch.tv/helix/games?name=${encodeURIComponent(gameName)}`,
    {
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${token}`,
      },
    }
  );
  const twitchGame = gamesRes.data?.data?.[0];
  if (!twitchGame) return null;

  const streamsRes = await axios.get(
    `https://api.twitch.tv/helix/streams?game_id=${twitchGame.id}&first=1`,
    {
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${token}`,
      },
    }
  );
  const stream = streamsRes.data?.data?.[0] || null;
  if (!stream) return null;
  return { ...stream, twitch_game_name: twitchGame.name };
}

function twitchEmbedParent(req) {
  // Twitch requires parent domain(s). Use host without port for localhost/production.
  const host = (req.hostname || "localhost").split(":")[0];
  return host || "localhost";
}

//#region Achievements
const ACHIEVEMENTS = {
  first_review: {
    id: "first_review",
    title: "First Steps",
    description: "Write your first game review",
    icon: "🎮",
  },
  reviews_10: {
    id: "reviews_10",
    title: "Critic",
    description: "Write 10 reviews",
    icon: "📝",
  },
  reviews_25: {
    id: "reviews_25",
    title: "Seasoned",
    description: "Write 25 reviews",
    icon: "✍️",
  },
  reviews_50: {
    id: "reviews_50",
    title: "Prolific",
    description: "Write 50 reviews",
    icon: "🏆",
  },
  first_follow: {
    id: "first_follow",
    title: "Networked",
    description: "Follow another user",
    icon: "👋",
  },
  first_follower: {
    id: "first_follower",
    title: "Rising Star",
    description: "Gain your first follower",
    icon: "⭐",
  },
  likes_received_10: {
    id: "likes_received_10",
    title: "Popular",
    description: "Receive 10 likes on your reviews",
    icon: "❤️",
  },
  first_list: {
    id: "first_list",
    title: "Curator",
    description: "Create your first list",
    icon: "📋",
  },
  first_status: {
    id: "first_status",
    title: "On the Shelf",
    description: "Set a Want / Playing / Played status",
    icon: "📚",
  },
  completions_10: {
    id: "completions_10",
    title: "Completionist",
    description: "Log 10 games with a completion date",
    icon: "✅",
  },
};

async function unlockAchievement(userId, achievementId) {
  if (!ACHIEVEMENTS[achievementId]) return false;
  try {
    const result = await db.query(
      `INSERT INTO user_achievements (user_id, achievement_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, achievement_id) DO NOTHING
       RETURNING achievement_id`,
      [userId, achievementId]
    );
    if (result.rows.length > 0) {
      await grantXp(userId, "achievement");
      const ach = ACHIEVEMENTS[achievementId];
      await createActivity({
        actorId: userId,
        type: "achievement",
        entityType: "achievement",
        entityId: null,
        meta: {
          achievement_id: achievementId,
          title: ach?.title || achievementId,
          description: ach?.description || "",
          icon: ach?.icon || "🏆",
        },
      });
      return true;
    }
    return false;
  } catch (err) {
    // table may not exist yet
    return false;
  }
}

async function checkAndUnlockAchievements(userId) {
  if (!userId) return;
  try {
    // Review counts
    const reviewCount = (
      await db.query("SELECT COUNT(*)::int AS c FROM games WHERE user_id = $1", [userId])
    ).rows[0].c;
    if (reviewCount >= 1) await unlockAchievement(userId, "first_review");
    if (reviewCount >= 10) await unlockAchievement(userId, "reviews_10");
    if (reviewCount >= 25) await unlockAchievement(userId, "reviews_25");
    if (reviewCount >= 50) await unlockAchievement(userId, "reviews_50");

    // Completions
    try {
      const completions = (
        await db.query(
          `SELECT COUNT(*)::int AS c FROM games
           WHERE user_id = $1 AND completed IS NOT NULL AND CAST(completed AS TEXT) <> ''`,
          [userId]
        )
      ).rows[0].c;
      if (completions >= 10) await unlockAchievement(userId, "completions_10");
    } catch (e) {}

    // Follows given
    try {
      const following = (
        await db.query("SELECT COUNT(*)::int AS c FROM follows WHERE follower_id = $1", [userId])
      ).rows[0].c;
      if (following >= 1) await unlockAchievement(userId, "first_follow");
    } catch (e) {}

    // Followers
    try {
      const followers = (
        await db.query("SELECT COUNT(*)::int AS c FROM follows WHERE following_id = $1", [userId])
      ).rows[0].c;
      if (followers >= 1) await unlockAchievement(userId, "first_follower");
    } catch (e) {}

    // Likes received
    try {
      const likesRecv = (
        await db.query(
          `SELECT COUNT(*)::int AS c FROM likes l
           JOIN games g ON g.id = l.review_id WHERE g.user_id = $1`,
          [userId]
        )
      ).rows[0].c;
      if (likesRecv >= 10) await unlockAchievement(userId, "likes_received_10");
    } catch (e) {}

    // Lists
    try {
      const lists = await db.query(
        "SELECT id FROM lists WHERE user_id = $1",
        [userId]
      );
      if (lists.rows.length >= 1) await unlockAchievement(userId, "first_list");
    } catch (e) {}

    // Statuses
    try {
      const statuses = (
        await db.query("SELECT COUNT(*)::int AS c FROM game_statuses WHERE user_id = $1", [userId])
      ).rows[0].c;
      if (statuses >= 1) await unlockAchievement(userId, "first_status");
    } catch (e) {}

  } catch (err) {
    console.warn("Achievement check error:", err.message);
  }
}

async function getUserAchievements(userId) {
  try {
    const result = await db.query(
      `SELECT achievement_id, unlocked_at FROM user_achievements
       WHERE user_id = $1 ORDER BY unlocked_at ASC`,
      [userId]
    );
    return result.rows.map((row) => ({
      ...ACHIEVEMENTS[row.achievement_id],
      unlocked_at: row.unlocked_at,
    })).filter((a) => a.id);
  } catch (err) {
    return [];
  }
}
//#endregion

//#region XP & Levels
const XP_DAILY_CAP = 400;
const XP_REWARDS = {
  // amount granted per action (before caps)
  review: 50,
  completion: 25,
  like_given: 5,
  like_received: 10,
  follow: 15,
  follower: 20,
  list: 40,
  status: 10,
  achievement: 75,
  comment: 8,
  level_up: 0, // cosmetic only
};

// Per-reason daily caps (how many times this reason can grant XP per day)
const XP_REASON_DAILY_LIMIT = {
  like_given: 20, // max 20 * 5 = 100
  like_received: 30,
  comment: 15,
  follow: 10,
  follower: 15,
  status: 15,
};

// Titles unlocked at level thresholds (highest applicable wins)
const LEVEL_TITLES = [
  { level: 1, title: "Newcomer" },
  { level: 3, title: "Player" },
  { level: 5, title: "Regular" },
  { level: 8, title: "Enthusiast" },
  { level: 12, title: "Veteran" },
  { level: 16, title: "Critic" },
  { level: 20, title: "Expert" },
  { level: 25, title: "Legend" },
  { level: 30, title: "Grandmaster" },
];

function titleForLevel(level) {
  let title = LEVEL_TITLES[0].title;
  for (const t of LEVEL_TITLES) {
    if (level >= t.level) title = t.title;
  }
  return title;
}

function levelFromXp(totalXp) {
  let level = 1;
  let xpIntoLevel = Math.max(0, totalXp || 0);
  let need = 100;
  while (xpIntoLevel >= need) {
    xpIntoLevel -= need;
    level += 1;
    need = Math.floor(100 * Math.pow(1.2, level - 1));
  }
  const pct = need > 0 ? Math.min(100, Math.round((xpIntoLevel / need) * 100)) : 100;
  return {
    level,
    totalXp: Math.max(0, totalXp || 0),
    xpIntoLevel,
    xpForNext: need,
    progressPct: pct,
    title: titleForLevel(level),
  };
}

async function getDailyXp(userId) {
  try {
    const r = await db.query(
      `SELECT amount FROM xp_daily WHERE user_id = $1 AND day = CURRENT_DATE`,
      [userId]
    );
    return r.rows[0]?.amount || 0;
  } catch (e) {
    return 0;
  }
}

async function countReasonToday(userId, reason) {
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS c FROM xp_events
       WHERE user_id = $1 AND reason = $2 AND created_at::date = CURRENT_DATE`,
      [userId, reason]
    );
    return r.rows[0].c;
  } catch (e) {
    return 0;
  }
}

/**
 * Grant XP with daily total cap + per-reason daily limits.
 * Returns { granted, capped, levelBefore, levelAfter, totalXp, rewardTitle }
 */
async function grantXp(userId, reason, amountOverride = null) {
  if (!userId || !reason) return { granted: 0 };
  const base = amountOverride != null ? amountOverride : XP_REWARDS[reason];
  if (!base || base <= 0) return { granted: 0 };

  try {
    // Per-reason daily limit
    const reasonLimit = XP_REASON_DAILY_LIMIT[reason];
    if (reasonLimit != null) {
      const used = await countReasonToday(userId, reason);
      if (used >= reasonLimit) {
        return { granted: 0, capped: true, reason: "reason_limit" };
      }
    }

    const dailySoFar = await getDailyXp(userId);
    if (dailySoFar >= XP_DAILY_CAP) {
      return { granted: 0, capped: true, reason: "daily_cap" };
    }

    const grant = Math.min(base, XP_DAILY_CAP - dailySoFar);

    // Level before
    const beforeRes = await db.query(
      `SELECT COALESCE(total_xp, 0)::int AS total_xp FROM users WHERE id = $1`,
      [userId]
    );
    const xpBefore = beforeRes.rows[0]?.total_xp || 0;
    const levelBefore = levelFromXp(xpBefore).level;

    await db.query(
      `INSERT INTO xp_events (user_id, amount, reason) VALUES ($1, $2, $3)`,
      [userId, grant, reason]
    );
    await db.query(
      `INSERT INTO xp_daily (user_id, day, amount) VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (user_id, day) DO UPDATE SET amount = xp_daily.amount + EXCLUDED.amount`,
      [userId, grant]
    );
    const updated = await db.query(
      `UPDATE users SET total_xp = COALESCE(total_xp, 0) + $1 WHERE id = $2
       RETURNING total_xp`,
      [grant, userId]
    );
    const totalXp = updated.rows[0].total_xp;
    const after = levelFromXp(totalXp);

    // Update profile title if level reward changed
    if (after.level > levelBefore || !beforeRes.rows[0]) {
      await db.query(
        `UPDATE users SET profile_title = $1 WHERE id = $2`,
        [after.title, userId]
      );
    } else {
      // keep title in sync even without level-up
      await db.query(
        `UPDATE users SET profile_title = $1 WHERE id = $2 AND (profile_title IS NULL OR profile_title = '')`,
        [after.title, userId]
      );
    }

    return {
      granted: grant,
      capped: grant < base,
      levelBefore,
      levelAfter: after.level,
      leveledUp: after.level > levelBefore,
      totalXp,
      title: after.title,
    };
  } catch (err) {
    console.warn("grantXp error:", err.message);
    return { granted: 0, error: err.message };
  }
}

async function ensureXpSeeded(userId) {
  // One-time backfill from activity if user has 0 XP but has activity
  try {
    const u = await db.query(
      `SELECT COALESCE(total_xp, 0)::int AS total_xp FROM users WHERE id = $1`,
      [userId]
    );
    if (!u.rows[0] || u.rows[0].total_xp > 0) {
      const total = u.rows[0]?.total_xp || 0;
      return levelFromXp(total);
    }

    // Seed from computed historical activity (no daily cap on backfill)
    const computed = await computeHistoricalXp(userId);
    if (computed > 0) {
      await db.query(`UPDATE users SET total_xp = $1, profile_title = $2 WHERE id = $3`, [
        computed,
        titleForLevel(levelFromXp(computed).level),
        userId,
      ]);
      await db.query(
        `INSERT INTO xp_events (user_id, amount, reason) VALUES ($1, $2, 'seed')`,
        [userId, computed]
      );
    }
    return levelFromXp(computed);
  } catch (e) {
    return levelFromXp(0);
  }
}

async function computeHistoricalXp(userId) {
  let xp = 0;
  try {
    const reviews = (await db.query("SELECT COUNT(*)::int AS c FROM games WHERE user_id = $1", [userId])).rows[0].c;
    xp += reviews * XP_REWARDS.review;
  } catch (e) {}
  try {
    const completions = (
      await db.query(
        `SELECT COUNT(*)::int AS c FROM games
         WHERE user_id = $1 AND completed IS NOT NULL AND CAST(completed AS TEXT) <> ''`,
        [userId]
      )
    ).rows[0].c;
    xp += completions * XP_REWARDS.completion;
  } catch (e) {}
  try {
    const likesGiven = (await db.query("SELECT COUNT(*)::int AS c FROM likes WHERE user_id = $1", [userId])).rows[0].c;
    xp += likesGiven * XP_REWARDS.like_given;
  } catch (e) {}
  try {
    const likesRecv = (
      await db.query(
        `SELECT COUNT(*)::int AS c FROM likes l JOIN games g ON g.id = l.review_id WHERE g.user_id = $1`,
        [userId]
      )
    ).rows[0].c;
    xp += likesRecv * XP_REWARDS.like_received;
  } catch (e) {}
  try {
    const following = (await db.query("SELECT COUNT(*)::int AS c FROM follows WHERE follower_id = $1", [userId])).rows[0].c;
    xp += following * XP_REWARDS.follow;
  } catch (e) {}
  try {
    const followers = (await db.query("SELECT COUNT(*)::int AS c FROM follows WHERE following_id = $1", [userId])).rows[0].c;
    xp += followers * XP_REWARDS.follower;
  } catch (e) {}
  try {
    const lists = (await db.query("SELECT COUNT(*)::int AS c FROM lists WHERE user_id = $1", [userId])).rows[0].c;
    xp += lists * XP_REWARDS.list;
  } catch (e) {}
  try {
    const statuses = (await db.query("SELECT COUNT(*)::int AS c FROM game_statuses WHERE user_id = $1", [userId])).rows[0].c;
    xp += statuses * XP_REWARDS.status;
  } catch (e) {}
  try {
    const ach = (await db.query("SELECT COUNT(*)::int AS c FROM user_achievements WHERE user_id = $1", [userId])).rows[0].c;
    xp += ach * XP_REWARDS.achievement;
  } catch (e) {}
  try {
    const comments = (await db.query("SELECT COUNT(*)::int AS c FROM comments WHERE user_id = $1", [userId])).rows[0].c;
    xp += comments * XP_REWARDS.comment;
  } catch (e) {}
  return xp;
}

async function getXpInfo(userId) {
  try {
    const seeded = await ensureXpSeeded(userId);
    const daily = await getDailyXp(userId);
    const u = await db.query(
      `SELECT COALESCE(total_xp, 0)::int AS total_xp, profile_title FROM users WHERE id = $1`,
      [userId]
    );
    const totalXp = u.rows[0]?.total_xp ?? seeded.totalXp;
    const info = levelFromXp(totalXp);
    info.dailyXp = daily;
    info.dailyCap = XP_DAILY_CAP;
    info.dailyRemaining = Math.max(0, XP_DAILY_CAP - daily);
    info.title = u.rows[0]?.profile_title || info.title;
    info.nextTitles = LEVEL_TITLES.filter((t) => t.level > info.level).slice(0, 3);
    return info;
  } catch (e) {
    return { ...levelFromXp(0), dailyXp: 0, dailyCap: XP_DAILY_CAP, dailyRemaining: XP_DAILY_CAP, nextTitles: [] };
  }
}

// Keep old name working for any leftover callers
async function computeUserXp(userId) {
  return getXpInfo(userId);
}
//#endregion

//#region Notifications
async function createNotification({ userId, actorId, type, entityType, entityId, message }) {
  if (!userId || userId === actorId) return; // no self-notify
  try {
    await db.query(
      `INSERT INTO notifications (user_id, actor_id, type, entity_type, entity_id, message)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, actorId || null, type, entityType || null, entityId || null, message || null]
    );
  } catch (err) {
    console.warn("Notification create error:", err.message);
  }

  // Browser push (best-effort)
  try {
    await sendPushToUser(userId, { type, message, entityType, entityId, actorId });
  } catch (e) {
    // ignore
  }
}

async function sendPushToUser(userId, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  let actorName = "Someone";
  try {
    if (payload.actorId) {
      const a = await db.query(
        "SELECT display_name, username FROM users WHERE id = $1",
        [payload.actorId]
      );
      if (a.rows[0]) {
        actorName = a.rows[0].display_name || a.rows[0].username || actorName;
      }
    }
  } catch (e) {}

  let title = "GameCouch";
  let body = "You have a new notification";
  if (payload.type === "like") {
    title = "New like";
    body = `${actorName} liked your review` + (payload.message ? ` of ${payload.message}` : "");
  } else if (payload.type === "follow") {
    title = "New follower";
    body = `${actorName} followed you`;
  } else if (payload.type === "comment") {
    title = "New comment";
    body = `${actorName} commented on your review` + (payload.message ? ` of ${payload.message}` : "");
  }

  const data = {
    title,
    body,
    url: "/notifications",
  };

  let subs = [];
  try {
    const r = await db.query(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
      [userId]
    );
    subs = r.rows;
  } catch (e) {
    return;
  }

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(data)
      );
    } catch (err) {
      // Gone / invalid subscription
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]).catch(() => {});
      } else {
        console.warn("Push send error:", err.statusCode || err.message);
      }
    }
  }
}

async function createActivity({ actorId, type, entityType, entityId, meta }) {
  if (!actorId || !type) return;
  try {
    await db.query(
      `INSERT INTO activities (actor_id, type, entity_type, entity_id, meta)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        actorId,
        type,
        entityType || null,
        entityId || null,
        JSON.stringify(meta || {}),
      ]
    );
  } catch (err) {
    console.warn("Activity create error:", err.message);
  }
}

async function getUnreadNotificationCount(userId) {
  try {
    const r = await db.query(
      "SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read = FALSE",
      [userId]
    );
    return r.rows[0].c;
  } catch (err) {
    return 0;
  }
}

//#endregion

app.get("/api/users/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) return res.json({ results: [] });

  try {
    const result = await db.query(
      `SELECT id, username, display_name, avatar_url, bio
       FROM users
       WHERE username IS NOT NULL
         AND (
           LOWER(username) LIKE $1
           OR LOWER(COALESCE(display_name, '')) LIKE $1
         )
       ORDER BY
         CASE WHEN LOWER(username) = LOWER($2) THEN 0
              WHEN LOWER(username) LIKE LOWER($2) || '%' THEN 1
              ELSE 2 END,
         username ASC
       LIMIT 12`,
      ["%" + q.toLowerCase() + "%", q.toLowerCase()]
    );
    res.json({
      results: result.rows.map((u) => ({
        id: u.id,
        username: u.username,
        display_name: u.display_name || u.username,
        avatar_url: u.avatar_url,
        bio: u.bio,
      })),
    });
  } catch (err) {
    console.error("User search error:", err.message);
    res.status(500).json({ error: "Search failed" });
  }
});

app.get("/api/games/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) {
    return res.json({ results: [] });
  }

  if (!process.env.IGDB_CLIENT_ID || !process.env.IGDB_CLIENT_SECRET) {
    return res.status(500).json({
      error: "Game search is not configured. Add IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to your .env file.",
    });
  }

  try {
    const { token, clientId } = await getIgdbToken();

    // Apicalypse query language
    // Escape double quotes in the search term
    const safeQ = q.replace(/"/g, "");
    const body =
      `search "${safeQ}";` +
      ` fields name, first_release_date, cover.image_id;` +
      ` limit 8;`;

    const result = await axios.post("https://api.igdb.com/v4/games", body, {
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "text/plain",
      },
    });

    const results = (result.data || []).map((g) => {
      let cover = null;
      if (g.cover && g.cover.image_id) {
        // t_cover_big is a good size for cards
        cover = `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`;
      }
      let released = null;
      if (g.first_release_date) {
        // IGDB uses unix timestamp (seconds)
        released = new Date(g.first_release_date * 1000).toISOString().slice(0, 10);
      }
      return {
        id: g.id,
        name: g.name,
        released,
        cover,
      };
    });

    res.json({ results });
  } catch (err) {
    console.error("IGDB search error:", err.response?.data || err.message);
    res.status(502).json({ error: "Search service unavailable. Try again shortly." });
  }
});
//#endregion

//#region get and post for adding new game reviews
app.get("/add", (req, res) => {
  // Require login to add a review
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }
  res.render("add.ejs");
});

app.get("/log", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  res.render("log.ejs");
});

app.post("/log-game", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  const gameId = req.body.game_id;
  const title = (req.body.title || "").trim();
  const coverUrl = (req.body.cover_url || "").trim() || null;
  const released = req.body.released || null;
  let completed = (req.body.completed || "").trim() || null;
  const rating = req.body.rating;
  const markPlayed = req.body.mark_played === "1" || req.body.mark_played === "on";

  if (!gameId || !title) {
    return res.render("log.ejs", { error: "Please search for and select a game first." });
  }
  if (rating === undefined || rating === null || rating === "") {
    return res.render("log.ejs", { error: "Please choose a rating." });
  }

  // Default completed to today if blank
  if (!completed) {
    completed = new Date().toISOString().slice(0, 10);
  }

  try {
    await db.query(
      `INSERT INTO games (game_id, title, completed, rating, notes, released, user_id, cover_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [gameId, title, completed, rating, "", released, req.user.id, coverUrl]
    );

    if (markPlayed) {
      try {
        await db.query(
          `INSERT INTO game_statuses (user_id, game_id, status, title, cover_url, released, updated_at)
           VALUES ($1, $2, 'played', $3, $4, $5, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, game_id)
           DO UPDATE SET status = 'played',
                         title = COALESCE(EXCLUDED.title, game_statuses.title),
                         cover_url = COALESCE(EXCLUDED.cover_url, game_statuses.cover_url),
                         updated_at = CURRENT_TIMESTAMP`,
          [req.user.id, gameId, title, coverUrl, released]
        );
      } catch (e) {
        console.warn("Quick log status:", e.message);
      }
    }

    await checkAndUnlockAchievements(req.user.id);
    await grantXp(req.user.id, "review");
    await grantXp(req.user.id, "completion");
    if (markPlayed) await grantXp(req.user.id, "status");

    await createActivity({
      actorId: req.user.id,
      type: "review",
      entityType: "review",
      entityId: null,
      meta: {
        game_id: parseInt(gameId, 10) || gameId,
        title,
        rating,
        cover_url: coverUrl,
        quick_log: true,
      },
    });

    res.redirect("/");
  } catch (err) {
    console.error("Quick log error:", err.message);
    res.render("log.ejs", { error: "Could not save log. Please try again." });
  }
});

app.post("/add-game", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  const gameId = req.body.game_id;
  const title = (req.body.title || "").trim();
  const coverUrl = (req.body.cover_url || "").trim() || null;
  const released = req.body.released || null;
  const completed = req.body.completed;
  const rating = req.body.rating;
  const notes = req.body.review;
  const hasSpoilers = req.body.has_spoilers === "1" || req.body.has_spoilers === "on";

  if (!gameId || !title) {
    return res.render("add.ejs", { error: "Please search for and select a game first." });
  }

  try {
    await db.query(
      `INSERT INTO games (game_id, title, completed, rating, notes, released, user_id, cover_url, has_spoilers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [gameId, title, completed, rating, notes, released, req.user.id, coverUrl, hasSpoilers]
    );
    await checkAndUnlockAchievements(req.user.id);
    await grantXp(req.user.id, "review");
    if (completed) await grantXp(req.user.id, "completion");
    await createActivity({
      actorId: req.user.id,
      type: "review",
      entityType: "review",
      entityId: null,
      meta: { game_id: gameId, title, rating, cover_url: coverUrl },
    });
    res.redirect("/");
  } catch (err) {
    console.error("Error adding game:", err.message);
    res.render("add.ejs", { error: "Could not save review. Please try again." });
  }
});
//#endregion

//#region get and post for editing game reviews
app.post("/edit", async (req, res) => {
  let data = await db.query(
    `SELECT * FROM games WHERE game_id=${req.body["edit"]}`
  );
  activeEdit = data.rows[0]["game_id"];
  res.render("edit.ejs", { data: data.rows[0] });
});

app.post("/edit-game", async (req, res) => {
  await db.query(
    `UPDATE games SET completed=$1, rating=$2, notes=$3 WHERE game_id=$4`,
    [req.body["completed"], req.body["rating"], req.body["review"], activeEdit]
  );
  res.redirect("/");
});
//#endregion

//#region post for game review deletion
app.post("/delete", async (req, res) => {
  console.log(req.body);
  await db.query(`DELETE FROM games WHERE game_id=$1`, [req.body["delete"]]);
  res.redirect("/");
});
//#endregion

//#region post for sorting game reviews
app.post("/sort", async (req, res) => {
  console.log(req.body);
  sortMethod = req.body["sort"];
  res.redirect("/");
});
//#endregion

//#region comments
app.post("/comment", async (req, res) => {
  const json = wantsJson(req);
  if (!req.isAuthenticated()) {
    if (json) return res.status(401).json({ error: "Login required" });
    return res.redirect("/login");
  }
  const review_id = parseInt(req.body.review_id, 10);
  const content = (req.body.content || "").trim();
  const hasSpoilers = req.body.has_spoilers === "1" || req.body.has_spoilers === "on" || req.body.has_spoilers === true || req.body.has_spoilers === "true";
  if (!review_id || !content) {
    if (json) return res.status(400).json({ error: "Comment required" });
    return res.redirect(req.get("Referer") || "/");
  }
  try {
    let inserted;
    try {
      inserted = await db.query(
        `INSERT INTO comments (review_id, user_id, content, has_spoilers)
         VALUES ($1, $2, $3, $4)
         RETURNING id, review_id, user_id, content, created_at, has_spoilers`,
        [review_id, req.user.id, content, hasSpoilers]
      );
    } catch (e) {
      // column may not exist yet
      inserted = await db.query(
        `INSERT INTO comments (review_id, user_id, content)
         VALUES ($1, $2, $3)
         RETURNING id, review_id, user_id, content, created_at`,
        [review_id, req.user.id, content]
      );
    }
    const comment = inserted.rows[0];
    if (comment.has_spoilers === undefined) comment.has_spoilers = hasSpoilers;

    try {
      const review = await db.query("SELECT user_id, title FROM games WHERE id = $1", [review_id]);
      if (review.rows[0]) {
        await createNotification({
          userId: review.rows[0].user_id,
          actorId: req.user.id,
          type: "comment",
          entityType: "review",
          entityId: review_id,
          message: review.rows[0].title || null,
        });
      }
      await grantXp(req.user.id, "comment");
    } catch (e) {}

    if (json) {
      return res.json({
        ok: true,
        comment: {
          id: comment.id,
          review_id: comment.review_id,
          user_id: comment.user_id,
          content: comment.content,
          created_at: comment.created_at,
          author_username: req.user.username || null,
          author_display_name: req.user.display_name || req.user.username || "You",
          has_spoilers: !!comment.has_spoilers,
        },
      });
    }
  } catch (err) {
    console.error("Comment error:", err.message);
    if (json) return res.status(500).json({ error: "Could not post comment" });
  }
  res.redirect(req.get("Referer") || "/");
});

app.post("/edit-comment", async (req, res) => {
  const json = wantsJson(req);
  if (!req.isAuthenticated()) {
    if (json) return res.status(401).json({ error: "Login required" });
    return res.redirect("/login");
  }
  const comment_id = parseInt(req.body.comment_id, 10);
  const content = (req.body.content || "").trim();
  if (!comment_id || !content) {
    if (json) return res.status(400).json({ error: "Invalid comment" });
    return res.redirect(req.get("Referer") || "/");
  }
  try {
    const result = await db.query(
      `UPDATE comments SET content = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3
       RETURNING id, content`,
      [content, comment_id, req.user.id]
    );
    if (!result.rows.length) {
      if (json) return res.status(403).json({ error: "Not allowed" });
      return res.redirect(req.get("Referer") || "/");
    }
    if (json) return res.json({ ok: true, comment: result.rows[0] });
  } catch (err) {
    console.error("Edit comment error:", err.message);
    if (json) return res.status(500).json({ error: "Could not edit comment" });
  }
  res.redirect(req.get("Referer") || "/");
});

app.post("/delete-comment", async (req, res) => {
  const json = wantsJson(req);
  if (!req.isAuthenticated()) {
    if (json) return res.status(401).json({ error: "Login required" });
    return res.redirect("/login");
  }
  const comment_id = parseInt(req.body.comment_id, 10);
  if (!comment_id) {
    if (json) return res.status(400).json({ error: "Invalid comment" });
    return res.redirect(req.get("Referer") || "/");
  }
  try {
    const result = await db.query(
      `DELETE FROM comments WHERE id = $1 AND user_id = $2 RETURNING id, review_id`,
      [comment_id, req.user.id]
    );
    if (!result.rows.length) {
      if (json) return res.status(403).json({ error: "Not allowed" });
      return res.redirect(req.get("Referer") || "/");
    }
    if (json) {
      return res.json({
        ok: true,
        comment_id: result.rows[0].id,
        review_id: result.rows[0].review_id,
      });
    }
  } catch (err) {
    console.error("Delete comment error:", err.message);
    if (json) return res.status(500).json({ error: "Could not delete comment" });
  }
  res.redirect(req.get("Referer") || "/");
});
//#endregion

//#region gets for login and register
app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});
//#endregion

//#region post for login and register
app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login",
  })
);

app.post("/register", async (req, res) => {
  const email = (req.body.username || "").trim().toLowerCase();
  const password = req.body.password;
  const handle = (req.body.handle || "").trim().toLowerCase();
  const displayName = (req.body.display_name || "").trim() || handle;

  if (!isValidUsername(handle) || RESERVED_USERNAMES.has(handle)) {
    return res.render("register.ejs", {
      error: "Username must be 3–30 characters, start with a letter, and only contain lowercase letters, numbers, or underscores.",
    });
  }

  if (!email || !password || password.length < 6) {
    return res.render("register.ejs", { error: "Valid email and password (min 6 chars) are required." });
  }

  bcrypt.hash(password, saltRounds, async (err, hash) => {
    if (err) {
      console.error(err);
      return res.render("register.ejs", { error: "Something went wrong. Please try again." });
    }
    try {
      const result = await db.query(
        `INSERT INTO users (email, password, username, display_name)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [email, hash, handle, displayName]
      );
      const user = result.rows[0];
      req.login(user, (err) => {
        if (err) console.error(err);
        res.redirect(`/u/${user.username}`);
      });
    } catch (dbErr) {
      console.error("Registration error:", dbErr.message);
      let msg = "Registration failed. Please try again.";
      if (dbErr.code === "23505") {
        if (dbErr.detail && dbErr.detail.includes("username")) {
          msg = "That username is already taken.";
        } else {
          msg = "An account with that email already exists.";
        }
      }
      res.render("register.ejs", { error: msg });
    }
  });
});
//#endregion

//#region logout
app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) console.log(err);
    res.redirect("/");
  });
});
//#endregion

//#region Passport Local Strategy
passport.use(
  "local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1", [
        username,
      ]);
      if (result.rows.length === 0) {
        return cb(null, false);
      }
      let newResult = result.rows[0];
      let storedHashedPassword = newResult.password;
      bcrypt.compare(password, storedHashedPassword, (err, result) => {
        if (err) {
          console.log(err);
          return cb(err);
        } else {
          if (result) {
            return cb(null, newResult);
          } else {
            return cb(null, false);
          }
        }
      });
    } catch (err) {
      return cb(err);
    }
  })
);
//#endregion

//#region Passport Google Strategy (only if credentials exist)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    "google",
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "http://localhost:3000/auth/google/profile",
        userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
      },
      async (accessToken, refreshToken, profile, cb) => {
        try {
          console.log(profile);
          const result = await db.query("SELECT * FROM users WHERE email = $1", [
            profile.email,
          ]);
          if (result.rows.length === 0) {
            const newUser = await db.query(
              "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
              [profile.email, "google"]
            );
            return cb(null, newUser.rows[0]);
          } else {
            return cb(null, result.rows[0]);
          }
        } catch (err) {
          return cb(err);
        }
      }
    )
  );

  // Google auth routes
  app.get(
    "/auth/google",
    passport.authenticate("google", {
      scope: ["profile", "email"],
    })
  );

  app.get(
    "/auth/google/profile",
    passport.authenticate("google", {
      successRedirect: "/",
      failureRedirect: "/login",
    })
  );
}
//#endregion

//#region Serialize and Deserialize user
passport.serializeUser((user, cb) => {
  cb(null, user.id);
});

passport.deserializeUser(async (id, cb) => {
  try {
    const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    cb(null, result.rows[0]);
  } catch (err) {
    cb(err);
  }
});
//#endregion

//#region Profile routes
app.get("/u/:username", async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    const userResult = await db.query(
      "SELECT id, email, username, display_name, bio, avatar_url, banner_url, accent_color, pronouns, location, favorite_game, favorite_game_id, favorite_game_cover, profile_style, twitch_username, youtube_url, x_username, created_at, total_xp, profile_title FROM users WHERE LOWER(username) = $1",
      [username]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).send("User not found");
    }
    const profile = userResult.rows[0];

    // Reviews by this user
    const reviewsResult = await db.query(
      `SELECT games.*, users.email AS author_email, users.username AS author_username, users.display_name AS author_display_name
       FROM games
       LEFT JOIN users ON games.user_id = users.id
       WHERE games.user_id = $1
       ORDER BY games.released DESC NULLS LAST, games.id DESC`,
      [profile.id]
    );
    const userInfo = reviewsResult.rows;

    // Comments for these reviews
    let commentsByReview = {};
    if (userInfo.length > 0) {
      const reviewIds = userInfo.map((g) => g.id);
      const commentsResult = await db.query(
        `SELECT comments.*, users.email AS author_email, users.username AS author_username, users.display_name AS author_display_name
         FROM comments
         JOIN users ON comments.user_id = users.id
         WHERE comments.review_id = ANY($1)
         ORDER BY comments.created_at ASC`,
        [reviewIds]
      );
      for (const c of commentsResult.rows) {
        if (!commentsByReview[c.review_id]) commentsByReview[c.review_id] = [];
        commentsByReview[c.review_id].push(c);
      }
    }

    // Like counts + which the current user liked
    let likeCountByReview = {};
    let likedByUser = new Set();
    if (userInfo.length > 0) {
      const reviewIds = userInfo.map((g) => g.id);
      const likesResult = await db.query(
        `SELECT review_id, COUNT(*)::int AS count FROM likes WHERE review_id = ANY($1) GROUP BY review_id`,
        [reviewIds]
      );
      for (const row of likesResult.rows) {
        likeCountByReview[row.review_id] = row.count;
      }
      if (req.user) {
        const userLikes = await db.query(
          `SELECT review_id FROM likes WHERE user_id = $1 AND review_id = ANY($2)`,
          [req.user.id, reviewIds]
        );
        for (const row of userLikes.rows) {
          likedByUser.add(row.review_id);
        }
      }
    }

    // Follow counts + status
    const followerCountRes = await db.query(
      "SELECT COUNT(*)::int AS count FROM follows WHERE following_id = $1",
      [profile.id]
    );
    const followingCountRes = await db.query(
      "SELECT COUNT(*)::int AS count FROM follows WHERE follower_id = $1",
      [profile.id]
    );
    let isFollowing = false;
    let iBlockedThem = false;
    let theyBlockedMe = false;
    if (req.user && req.user.id !== profile.id) {
      const followCheck = await db.query(
        "SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2",
        [req.user.id, profile.id]
      );
      isFollowing = followCheck.rows.length > 0;
      try {
        const b1 = await db.query(
          "SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2",
          [req.user.id, profile.id]
        );
        iBlockedThem = b1.rows.length > 0;
        const b2 = await db.query(
          "SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2",
          [profile.id, req.user.id]
        );
        theyBlockedMe = b2.rows.length > 0;
      } catch (e) {}
    }

    // Social graph: "Followed by" + mutual following (viewer-aware)
    let followedBy = [];
    let mutualFollowing = [];
    if (req.user && req.user.id !== profile.id) {
      try {
        // People I follow who also follow this profile
        const fb = await db.query(
          `SELECT u.id, u.username, u.display_name, u.avatar_url
           FROM follows my_follows
           JOIN follows their_followers
             ON their_followers.follower_id = my_follows.following_id
            AND their_followers.following_id = $2
           JOIN users u ON u.id = my_follows.following_id
           WHERE my_follows.follower_id = $1
             AND u.username IS NOT NULL
             AND COALESCE(u.is_banned, FALSE) = FALSE
           ORDER BY u.username
           LIMIT 8`,
          [req.user.id, profile.id]
        );
        followedBy = fb.rows;
      } catch (e) {
        console.warn("followedBy query:", e.message);
      }

      try {
        // People we both follow
        const mutual = await db.query(
          `SELECT u.id, u.username, u.display_name, u.avatar_url
           FROM follows a
           JOIN follows b
             ON a.following_id = b.following_id
            AND b.follower_id = $2
           JOIN users u ON u.id = a.following_id
           WHERE a.follower_id = $1
             AND u.username IS NOT NULL
             AND u.id <> $1
             AND u.id <> $2
             AND COALESCE(u.is_banned, FALSE) = FALSE
           ORDER BY u.username
           LIMIT 8`,
          [req.user.id, profile.id]
        );
        mutualFollowing = mutual.rows;
      } catch (e) {
        console.warn("mutualFollowing query:", e.message);
      }
    }

    // Game status shelves
    let statusShelves = { want: [], playing: [], played: [] };
    try {
      const statusRes = await db.query(
        `SELECT game_id, status, title, cover_url, released, updated_at
         FROM game_statuses
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [profile.id]
      );
      for (const row of statusRes.rows) {
        if (statusShelves[row.status]) statusShelves[row.status].push(row);
      }
    } catch (e) {
      // table may not exist yet
    }

    // User lists
    let userLists = [];
    try {
      const listsRes = await db.query(
        `SELECT l.*, COUNT(li.id)::int AS item_count,
                (ARRAY_AGG(li.cover_url ORDER BY li.position ASC NULLS LAST, li.id ASC)
                  FILTER (WHERE li.cover_url IS NOT NULL))[1:3] AS preview_covers
         FROM lists l
         LEFT JOIN list_items li ON li.list_id = l.id
         WHERE l.user_id = $1
         GROUP BY l.id
         ORDER BY l.updated_at DESC`,
        [profile.id]
      );
      userLists = listsRes.rows;
    } catch (e) {
      // table may not exist yet
    }

    // Profile stats
    const year = new Date().getFullYear();
    let profileStats = {
      reviewCount: userInfo.length,
      avgRating: null,
      completedThisYear: 0,
      wantCount: statusShelves.want.length,
      playingCount: statusShelves.playing.length,
      playedCount: statusShelves.played.length,
      listCount: userLists.length,
      likesReceived: 0,
    };

    try {
      const avgRes = await db.query(
        `SELECT AVG(CAST(rating AS DOUBLE PRECISION)) AS avg_rating
         FROM games WHERE user_id = $1`,
        [profile.id]
      );
      if (avgRes.rows[0].avg_rating !== null) {
        profileStats.avgRating = Number(avgRes.rows[0].avg_rating);
      }
    } catch (e) {}

    try {
      const yearRes = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM games
         WHERE user_id = $1
           AND completed IS NOT NULL
           AND CAST(completed AS TEXT) <> ''
           AND EXTRACT(YEAR FROM CAST(completed AS DATE)) = $2`,
        [profile.id, year]
      );
      profileStats.completedThisYear = yearRes.rows[0].count;
    } catch (e) {
      // completed may not cast cleanly for all rows
      try {
        const yearRes = await db.query(
          `SELECT COUNT(*)::int AS count
           FROM games
           WHERE user_id = $1
             AND completed IS NOT NULL
             AND CAST(completed AS TEXT) LIKE $2`,
          [profile.id, year + "%"]
        );
        profileStats.completedThisYear = yearRes.rows[0].count;
      } catch (e2) {}
    }

    try {
      const likesRes = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM likes l
         JOIN games g ON g.id = l.review_id
         WHERE g.user_id = $1`,
        [profile.id]
      );
      profileStats.likesReceived = likesRes.rows[0].count;
    } catch (e) {}

    // Live Twitch stream for this profile (if linked)
    let liveStream = null;
    if (profile.twitch_username) {
      try {
        liveStream = await getTwitchStreamByLogin(profile.twitch_username);
      } catch (e) {
        console.warn("Twitch profile stream error:", e.message);
      }
    }

    // Achievements (backfill + load)
    await checkAndUnlockAchievements(profile.id);
    const unlockedAchievements = await getUserAchievements(profile.id);
    const xpInfo = await getXpInfo(profile.id);
    const allAchievements = Object.values(ACHIEVEMENTS).map((a) => {
      const unlocked = unlockedAchievements.find((u) => u.id === a.id);
      return {
        ...a,
        unlocked: !!unlocked,
        unlocked_at: unlocked ? unlocked.unlocked_at : null,
      };
    });

    res.render("profile.ejs", {
      profile,
      userInfo,
      userlog: req.user,
      commentsByReview,
      reviewCount: userInfo.length,
      followerCount: followerCountRes.rows[0].count,
      followingCount: followingCountRes.rows[0].count,
      isFollowing,
      iBlockedThem,
      theyBlockedMe,
      followedBy,
      mutualFollowing,
      likeCountByReview,
      likedByUser,
      statusShelves,
      userLists,
      profileStats,
      statsYear: year,
      liveStream,
      twitchParent: twitchEmbedParent(req),
      achievements: allAchievements,
      unlockedCount: unlockedAchievements.length,
      totalAchievements: Object.keys(ACHIEVEMENTS).length,
      xpInfo,
    });
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).send("Something went wrong");
  }
});

app.get("/u/:username/followers", async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    const userResult = await db.query(
      "SELECT id, username, display_name FROM users WHERE LOWER(username) = $1",
      [username]
    );
    if (userResult.rows.length === 0) return res.status(404).send("User not found");
    const profile = userResult.rows[0];

    const listResult = await db.query(
      `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url
       FROM follows f
       JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = $1
       ORDER BY f.created_at DESC`,
      [profile.id]
    );

    let users = listResult.rows;
    if (req.user && users.length > 0) {
      const ids = users.map((u) => u.id);
      const myFollows = await db.query(
        `SELECT following_id FROM follows WHERE follower_id = $1 AND following_id = ANY($2)`,
        [req.user.id, ids]
      );
      const followedSet = new Set(myFollows.rows.map((r) => r.following_id));
      users = users.map((u) => ({ ...u, is_followed_by_me: followedSet.has(u.id) }));
    }

    res.render("follow-list.ejs", {
      profile,
      users,
      listType: "followers",
      listTitle: "Followers",
      userlog: req.user,
    });
  } catch (err) {
    console.error("Followers list error:", err);
    res.status(500).send("Something went wrong");
  }
});

app.get("/u/:username/following", async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    const userResult = await db.query(
      "SELECT id, username, display_name FROM users WHERE LOWER(username) = $1",
      [username]
    );
    if (userResult.rows.length === 0) return res.status(404).send("User not found");
    const profile = userResult.rows[0];

    const listResult = await db.query(
      `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url
       FROM follows f
       JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = $1
       ORDER BY f.created_at DESC`,
      [profile.id]
    );

    let users = listResult.rows;
    if (req.user && users.length > 0) {
      const ids = users.map((u) => u.id);
      const myFollows = await db.query(
        `SELECT following_id FROM follows WHERE follower_id = $1 AND following_id = ANY($2)`,
        [req.user.id, ids]
      );
      const followedSet = new Set(myFollows.rows.map((r) => r.following_id));
      users = users.map((u) => ({ ...u, is_followed_by_me: followedSet.has(u.id) }));
    }

    res.render("follow-list.ejs", {
      profile,
      users,
      listType: "following",
      listTitle: "Following",
      userlog: req.user,
    });
  } catch (err) {
    console.error("Following list error:", err);
    res.status(500).send("Something went wrong");
  }
});

//#region Game pages + site search
app.get("/game/:gameId", async (req, res) => {
  const gameId = parseInt(req.params.gameId, 10);
  if (!gameId) return res.status(404).send("Game not found");

  try {
    const reviewsResult = await db.query(
      `SELECT games.*, users.email AS author_email,
              users.username AS author_username, users.display_name AS author_display_name
       FROM games
       LEFT JOIN users ON games.user_id = users.id
       WHERE games.game_id = $1
       ORDER BY games.id DESC`,
      [gameId]
    );
    const userInfo = reviewsResult.rows;

    // Community stats
    let statsResult;
    try {
      statsResult = await db.query(
        `SELECT COUNT(*)::int AS review_count,
                AVG(CAST(rating AS DOUBLE PRECISION)) AS avg_rating,
                MAX(title) AS title,
                MAX(cover_url) AS cover_url,
                MAX(CAST(released AS TEXT)) AS released
         FROM games
         WHERE game_id = $1`,
        [gameId]
      );
    } catch (e) {
      console.warn("Game stats fallback:", e.message);
      statsResult = await db.query(
        `SELECT COUNT(*)::int AS review_count,
                AVG(CAST(rating AS DOUBLE PRECISION)) AS avg_rating,
                MAX(title) AS title,
                NULL::text AS cover_url,
                MAX(CAST(released AS TEXT)) AS released
         FROM games
         WHERE game_id = $1`,
        [gameId]
      );
    }
    const stats = statsResult.rows[0];

    // If no local reviews, still show a page using IGDB for title/cover
    let gameTitle = stats.title;
    let coverUrl = stats.cover_url;
    let released = stats.released;
    let avgRating = stats.avg_rating;
    let reviewCount = stats.review_count || 0;

    if (!gameTitle && process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET) {
      try {
        // reuse token helper if available - call search by id via IGDB
        const { token, clientId } = await getIgdbToken();
        const body = `where id = ${gameId}; fields name, first_release_date, cover.image_id;`;
        const igdbRes = await axios.post("https://api.igdb.com/v4/games", body, {
          headers: {
            "Client-ID": clientId,
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "text/plain",
          },
        });
        if (igdbRes.data && igdbRes.data[0]) {
          const g = igdbRes.data[0];
          gameTitle = g.name;
          if (g.cover && g.cover.image_id) {
            coverUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`;
          }
          if (g.first_release_date) {
            released = new Date(g.first_release_date * 1000).toISOString().slice(0, 10);
          }
        }
      } catch (err) {
        console.error("IGDB game fetch error:", err.message);
      }
    }

    if (!gameTitle) {
      return res.status(404).send("Game not found");
    }

    // Comments + likes for these reviews
    let commentsByReview = {};
    let likeCountByReview = {};
    let likedByUser = new Set();
    if (userInfo.length > 0) {
      const reviewIds = userInfo.map((g) => g.id);
      const commentsResult = await db.query(
        `SELECT comments.*, users.email AS author_email,
                users.username AS author_username, users.display_name AS author_display_name
         FROM comments
         JOIN users ON comments.user_id = users.id
         WHERE comments.review_id = ANY($1)
         ORDER BY comments.created_at ASC`,
        [reviewIds]
      );
      for (const c of commentsResult.rows) {
        if (!commentsByReview[c.review_id]) commentsByReview[c.review_id] = [];
        commentsByReview[c.review_id].push(c);
      }

      const likesResult = await db.query(
        `SELECT review_id, COUNT(*)::int AS count FROM likes WHERE review_id = ANY($1) GROUP BY review_id`,
        [reviewIds]
      );
      for (const row of likesResult.rows) {
        likeCountByReview[row.review_id] = row.count;
      }
      if (req.user) {
        const userLikes = await db.query(
          `SELECT review_id FROM likes WHERE user_id = $1 AND review_id = ANY($2)`,
          [req.user.id, reviewIds]
        );
        for (const row of userLikes.rows) {
          likedByUser.add(row.review_id);
        }
      }
    }

    // Current user's status for this game
    let userStatus = null;
    if (req.user) {
      try {
        const st = await db.query(
          "SELECT status FROM game_statuses WHERE user_id = $1 AND game_id = $2",
          [req.user.id, gameId]
        );
        if (st.rows.length) userStatus = st.rows[0].status;
      } catch (e) {
        // table may not exist yet
      }
    }

    // Fans also liked: other games reviewed by people who reviewed this one
    let fansAlsoLiked = [];
    try {
      const also = await db.query(
        `SELECT g.game_id,
                MAX(g.title) AS title,
                MAX(g.cover_url) AS cover_url,
                COUNT(*)::int AS shared_reviewers,
                AVG(CAST(g.rating AS DOUBLE PRECISION)) AS avg_rating
         FROM games g
         WHERE g.user_id IN (
           SELECT DISTINCT user_id FROM games WHERE game_id = $1 AND user_id IS NOT NULL
         )
         AND g.game_id IS NOT NULL
         AND g.game_id <> $1
         GROUP BY g.game_id
         HAVING COUNT(*) >= 1
         ORDER BY shared_reviewers DESC, avg_rating DESC NULLS LAST
         LIMIT 8`,
        [gameId]
      );
      fansAlsoLiked = also.rows;
    } catch (e) {
      console.warn("Fans also liked:", e.message);
    }

    // Top live Twitch stream for this game
    let topStream = null;
    try {
      if (process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET) {
        topStream = await getTopTwitchStreamForGame(gameTitle);
      }
    } catch (e) {
      console.warn("Twitch game stream error:", e.message);
    }

    res.render("game.ejs", {
      gameId,
      gameTitle,
      coverUrl,
      released,
      avgRating,
      reviewCount,
      userInfo,
      userlog: req.user,
      commentsByReview,
      likeCountByReview,
      likedByUser,
      userStatus,
      fansAlsoLiked,
      topStream,
      twitchParent: twitchEmbedParent(req),
    });
  } catch (err) {
    console.error("Game page error:", err);
    res.status(500).send("Something went wrong");
  }
});

app.post("/game/:gameId/status", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const gameId = parseInt(req.params.gameId, 10);
  if (!gameId) return res.redirect("back");

  const status = (req.body.status || "").trim();
  const allowed = ["want", "playing", "played"];

  try {
    if (!status || !allowed.includes(status)) {
      // Clear status
      await db.query(
        "DELETE FROM game_statuses WHERE user_id = $1 AND game_id = $2",
        [req.user.id, gameId]
      );
    } else {
      const title = (req.body.title || "").trim() || null;
      const coverUrl = (req.body.cover_url || "").trim() || null;
      const released = req.body.released || null;

      await db.query(
        `INSERT INTO game_statuses (user_id, game_id, status, title, cover_url, released, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, game_id)
         DO UPDATE SET status = EXCLUDED.status,
                       title = COALESCE(EXCLUDED.title, game_statuses.title),
                       cover_url = COALESCE(EXCLUDED.cover_url, game_statuses.cover_url),
                       released = COALESCE(EXCLUDED.released, game_statuses.released),
                       updated_at = CURRENT_TIMESTAMP`,
        [req.user.id, gameId, status, title, coverUrl, released]
      );
      await checkAndUnlockAchievements(req.user.id);
      await grantXp(req.user.id, "status");
    }
  } catch (err) {
    console.error("Status update error:", err.message);
  }

  res.redirect(req.get("Referer") || `/game/${gameId}`);
});

app.get("/review/:id", async (req, res) => {
  const reviewId = parseInt(req.params.id, 10);
  if (!reviewId) return res.status(404).send("Review not found");

  try {
    const reviewRes = await db.query(
      `SELECT games.*, users.email AS author_email,
              users.username AS author_username, users.display_name AS author_display_name,
              users.avatar_url AS author_avatar
       FROM games
       LEFT JOIN users ON games.user_id = users.id
       WHERE games.id = $1`,
      [reviewId]
    );
    if (!reviewRes.rows.length) return res.status(404).send("Review not found");

    const userInfo = reviewRes.rows;

    // Comments
    const commentsResult = await db.query(
      `SELECT comments.*, users.email AS author_email,
              users.username AS author_username, users.display_name AS author_display_name
       FROM comments
       JOIN users ON comments.user_id = users.id
       WHERE comments.review_id = $1
       ORDER BY comments.created_at ASC`,
      [reviewId]
    );
    const commentsByReview = { [reviewId]: commentsResult.rows };

    // Likes
    let likeCountByReview = {};
    let likedByUser = new Set();
    const likesResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM likes WHERE review_id = $1`,
      [reviewId]
    );
    likeCountByReview[reviewId] = likesResult.rows[0].count;
    if (req.user) {
      const userLike = await db.query(
        `SELECT 1 FROM likes WHERE user_id = $1 AND review_id = $2`,
        [req.user.id, reviewId]
      );
      if (userLike.rows.length) likedByUser.add(reviewId);
    }

    const shareUrl = `${req.protocol}://${req.get("host")}/review/${reviewId}`;

    res.render("review.ejs", {
      userInfo,
      userlog: req.user,
      commentsByReview,
      likeCountByReview,
      likedByUser,
      shareUrl,
      review: userInfo[0],
    });
  } catch (err) {
    console.error("Review page error:", err);
    res.status(500).send("Something went wrong");
  }
});

app.get("/search", async (req, res) => {
  try {
    let localGames = [];
    try {
      const localResult = await db.query(
        `SELECT game_id,
                MAX(title) AS title,
                MAX(cover_url) AS cover_url,
                COUNT(*)::int AS review_count,
                AVG(CAST(rating AS DOUBLE PRECISION)) AS avg_rating
         FROM games
         GROUP BY game_id
         ORDER BY review_count DESC, avg_rating DESC NULLS LAST
         LIMIT 20`
      );
      localGames = localResult.rows;
    } catch (innerErr) {
      console.warn("Search local games query issue:", innerErr.message);
      try {
        const localResult = await db.query(
          `SELECT game_id,
                  MAX(title) AS title,
                  COUNT(*)::int AS review_count,
                  AVG(CAST(rating AS DOUBLE PRECISION)) AS avg_rating
           FROM games
           GROUP BY game_id
           ORDER BY review_count DESC, avg_rating DESC NULLS LAST
           LIMIT 20`
        );
        localGames = localResult.rows.map((r) => ({ ...r, cover_url: null }));
      } catch (innerErr2) {
        console.warn("Search local games unavailable:", innerErr2.message);
        localGames = [];
      }
    }

    res.render("search.ejs", {
      userlog: req.user,
      localGames,
      query: req.query.q || "",
    });
  } catch (err) {
    console.error("Search page error:", err);
    // Still show the search UI even if local list fails
    res.render("search.ejs", {
      userlog: req.user,
      localGames: [],
      query: req.query.q || "",
    });
  }
});
//#endregion

//#region Leaderboards
app.get("/leaderboards", async (req, res) => {
  const minReviews = 1; // raise to 3 when the community is bigger
  const year = new Date().getFullYear();
  const limit = 10;

  let topRated = [];
  let mostReviewed = [];
  let topReviewers = [];
  let topLiked = [];
  let topThisYear = [];

  try {
    // Highest rated games (community avg)
    try {
      const r = await db.query(
        `SELECT game_id,
                MAX(title) AS title,
                MAX(cover_url) AS cover_url,
                COUNT(*)::int AS review_count,
                AVG(CAST(rating AS DOUBLE PRECISION)) AS avg_rating
         FROM games
         GROUP BY game_id
         HAVING COUNT(*) >= $1
         ORDER BY avg_rating DESC NULLS LAST, review_count DESC
         LIMIT $2`,
        [minReviews, limit]
      );
      topRated = r.rows;
    } catch (e) {
      const r = await db.query(
        `SELECT game_id,
                MAX(title) AS title,
                COUNT(*)::int AS review_count,
                AVG(CAST(rating AS DOUBLE PRECISION)) AS avg_rating
         FROM games
         GROUP BY game_id
         HAVING COUNT(*) >= $1
         ORDER BY avg_rating DESC NULLS LAST, review_count DESC
         LIMIT $2`,
        [minReviews, limit]
      );
      topRated = r.rows.map((row) => ({ ...row, cover_url: null }));
    }

    // Most reviewed games
    try {
      const r = await db.query(
        `SELECT game_id,
                MAX(title) AS title,
                MAX(cover_url) AS cover_url,
                COUNT(*)::int AS review_count,
                AVG(CAST(rating AS DOUBLE PRECISION)) AS avg_rating
         FROM games
         GROUP BY game_id
         ORDER BY review_count DESC, avg_rating DESC NULLS LAST
         LIMIT $1`,
        [limit]
      );
      mostReviewed = r.rows;
    } catch (e) {
      const r = await db.query(
        `SELECT game_id,
                MAX(title) AS title,
                COUNT(*)::int AS review_count,
                AVG(CAST(rating AS DOUBLE PRECISION)) AS avg_rating
         FROM games
         GROUP BY game_id
         ORDER BY review_count DESC, avg_rating DESC NULLS LAST
         LIMIT $1`,
        [limit]
      );
      mostReviewed = r.rows.map((row) => ({ ...row, cover_url: null }));
    }

    // Most active reviewers
    const reviewers = await db.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url,
              COUNT(g.id)::int AS review_count
       FROM users u
       JOIN games g ON g.user_id = u.id
       GROUP BY u.id
       ORDER BY review_count DESC
       LIMIT $1`,
      [limit]
    );
    topReviewers = reviewers.rows;

    // Most liked reviewers
    try {
      const liked = await db.query(
        `SELECT u.id, u.username, u.display_name, u.avatar_url,
                COUNT(l.id)::int AS likes_count
         FROM users u
         JOIN games g ON g.user_id = u.id
         JOIN likes l ON l.review_id = g.id
         GROUP BY u.id
         ORDER BY likes_count DESC
         LIMIT $1`,
        [limit]
      );
      topLiked = liked.rows;
    } catch (e) {
      topLiked = [];
    }

    // Completions this year
    try {
      const yr = await db.query(
        `SELECT u.id, u.username, u.display_name, u.avatar_url,
                COUNT(g.id)::int AS completed_count
         FROM users u
         JOIN games g ON g.user_id = u.id
         WHERE g.completed IS NOT NULL
           AND CAST(g.completed AS TEXT) <> ''
           AND (
             EXTRACT(YEAR FROM CAST(g.completed AS DATE)) = $1
             OR CAST(g.completed AS TEXT) LIKE $2
           )
         GROUP BY u.id
         ORDER BY completed_count DESC
         LIMIT $3`,
        [year, String(year) + "%", limit]
      );
      topThisYear = yr.rows;
    } catch (e) {
      try {
        const yr = await db.query(
          `SELECT u.id, u.username, u.display_name, u.avatar_url,
                  COUNT(g.id)::int AS completed_count
           FROM users u
           JOIN games g ON g.user_id = u.id
           WHERE g.completed IS NOT NULL
             AND CAST(g.completed AS TEXT) LIKE $1
           GROUP BY u.id
           ORDER BY completed_count DESC
           LIMIT $2`,
          [String(year) + "%", limit]
        );
        topThisYear = yr.rows;
      } catch (e2) {
        topThisYear = [];
      }
    }
  } catch (err) {
    console.error("Leaderboards error:", err);
  }

  res.render("leaderboards.ejs", {
    userlog: req.user,
    topRated,
    mostReviewed,
    topReviewers,
    topLiked,
    topThisYear,
    minReviews,
    year,
  });
});
//#endregion

//#region Diary
app.get("/u/:username/diary", async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    const userResult = await db.query(
      "SELECT id, username, display_name FROM users WHERE LOWER(username) = $1",
      [username]
    );
    if (!userResult.rows.length) return res.status(404).send("User not found");
    const profile = userResult.rows[0];

    // Reviews with a completion date, newest first
    let entries = [];
    try {
      const result = await db.query(
        `SELECT id, game_id, title, rating, notes, completed, cover_url, released
         FROM games
         WHERE user_id = $1
           AND completed IS NOT NULL
           AND CAST(completed AS TEXT) <> ''
         ORDER BY completed DESC NULLS LAST, id DESC`,
        [profile.id]
      );
      entries = result.rows;
    } catch (e) {
      // Fallback without cover_url
      const result = await db.query(
        `SELECT id, game_id, title, rating, notes, completed, released
         FROM games
         WHERE user_id = $1
           AND completed IS NOT NULL
           AND CAST(completed AS TEXT) <> ''
         ORDER BY completed DESC NULLS LAST, id DESC`,
        [profile.id]
      );
      entries = result.rows.map((r) => ({ ...r, cover_url: null }));
    }

    res.render("diary.ejs", {
      profile,
      entries,
      userlog: req.user,
    });
  } catch (err) {
    console.error("Diary error:", err);
    res.status(500).send("Something went wrong");
  }
});
//#endregion

//#region Lists
app.get("/lists/new", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  res.render("new-list.ejs", { userlog: req.user });
});

app.post("/lists", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const title = (req.body.title || "").trim();
  const description = (req.body.description || "").trim().slice(0, 500);
  const isRanked = req.body.is_ranked === "1" || req.body.is_ranked === "on";

  if (!title || title.length < 1) {
    return res.render("new-list.ejs", { userlog: req.user, error: "Title is required." });
  }

  try {
    const result = await db.query(
      `INSERT INTO lists (user_id, title, description, is_ranked)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.id, title.slice(0, 150), description, isRanked]
    );
    await checkAndUnlockAchievements(req.user.id);
    await grantXp(req.user.id, "list");
    res.redirect(`/lists/${result.rows[0].id}`);
  } catch (err) {
    console.error("Create list error:", err.message);
    res.render("new-list.ejs", { userlog: req.user, error: "Could not create list." });
  }
});

app.get("/lists/:id", async (req, res) => {
  const listId = parseInt(req.params.id, 10);
  if (!listId) return res.status(404).send("List not found");

  try {
    const listRes = await db.query("SELECT * FROM lists WHERE id = $1", [listId]);
    if (!listRes.rows.length) return res.status(404).send("List not found");
    const list = listRes.rows[0];

    const ownerRes = await db.query(
      "SELECT id, username, display_name FROM users WHERE id = $1",
      [list.user_id]
    );
    const owner = ownerRes.rows[0];

    const order = list.is_ranked
      ? "ORDER BY position ASC, added_at ASC"
      : "ORDER BY added_at DESC";
    const itemsRes = await db.query(
      `SELECT * FROM list_items WHERE list_id = $1 ${order}`,
      [listId]
    );

    res.render("list.ejs", {
      list,
      owner,
      items: itemsRes.rows,
      userlog: req.user,
    });
  } catch (err) {
    console.error("List page error:", err);
    res.status(500).send("Something went wrong");
  }
});

app.post("/lists/:id/items", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const listId = parseInt(req.params.id, 10);
  const gameId = parseInt(req.body.game_id, 10);
  const title = (req.body.title || "").trim();
  const coverUrl = (req.body.cover_url || "").trim() || null;

  if (!listId || !gameId || !title) return res.redirect("back");

  try {
    const listRes = await db.query("SELECT * FROM lists WHERE id = $1", [listId]);
    if (!listRes.rows.length || listRes.rows[0].user_id !== req.user.id) {
      return res.status(403).send("Not allowed");
    }

    // Next position for ranked lists
    let position = 0;
    if (listRes.rows[0].is_ranked) {
      const posRes = await db.query(
        "SELECT COALESCE(MAX(position), 0) + 1 AS next FROM list_items WHERE list_id = $1",
        [listId]
      );
      position = posRes.rows[0].next;
    }

    const listMeta = listRes.rows[0];
    await db.query(
      `INSERT INTO list_items (list_id, game_id, title, cover_url, position)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (list_id, game_id) DO NOTHING`,
      [listId, gameId, title, coverUrl, position]
    );

    await db.query("UPDATE lists SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [listId]);
    await createActivity({
      actorId: req.user.id,
      type: "list_add",
      entityType: "list",
      entityId: listId,
      meta: {
        list_title: listMeta.title,
        game_id: gameId,
        game_title: title,
        cover_url: coverUrl,
      },
    });
  } catch (err) {
    console.error("Add list item error:", err.message);
  }
  res.redirect(`/lists/${listId}`);
});

app.post("/lists/:id/items/:itemId/move", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const listId = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  const direction = (req.body.direction || "").toLowerCase(); // "up" | "down"

  if (!listId || !itemId || !["up", "down"].includes(direction)) {
    return res.redirect(`/lists/${listId || ""}`);
  }

  try {
    const listRes = await db.query("SELECT * FROM lists WHERE id = $1", [listId]);
    if (!listRes.rows.length || listRes.rows[0].user_id !== req.user.id) {
      return res.status(403).send("Not allowed");
    }
    if (!listRes.rows[0].is_ranked) {
      return res.redirect(`/lists/${listId}`);
    }

    const itemsRes = await db.query(
      "SELECT id FROM list_items WHERE list_id = $1 ORDER BY position ASC, added_at ASC, id ASC",
      [listId]
    );
    const ids = itemsRes.rows.map((r) => r.id);
    const idx = ids.indexOf(itemId);
    if (idx === -1) return res.redirect(`/lists/${listId}`);

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= ids.length) {
      return res.redirect(`/lists/${listId}`);
    }

    // Swap in array, then renumber 1..n
    const tmp = ids[idx];
    ids[idx] = ids[swapIdx];
    ids[swapIdx] = tmp;

    for (let i = 0; i < ids.length; i++) {
      await db.query("UPDATE list_items SET position = $1 WHERE id = $2", [i + 1, ids[i]]);
    }

    await db.query("UPDATE lists SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [listId]);
  } catch (err) {
    console.error("Move list item error:", err.message);
  }
  res.redirect(`/lists/${listId}`);
});

app.post("/lists/:id/items/:itemId/delete", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const listId = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);

  try {
    const listRes = await db.query("SELECT user_id FROM lists WHERE id = $1", [listId]);
    if (!listRes.rows.length || listRes.rows[0].user_id !== req.user.id) {
      return res.status(403).send("Not allowed");
    }
    await db.query("DELETE FROM list_items WHERE id = $1 AND list_id = $2", [itemId, listId]);
  } catch (err) {
    console.error("Remove list item error:", err.message);
  }
  res.redirect(`/lists/${listId}`);
});

app.post("/lists/:id/delete", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const listId = parseInt(req.params.id, 10);

  try {
    const listRes = await db.query("SELECT user_id FROM lists WHERE id = $1", [listId]);
    if (!listRes.rows.length || listRes.rows[0].user_id !== req.user.id) {
      return res.status(403).send("Not allowed");
    }
    await db.query("DELETE FROM lists WHERE id = $1", [listId]);
    const username = req.user.username;
    return res.redirect(username ? `/u/${username}` : "/");
  } catch (err) {
    console.error("Delete list error:", err.message);
  }
  res.redirect("/");
});
//#endregion

//#region Web Push
app.get("/api/push/vapid-public-key", (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: "Push not configured" });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/push/subscribe", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Login required" });
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "Invalid subscription" });
    }
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Push subscribe error:", err.message);
    res.status(500).json({ error: "Could not save subscription" });
  }
});

app.post("/api/push/unsubscribe", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Login required" });
  try {
    const endpoint = req.body?.endpoint;
    if (!endpoint) return res.status(400).json({ error: "Missing endpoint" });
    await db.query(
      "DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
      [req.user.id, endpoint]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Could not unsubscribe" });
  }
});
//#endregion

//#region Notification routes
app.get("/notifications", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  try {
    const result = await db.query(
      `SELECT n.*,
              u.username AS actor_username,
              u.display_name AS actor_display_name,
              u.avatar_url AS actor_avatar
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    // Mark all as read when opening the page
    await db.query(
      "UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE",
      [req.user.id]
    );
    res.locals.unreadNotifications = 0;

    res.render("notifications.ejs", {
      userlog: req.user,
      notifications: result.rows,
    });
  } catch (err) {
    console.error("Notifications error:", err);
    res.status(500).send("Something went wrong");
  }
});

app.post("/notifications/read", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  try {
    await db.query(
      "UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE",
      [req.user.id]
    );
  } catch (err) {
    console.error("Mark read error:", err.message);
  }
  res.redirect("/notifications");
});
//#endregion

app.get("/profile/edit", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  res.render("edit-profile.ejs", { user: req.user });
});

app.post("/profile/avatar", (req, res) => {
  if (!req.isAuthenticated()) {
    if ((req.get("Accept") || "").includes("application/json")) {
      return res.status(401).json({ ok: false, error: "Login required" });
    }
    return res.redirect("/login");
  }

  const wantsJson = (req.get("Accept") || "").includes("application/json");

  avatarUpload.single("avatar")(req, res, async (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE"
        ? "Image must be under 5 MB."
        : (err.message || "Upload failed.");
      if (wantsJson) return res.status(400).json({ ok: false, error: msg });
      return res.render("edit-profile.ejs", { user: req.user, error: msg });
    }
    if (!req.file || !req.file.buffer) {
      if (wantsJson) return res.status(400).json({ ok: false, error: "Please choose an image file." });
      return res.render("edit-profile.ejs", { user: req.user, error: "Please choose an image file." });
    }

    try {
      const avatarUrl = await processAndSaveAvatar(req.user.id, req.file.buffer);

      // Remove previous local upload if we stored one
      if (req.user.avatar_url && req.user.avatar_url.startsWith("/uploads/avatars/")) {
        const oldPath = path.join(__dirname, "public", req.user.avatar_url);
        fs.promises.unlink(oldPath).catch(() => {});
      }

      const result = await db.query(
        `UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING *`,
        [avatarUrl, req.user.id]
      );

      req.login(result.rows[0], (loginErr) => {
        if (loginErr) console.error(loginErr);
        if (wantsJson) {
          return res.json({ ok: true, avatar_url: avatarUrl });
        }
        res.render("edit-profile.ejs", {
          user: result.rows[0],
          success: "Profile photo updated.",
        });
      });
    } catch (e) {
      console.error("Avatar upload error:", e.message);
      if (wantsJson) {
        return res.status(500).json({ ok: false, error: "Could not process image." });
      }
      res.render("edit-profile.ejs", {
        user: req.user,
        error: "Could not process image. Try a different file.",
      });
    }
  });
});


app.post("/profile/banner", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  // Make sure column exists before write
  const run = async () => {
    try {
      await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT`);
    } catch (e) {}

    bannerUpload.single("banner")(req, res, async (err) => {
      if (err) {
        console.error("Banner multer error:", err);
        const msg = err.code === "LIMIT_FILE_SIZE"
          ? "Banner must be under 8 MB."
          : (err.message || "Upload failed.");
        return res.render("edit-profile.ejs", { user: req.user, error: msg });
      }
      if (!req.file || !req.file.buffer) {
        return res.render("edit-profile.ejs", {
          user: req.user,
          error: "Please choose a banner image file.",
        });
      }

      try {
        fs.mkdirSync(bannerDir, { recursive: true });
        const bannerUrl = await processAndSaveBanner(req.user.id, req.file.buffer);
        console.log("Banner saved:", bannerUrl, "bytes in:", req.file.buffer.length);

        if (req.user.banner_url && String(req.user.banner_url).startsWith("/uploads/banners/")) {
          const oldPath = path.join(__dirname, "public", req.user.banner_url);
          fs.promises.unlink(oldPath).catch(() => {});
        }

        const result = await db.query(
          `UPDATE users SET banner_url = $1 WHERE id = $2 RETURNING *`,
          [bannerUrl, req.user.id]
        );
        if (!result.rows.length) {
          return res.render("edit-profile.ejs", {
            user: req.user,
            error: "Could not update user banner_url.",
          });
        }

        req.login(result.rows[0], (loginErr) => {
          if (loginErr) console.error(loginErr);
          res.render("edit-profile.ejs", {
            user: result.rows[0],
            success: "Banner updated. Open your profile to see it.",
          });
        });
      } catch (e) {
        console.error("Banner upload error:", e);
        res.render("edit-profile.ejs", {
          user: req.user,
          error: "Could not process banner: " + (e.message || "unknown error"),
        });
      }
    });
  };

  run();
});

app.post("/profile/banner/remove", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  try {
    if (req.user.banner_url && req.user.banner_url.startsWith("/uploads/banners/")) {
      const oldPath = path.join(__dirname, "public", req.user.banner_url);
      fs.promises.unlink(oldPath).catch(() => {});
    }
    const result = await db.query(
      `UPDATE users SET banner_url = NULL WHERE id = $1 RETURNING *`,
      [req.user.id]
    );
    req.login(result.rows[0], (err) => {
      if (err) console.error(err);
      res.render("edit-profile.ejs", { user: result.rows[0], success: "Banner removed." });
    });
  } catch (e) {
    res.redirect("/profile/edit");
  }
});

app.post("/profile/edit", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  const handle = (req.body.username || "").trim().toLowerCase();
  const displayName = (req.body.display_name || "").trim();
  const bio = (req.body.bio || "").trim().slice(0, 300);
  const avatarUrl = (req.body.avatar_url || "").trim() || null;
  let twitchUsername = (req.body.twitch_username || "").trim().toLowerCase() || null;
  if (twitchUsername) {
    twitchUsername = twitchUsername.replace(/^https?:\/\/(www\.)?twitch\.tv\//, "").split("/")[0].split("?")[0];
    twitchUsername = twitchUsername.replace(/[^a-z0-9_]/g, "") || null;
  }

  let youtubeUrl = (req.body.youtube_url || "").trim() || null;
  if (youtubeUrl) {
    // Accept full URL or @handle / channel path
    if (!/^https?:\/\//i.test(youtubeUrl)) {
      const handle = youtubeUrl.replace(/^@/, "");
      youtubeUrl = `https://www.youtube.com/@${handle}`;
    }
  }

  let xUsername = (req.body.x_username || "").trim().replace(/^@/, "").toLowerCase() || null;
  if (xUsername) {
    xUsername = xUsername.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//, "").split("/")[0].split("?")[0];
    xUsername = xUsername.replace(/[^a-z0-9_]/g, "") || null;
  }

  if (!isValidUsername(handle) || RESERVED_USERNAMES.has(handle)) {
    return res.render("edit-profile.ejs", {
      user: { ...req.user, ...req.body },
      error: "Invalid username. Use 3–30 lowercase letters, numbers, or underscores, starting with a letter.",
    });
  }

  try {
    // Check uniqueness (excluding self)
    const existing = await db.query(
      "SELECT id FROM users WHERE LOWER(username) = $1 AND id != $2",
      [handle, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.render("edit-profile.ejs", {
        user: { ...req.user, username: handle, display_name: displayName, bio, avatar_url: avatarUrl, twitch_username: twitchUsername },
        error: "That username is already taken.",
      });
    }

    const pronouns = (req.body.pronouns || "").trim().slice(0, 40) || null;
    const location = (req.body.location || "").trim().slice(0, 80) || null;
    const favoriteGame = (req.body.favorite_game || "").trim().slice(0, 120) || null;
    const favoriteGameId = parseInt(req.body.favorite_game_id, 10) || null;
    const favoriteGameCover = (req.body.favorite_game_cover || "").trim() || null;
    let accentColor = (req.body.accent_color || "").trim() || "#4f8cff";
    if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) accentColor = "#4f8cff";
    const allowedStyles = ["default", "compact", "vivid"];
    const profileStyle = allowedStyles.includes(req.body.profile_style) ? req.body.profile_style : "default";

    let result;
    try {
      result = await db.query(
        `UPDATE users
         SET username = $1, display_name = $2, bio = $3, avatar_url = $4,
             twitch_username = $5, youtube_url = $6, x_username = $7,
             pronouns = $8, location = $9, favorite_game = $10,
             favorite_game_id = $11, favorite_game_cover = $12,
             accent_color = $13, profile_style = $14
         WHERE id = $15
         RETURNING *`,
        [handle, displayName || handle, bio, avatarUrl, twitchUsername, youtubeUrl, xUsername,
         pronouns, location, favoriteGame, favoriteGameId, favoriteGameCover,
         accentColor, profileStyle, req.user.id]
      );
    } catch (e) {
      // columns may not exist yet — fall back
      result = await db.query(
        `UPDATE users
         SET username = $1, display_name = $2, bio = $3, avatar_url = $4,
             twitch_username = $5, youtube_url = $6, x_username = $7
         WHERE id = $8
         RETURNING *`,
        [handle, displayName || handle, bio, avatarUrl, twitchUsername, youtubeUrl, xUsername, req.user.id]
      );
    }

    await checkAndUnlockAchievements(req.user.id);

    // Refresh session user
    req.login(result.rows[0], (err) => {
      if (err) console.error(err);
      res.render("edit-profile.ejs", {
        user: result.rows[0],
        success: "Profile updated successfully.",
      });
    });
  } catch (err) {
    console.error("Edit profile error:", err);
    res.render("edit-profile.ejs", {
      user: req.user,
      error: "Could not update profile. Please try again.",
    });
  }
});
//#endregion

//#region Likes
function wantsJson(req) {
  const accept = req.get("Accept") || "";
  return (
    req.xhr ||
    accept.includes("application/json") ||
    req.get("X-Requested-With") === "XMLHttpRequest"
  );
}

app.post("/like/:reviewId", async (req, res) => {
  if (!req.isAuthenticated()) {
    if (wantsJson(req)) return res.status(401).json({ error: "Login required" });
    return res.redirect("/login");
  }
  const reviewId = parseInt(req.params.reviewId, 10);
  if (!reviewId) {
    if (wantsJson(req)) return res.status(400).json({ error: "Invalid review" });
    return res.redirect("back");
  }

  try {
    await db.query(
      `INSERT INTO likes (user_id, review_id) VALUES ($1, $2)
       ON CONFLICT (user_id, review_id) DO NOTHING`,
      [req.user.id, reviewId]
    );
    const countRes = await db.query(
      "SELECT COUNT(*)::int AS count FROM likes WHERE review_id = $1",
      [reviewId]
    );
    try {
      const author = await db.query("SELECT user_id, title FROM games WHERE id = $1", [reviewId]);
      if (author.rows[0]) {
        await createNotification({
          userId: author.rows[0].user_id,
          actorId: req.user.id,
          type: "like",
          entityType: "review",
          entityId: reviewId,
          message: author.rows[0].title || null,
        });
        await checkAndUnlockAchievements(author.rows[0].user_id);
        await grantXp(author.rows[0].user_id, "like_received");
      }
    } catch (e) {}
    await checkAndUnlockAchievements(req.user.id);
    await grantXp(req.user.id, "like_given");
    if (wantsJson(req)) {
      return res.json({ liked: true, count: countRes.rows[0].count });
    }
  } catch (err) {
    console.error("Like error:", err.message);
    if (wantsJson(req)) return res.status(500).json({ error: "Could not like" });
  }
  res.redirect(req.get("Referer") || "/");
});

app.post("/unlike/:reviewId", async (req, res) => {
  if (!req.isAuthenticated()) {
    if (wantsJson(req)) return res.status(401).json({ error: "Login required" });
    return res.redirect("/login");
  }
  const reviewId = parseInt(req.params.reviewId, 10);
  if (!reviewId) {
    if (wantsJson(req)) return res.status(400).json({ error: "Invalid review" });
    return res.redirect("back");
  }

  try {
    await db.query(
      "DELETE FROM likes WHERE user_id = $1 AND review_id = $2",
      [req.user.id, reviewId]
    );
    const countRes = await db.query(
      "SELECT COUNT(*)::int AS count FROM likes WHERE review_id = $1",
      [reviewId]
    );
    if (wantsJson(req)) {
      return res.json({ liked: false, count: countRes.rows[0].count });
    }
  } catch (err) {
    console.error("Unlike error:", err.message);
    if (wantsJson(req)) return res.status(500).json({ error: "Could not unlike" });
  }
  res.redirect(req.get("Referer") || "/");
});
//#endregion

//#region Follow / Unfollow
app.post("/follow/:username", async (req, res) => {
  const json = wantsJson(req);
  if (!req.isAuthenticated()) {
    if (json) return res.status(401).json({ error: "Login required" });
    return res.redirect("/login");
  }
  try {
    const username = req.params.username.toLowerCase();
    const target = await db.query(
      "SELECT id, username, display_name FROM users WHERE LOWER(username) = $1",
      [username]
    );
    if (target.rows.length === 0) {
      if (json) return res.status(404).json({ error: "User not found" });
      return res.status(404).send("User not found");
    }
    const targetId = target.rows[0].id;
    if (targetId === req.user.id) {
      if (json) return res.status(400).json({ error: "Cannot follow yourself" });
      return res.redirect(`/u/${username}`);
    }

    // Blocked either way?
    try {
      const blocked = await db.query(
        `SELECT 1 FROM blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)`,
        [req.user.id, targetId]
      );
      if (blocked.rows.length) {
        if (json) return res.status(403).json({ error: "Cannot follow this user" });
        return res.redirect(`/u/${username}`);
      }
    } catch (e) {}

    await db.query(
      `INSERT INTO follows (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT (follower_id, following_id) DO NOTHING`,
      [req.user.id, targetId]
    );
    await createNotification({
      userId: targetId,
      actorId: req.user.id,
      type: "follow",
      entityType: "user",
      entityId: req.user.id,
      message: null,
    });
    await checkAndUnlockAchievements(req.user.id);
    await checkAndUnlockAchievements(targetId);
    await grantXp(req.user.id, "follow");
    await grantXp(targetId, "follower");
    await createActivity({
      actorId: req.user.id,
      type: "follow",
      entityType: "user",
      entityId: targetId,
      meta: {
        target_username: target.rows[0].username,
        target_display_name: target.rows[0].display_name || target.rows[0].username,
      },
    });

    const countRes = await db.query(
      "SELECT COUNT(*)::int AS count FROM follows WHERE following_id = $1",
      [targetId]
    );

    if (json) {
      return res.json({ following: true, followerCount: countRes.rows[0].count });
    }
    res.redirect(req.get("Referer") || `/u/${username}`);
  } catch (err) {
    console.error("Follow error:", err.message);
    if (json) return res.status(500).json({ error: "Could not follow" });
    res.redirect(req.get("Referer") || `/u/${req.params.username}`);
  }
});

app.post("/unfollow/:username", async (req, res) => {
  const json = wantsJson(req);
  if (!req.isAuthenticated()) {
    if (json) return res.status(401).json({ error: "Login required" });
    return res.redirect("/login");
  }
  try {
    const username = req.params.username.toLowerCase();
    const target = await db.query(
      "SELECT id, username FROM users WHERE LOWER(username) = $1",
      [username]
    );
    if (target.rows.length === 0) {
      if (json) return res.status(404).json({ error: "User not found" });
      return res.status(404).send("User not found");
    }
    const targetId = target.rows[0].id;

    await db.query(
      "DELETE FROM follows WHERE follower_id = $1 AND following_id = $2",
      [req.user.id, targetId]
    );

    const countRes = await db.query(
      "SELECT COUNT(*)::int AS count FROM follows WHERE following_id = $1",
      [targetId]
    );

    if (json) {
      return res.json({ following: false, followerCount: countRes.rows[0].count });
    }
    res.redirect(req.get("Referer") || `/u/${username}`);
  } catch (err) {
    console.error("Unfollow error:", err.message);
    if (json) return res.status(500).json({ error: "Could not unfollow" });
    res.redirect(req.get("Referer") || `/u/${req.params.username}`);
  }
});

app.post("/block/:username", async (req, res) => {
  const json = wantsJson(req);
  if (!req.isAuthenticated()) {
    if (json) return res.status(401).json({ error: "Login required" });
    return res.redirect("/login");
  }
  try {
    const username = req.params.username.toLowerCase();
    const target = await db.query(
      "SELECT id, username FROM users WHERE LOWER(username) = $1",
      [username]
    );
    if (!target.rows.length) {
      if (json) return res.status(404).json({ error: "User not found" });
      return res.status(404).send("User not found");
    }
    const targetId = target.rows[0].id;
    if (targetId === req.user.id) {
      if (json) return res.status(400).json({ error: "Cannot block yourself" });
      return res.redirect(`/u/${username}`);
    }

    await db.query(
      `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, targetId]
    );
    // Remove follows both directions
    await db.query(
      `DELETE FROM follows
       WHERE (follower_id = $1 AND following_id = $2)
          OR (follower_id = $2 AND following_id = $1)`,
      [req.user.id, targetId]
    );

    if (json) return res.json({ blocked: true });
    res.redirect(req.get("Referer") || `/u/${username}`);
  } catch (err) {
    console.error("Block error:", err.message);
    if (json) return res.status(500).json({ error: "Could not block" });
    res.redirect(req.get("Referer") || "/");
  }
});

app.post("/unblock/:username", async (req, res) => {
  const json = wantsJson(req);
  if (!req.isAuthenticated()) {
    if (json) return res.status(401).json({ error: "Login required" });
    return res.redirect("/login");
  }
  try {
    const username = req.params.username.toLowerCase();
    const target = await db.query(
      "SELECT id, username FROM users WHERE LOWER(username) = $1",
      [username]
    );
    if (!target.rows.length) {
      if (json) return res.status(404).json({ error: "User not found" });
      return res.status(404).send("User not found");
    }

    await db.query(
      "DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2",
      [req.user.id, target.rows[0].id]
    );

    if (json) return res.json({ blocked: false });
    res.redirect(req.get("Referer") || `/u/${username}`);
  } catch (err) {
    console.error("Unblock error:", err.message);
    if (json) return res.status(500).json({ error: "Could not unblock" });
    res.redirect(req.get("Referer") || "/");
  }
});
//#endregion

//#region Listen on port
//#region Year in Review
app.get("/year-in-review", (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const year = new Date().getFullYear();
  const username = req.user.username;
  if (!username) return res.redirect("/profile/edit");
  res.redirect(`/u/${username}/year/${year}`);
});

app.get("/u/:username/year/:year", async (req, res) => {
  const username = req.params.username.toLowerCase();
  const year = parseInt(req.params.year, 10);
  const currentYear = new Date().getFullYear();
  if (!year || year < 2000 || year > currentYear + 1) {
    return res.status(404).send("Invalid year");
  }

  try {
    const userRes = await db.query(
      `SELECT id, username, display_name, avatar_url, profile_title
       FROM users WHERE LOWER(username) = $1`,
      [username]
    );
    if (!userRes.rows.length) return res.status(404).send("User not found");
    const profile = userRes.rows[0];

    // Games completed (or logged) in this year
    let games = [];
    try {
      const g = await db.query(
        `SELECT id, game_id, title, rating, notes, completed, cover_url, released, has_spoilers
         FROM games
         WHERE user_id = $1
           AND completed IS NOT NULL
           AND CAST(completed AS TEXT) <> ''
           AND (
             EXTRACT(YEAR FROM CAST(completed AS DATE)) = $2
             OR CAST(completed AS TEXT) LIKE $3
           )
         ORDER BY CAST(completed AS DATE) ASC NULLS LAST, id ASC`,
        [profile.id, year, String(year) + "%"]
      );
      games = g.rows;
    } catch (e) {
      const g = await db.query(
        `SELECT id, game_id, title, rating, notes, completed, cover_url, released
         FROM games
         WHERE user_id = $1
           AND completed IS NOT NULL
           AND CAST(completed AS TEXT) LIKE $2
         ORDER BY id ASC`,
        [profile.id, String(year) + "%"]
      );
      games = g.rows.map((r) => ({ ...r, has_spoilers: false }));
    }

    const ratings = games
      .map((g) => parseFloat(g.rating))
      .filter((n) => !Number.isNaN(n));
    const avgRating = ratings.length
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : null;

    const topRated = [...games]
      .filter((g) => g.rating != null && g.rating !== "")
      .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating))
      .slice(0, 5);

    const fiveStars = games.filter((g) => parseFloat(g.rating) >= 5).length;
    const withNotes = games.filter((g) => g.notes && String(g.notes).trim()).length;

    // Monthly histogram
    const months = Array.from({ length: 12 }, () => 0);
    for (const g of games) {
      try {
        const d = new Date(g.completed);
        if (!Number.isNaN(d.getTime()) && d.getFullYear() === year) {
          months[d.getMonth()] += 1;
        }
      } catch (e) {}
    }
    const maxMonth = Math.max(1, ...months);

    // Achievements unlocked this year
    let yearAchievements = [];
    try {
      const a = await db.query(
        `SELECT achievement_id, unlocked_at
         FROM user_achievements
         WHERE user_id = $1
           AND EXTRACT(YEAR FROM unlocked_at) = $2
         ORDER BY unlocked_at ASC`,
        [profile.id, year]
      );
      yearAchievements = a.rows
        .map((row) => ({
          ...ACHIEVEMENTS[row.achievement_id],
          unlocked_at: row.unlocked_at,
        }))
        .filter((x) => x && x.id);
    } catch (e) {}

    // Lists created this year
    let listsCreated = 0;
    try {
      const l = await db.query(
        `SELECT COUNT(*)::int AS c FROM lists
         WHERE user_id = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
        [profile.id, year]
      );
      listsCreated = l.rows[0].c;
    } catch (e) {}

    const shareUrl = `${req.protocol}://${req.get("host")}/u/${profile.username}/year/${year}`;
    const isOwner = req.user && req.user.id === profile.id;

    res.render("year-in-review.ejs", {
      userlog: req.user,
      profile,
      year,
      games,
      stats: {
        total: games.length,
        avgRating,
        fiveStars,
        withNotes,
        listsCreated,
        achievementCount: yearAchievements.length,
      },
      topRated,
      months,
      maxMonth,
      yearAchievements,
      shareUrl,
      isOwner,
      monthNames: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
    });
  } catch (err) {
    console.error("Year in review error:", err);
    res.status(500).send("Something went wrong");
  }
});
//#endregion

//#region Activity feed
app.get("/activity", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const result = await db.query(
      `SELECT a.*,
              u.username AS actor_username,
              u.display_name AS actor_display_name,
              u.avatar_url AS actor_avatar
       FROM activities a
       JOIN users u ON u.id = a.actor_id
       WHERE a.actor_id = $1
          OR a.actor_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    // meta may already be object from pg
    const activities = result.rows.map((row) => ({
      ...row,
      meta: typeof row.meta === "string" ? JSON.parse(row.meta) : (row.meta || {}),
    }));

    res.render("activity.ejs", {
      userlog: req.user,
      activities,
    });
  } catch (err) {
    console.error("Activity feed error:", err);
    // table may not exist yet
    res.render("activity.ejs", {
      userlog: req.user,
      activities: [],
      error: "Activity feed is not available yet. Run the activities migration.",
    });
  }
});
//#endregion

//#region Direct messages
app.get("/messages", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  try {
    const threads = await db.query(
      `SELECT c.id AS conversation_id,
              c.updated_at,
              CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END AS other_id,
              u.username AS other_username,
              u.display_name AS other_display_name,
              u.avatar_url AS other_avatar,
              (
                SELECT content FROM messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC LIMIT 1
              ) AS last_message,
              (
                SELECT created_at FROM messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC LIMIT 1
              ) AS last_message_at,
              (
                SELECT COUNT(*)::int FROM messages m
                WHERE m.conversation_id = c.id
                  AND m.sender_id <> $1
                  AND m.read_at IS NULL
              ) AS unread_count
       FROM conversations c
       JOIN users u ON u.id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END
       WHERE c.user_a_id = $1 OR c.user_b_id = $1
       ORDER BY COALESCE(c.updated_at, c.created_at) DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.render("messages.ejs", {
      userlog: req.user,
      threads: threads.rows,
      activeThread: null,
      messages: [],
      otherUser: null,
    });
  } catch (err) {
    console.error("Messages inbox error:", err.message);
    res.render("messages.ejs", {
      userlog: req.user,
      threads: [],
      activeThread: null,
      messages: [],
      otherUser: null,
      error: "Messages need the DM migration. Run migrations/017_messages.sql",
    });
  }
});

app.get("/messages/u/:username", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const username = req.params.username.toLowerCase();
  try {
    const otherRes = await db.query(
      `SELECT id, username, display_name, avatar_url FROM users WHERE LOWER(username) = $1`,
      [username]
    );
    if (!otherRes.rows.length) return res.status(404).send("User not found");
    const other = otherRes.rows[0];
    if (other.id === req.user.id) return res.redirect("/messages");

    // Blocks either way
    try {
      const blocked = await db.query(
        `SELECT 1 FROM blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)`,
        [req.user.id, other.id]
      );
      if (blocked.rows.length) {
        return res.status(403).send("You can’t message this user.");
      }
    } catch (e) {}

    const a = Math.min(req.user.id, other.id);
    const b = Math.max(req.user.id, other.id);
    let conv = await db.query(
      `SELECT * FROM conversations WHERE user_a_id = $1 AND user_b_id = $2`,
      [a, b]
    );
    if (!conv.rows.length) {
      conv = await db.query(
        `INSERT INTO conversations (user_a_id, user_b_id)
         VALUES ($1, $2)
         ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET user_a_id = EXCLUDED.user_a_id
         RETURNING *`,
        [a, b]
      );
    }
    const conversation = conv.rows[0];

    const msgs = await db.query(
      `SELECT m.*, u.username AS sender_username, u.display_name AS sender_display_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [conversation.id]
    );

    // Mark as read
    await db.query(
      `UPDATE messages SET read_at = CURRENT_TIMESTAMP
       WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
      [conversation.id, req.user.id]
    );

    const threads = await db.query(
      `SELECT c.id AS conversation_id,
              c.updated_at,
              CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END AS other_id,
              u.username AS other_username,
              u.display_name AS other_display_name,
              u.avatar_url AS other_avatar,
              (
                SELECT content FROM messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC LIMIT 1
              ) AS last_message,
              (
                SELECT COUNT(*)::int FROM messages m
                WHERE m.conversation_id = c.id
                  AND m.sender_id <> $1
                  AND m.read_at IS NULL
              ) AS unread_count
       FROM conversations c
       JOIN users u ON u.id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END
       WHERE c.user_a_id = $1 OR c.user_b_id = $1
       ORDER BY COALESCE(c.updated_at, c.created_at) DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.render("messages.ejs", {
      userlog: req.user,
      threads: threads.rows,
      activeThread: conversation,
      messages: msgs.rows,
      otherUser: other,
    });
  } catch (err) {
    console.error("DM thread error:", err.message);
    res.status(500).send("Could not open conversation. Run the messages migration.");
  }
});

app.post("/messages/u/:username", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const username = req.params.username.toLowerCase();
  const content = (req.body.content || "").trim().slice(0, 2000);
  if (!content) return res.redirect(`/messages/u/${username}`);

  try {
    const otherRes = await db.query(
      `SELECT id, username FROM users WHERE LOWER(username) = $1`,
      [username]
    );
    if (!otherRes.rows.length) return res.status(404).send("User not found");
    const other = otherRes.rows[0];
    if (other.id === req.user.id) return res.redirect("/messages");

    try {
      const blocked = await db.query(
        `SELECT 1 FROM blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)`,
        [req.user.id, other.id]
      );
      if (blocked.rows.length) return res.status(403).send("You can’t message this user.");
    } catch (e) {}

    const a = Math.min(req.user.id, other.id);
    const b = Math.max(req.user.id, other.id);
    let conv = await db.query(
      `INSERT INTO conversations (user_a_id, user_b_id)
       VALUES ($1, $2)
       ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [a, b]
    );
    const conversation = conv.rows[0];

    await db.query(
      `INSERT INTO messages (conversation_id, sender_id, content)
       VALUES ($1, $2, $3)`,
      [conversation.id, req.user.id, content]
    );
    await db.query(
      `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [conversation.id]
    );

    // Optional in-app notification
    try {
      await createNotification({
        userId: other.id,
        actorId: req.user.id,
        type: "message",
        entityType: "user",
        entityId: req.user.id,
        message: content.slice(0, 80),
      });
    } catch (e) {}

    res.redirect(`/messages/u/${username}`);
  } catch (err) {
    console.error("Send DM error:", err.message);
    res.status(500).send("Could not send message");
  }
});
//#endregion

//#region Reports + Admin moderation

app.post("/report", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const targetType = (req.body.target_type || "").trim();
  const targetId = parseInt(req.body.target_id, 10);
  const reason = (req.body.reason || "").trim().slice(0, 500);
  if (!["review", "user", "comment"].includes(targetType) || !targetId) {
    return res.redirect(req.get("Referer") || "/");
  }
  try {
    await db.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, targetType, targetId, reason || null]
    );
  } catch (err) {
    console.error("Report error:", err.message);
  }
  const redirect = req.get("Referer") || "/";
  res.redirect(redirect);
});

app.get("/admin", ensureAdmin, async (req, res) => {
  try {
    const openReports = await db.query(
      `SELECT r.*,
              u.username AS reporter_username,
              u.display_name AS reporter_display_name
       FROM reports r
       LEFT JOIN users u ON u.id = r.reporter_id
       WHERE r.status = 'open'
       ORDER BY r.created_at DESC
       LIMIT 50`
    );

    const recentReviews = await db.query(
      `SELECT g.id, g.title, g.rating, g.notes, g.user_id, g.game_id,
              u.username, u.display_name
       FROM games g
       LEFT JOIN users u ON u.id = g.user_id
       ORDER BY g.id DESC
       LIMIT 30`
    );

    const recentComments = await db.query(
      `SELECT c.id, c.content, c.review_id, c.user_id, c.created_at,
              u.username, u.display_name
       FROM comments c
       LEFT JOIN users u ON u.id = c.user_id
       ORDER BY c.created_at DESC
       LIMIT 30`
    );

    const users = await db.query(
      `SELECT id, email, username, display_name, is_admin, is_banned, created_at,
              COALESCE(total_xp, 0) AS total_xp
       FROM users
       ORDER BY id DESC
       LIMIT 50`
    );

    const stats = {
      users: (await db.query("SELECT COUNT(*)::int AS c FROM users")).rows[0].c,
      reviews: (await db.query("SELECT COUNT(*)::int AS c FROM games")).rows[0].c,
      comments: (await db.query("SELECT COUNT(*)::int AS c FROM comments")).rows[0].c,
      openReports: openReports.rows.length,
    };

    res.render("admin.ejs", {
      userlog: req.user,
      reports: openReports.rows,
      recentReviews: recentReviews.rows,
      recentComments: recentComments.rows,
      users: users.rows,
      stats,
    });
  } catch (err) {
    console.error("Admin panel error:", err);
    res.status(500).send("Admin panel error: " + err.message);
  }
});

app.post("/admin/reports/:id/resolve", ensureAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = req.body.status === "dismissed" ? "dismissed" : "resolved";
  try {
    await db.query(
      `UPDATE reports SET status = $1, resolved_at = CURRENT_TIMESTAMP, resolved_by = $2
       WHERE id = $3`,
      [status, req.user.id, id]
    );
  } catch (err) {
    console.error("Resolve report error:", err.message);
  }
  res.redirect("/admin");
});

app.post("/admin/reviews/:id/delete", ensureAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await db.query("DELETE FROM likes WHERE review_id = $1", [id]);
    await db.query("DELETE FROM comments WHERE review_id = $1", [id]);
    await db.query("DELETE FROM games WHERE id = $1", [id]);
  } catch (err) {
    console.error("Admin delete review error:", err.message);
  }
  res.redirect("/admin");
});

app.post("/admin/comments/:id/delete", ensureAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await db.query("DELETE FROM comments WHERE id = $1", [id]);
  } catch (err) {
    console.error("Admin delete comment error:", err.message);
  }
  res.redirect("/admin");
});

app.post("/admin/users/:id/ban", ensureAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.redirect("/admin");
  try {
    await db.query("UPDATE users SET is_banned = TRUE WHERE id = $1 AND is_admin = FALSE", [id]);
  } catch (err) {
    console.error("Ban error:", err.message);
  }
  res.redirect("/admin");
});

app.post("/admin/users/:id/unban", ensureAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await db.query("UPDATE users SET is_banned = FALSE WHERE id = $1", [id]);
  } catch (err) {
    console.error("Unban error:", err.message);
  }
  res.redirect("/admin");
});
//#endregion

app.listen(port, () => {
  console.log(`GameCouch listening on port ${port} (${process.env.NODE_ENV || "development"})`);
  console.log(`Server running on port ${port}`);
});
//#endregion