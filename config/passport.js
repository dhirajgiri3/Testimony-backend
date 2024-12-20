// src/config/passport.js

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth2';
import User from '../models/User.js';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

const passportConfig = () => {
  // Google OAuth Strategy
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.SERVER_URL}/api/v1/auth/google/callback`,
        passReqToCallback: true,
        state: true, // Enable state parameter
      },
      async (request, accessToken, refreshToken, profile, done) => {
        try {
          let user = await User.findOne({ email: profile.email.toLowerCase() });

          if (user) {
            if (!user.googleId) {
              user.googleId = profile.id;
              user.provider = 'google';
              user.isEmailVerified = true;
              user.accessToken = accessToken;
              user.refreshToken = refreshToken;
              await user.save();
            }
            request.user = user; // Attach user information to the request object
            return done(null, user);
          }

          // Create a new user if one doesn't exist
          user = new User({
            firstName: profile.given_name,
            lastName: profile.family_name,
            email: profile.email.toLowerCase(),
            role: 'seeker', // default role
            provider: 'google',
            googleId: profile.id,
            isEmailVerified: true,
            isPhoneVerified: false,
            accessToken,
            refreshToken,
          });

          await user.save();
          request.user = user; // Attach user information to the request object
          return done(null, user);
        } catch (err) {
          logger.error(`Google OAuth Error: ${err.message}`, {
            stack: err.stack,
          });
          return done(err, false, { message: 'Google authentication failed' });
        }
      }
    )
  );

  // Serialize user for the session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from the session
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (err) {
      logger.error(`Deserialize User Error: ${err.message}`, {
        stack: err.stack,
      });
      done(err);
    }
  });
};

export default passportConfig;
