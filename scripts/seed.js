/**
 * Wipe DB and seed realistic GameCouch data using IGDB for real games.
 *
 * Usage (from project root):
 *   npm run seed
 *   node scripts/seed.js
 *
 * Requires .env with Postgres + IGDB_CLIENT_ID / IGDB_CLIENT_SECRET
 * All seeded accounts use password: password123
 */
import env from "dotenv";
import bcrypt from "bcrypt";
import axios from "axios";
import Pool from "pg-pool";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
env.config({ path: path.join(__dirname, "..", ".env") });

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

const CLIENT_ID = process.env.IGDB_CLIENT_ID;
const CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing IGDB_CLIENT_ID / IGDB_CLIENT_SECRET in .env");
  process.exit(1);
}

let tokenCache = null;
let tokenExpires = 0;

async function getToken() {
  if (tokenCache && Date.now() < tokenExpires - 60_000) return tokenCache;
  const url =
    `https://id.twitch.tv/oauth2/token` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&client_secret=${encodeURIComponent(CLIENT_SECRET)}` +
    `&grant_type=client_credentials`;
  const res = await axios.post(url);
  tokenCache = res.data.access_token;
  tokenExpires = Date.now() + (res.data.expires_in || 5000000) * 1000;
  return tokenCache;
}

async function igdb(body) {
  const token = await getToken();
  const res = await axios.post("https://api.igdb.com/v4/games", body, {
    headers: {
      "Client-ID": CLIENT_ID,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "text/plain",
    },
  });
  return res.data || [];
}

function coverUrl(imageId) {
  if (!imageId) return null;
  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
}

function releasedDate(unix) {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

async function resolveGame(name) {
  const safe = name.replace(/"/g, "");
  const rows = await igdb(
    `search "${safe}"; fields name, first_release_date, cover.image_id, slug; limit 10;`
  );
  if (!rows.length) return null;
  const lower = name.toLowerCase();

  function score(g) {
    const n = (g.name || "").toLowerCase();
    if (n === lower) return 100;
    if (n.startsWith(lower)) return 80;
    if (n.includes(lower)) return 60;
    const words = lower.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const hits = words.filter((w) => n.includes(w)).length;
    return hits * 10 + (g.cover?.image_id ? 2 : 0);
  }

  const ranked = [...rows].sort((a, b) => score(b) - score(a));
  const g = ranked[0];
  if (score(g) < 20) return null;
  return {
    id: g.id,
    title: g.name,
    released: releasedDate(g.first_release_date),
    cover_url: coverUrl(g.cover?.image_id),
  };
}

const GAME_NAMES = [
  "Elden Ring",
  "The Legend of Zelda: Breath of the Wild",
  "The Legend of Zelda: Tears of the Kingdom",
  "Hades",
  "Hades II",
  "Celeste",
  "Hollow Knight",
  "Stardew Valley",
  "Baldur's Gate 3",
  "Disco Elysium",
  "The Witcher 3: Wild Hunt",
  "Red Dead Redemption 2",
  "God of War",
  "God of War Ragnarök",
  "Marvel's Spider-Man 2",
  "Horizon Forbidden West",
  "Final Fantasy VII Remake",
  "Persona 5 Royal",
  "Sekiro: Shadows Die Twice",
  "Dark Souls III",
  "Bloodborne",
  "Monster Hunter: World",
  "Animal Crossing: New Horizons",
  "Super Mario Odyssey",
  "Mario Kart 8 Deluxe",
  "The Last of Us Part I",
  "The Last of Us Part II",
  "Ghost of Tsushima",
  "Cyberpunk 2077",
  "Minecraft",
  "Terraria",
  "Portal 2",
  "Half-Life 2",
  "DOOM Eternal",
  "Resident Evil 4",
  "Alan Wake 2",
  "Control",
  "Death Stranding",
  "NieR: Automata",
  "Outer Wilds",
  "Subnautica",
  "No Man's Sky",
  "Factorio",
  "Slay the Spire",
  "Balatro",
  "Inscryption",
  "Undertale",
  "Cuphead",
  "Ori and the Will of the Wisps",
  "Dead Cells",
  "It Takes Two",
  "Helldivers 2",
  "Black Myth: Wukong",
  "Astro Bot",
  "Palworld",
  "Lethal Company",
  "Diablo IV",
  "Ultrakill",
  "Metal Gear Solid V: The Phantom Pain",
];

const USER_SEEDS = [
  { email: "alex@example.com", username: "alexplays", display: "Alex", bio: "Soulsborne enjoyer. Always down for co-op.", location: "Austin, TX" },
  { email: "jordan@example.com", username: "jordancrit", display: "Jordan", bio: "I rate everything a 7. Except when I don't.", location: "Seattle" },
  { email: "sam@example.com", username: "samlogs", display: "Sam", bio: "Journaling every clear since 2019.", location: "Chicago" },
  { email: "riley@example.com", username: "rileybytes", display: "Riley", bio: "Indie hopper. Soundtrack first.", location: "Portland" },
  { email: "casey@example.com", username: "caseyclear", display: "Casey", bio: "Completionist with a backlog problem.", location: "Denver" },
  { email: "morgan@example.com", username: "morganmeta", display: "Morgan", bio: "Theorycrafter. Tier lists welcome.", location: "NYC" },
  { email: "taylor@example.com", username: "taylorruns", display: "Taylor", bio: "Speedrun curious, story focused.", location: "Toronto" },
  { email: "jamie@example.com", username: "jamieshelf", display: "Jamie", bio: "Physical editions only (mostly).", location: "London" },
  { email: "avery@example.com", username: "averycoop", display: "Avery", bio: "Local multiplayer evangelist.", location: "Berlin" },
  { email: "quinn@example.com", username: "quinnxp", display: "Quinn", bio: "Here for the XP and the vibes.", location: "Remote" },
  { email: "drew@example.com", username: "drewdrops", display: "Drew", bio: "Always chasing the next drop.", location: "LA" },
  { email: "noah@example.com", username: "noahnotes", display: "Noah", bio: "Long reviews. Longer load times.", location: "Boston" },
];

const NOTES = [
  "Absolutely hooked from the first hour.",
  "Great systems, uneven pacing.",
  "A comfort game I keep coming back to.",
  "Combat feels incredible once it clicks.",
  "Story hit harder than I expected.",
  "Worth playing if you like this genre.",
  "Not for everyone, but it was for me.",
  "Soundtrack alone is worth the price.",
  "Some frustration, but the highs are high.",
  "Logged for the journal — will write more later.",
  "",
  "",
  "Quick log after finishing the main story.",
  "Co-op made this shine.",
  "Art direction is unreal.",
  "Boss fights are the highlight.",
  "Took a while to click, then I couldn't stop.",
];

const COMMENT_TEXT = [
  "Totally agree with this take.",
  "I bounced off it — glad it worked for you.",
  "Adding this to my list tonight.",
  "The ending though…",
  "Have you tried the DLC?",
  "This is on my shelf too.",
  "Underrated pick.",
  "Hard disagree but respect.",
  "Need a co-op buddy for this.",
  "Soundtrack goes so hard.",
];

const REPLY_TEXT = [
  "Fair point!",
  "That's what got me hooked.",
  "Exactly.",
  "I'll check the DLC next.",
  "We should run it sometime.",
  "test",
  "test 2",
];

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function rating() {
  return rand([2.5, 3, 3.5, 4, 4, 4.5, 4.5, 5, 5, 3.5]);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function avatarUrl(seed) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}
function bannerUrl(seed) {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/1200/400`;
}

async function wipe() {
  console.log("Wiping tables…");
  await db.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
  console.log("All public tables truncated.");

  try {
    await db.query(`ALTER TABLE games DROP CONSTRAINT IF EXISTS games_game_id_key`);
    console.log("Dropped games_game_id_key (if it existed).");
  } catch (e) {
    console.warn("Could not drop games_game_id_key:", e.message);
  }
  try {
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS games_user_game_unique
      ON games (user_id, game_id)
      WHERE user_id IS NOT NULL AND game_id IS NOT NULL
    `);
  } catch (e) {}
}

async function seedUsers() {
  const hash = await bcrypt.hash("password123", 10);
  const users = [];

  for (const u of USER_SEEDS) {
    const res = await db.query(
      `INSERT INTO users (
         email, password, username, display_name, bio, location,
         avatar_url, banner_url, total_xp, email_verified
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
       RETURNING *`,
      [
        u.email,
        hash,
        u.username,
        u.display,
        u.bio,
        u.location || null,
        avatarUrl(u.username),
        bannerUrl(u.username + "-banner"),
        randInt(120, 3200),
      ]
    );
    users.push(res.rows[0]);
  }

  const admin = await db.query(
    `INSERT INTO users (
       email, password, username, display_name, bio, location,
       avatar_url, banner_url, is_admin, total_xp, email_verified
     ) VALUES ($1,$2,'admin','Admin','Site admin account','HQ',
       $3,$4,TRUE,5000,TRUE)
     RETURNING *`,
    [
      "admin@gamecouch.local",
      hash,
      avatarUrl("admin"),
      bannerUrl("admin-banner"),
    ]
  );
  users.push(admin.rows[0]);

  await db.query(`UPDATE users SET is_admin = TRUE WHERE email = $1`, ["alex@example.com"]);
  const alex = users.find((u) => u.email === "alex@example.com");
  if (alex) alex.is_admin = true;

  console.log(`Users: ${users.length} (password for all: password123)`);
  return users;
}

async function fetchGames() {
  console.log("Resolving games via IGDB…");
  const games = [];
  const seen = new Set();
  for (const name of GAME_NAMES) {
    try {
      const g = await resolveGame(name);
      if (!g || seen.has(g.id)) {
        if (g && seen.has(g.id)) console.log(`  · skip duplicate ${g.title}`);
        continue;
      }
      seen.add(g.id);
      games.push(g);
      console.log(`  ✓ ${g.title}`);
      await new Promise((r) => setTimeout(r, 120));
    } catch (e) {
      console.warn(`  ✗ ${name}: ${e.message}`);
    }
  }
  console.log(`Games resolved: ${games.length}`);
  return games;
}

async function seedSocial(users, games) {
  // Follows
  for (let i = 0; i < users.length; i++) {
    const targets = [...users].filter((u) => u.id !== users[i].id).sort(() => Math.random() - 0.5).slice(0, randInt(3, 7));
    for (const t of targets) {
      try {
        await db.query(
          `INSERT INTO follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [users[i].id, t.id]
        );
      } catch (e) {}
    }
  }
  console.log("Follows created.");

  // Reviews + statuses
  const reviewIds = [];
  for (const u of users) {
    const picks = [...games].sort(() => Math.random() - 0.5).slice(0, randInt(6, 14));
    for (const g of picks) {
      const notes = rand(NOTES);
      const completed = daysAgo(randInt(1, 320));
      const r = rating();
      try {
        const ins = await db.query(
          `INSERT INTO games (game_id, title, completed, rating, notes, released, user_id, cover_url, has_spoilers)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT DO NOTHING
           RETURNING id, user_id, game_id, title, cover_url`,
          [
            g.id,
            g.title,
            completed,
            r,
            notes,
            g.released,
            u.id,
            g.cover_url,
            notes && Math.random() < 0.12,
          ]
        );
        if (ins.rows[0]) reviewIds.push(ins.rows[0]);
      } catch (e) {
        try {
          const ins = await db.query(
            `INSERT INTO games (game_id, title, completed, rating, notes, released, user_id, cover_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, user_id, game_id, title, cover_url`,
            [g.id, g.title, completed, r, notes, g.released, u.id, g.cover_url]
          );
          if (ins.rows[0]) reviewIds.push(ins.rows[0]);
        } catch (e2) {}
      }

      // Status shelves
      try {
        const status = rand(["want", "playing", "played", "played", "played"]);
        await db.query(
          `INSERT INTO game_statuses (user_id, game_id, status, title, cover_url, released, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, game_id)
           DO UPDATE SET status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP`,
          [u.id, g.id, status, g.title, g.cover_url, g.released]
        );
      } catch (e) {}
    }
  }
  console.log(`Reviews created: ${reviewIds.length}`);

  // Likes
  for (const rev of reviewIds) {
    const likers = [...users].sort(() => Math.random() - 0.5).slice(0, randInt(0, 6));
    for (const l of likers) {
      if (l.id === rev.user_id) continue;
      try {
        await db.query(
          `INSERT INTO likes (user_id, review_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [l.id, rev.id]
        );
      } catch (e) {}
    }
  }
  console.log("Likes created.");

  // Comments + replies
  const rootComments = [];
  for (const rev of reviewIds) {
    const n = randInt(0, 4);
    for (let i = 0; i < n; i++) {
      const commenter = rand(users);
      try {
        const ins = await db.query(
          `INSERT INTO comments (review_id, user_id, content, parent_id, has_spoilers)
           VALUES ($1,$2,$3,NULL,$4) RETURNING id, review_id, user_id`,
          [rev.id, commenter.id, rand(COMMENT_TEXT), Math.random() < 0.08]
        );
        if (ins.rows[0]) rootComments.push(ins.rows[0]);
      } catch (e) {
        try {
          const ins = await db.query(
            `INSERT INTO comments (review_id, user_id, content) VALUES ($1,$2,$3) RETURNING id, review_id, user_id`,
            [rev.id, commenter.id, rand(COMMENT_TEXT)]
          );
          if (ins.rows[0]) rootComments.push(ins.rows[0]);
        } catch (e2) {}
      }
    }
  }

  let replyCount = 0;
  for (const c of rootComments) {
    if (Math.random() > 0.55) continue;
    const replies = randInt(1, 3);
    let parentId = c.id;
    for (let i = 0; i < replies; i++) {
      const commenter = rand(users);
      try {
        const ins = await db.query(
          `INSERT INTO comments (review_id, user_id, content, parent_id)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [c.review_id, commenter.id, rand(REPLY_TEXT), parentId]
        );
        if (ins.rows[0] && Math.random() < 0.4) parentId = ins.rows[0].id; // nest deeper sometimes
        replyCount++;
      } catch (e) {}
    }
  }
  console.log(`Comments: ${rootComments.length} roots, ${replyCount} replies.`);

  // Lists
  for (const u of users) {
    const listCount = randInt(1, 3);
    for (let i = 0; i < listCount; i++) {
      const list = await db.query(
        `INSERT INTO lists (user_id, title, description)
         VALUES ($1,$2,$3) RETURNING id`,
        [
          u.id,
          rand(["Top 10", "Comfort games", "Backlog crushers", "2026 favorites", "Indie gems", "Co-op night", "Story first"]),
          rand(["Seeded list for demos.", "Games I keep recommending.", "Need to finish these."]),
        ]
      );
      const picks = [...games].sort(() => Math.random() - 0.5).slice(0, randInt(4, 9));
      let pos = 0;
      for (const g of picks) {
        try {
          await db.query(
            `INSERT INTO list_items (list_id, game_id, title, cover_url, position)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
            [list.rows[0].id, g.id, g.title, g.cover_url, pos++]
          );
        } catch (e) {}
      }
    }
  }
  console.log("Lists created.");

  // Favorite games (with id + cover so profiles work)
  for (const u of users) {
    const fav = rand(games);
    try {
      await db.query(
        `UPDATE users
         SET favorite_game = $1,
             favorite_game_id = $2,
             favorite_game_cover = $3
         WHERE id = $4`,
        [fav.title, fav.id, fav.cover_url, u.id]
      );
    } catch (e) {
      try {
        await db.query(`UPDATE users SET favorite_game = $1 WHERE id = $2`, [fav.title, u.id]);
      } catch (_) {}
    }
  }
  console.log("Favorite games set.");

  // Notifications
  let notifCount = 0;
  for (const u of users) {
    const actors = users.filter((x) => x.id !== u.id).sort(() => Math.random() - 0.5).slice(0, randInt(2, 6));
    for (const actor of actors) {
      const type = rand(["follow", "like", "comment"]);
      let message = `${actor.display_name || actor.username} interacted with you`;
      if (type === "follow") message = `${actor.display_name || actor.username} started following you`;
      if (type === "like") message = `${actor.display_name || actor.username} liked your review`;
      if (type === "comment") message = `${actor.display_name || actor.username} commented on your review`;
      try {
        await db.query(
          `INSERT INTO notifications (user_id, actor_id, type, entity_type, entity_id, message, read)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            u.id,
            actor.id,
            type,
            type === "follow" ? "user" : "review",
            type === "follow" ? actor.id : (reviewIds[0] && reviewIds[0].id) || null,
            message,
            false,
          ]
        );
        notifCount++;
      } catch (e) {}
    }
  }
  console.log(`Notifications: ${notifCount}`);

  // Messages / conversations
  let msgCount = 0;
  const pairs = new Set();
  for (let i = 0; i < 18; i++) {
    let a = rand(users);
    let b = rand(users);
    if (a.id === b.id) continue;
    const lo = Math.min(a.id, b.id);
    const hi = Math.max(a.id, b.id);
    const key = `${lo}:${hi}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    try {
      const conv = await db.query(
        `INSERT INTO conversations (user_a_id, user_b_id)
         VALUES ($1,$2)
         ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [lo, hi]
      );
      const cid = conv.rows[0].id;
      const turns = randInt(2, 6);
      for (let t = 0; t < turns; t++) {
        const sender = t % 2 === 0 ? a : b;
        await db.query(
          `INSERT INTO messages (conversation_id, sender_id, content)
           VALUES ($1,$2,$3)`,
          [
            cid,
            sender.id,
            rand([
              "Have you played this yet?",
              "That boss fight was rough.",
              "Want to co-op this weekend?",
              "Just finished — spoilers later.",
              "Adding it to my list.",
              "What should I play next?",
              "Nice review on that one.",
            ]),
          ]
        );
        msgCount++;
      }
      await db.query(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [cid]);
    } catch (e) {}
  }
  console.log(`Messages: ${msgCount} across ${pairs.size} conversations.`);

  // Reports
  let reportCount = 0;
  for (let i = 0; i < 8; i++) {
    const reporter = rand(users);
    const targetReview = rand(reviewIds);
    if (!targetReview) continue;
    try {
      await db.query(
        `INSERT INTO reports (reporter_id, target_type, target_id, reason, status)
         VALUES ($1,'review',$2,$3,'open')`,
        [
          reporter.id,
          targetReview.id,
          rand(["Spoilers without tags", "Harassment", "Spam", "Off-topic", "Other"]),
        ]
      );
      reportCount++;
    } catch (e) {}
  }
  for (let i = 0; i < 3; i++) {
    const reporter = rand(users);
    const target = rand(users);
    if (reporter.id === target.id) continue;
    try {
      await db.query(
        `INSERT INTO reports (reporter_id, target_type, target_id, reason, status)
         VALUES ($1,'user',$2,$3,'open')`,
        [reporter.id, target.id, rand(["Impersonation", "Spam account", "Harassment"])]
      );
      reportCount++;
    } catch (e) {}
  }
  console.log(`Reports: ${reportCount}`);

  // Activities
  for (const rev of reviewIds.slice(0, 50)) {
    try {
      await db.query(
        `INSERT INTO activities (actor_id, type, entity_type, entity_id, meta)
         VALUES ($1,'review','review',$2,$3::jsonb)`,
        [
          rev.user_id,
          rev.id,
          JSON.stringify({ game_id: rev.game_id, title: rev.title, rating: 4, cover_url: rev.cover_url }),
        ]
      );
    } catch (e) {}
  }
  console.log("Activities created.");
}

async function main() {
  console.log("GameCouch seed starting…");
  try {
    await db.query("SELECT 1");
  } catch (e) {
    console.error("DB connection failed:", e.message);
    process.exit(1);
  }

  await wipe();
  const users = await seedUsers();
  const games = await fetchGames();
  if (games.length < 10) {
    console.error("Too few games resolved from IGDB — check API keys / rate limits.");
    process.exit(1);
  }
  await seedSocial(users, games);

  console.log("\nDone. Seeded:");
  console.log("  • Users with avatars, banners, verified email, favorites");
  console.log("  • Reviews, likes, comments + nested replies");
  console.log("  • Lists, shelves, notifications, DMs, reports, activity");
  console.log("\nLogin (password for all: password123)");
  console.log("  admin@gamecouch.local  (admin)");
  console.log("  alex@example.com       (admin)");
  console.log("  jordan@example.com");
  console.log("  riley@example.com");
  await db.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await db.end();
  } catch (_) {}
  process.exit(1);
});
