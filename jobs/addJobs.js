// src/jobs/addJobs.js

import queues from './queues.js';
import { logger } from '../utils/logger.js';

const addJobs = async () => {
  // Example: Add a high-priority email job
  await queues.emailQueue.add(
    'sendVerificationEmail',
    {
      email: 'dhirajg934@gmail.com',
      subject: 'Verify Your Email',
      html: '<p>Please verify your email by clicking <a href="#">here</a>.</p>',
    },
    { priority: 1 } // Highest priority
  );

  // Example: Add a normal-priority AI job
  await queues.aiQueue.add(
    'generateAITestimonial',
    {
      projectDetails: 'Project Alpha',
      userId: 'user123',
    },
    { priority: 5 } // Normal priority
  );

  logger.info('📦 Jobs added to the queues successfully.');
};

addJobs().catch(error => {
  logger.error('❌ Error adding jobs:', error);
});