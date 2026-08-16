/**
 * Wipe DB and seed realistic GameCouch data using IGDB for real games.
 *
 * Usage (from project root):
 *   node scripts/seed.js
 *
 * Requires .env with Postgres + IGDB_CLIENT_ID / IGDB_CLIENT_SECRET
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
    // prefer results that contain all significant words
    const words = lower.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const hits = words.filter((w) => n.includes(w)).length;
    return hits * 10 + (g.cover?.image_id ? 2 : 0);
  }

  const ranked = [...rows].sort((a, b) => score(b) - score(a));
  const g = ranked[0];
  // reject weak matches
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
  { email: "alex@example.com", username: "alexplays", display: "Alex", bio: "Soulsborne enjoyer. Always down for co-op.", accent: "#4f8cff" },
  { email: "jordan@example.com", username: "jordancrit", display: "Jordan", bio: "I rate everything 3 stars and mean it.", accent: "#7c5cff" },
  { email: "sam@example.com", username: "samlogs", display: "Sam", bio: "Completionist. Trophy hunter.", accent: "#3dd68c" },
  { email: "riley@example.com", username: "rileybytes", display: "Riley", bio: "Indie games + coffee.", accent: "#ff8a5c" },
  { email: "casey@example.com", username: "caseyq", display: "Casey", bio: "Story-first. Spoilers carefully tagged.", accent: "#f5c518" },
  { email: "morgan@example.com", username: "morgangames", display: "Morgan", bio: "JRPG main.", accent: "#ff5c7a" },
  { email: "taylor@example.com", username: "taylorruns", display: "Taylor", bio: "Speedrunner energy, casual hours.", accent: "#5ce1ff" },
  { email: "jamie@example.com", username: "jamieshelf", display: "Jamie", bio: "Backlog warrior. Lists for days.", accent: "#b388ff" },
  { email: "avery@example.com", username: "averycoop", display: "Avery", bio: "Local multiplayer evangelist.", accent: "#69f0ae" },
  { email: "quinn@example.com", username: "quinnxp", display: "Quinn", bio: "Here for the XP and the vibes.", accent: "#82b1ff" },
  { email: "drew@example.com", username: "drewdrops", display: "Drew", bio: "Always chasing the next drop.", accent: "#ffab40" },
  { email: "noah@example.com", username: "noahnotes", display: "Noah", bio: "Long reviews. Longer load times.", accent: "#ea80fc" },
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

  // This app allows many users to review the same IGDB game_id.
  // Drop a mistaken global unique on games.game_id if present.
  try {
    await db.query(`ALTER TABLE games DROP CONSTRAINT IF EXISTS games_game_id_key`);
    console.log("Dropped games_game_id_key (if it existed).");
  } catch (e) {
    console.warn("Could not drop games_game_id_key:", e.message);
  }
  // Prefer one log per user per game for seed cleanliness
  try {
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS games_user_game_unique
      ON games (user_id, game_id)
      WHERE user_id IS NOT NULL AND game_id IS NOT NULL
    `);
  } catch (e) {
    // ok if not supported
  }
}

async function seedUsers() {
  const hash = await bcrypt.hash("password123", 10);
  const users = [];
  for (const u of USER_SEEDS) {
    let res;
    try {
      res = await db.query(
        `INSERT INTO users (email, password, username, display_name, bio, accent_color, pronouns, location, profile_style, total_xp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          u.email,
          hash,
          u.username,
          u.display,
          u.bio,
          u.accent,
          rand(["they/them", "she/her", "he/him", null, null]),
          rand(["Austin, TX", "Seattle", "London", "Toronto", "Berlin", "Remote", null]),
          rand(["default", "compact", "vivid"]),
          randInt(50, 2500),
        ]
      );
    } catch (e) {
      res = await db.query(
        `INSERT INTO users (email, password, username, display_name, bio)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [u.email, hash, u.username, u.display, u.bio]
      );
    }
    users.push(res.rows[0]);
  }
  let admin;
  try {
    admin = await db.query(
      `INSERT INTO users (email, password, username, display_name, bio, is_admin, total_xp, accent_color)
       VALUES ($1,$2,'admin','Admin','Site admin account', TRUE, 5000, '#4f8cff')
       RETURNING *`,
      ["admin@gamecouch.local", hash]
    );
  } catch (e) {
    admin = await db.query(
      `INSERT INTO users (email, password, username, display_name, bio)
       VALUES ($1,$2,'admin','Admin','Site admin account') RETURNING *`,
      ["admin@gamecouch.local", hash]
    );
    try {
      await db.query(`UPDATE users SET is_admin = TRUE WHERE id = $1`, [admin.rows[0].id]);
    } catch (_) {}
  }
  users.push(admin.rows[0]);

  // Alex is a primary demo admin too
  try {
    await db.query(`UPDATE users SET is_admin = TRUE WHERE email = $1`, ["alex@example.com"]);
    const alex = users.find((u) => u.email === "alex@example.com");
    if (alex) alex.is_admin = true;
  } catch (e) {}

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
      if (!g || seen.has(g.id)) continue;
      seen.add(g.id);
      games.push(g);
      console.log(`  ✓ ${g.title}`);
      await new Promise((r) => setTimeout(r, 120));
    } catch (e) {
      console.warn(`  ✗ ${name}:`, e.response?.status || e.message);
    }
  }
  console.log(`Games resolved: ${games.length}`);
  return games;
}

async function seedSocial(users, games) {
  for (const u of users) {
    const others = users.filter((x) => x.id !== u.id);
    const followCount = randInt(3, Math.min(8, others.length));
    const shuffled = [...others].sort(() => Math.random() - 0.5).slice(0, followCount);
    for (const o of shuffled) {
      await db.query(
        `INSERT INTO follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [u.id, o.id]
      );
    }
  }
  console.log("Follows created.");

  const reviewIds = [];
  for (const u of users) {
    const count = randInt(8, 18);
    const picks = [...games].sort(() => Math.random() - 0.5).slice(0, count);
    for (const g of picks) {
      const completed = daysAgo(randInt(0, 400));
      const notes = rand(NOTES);
      const hasSpoilers = notes.length > 20 && Math.random() < 0.12;
      let r;
      try {
        r = await db.query(
          `INSERT INTO games (game_id, title, completed, rating, notes, released, user_id, cover_url, has_spoilers)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [g.id, g.title, completed, rating(), notes, g.released, u.id, g.cover_url, hasSpoilers]
        );
      } catch (e) {
        if (e.code === "23505") continue; // unique violation — skip
        throw e;
      }
      reviewIds.push({ id: r.rows[0].id, user_id: u.id, game_id: g.id, title: g.title });

      const st = rand(["want", "playing", "played", "played", "played"]);
      try {
        await db.query(
          `INSERT INTO game_statuses (user_id, game_id, status, title, cover_url, released, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, game_id) DO UPDATE SET status = EXCLUDED.status`,
          [u.id, g.id, st, g.title, g.cover_url, g.released]
        );
      } catch (e) {}
    }
  }
  console.log(`Reviews/logs: ${reviewIds.length}`);

  for (const rev of reviewIds) {
    if (Math.random() > 0.55) continue;
    const likers = [...users].sort(() => Math.random() - 0.5).slice(0, randInt(1, 5));
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

  for (const rev of reviewIds) {
    if (Math.random() > 0.35) continue;
    const commenter = rand(users);
    try {
      await db.query(
        `INSERT INTO comments (review_id, user_id, content, has_spoilers)
         VALUES ($1,$2,$3,false)`,
        [
          rev.id,
          commenter.id,
          rand([
            "Agreed — this one rules.",
            "I bounced off it, glad you liked it.",
            "Adding this to my list.",
            "The ending though…",
            "Have you tried the DLC?",
            "This is on my shelf too.",
          ]),
        ]
      );
    } catch (e) {
      await db.query(
        `INSERT INTO comments (review_id, user_id, content) VALUES ($1,$2,$3)`,
        [rev.id, commenter.id, "Nice log!"]
      );
    }
  }
  console.log("Comments created.");

  for (const u of users.slice(0, 8)) {
    const list = await db.query(
      `INSERT INTO lists (user_id, title, description) VALUES ($1,$2,$3) RETURNING id`,
      [u.id, rand(["Top 10", "Comfort games", "Backlog crushers", "2026 favorites", "Indie gems"]), "Seeded list"]
    );
    const picks = [...games].sort(() => Math.random() - 0.5).slice(0, randInt(4, 8));
    let pos = 0;
    for (const g of picks) {
      await db.query(
        `INSERT INTO list_items (list_id, game_id, title, cover_url, position)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [list.rows[0].id, g.id, g.title, g.cover_url, pos++]
      );
    }
  }
  console.log("Lists created.");

  for (const rev of reviewIds.slice(0, 40)) {
    try {
      await db.query(
        `INSERT INTO activities (actor_id, type, entity_type, entity_id, meta)
         VALUES ($1,'review','review',$2,$3::jsonb)`,
        [
          rev.user_id,
          rev.id,
          JSON.stringify({ game_id: rev.game_id, title: rev.title, rating: 4 }),
        ]
      );
    } catch (e) {}
  }

  for (const u of users) {
    const fav = rand(games);
    try {
      await db.query(`UPDATE users SET favorite_game = $1 WHERE id = $2`, [fav.title, u.id]);
    } catch (e) {}
  }
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

  console.log("\nDone.");
  console.log("Login examples:");
  console.log("  admin@gamecouch.local / password123 (admin)");
  console.log("  alex@example.com / password123");
  console.log("  jordan@example.com / password123");
  await db.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await db.end(); } catch (_) {}
  process.exit(1);
});
