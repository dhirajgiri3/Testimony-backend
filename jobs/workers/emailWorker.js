// src/jobs/workers/emailWorker.js

import { Worker } from 'bullmq';
import { logger } from '../../utils/logger.js';
import { sendEmail } from '../../config/email.js';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import AppError from '../../utils/appError.js';

// Precompile email templates
const compileTemplate = (templateName, data) => {
  const templatePath = path.join(
    __dirname,
    `../../utils/emailTemplates/${templateName}.hbs`
  );
  const templateSource = fs.readFileSync(templatePath, 'utf8');
  const template = Handlebars.compile(templateSource);
  return template(data);
};

// Define the Email Worker
const emailWorker = new Worker(
  'emailQueue',
  async (job) => {
    const { to, subject, template, data } = job.data;

    try {
      // Compile the email template with data
      const html = compileTemplate(template, data);

      // Send the email
      await sendEmail({
        to,
        subject,
        html,
      });

      logger.info(`📧 Email sent to ${to} with subject "${subject}"`);
    } catch (error) {
      logger.error(`❌ Failed to send email to ${to}:`, error);
      throw new AppError(`Failed to send email to ${to}`, 500);
    }
  },
  { connection: redisClient, concurrency: 10 }
);

// Event Listeners
emailWorker.on('completed', (job) => {
  logger.info(`✅ Email job ${job.id} completed successfully.`);
});

emailWorker.on('failed', (job, err) => {
  logger.error(`❌ Email job ${job.id} failed: ${err.message}`);
});

emailWorker.on('error', (err) => {
  logger.error('❌ Email Worker encountered an error:', err);
});

export default emailWorker;
