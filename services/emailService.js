/**
 * Sends a testimonial request email to the giver.
 *
 * @param {string} giverEmail - Giver's email address.
 * @param {string} link - Testimonial submission link.
 * @param {string} seekerName - Seeker's name.
 * @param {string} projectDetails - Details about the project.
 */
export const sendTestimonialRequestEmail = async (
  giverEmail,
  link,
  seekerName,
  projectDetails
) => {
  try {
    const html = createTestimonialRequestEmailTemplate(
      link,
      seekerName,
      projectDetails
    );
    await sendEmail({
      from: `"Testimony App" <${process.env.MAILTRAP_USER}>`,
      to: giverEmail,
      subject: 'Testimonial Request',
      html,
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
      },
    });
    logger.info(`✅ Testimonial request email sent to ${giverEmail}`);
  } catch (error) {
    logger.error(
      `❌ Error sending testimonial request email to ${giverEmail}: ${error.message}`
    );
    throw new AppError('Testimonial request email could not be sent', 500);
  }
};

/**
 * Sends an escalation notification email to the admin.
 *
 * @param {string} giverEmail - Giver's email address.
 * @param {string} reason - Reason for escalation.
 */
export const sendEscalationNotificationEmail = async (giverEmail, reason) => {
  try {
    const html = createEscalationNotificationTemplate(giverEmail, reason);
    await sendEmail({
      from: `"Testimony App" <${process.env.MAILTRAP_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: 'Testimonial Reminder Escalation',
      html,
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
      },
    });
    logger.info(`✅ Escalation notification email sent for ${giverEmail}`);
  } catch (error) {
    logger.error(
      `❌ Error sending escalation notification email for ${giverEmail}: ${error.message}`
    );
    throw new AppError('Escalation notification email could not be sent', 500);
  }
};

const emailService = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendTestimonialRequestEmail,
  sendEscalationNotificationEmail,
};

export default emailService;
