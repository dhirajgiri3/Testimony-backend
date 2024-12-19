import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "Please provide your first name"],
      trim: true,
      maxlength: [50, "First name cannot exceed 50 characters"],
    },
    lastName: {
      type: String,
      required: [true, "Please provide your last name"],
      trim: true,
      maxlength: [50, "Last name cannot exceed 50 characters"],
    },
    email: {
      type: String,
      required: [true, "Please provide your email"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Please provide a password"],
      minlength: 8,
      select: false,
    },
    role: {
      type: String,
      enum: ["seeker", "giver", "admin"],
      default: "seeker",
    },
    phone: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      match: [
        /^\+[1-9]\d{1,14}$/,
        "Phone number must be in E.164 format (e.g., +1234567890)",
      ],
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: String,
    emailVerificationTokenExpiry: Date,
    resetPasswordToken: String,
    resetPasswordExpiry: Date,
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockedUntil: Date,
    provider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    passwordChangedAt: Date,
    isActive: {
      type: Boolean,
      default: true,
    },
    otp: {
      code: String,
      expiresAt: Date,
    },
    userAgent: String,
    ipAddress: String,
    createdAt: {
      type: Date,
      default: Date.now,
    },
    // Additional fields as needed
  },
  { timestamps: true }
);

// Collation for case-insensitive queries
userSchema.index(
  { email: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);
userSchema.index({ phone: 1 }, { unique: true, sparse: true });

// Encrypt password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  // Set passwordChangedAt if password is modified and not new
  if (!this.isNew) {
    this.passwordChangedAt = Date.now() - 1000; // Ensure it's set before the token's iat
  }

  next();
});

// Compare user entered password with hashed password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Check if password was changed after token was issued
userSchema.methods.passwordChangedAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimestamp < changedTimestamp;
  }

  // False means NOT changed
  return false;
};

// Increment Token Version to invalidate existing refresh tokens
userSchema.methods.incrementTokenVersion = function() {
  this.tokenVersion += 1;
  return this.save();
};

// Generate JWT Access Token
userSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    { id: this._id, role: this.role, tokenVersion: this.tokenVersion },
    process.env.JWT_ACCESS_SECRET,
    {
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    }
  );
};

// Generate JWT Refresh Token
userSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    { id: this._id, role: this.role, tokenVersion: this.tokenVersion },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
    }
  );
};

// Generate Email Verification Token
userSchema.methods.generateEmailVerificationToken = function () {
  const verificationToken = crypto.randomBytes(20).toString("hex");

  // Hash token and set to emailVerificationToken field
  this.emailVerificationToken = crypto
    .createHash("sha256")
    .update(verificationToken)
    .digest("hex");

  // Set expire time
  this.emailVerificationTokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  return verificationToken;
};

const User = mongoose.model("User", userSchema);

export default User;
