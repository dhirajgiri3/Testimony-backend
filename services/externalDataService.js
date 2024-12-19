import googleTrends from 'google-trends-api';
import NodeCache from 'node-cache';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

// Enhanced cache configuration
const trendCache = new NodeCache({ 
  stdTTL: 3600, // 1 hour cache
  checkperiod: 120, // Check for expired keys every 2 minutes
  maxKeys: 1000 // Maximum number of keys in cache
});

// Industry keywords mapping (keeping existing INDUSTRY_KEYWORDS object)
const INDUSTRY_KEYWORDS = {
  'Web Development': {
    frontend: ['React', 'Vue.js', 'Angular', 'TypeScript', 'Svelte', 'Next.js', 'Tailwind CSS'],
    backend: ['Node.js', 'Python Django', 'Ruby Rails', 'Spring Boot', 'FastAPI', 'Express.js'],
    database: ['MongoDB', 'PostgreSQL', 'Redis', 'GraphQL', 'Prisma ORM'],
    cloud: ['AWS Services', 'Google Cloud', 'Azure', 'Vercel', 'Netlify', 'Digital Ocean'],
    devops: ['Docker', 'Kubernetes', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'Terraform'],
    testing: ['Jest', 'Cypress', 'Playwright', 'Selenium', 'Testing Library']
  },

  'Marketing': {
    digital: ['SEO Strategy', 'Content Marketing', 'Email Marketing', 'Marketing Automation'],
    social: ['Social Media Marketing', 'Instagram Marketing', 'TikTok Marketing', 'LinkedIn Marketing'],
    advertising: ['Facebook Ads', 'Google Ads', 'Programmatic Advertising', 'Native Advertising'],
    analytics: ['Google Analytics', 'Marketing Analytics', 'Attribution Modeling', 'Conversion Optimization'],
    tools: ['HubSpot', 'Salesforce', 'Mailchimp', 'Semrush', 'Ahrefs', 'Google Tag Manager'],
    content: ['Content Strategy', 'Video Marketing', 'Influencer Marketing', 'Podcast Marketing']
  },

  'Design': {
    ui: ['UI Design', 'Design Systems', 'Mobile UI', 'Responsive Design', 'Material Design'],
    ux: ['UX Research', 'User Testing', 'Information Architecture', 'Wireframing', 'Prototyping'],
    tools: ['Figma', 'Adobe XD', 'Sketch', 'InVision', 'Principle', 'Framer'],
    graphics: ['Adobe Creative Suite', 'Motion Design', 'Brand Design', 'Typography'],
    emerging: ['AR Design', 'VR Design', '3D Design', 'Voice UI', 'Gesture Interfaces'],
    methodology: ['Design Thinking', 'Agile Design', 'Design Sprint', 'Lean UX']
  },

  'Data Science': {
    core: ['Machine Learning', 'Data Mining', 'Statistical Analysis', 'Deep Learning'],
    languages: ['Python', 'R Programming', 'SQL', 'Julia', 'Scala'],
    tools: ['TensorFlow', 'PyTorch', 'Scikit-learn', 'Pandas', 'NumPy'],
    applications: ['NLP', 'Computer Vision', 'Predictive Analytics', 'Time Series Analysis'],
    bigData: ['Spark', 'Hadoop', 'Databricks', 'Big Query', 'Snowflake'],
    visualization: ['Tableau', 'Power BI', 'D3.js', 'Plotly', 'Seaborn']
  },

  'Product Management': {
    core: ['Product Strategy', 'Product Roadmap', 'Product Analytics', 'Growth Hacking'],
    tools: ['Jira', 'Confluence', 'Amplitude', 'Mixpanel', 'Product Board'],
    methodology: ['Agile', 'Scrum', 'Lean Product', 'OKRs', 'Design Sprint'],
    skills: ['Stakeholder Management', 'User Stories', 'Product Discovery', 'Go-to-Market'],
    research: ['Market Research', 'User Research', 'Competitive Analysis', 'Customer Journey']
  }
};

/**
 * Enhanced Google Trends fetcher with retry mechanism
 * @param {Array<string>} keywords
 * @param {Object} options
 * @returns {Promise<Array>}
 */
export const fetchGoogleTrends = async (keywords, options = {}) => {
  const MAX_RETRIES = 3;
  const cacheKey = `trends_${keywords.sort().join('_')}_${options.geo || 'global'}`;

  try {
    // Check cache first
    const cachedData = trendCache.get(cacheKey);
    if (cachedData) {
      logger.info('Cache hit for trends data', { keywords });
      return cachedData;
    }

    const {
      timeRange = 'PAST_12_MONTHS',
      geo = '',
      category = ''
    } = options;

    let error;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const results = await googleTrends.interestOverTime({
          keyword: keywords,
          startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          geo,
          category
        });

        const parsedResults = JSON.parse(results);
        const formattedData = parsedResults.default.timelineData.map(item => ({
          timestamp: new Date(item.time * 1000).toISOString(),
          values: item.value,
          keywords: keywords,
          formattedTime: item.formattedTime,
          formattedAxisTime: item.formattedAxisTime
        }));

        // Add metadata
        const enhancedData = {
          data: formattedData,
          metadata: {
            fetchedAt: new Date().toISOString(),
            region: geo || 'global',
            keywords: keywords,
            timeRange
          }
        };

        trendCache.set(cacheKey, enhancedData);
        return enhancedData;

      } catch (e) {
        error = e;
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
    throw error;

  } catch (error) {
    logger.error('Error fetching Google Trends:', {
      error: error.message,
      keywords,
      options
    });
    throw new AppError('Failed to fetch trend data', 500);
  }
};

/**
 * Enhanced trends data analyzer
 * @param {Array} trendsData
 * @returns {Object}
 */
const analyzeTrendsData = (trendsData) => {
  if (!trendsData?.length) return null;

  const analysis = {
    overall: {
      averages: {},
      trends: {},
      momentum: {},
      volatility: {}
    },
    timeframes: {
      recent: {},    // Last 30 days
      historical: {} // Full period
    },
    rankings: {
      byGrowth: [],
      byVolume: []
    }
  };

  trendsData.forEach(trend => {
    const keyword = trend.keywords[0];
    const values = trend.values;

    // Calculate statistics
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    const trendChange = values[values.length - 1] - values[0];
    const recentValues = values.slice(-30);
    const momentum = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;

    // Calculate volatility
    const volatility = Math.sqrt(
      values.reduce((sum, val) => sum + Math.pow(val - average, 2), 0) / values.length
    );

    // Store calculations
    analysis.overall.averages[keyword] = average;
    analysis.overall.trends[keyword] = trend;
    analysis.overall.momentum[keyword] = momentum;
    analysis.overall.volatility[keyword] = volatility;

    // Recent vs historical analysis
    analysis.timeframes.recent[keyword] = {
      average: momentum,
      trend: recentValues[recentValues.length - 1] - recentValues[0]
    };

    analysis.timeframes.historical[keyword] = {
      average,
      trend
    };
  });

  // Generate rankings
  analysis.rankings.byGrowth = Object.entries(analysis.overall.trends)
    .sort(([, a], [, b]) => b - a)
    .map(([keyword, value]) => ({ keyword, growth: value }));

  analysis.rankings.byVolume = Object.entries(analysis.overall.averages)
    .sort(([, a], [, b]) => b - a)
    .map(([keyword, value]) => ({ keyword, volume: value }));

  return analysis;
};

/**
 * Enhanced Industry Trends updater
 * @param {string} seekerId
 * @param {string} industry
 * @returns {Promise<Object>}
 */
export const updateIndustryTrends = async (seekerId, industry) => {
  try {
    if (!INDUSTRY_KEYWORDS[industry]) {
      throw new AppError(`Invalid industry: ${industry}`, 400);
    }

    const industryKeywords = Object.values(INDUSTRY_KEYWORDS[industry]).flat();
    const trendsPromises = [];
    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES = 1000; // 1 second

    // Process keywords in batches
    for (let i = 0; i < industryKeywords.length; i += BATCH_SIZE) {
      const batch = industryKeywords.slice(i, i + BATCH_SIZE);
      trendsPromises.push(
        fetchGoogleTrends(batch, {
          timeRange: 'PAST_12_MONTHS',
          geo: 'US'
        })
      );
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }

    const trendsResults = await Promise.all(trendsPromises);
    const flattenedResults = trendsResults.flatMap(result => result.data);

    // Analyze trends
    const analysis = analyzeTrendsData(flattenedResults);

    const response = {
      industry,
      updatedAt: new Date().toISOString(),
      rawData: flattenedResults,
      analysis,
      metadata: {
        keywordCount: industryKeywords.length,
        dataPoints: flattenedResults.length,
        categories: Object.keys(INDUSTRY_KEYWORDS[industry]),
        lastUpdated: new Date().toISOString(),
        dataQuality: calculateDataQuality(flattenedResults)
      }
    };

    logger.info(`Updated industry trends for ${industry}`, {
      seekerId,
      keywordCount: industryKeywords.length
    });

    return response;

  } catch (error) {
    logger.error(`Error updating industry trends:`, {
      error: error.message,
      seekerId,
      industry,
      stack: error.stack
    });

    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('Failed to update industry trends', 500);
  }
};

/**
 * Helper function to calculate data quality score
 * @param {Array} data
 * @returns {Object}
 */
function calculateDataQuality(data) {
  const completeness = data.filter(item => item.values?.length > 0).length / data.length;
  const hasNulls = data.some(item => item.values.includes(null));

  return {
    score: completeness * 100,
    completeness: `${(completeness * 100).toFixed(2)}%`,
    hasNulls,
    sampleSize: data.length
  };
}