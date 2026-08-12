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
//#endregion

//#region Configs
env.config();
const app = express();
const port = 3000;
const API_KEY = process.env.API_KEY;
const API_URL = `https://api.mobygames.com/v1/games?api_key=${API_KEY}`;
const saltRounds = 10;
//#endregion

//#region Database Connection Config
const db = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
//#endregion

//#region body parser and static public middlewares
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
//#endregion

//#region Session creation
app.use(
  session({
    store: new (PGStore(session))({
      pool: db,
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 1000 * 60 * 60,
    },
  })
);
//#endregion

//#region Passport initialization middleware
app.use(passport.initialize());
app.use(passport.session());
//#endregion

//#region default vars for home page display and post editing
let activeEdit = 0;
let sortMethod = "released";
//#endregion

//#region get and display home page
app.get("/", async (req, res) => {
  // Whitelist allowed sort columns to avoid SQL injection
  const allowedSorts = ["released", "rating", "title", "completed"];
  if (!allowedSorts.includes(sortMethod)) {
    sortMethod = "released";
  }

  // Join users so we can show who wrote each review
  let dbResult = await db.query(
    `SELECT games.*, users.email AS author_email
     FROM games
     LEFT JOIN users ON games.user_id = users.id
     ORDER BY games.${sortMethod} DESC`
  );
  let userInfo = dbResult.rows;

  // Fetch all comments for these reviews
  let commentsByReview = {};
  if (userInfo.length > 0) {
    const reviewIds = userInfo.map((g) => g.id);
    const commentsResult = await db.query(
      `SELECT comments.*, users.email AS author_email
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

  let gamesData = [];
  if (userInfo.length > 0) {
    let ids = "";
    for (let i = 0; i < userInfo.length; i++) {
      ids += "&id=" + userInfo[i]["game_id"];
    }
    try {
      const result = await axios.get(API_URL + ids);
      gamesData = result.data["games"] || [];
      if (gamesData[0]?.sample_cover?.image) {
        console.log(gamesData[0]["sample_cover"]["image"]);
      }
    } catch (err) {
      console.error("MobyGames API error:", err.message);
    }
  }

  res.render("index.ejs", {
    userInfo: userInfo,
    data: gamesData,
    userlog: req.user,
    commentsByReview: commentsByReview,
  });
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

app.post("/add-game", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  try {
    console.log(req.body);
    const result = await axios.get(API_URL + `&id=${req.body["game_id"]}`);
    console.log(result.data);
    let title = result.data["games"][0]["title"];
    let release =
      result.data["games"][0]["platforms"]?.[0]?.["first_release_date"] || null;

    await db.query(
      `INSERT INTO games (game_id, title, completed, rating, notes, released, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.body["game_id"],
        title,
        req.body["completed"],
        req.body["rating"],
        req.body["review"],
        release,
        req.user.id,
      ]
    );
    res.redirect("/");
  } catch (err) {
    console.error("Error adding game:", err.message);
    res.redirect("/add");
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
  if (!req.isAuthenticated()) return res.redirect("/login");
  const { review_id, content } = req.body;
  if (!review_id || !content || !content.trim()) return res.redirect("/");
  try {
    await db.query(
      `INSERT INTO comments (review_id, user_id, content) VALUES ($1, $2, $3)`,
      [review_id, req.user.id, content.trim()]
    );
  } catch (err) {
    console.error("Comment error:", err.message);
  }
  res.redirect("/");
});

app.post("/edit-comment", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const { comment_id, content } = req.body;
  if (!comment_id || !content || !content.trim()) return res.redirect("/");
  try {
    // Only allow editing own comments
    await db.query(
      `UPDATE comments SET content = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      [content.trim(), comment_id, req.user.id]
    );
  } catch (err) {
    console.error("Edit comment error:", err.message);
  }
  res.redirect("/");
});

app.post("/delete-comment", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");
  const { comment_id } = req.body;
  if (!comment_id) return res.redirect("/");
  try {
    // Only allow deleting own comments
    await db.query(
      `DELETE FROM comments WHERE id = $1 AND user_id = $2`,
      [comment_id, req.user.id]
    );
  } catch (err) {
    console.error("Delete comment error:", err.message);
  }
  res.redirect("/");
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
  const email = req.body.username;
  const password = req.body.password;

  console.log(email, password);
  bcrypt.hash(password, saltRounds, async (err, hash) => {
    if (err) {
      console.log("error");
    } else {
      console.log("attempting db user creation");
      try {
        const result = await db.query(
          "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
          [email, hash]
        );
        const user = result.rows[0];
        console.log(user);
        req.login(user, (err) => {
          if (err) console.log(err);
          res.redirect("/");
        });
      } catch (dbErr) {
        console.error("Registration error:", dbErr.message);
        res.redirect("/register");
      }
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

//#region Listen on port
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
//#endregion