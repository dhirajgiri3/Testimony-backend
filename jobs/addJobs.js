// src/jobs/addJobs.js

import { queues } from './queues.js';
import { logger } from '../utils/logger.js';

const addJobs = async () => {
  try {
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

    // Check if aiQueue exists before adding a job to it
    if (queues.aiQueue) {
      // Example: Add a normal-priority AI job
      await queues.aiQueue.add(
        'generateAITestimonial',
        {
          projectDetails: 'Project Alpha',
          userId: 'user123',
        },
        { priority: 5 } // Normal priority
      );
    } else {
      logger.warn('⚠️ AI Queue is not defined.');
    }

    // Example: Add a testimonial approval email notification
    await queues.emailQueue.add(
      'sendEmailNotification',
      {
        to: 'seeker@example.com',
        subject: 'Your Testimonial Has Been Approved',
        template: 'testimonialApprovalEmail',
        data: {
          firstName: 'John',
          giverEmail: 'giver@example.com',
          testimonialId: 'testimonial123',
          profileLink: 'https://testimony.com/profile/john',
        },
      },
      { priority: 1 } // Highest priority
    );

    // Example: Add a testimonial approval in-app notification
    await queues.notificationQueue.add(
      'sendInAppNotification',
      {
        userId: 'user123',
        message: 'Your testimonial has been approved.',
      },
      { priority: 1 } // Highest priority
    );

    logger.info('📦 Jobs added to the queues successfully.');
  } catch (error) {
    logger.error('❌ Error adding jobs:', error);
  }
};

addJobs();
