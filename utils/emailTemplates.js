// utils/emailTemplates.js

const emailTemplates = {
  verifyEmail: (verificationUrl) => `
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background-color: #ffffff;">
      <img src="[YOUR_LOGO_URL]" alt="Logo" style="display: block; margin: 0 auto 30px; height: 40px;">
      <h2 style="color: #1a1a1a; margin-bottom: 20px; text-align: center; font-size: 24px; font-weight: 600;">Verify Your Email Address</h2>
      <p style="color: #444444; margin-bottom: 24px; line-height: 1.6; text-align: center;">Welcome! We're excited to have you on board. To start using your account, please verify your email address.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${verificationUrl}" style="background: #0066ff; color: #ffffff; padding: 14px 28px; text-decoration: none; display: inline-block; border-radius: 6px; font-weight: 500; font-size: 16px;">Verify Email Address</a>
      </div>
      <p style="color: #666666; font-size: 14px; margin-top: 24px; text-align: center; line-height: 1.5;">Button not working? Copy and paste this link in your browser:<br>
        <a href="${verificationUrl}" style="color: #0066ff; text-decoration: none; word-break: break-all;">${verificationUrl}</a>
      </p>
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eaeaea; text-align: center;">
        <p style="color: #666666; font-size: 13px; margin-bottom: 10px;">If you didn't create an account, you can safely ignore this email.</p>
        <p style="color: #666666; font-size: 13px;">Need help? Contact us at <a href="mailto:support@example.com" style="color: #0066ff; text-decoration: none;">support@example.com</a></p>
      </div>
    </div>
  `,

  resetPassword: (resetUrl) => `
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background-color: #ffffff;">
      <img src="[YOUR_LOGO_URL]" alt="Logo" style="display: block; margin: 0 auto 30px; height: 40px;">
      <h2 style="color: #1a1a1a; margin-bottom: 20px; text-align: center; font-size: 24px; font-weight: 600;">Reset Your Password</h2>
      <p style="color: #444444; margin-bottom: 24px; line-height: 1.6; text-align: center;">We received a request to reset your password. Click the button below to create a new password.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetUrl}" style="background: #0066ff; color: #ffffff; padding: 14px 28px; text-decoration: none; display: inline-block; border-radius: 6px; font-weight: 500; font-size: 16px;">Reset Password</a>
      </div>
      <p style="color: #666666; font-size: 14px; text-align: center; margin-top: 24px; line-height: 1.5;">Button not working? Copy and paste this link:<br>
        <a href="${resetUrl}" style="color: #0066ff; text-decoration: none; word-break: break-all;">${resetUrl}</a>
      </p>
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eaeaea; text-align: center;">
        <p style="color: #666666; font-size: 13px; margin-bottom: 10px;">⚠️ This link expires in 10 minutes for security reasons.</p>
        <p style="color: #666666; font-size: 13px;">Didn't request this? Please ignore this email or contact support if you're concerned.</p>
      </div>
    </div>
  `,

  welcomeEmail: (userName) => `
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background-color: #ffffff;">
      <img src="[YOUR_LOGO_URL]" alt="Logo" style="display: block; margin: 0 auto 30px; height: 40px;">
      <h2 style="color: #1a1a1a; margin-bottom: 20px; text-align: center; font-size: 24px; font-weight: 600;">Welcome to the Community, ${userName}! 🎉</h2>
      <p style="color: #444444; margin-bottom: 24px; line-height: 1.6; text-align: center;">We're thrilled to have you join us. Here are some things you can do to get started:</p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; margin: 20px 0;">
        <ul style="color: #444444; line-height: 1.6; margin: 0; padding-left: 20px;">
          <li style="margin-bottom: 12px;">Complete your profile</li>
          <li style="margin-bottom: 12px;">Explore our features</li>
          <li>Connect with others</li>
        </ul>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="[YOUR_APP_URL]" style="background: #0066ff; color: #ffffff; padding: 14px 28px; text-decoration: none; display: inline-block; border-radius: 6px; font-weight: 500; font-size: 16px;">Get Started</a>
      </div>
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eaeaea; text-align: center;">
        <p style="color: #666666; font-size: 13px;">Questions? Contact our support team at <a href="mailto:support@example.com" style="color: #0066ff; text-decoration: none;">support@example.com</a></p>
      </div>
    </div>
  `,

  accountDeletion: (userName) => `
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background-color: #ffffff;">
      <img src="[YOUR_LOGO_URL]" alt="Logo" style="display: block; margin: 0 auto 30px; height: 40px;">
      <h2 style="color: #1a1a1a; margin-bottom: 20px; text-align: center; font-size: 24px; font-weight: 600;">Account Successfully Deleted</h2>
      <p style="color: #444444; margin-bottom: 24px; line-height: 1.6; text-align: center;">We're sorry to see you go, ${userName}. Your account and all associated data have been successfully deleted.</p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; margin: 20px 0; text-align: center;">
        <p style="color: #666666; margin: 0;">If you believe this was a mistake or would like to create a new account, please visit our website.</p>
      </div>
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eaeaea; text-align: center;">
        <p style="color: #666666; font-size: 13px;">Need assistance? Contact us at <a href="mailto:support@example.com" style="color: #0066ff; text-decoration: none;">support@example.com</a></p>
      </div>
    </div>
  `
};

export { emailTemplates };
