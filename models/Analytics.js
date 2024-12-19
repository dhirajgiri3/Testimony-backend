// src/models/Analytics.js

import mongoose from "mongoose";

const analyticsSchema = new mongoose.Schema(
  {
    seeker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    totalRequests: {
      type: Number,
      default: 0,
    },
    totalTestimonials: {
      type: Number,
      default: 0,
    },
    skills: [
      {
        skill: String,
        frequency: Number,
        sentiment: Number, // Average sentiment for the skill
      },
    ],
    sentimentOverview: {
      averageSentiment: {
        type: Number,
        default: 0,
      },
      sentimentTrend: [
        {
          month: String, // e.g., '2024-04'
          averageSentiment: Number,
        },
      ],
    },
    emotionDistribution: {
      joy: Number,
      anger: Number,
      sadness: Number,
      fear: Number,
      surprise: Number,
      disgust: Number,
      // Add more emotions as needed
    },
    testimonialsByStatus: [
      {
        status: String,
        count: Number,
      },
    ],
    testimonialsTrend: [
      {
        month: String,
        count: Number,
      },
    ],
    recentActivity: [
      {
        activity: String,
        timestamp: Date,
      },
    ],
    goals: [
      {
        title: String,
        description: String,
        status: String,
        startDate: Date,
        deadline: Date,
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const Analytics = mongoose.model("Analytics", analyticsSchema);

export default Analytics;
