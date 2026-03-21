import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string | null;
      image: string | null;
      role: string;
    }
  }
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!user) {
      done(null, false);
      return;
    }
    done(null, {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
    });
  } catch (err) {
    done(err);
  }
});

const GOOGLE_CLIENT_ID = process.env.SparqForge_Google_Client_ID || process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.SparqForge_Google_Client_Secret || process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback";

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            done(new Error("No email found in Google profile"));
            return;
          }

          const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));

          if (existing) {
            const [updated] = await db
              .update(usersTable)
              .set({
                name: profile.displayName || existing.name,
                image: profile.photos?.[0]?.value || existing.image,
                updatedAt: new Date(),
              })
              .where(eq(usersTable.id, existing.id))
              .returning();

            done(null, {
              id: updated.id,
              email: updated.email,
              name: updated.name,
              image: updated.image,
              role: updated.role,
            });
            return;
          }

          const [newUser] = await db
            .insert(usersTable)
            .values({
              email,
              name: profile.displayName || email,
              image: profile.photos?.[0]?.value || null,
              role: "editor",
            })
            .returning();

          done(null, {
            id: newUser.id,
            email: newUser.email,
            name: newUser.name,
            image: newUser.image,
            role: newUser.role,
          });
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );
  logger.info("Google OAuth strategy configured");
} else {
  logger.warn("Google OAuth not configured: missing SparqForge_Google_Client_ID / GOOGLE_CLIENT_ID or SparqForge_Google_Client_Secret / GOOGLE_CLIENT_SECRET");
}

export default passport;
