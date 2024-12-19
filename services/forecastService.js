// src/services/forecastService.js

import regression from 'regression';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

/**
 * Validates and preprocesses input data
 * @param {Array<Object>} data - Array of { ds: 'YYYY-MM-DD', y: Number }
 * @returns {Array<Object>} Cleaned data
 */
const validateAndPreprocessData = (data) => {
  if (!Array.isArray(data) || data.length < 3) {
    throw new AppError('Insufficient historical data for forecasting', 400);
  }

  return data.map(point => ({
    ds: new Date(point.ds),
    y: Math.max(0, Number(point.y))
  })).sort((a, b) => a.ds - b.ds);
};

/**
 * Calculate seasonal indices using ratio-to-moving-average method
 * @param {Array<Object>} data - Preprocessed data
 * @returns {Object} Seasonal indices by month
 */
const calculateSeasonalIndices = (data) => {
  const monthlyAverages = Array(12).fill(0);
  const monthCounts = Array(12).fill(0);

  data.forEach(point => {
    const month = point.ds.getMonth();
    monthlyAverages[month] += point.y;
    monthCounts[month]++;
  });

  const indices = monthlyAverages.map((sum, i) => 
    monthCounts[i] ? sum / monthCounts[i] : 1
  );

  // Normalize indices
  const avgIndex = indices.reduce((a, b) => a + b) / 12;
  return indices.map(index => index / avgIndex);
};

/**
 * Calculate confidence intervals using standard error
 * @param {Array<number>} predictions - Predicted values
 * @param {Array<number>} actual - Actual values
 * @returns {Array<Object>} Confidence intervals
 */
const calculateConfidenceIntervals = (predictions, actual) => {
  const errors = predictions.map((pred, i) => pred - actual[i]);
  const standardError = Math.sqrt(
    errors.reduce((sum, err) => sum + err * err, 0) / (errors.length - 1)
  );

  const confidenceLevel = 1.96; // 95% confidence interval
  return predictions.map(prediction => ({
    lower: Math.max(0, prediction - confidenceLevel * standardError),
    upper: prediction + confidenceLevel * standardError
  }));
};

/**
 * Forecast Testimonials Trend using multiple forecasting methods
 * @param {Array<Object>} historicalData - Array of { ds: 'YYYY-MM-DD', y: Number }
 * @param {Object} options - Forecasting options
 * @returns {Object} Forecasted data with confidence intervals
 */
export const forecastTestimonialsTrend = async (historicalData, options = {}) => {
  try {
    const {
      forecastHorizon = 6,
      includeSeasonality = true,
      confidenceIntervals = true
    } = options;

    const cleanData = validateAndPreprocessData(historicalData);
    const seasonalIndices = includeSeasonality ? calculateSeasonalIndices(cleanData) : null;

    // Prepare data for regression
    const dataPoints = cleanData.map((item, index) => [index, item.y]);
    const result = regression.linear(dataPoints);

    // Generate predictions
    const lastIndex = dataPoints.length - 1;
    const lastDate = cleanData[cleanData.length - 1].ds;
    const forecasted = [];

    for (let i = 1; i <= forecastHorizon; i++) {
      const monthIndex = lastIndex + i;
      const futureDate = new Date(lastDate);
      futureDate.setMonth(futureDate.getMonth() + i);

      let predictedValue = result.predict(monthIndex)[1];

      // Apply seasonal adjustment if enabled
      if (includeSeasonality) {
        const monthIndex = futureDate.getMonth();
        predictedValue *= seasonalIndices[monthIndex];
      }

      predictedValue = Math.max(0, Math.round(predictedValue));

      const forecast = {
        month: futureDate.toISOString().slice(0, 7),
        count: predictedValue,
        timestamp: futureDate.toISOString()
      };

      if (confidenceIntervals) {
        const intervals = calculateConfidenceIntervals(
          [predictedValue],
          cleanData.map(d => d.y)
        )[0];
        forecast.confidenceIntervals = intervals;
      }

      forecasted.push(forecast);
    }

    // Calculate forecast accuracy metrics
    const metrics = {
      r2: result.r2,
      equation: result.equation,
      points: result.points.length
    };

    return {
      forecast: forecasted,
      metrics,
      seasonalFactors: includeSeasonality ? seasonalIndices : null
    };

  } catch (error) {
    logger.error('❌ Error in forecastTestimonialsTrend:', {
      error: error.message,
      stack: error.stack
    });

    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('Failed to generate forecast', 500);
  }
};