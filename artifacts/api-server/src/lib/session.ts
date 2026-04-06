import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";

const PgSession = connectPgSimple(session);

const SESSION_SECRET = process.env.SESSION_SECRET || (
  process.env.NODE_ENV === "production"
    ? (() => { throw new Error("SESSION_SECRET is required in production"); })()
    : "sparqmake-dev-secret-change-in-production"
);

export const sessionMiddleware = session({
  store: new PgSession({
    pool: pool as any,
    tableName: "session",
    createTableIfMissing: true,
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
  },
});
