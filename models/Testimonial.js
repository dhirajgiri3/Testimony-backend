// src/models/Testimonial.js

import mongoose from "mongoose";

const giverSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [/[^\s@]+@[^\s@]+\.[^\s@]+/, "Please provide a valid email"],
    },
    name: {
      type: String,
      required: true,
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected", "approved"],
      default: "pending",
    },
    verificationToken: {
      type: String,
      required: true,
    },
    verificationTokenExpiry: {
      type: Date,
      required: true,
    },
    testimonial: {
      type: String,
      required: false,
    },
    projectCategory: {
      type: String,
      enum: [
        "Web Development",
        "Mobile Development",
        "Marketing",
        "Design",
        "Consulting",
        "Content Creation",
        "Other",
      ],
      default: "Other",
    },
    media: [
      {
        type: String, // URL to media in Cloudinary
      },
    ],
    isApproved: {
      type: Boolean,
      default: false,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    approvalHistory: [
      // New Field
      {
        status: {
          type: String,
          enum: ["approved", "rejected"],
          required: true,
        },
        approvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        approvedAt: {
          type: Date,
          default: Date.now,
        },
        comments: {
          type: String,
          default: "",
        },
      },
    ],
  },
  { _id: false }
);

const testimonialSchema = new mongoose.Schema(
  {
    seeker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    givers: [giverSchema],
    projectDetails: {
      type: String,
      required: true,
    },
    additionalData: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    report: {
      reason: {
        type: String,
        required: true,
      },
      reportedAt: {
        type: Date,
        required: true,
        default: Date.now,
      },
      status: {
        type: String,
        enum: ["pending", "reviewed", "dismissed"],
        default: "pending",
      },
    },
    status: {
      type: String,
      enum: [
        "pending",
        "in-progress",
        "completed",
        "reported",
        "approved",
        "rejected",
      ],
      default: "pending",
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reason: {
      type: String,
    },
    isPublic: {
      // New Field
      type: Boolean,
      default: false,
    },
    approvalStatus: {
      // New Field
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    approvalHistory: [
      // New Field
      {
        status: {
          type: String,
          enum: ["approved", "rejected"],
          required: true,
        },
        approvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        approvedAt: {
          type: Date,
          default: Date.now,
        },
        comments: {
          type: String,
          default: "",
        },
      },
    ],
    // New Fields for Analytics
    skills: [
      {
        type: String,
      },
    ],
    sentimentScore: {
      type: Number, // Range -1 (negative) to 1 (positive)
      default: 0,
    },
    emotionAnalysis: {
      type: Map,
      of: Number, // e.g., { joy: 0.7, anger: 0.1 }
      default: {},
    },
    analysis: {
      skills: [String],
      sentiment: Number,
      emotions: mongoose.Schema.Types.Mixed,
      analyzedAt: Date,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true, // Added index for faster querying
    },
  },
  { timestamps: true }
);

// Indexes for efficient querying
testimonialSchema.index({ seeker: 1 });
testimonialSchema.index({ status: 1 });
testimonialSchema.index({ isPublic: 1 });
testimonialSchema.index({ "givers.verificationStatus": 1 });

const Testimonial = mongoose.model("Testimonial", testimonialSchema);

export default Testimonial;
