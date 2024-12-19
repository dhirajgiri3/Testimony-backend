import Testimonial from "../models/Testimonial.js";
import { openai } from "../config/openAI.js";
import { logger } from "../utils/logger.js";

/**
 * Fetches all testimonials for a seeker and uses OpenAI to produce advanced analytics.
 * This includes skill extraction, sentiment analysis, predictive insights, improvement suggestions, etc.
 *
 * @param {string} seekerId - The seeker's user ID
 * @returns {Object} advancedInsights - Detailed AI-driven analytics
 */
export const getAdvancedAnalytics = async (seekerId) => {
  // Fetch all testimonials text
  const testimonials = await Testimonial.find({
    seeker: seekerId,
    "givers.testimonial": { $exists: true, $ne: null },
  })
    .select(
      "givers.testimonial givers.name givers.email projectDetails createdAt"
    )
    .lean();

  if (!testimonials || testimonials.length === 0) {
    // If no testimonials, return empty advanced insights
    return {
      skills: [],
      sentimentAnalysis: {},
      improvementSuggestions: [],
      predictiveInsights: {},
      benchmarking: {},
      trendAnalysis: {},
    };
  }

  // Aggregate testimonial texts
  const testimonialTexts = testimonials.flatMap((t) =>
    t.givers
      .filter((g) => g.testimonial && g.isApproved)
      .map((g) => ({
        testimonial: g.testimonial,
        projectDetails: t.projectDetails,
        date: t.createdAt,
      }))
  );

  if (testimonialTexts.length === 0) {
    return {
      skills: [],
      sentimentAnalysis: {},
      improvementSuggestions: [],
      predictiveInsights: {},
      benchmarking: {},
      trendAnalysis: {},
    };
  }

  const prompt = `
You are an expert AI assistant that analyzes professional testimonials. 
You will receive a series of testimonials (real or hypothetical) about a professional (the "Seeker"). 
Your goal: Produce a JSON response with advanced analytics:

Requirements for the JSON fields:
- "skills": An array of objects { "skill": string, "mentions": number, "context": "why skill is valued" } extracted from testimonial text.
- "sentimentAnalysis": Object with fields:
   - "overallSentiment": "very positive", "positive", "mixed", "negative", etc.
   - "emotions": array of objects { "emotion": "trust/confidence/praise/etc.", "intensity": 0-1 }
   - "commonPraises": array of phrases frequently used
   - "commonCriticisms": array of phrases or aspects needing improvement
- "improvementSuggestions": array of strings, each is a recommendation to the Seeker on how to improve (based on criticisms or trends)
- "predictiveInsights": object with:
   - "futureDemandSkills": array of skill names that might be in higher demand soon
   - "forecast": string describing expected testimonial trend if improvements are made
- "benchmarking": object with:
   - "industryComparison": a qualitative statement (e.g., "You rank above average in communication compared to peers")
   - "topStrengthComparedToPeers": a skill or trait that is relatively stronger than average
- "trendAnalysis": object showing how sentiments or skill mentions changed over time (just describe a trend if possible)

Return ONLY the JSON object, without explanations.
Make sure the JSON is valid.
Here are the testimonials:

${testimonialTexts.map((t, i) => `Testimonial #${i + 1} (Date: ${t.date.toISOString()}): "${t.testimonial}" [Project: ${t.projectDetails}]`).join("\n")}
`;

  try {
    const response = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a professional analytics assistant.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    });

    const content = response.data.choices[0].message.content.trim();

    // Attempt to parse JSON
    let advancedInsights;
    try {
      advancedInsights = JSON.parse(content);
    } catch (jsonErr) {
      logger.error(
        "❌ Failed to parse AI response JSON, returning fallback structure.",
        jsonErr
      );
      // Fallback if parsing fails
      advancedInsights = {
        skills: [],
        sentimentAnalysis: {},
        improvementSuggestions: [],
        predictiveInsights: {},
        benchmarking: {},
        trendAnalysis: {},
        parsingError: true,
        rawResponse: content,
      };
    }

    return advancedInsights;
  } catch (error) {
    logger.error("❌ Error generating advanced analytics from OpenAI:", error);
    return {
      skills: [],
      sentimentAnalysis: {},
      improvementSuggestions: ["We encountered an error analyzing your data."],
      predictiveInsights: {},
      benchmarking: {},
      trendAnalysis: {},
      error: "AI analysis failed",
    };
  }
};
