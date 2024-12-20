// src/services/forecastService.js

import regression from 'regression';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

/**
 * Validates and preprocesses input data for forecasting.
 *
 * @param {Array<Object>} data - Array of { ds: 'YYYY-MM-DD', y: Number }.
 * @returns {Array<Object>} Cleaned data.
 * @throws {AppError} If data is insufficient or malformed.
 */
const validateAndPreprocessData = (data) => {
  if (!Array.isArray(data) || data.length < 3) {
    throw new AppError('Insufficient historical data for forecasting', 400);
  }

  return data
    .map((point) => ({
      ds: new Date(point.ds),
      y: Math.max(0, Number(point.y)),
    }))
    .filter(point => !isNaN(point.ds) && !isNaN(point.y))
    .sort((a, b) => a.ds - b.ds);
};

/**
 * Calculates seasonal indices using the ratio-to-moving-average method.
 *
 * @param {Array<Object>} data - Preprocessed data.
 * @returns {Array<number>} Seasonal indices by month.
 */
const calculateSeasonalIndices = (data) => {
  const monthlySums = Array(12).fill(0);
  const monthCounts = Array(12).fill(0);

  data.forEach((point) => {
    const month = point.ds.getMonth();
    monthlySums[month] += point.y;
    monthCounts[month]++;
  });

  const indices = monthlySums.map((sum, i) =>
    monthCounts[i] ? sum / monthCounts[i] : 1
  );

  // Normalize indices
  const avgIndex = indices.reduce((a, b) => a + b, 0) / 12;
  return indices.map((index) => index / avgIndex);
};

/**
 * Calculates confidence intervals using standard error.
 *
 * @param {Array<number>} predictions - Predicted values.
 * @param {Array<number>} actual - Actual historical values.
 * @returns {Array<Object>} Confidence intervals.
 */
const calculateConfidenceIntervals = (predictions, actual) => {
  if (actual.length < 2) {
    return predictions.map(() => ({
      lower: 0,
      upper: 0,
    }));
  }

  const errors = actual.map((act, i) => act - predictions[i] || 0);
  const squaredErrors = errors.map(err => err * err);
  const variance = squaredErrors.reduce((sum, val) => sum + val, 0) / (squaredErrors.length - 1);
  const standardError = Math.sqrt(variance);

  const confidenceLevel = 1.96; // 95% confidence interval
  return predictions.map((prediction) => ({
    lower: Math.max(0, prediction - confidenceLevel * standardError),
    upper: prediction + confidenceLevel * standardError,
  }));
};

/**
 * Forecasts testimonial trends using linear regression.
 *
 * @param {Array<Object>} historicalData - Array of { ds: 'YYYY-MM-DD', y: Number }.
 * @param {Object} [options={}] - Forecasting options.
 * @returns {Promise<Object>} Forecasted data with confidence intervals.
 * @throws {AppError} If forecasting fails.
 */
export const forecastTestimonialsTrend = async (
  historicalData,
  options = {}
) => {
  try {
    const {
      forecastHorizon = 6, // Number of periods to forecast
      includeSeasonality = true,
      confidenceIntervals = true,
    } = options;

    const cleanData = validateAndPreprocessData(historicalData);
    const seasonalIndices = includeSeasonality
      ? calculateSeasonalIndices(cleanData)
      : null;

    // Prepare data for regression
    const dataPoints = cleanData.map((item, index) => [index, item.y]);
    const result = regression.linear(dataPoints);

    // Generate predictions
    const lastIndex = dataPoints.length - 1;
    const lastDate = cleanData[cleanData.length - 1].ds;
    const forecasted = [];

    for (let i = 1; i <= forecastHorizon; i++) {
      const forecastIndex = lastIndex + i;
      const futureDate = new Date(lastDate);
      futureDate.setMonth(futureDate.getMonth() + 1);

      let predictedValue = result.predict(forecastIndex)[1];

      // Apply seasonal adjustment if enabled
      if (includeSeasonality) {
        const month = futureDate.getMonth();
        predictedValue *= seasonalIndices[month];
      }

      predictedValue = Math.max(0, Math.round(predictedValue));

      const forecast = {
        month: futureDate.toISOString().slice(0, 7),
        count: predictedValue,
        timestamp: futureDate.toISOString(),
      };

      if (confidenceIntervals) {
        const intervals = calculateConfidenceIntervals(
          [predictedValue],
          cleanData.map((d) => d.y)
        )[0];
        forecast.confidenceIntervals = intervals;
      }

      forecasted.push(forecast);
      lastDate.setMonth(lastDate.getMonth() + 1);
    }

    // Calculate forecast accuracy metrics
    const metrics = {
      r2: result.r2,
      equation: result.equation,
      points: result.points.length,
    };

    return {
      forecast: forecasted,
      metrics,
      seasonalFactors: includeSeasonality ? seasonalIndices : null,
    };
  } catch (error) {
    logger.error('❌ Forecast Testimonials Trend Failed:', error);
    throw new AppError('Failed to generate forecast', 500);
  }
};

const forecastService = {
  forecastTestimonialsTrend,
};

export default forecastService;
