//#region Imports
// imports express for server routing
import express from "express";
// imports express sessions to allow users to remain signed in
import session from "express-session";
// allows for easily return form values
import bodyParser from "body-parser";
// allows easy api usage
import axios from "axios";
// allows postgresql usage
import Pool from "pg-pool";
// Hashes passwords
import bcrypt from "bcrypt";
// Stores sensitive vars like API keys in separate .env file
import env from "dotenv";
// Allows for easy user authentication
import passport from "passport";
// Allows sessions to be stored in postgresql db
import PGStore from "connect-pg-simple";
// Allows passport authentication with username and password
import { Strategy } from "passport-local";
// Allows passport authentication with Google (May want to change package to more popular one?)
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

//#region Databse Connection Config
//TODO: May need to be configured further
// Using pg pool instead of pg client because it works well with sessions.
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
    // Stores session in db. This is more secure than storing in the server. Now if server restarts sessions are still saved and prevents memory leaks
    store: new (PGStore(session))({
      pool: db,
      //conString: `postgres://${process.env.PG_USER}:${process.env.PG_PASSWORD}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}`,
      createTableIfMissing: true,
    }),
    // Secret is used to hash the session to protect against session hijacking
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
// passport middleware comes after session always
app.use(passport.initialize());
app.use(passport.session());
//#endregion

//#region default vars for home page display and post editing
let activeEdit = 0;
let sortMethod = "released";
//#endregion

//#region get and display home page
//TODO: ADD MobyGames credit on pages
app.get("/", async (req, res) => {
  let dbResult = await db.query(
    `SELECT * FROM games ORDER BY ${sortMethod} DESC`
  );
  let userInfo = dbResult.rows;
  let ids = "";
  for (let i = 0; i < userInfo.length; i++) {
    ids += "&id=" + userInfo[i]["game_id"];
  }
  const result = await axios.get(API_URL + ids);
  res.render("index.ejs", {
    userInfo: userInfo,
    data: result.data["games"],
    userlog: req.user,
  });
});
//#endregion

//#region get and post for adding new game reviews
app.get("/add", (req, res) => {
  res.render("add.ejs");
});

app.post("/add-game", async (req, res) => {
  console.log(req.body);
  const result = await axios.get(API_URL + `&id=${req.body["game_id"]}`);
  console.log(result.data);
  let title = result.data["games"][0]["title"];
  let release = result.data["games"][0]["platforms"][0]["first_release_date"];
  console.log(release);
  await db.query(
    `INSERT INTO games (game_id, title, completed, rating, notes, released) VALUES (${req.body["game_id"]}, '${title}', '${req.body["completed"]}', '${req.body["rating"]}', '${req.body["review"]}', '${release}')`
  );
  setTimeout(function () {
    res.redirect("/");
  }, 1000);
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
    `UPDATE games SET completed='${req.body["completed"]}', rating='${req.body["rating"]}', notes='${req.body["review"]}' WHERE game_id=${activeEdit}`
  );
  res.redirect("/");
});
//#endregion

//#region post for game review deletion
app.post("/delete", async (req, res) => {
  console.log(req.body);
  await db.query(`DELETE FROM games WHERE game_id=${req.body["delete"]}`);
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

//#region gets for login and register
// Get for login page
app.get("/login", (req, res) => {
  res.render("login.ejs");
});

// Get for register page
app.get("/register", (req, res) => {
  res.render("register.ejs");
});
//#endregion

//#region post for login and register
// Post for login page, submits credentials to local auth method, redirects depending on returned result
app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/secrets",
    failureRedirect: "/login",
  })
);

// Post for register page, hashes entered password and stores entered credentials in database, also logs user into new account and redirects to secrets
app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;
  //TODO: test hashing with salting duration to get it to 250ms
  //Use bcrypt.hash to hash form password, also add additional saltrounds for safety. (Rule is 250 ms per password (about 6 rounds))
  // returns hashed password if successful
  console.log(email, password);
  bcrypt.hash(password, saltRounds, async (err, hash) => {
    if (err) {
      // unsuccessful hash
      console.log("error");
    } else {
      // successful hash, store user in db
      console.log("attempting db user creation");
      const result = await db.query(
        "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
        [email, hash]
      );
      const user = result.rows[0];
      console.log(user);
      req.login(user, (err) => {
        console.log(err);
        res.redirect("/secrets");
      });
    }
  });
});
//#endregion

//#region get for secrets
// Get for secrets, Checks if user is authenticated, when true render secrets.ejs else redirect to login
app.get("/secrets", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("secrets.ejs");
  } else {
    res.redirect("/login");
  }
});
//#endregion

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/profile",
  passport.authenticate("google", {
    successRedirect: "/secrets",
    failureRedirect: "/login",
  })
);

app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) console.log(err);
    res.redirect("/");
  });
});

//#region Passport Local Strategy
//passport local auth strategy method, this is where login post sends to (passport.authenticate("local")) and returns back result
passport.use(
  "local",
  // passport automatically checks forms for names username and password (matching the first 2 params in verify). Therefore we don't need to rely on body parser
  new Strategy(async function verify(username, password, cb) {
    // Check if email exists in db (all emails are unique and not null in db)
    const result = await db.query("SELECT * FROM users WHERE email = $1", [
      username,
    ]);
    // assign vars based on db result and compare the password using bcrypt
    let newResult = result.rows[0];
    let storedHashedPassword = newResult.password;
    // bcrypt result returns true or false, or gives error
    bcrypt.compare(password, storedHashedPassword, (err, result) => {
      if (err) {
        console.log(err);
      } else {
        if (result) {
          // auth success
          return cb(null, newResult);
        } else {
          // auth fail
          return cb(null, false);
        }
      }
    });
  })
);
//#endregion

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/profile",
      userProfileURL: "https:www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        console.log(profile);
        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2)",
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

//#region Serialize and Deserialize user
//stores information about the user into the session
passport.serializeUser((user, cb) => {
  cb(null, user.id);
});

//extracts information about the user from the session
passport.deserializeUser((user, cb) => {
  cb(null, user);
});
//#endregion

//#region Listen on port
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
//#endregion
