// src/data/seed.js

import dotenv from 'dotenv';
import User from '../models/User.js';
import Testimonial from '../models/Testimonial.js';
import { connectDB } from '../config/db.js';
import { logger } from '../utils/logger.js';

dotenv.config();

const seedData = async () => {
  try {
    await connectDB();

    // Clear existing data
    await User.deleteMany();
    await Testimonial.deleteMany();

    // Create sample users
    const users = await User.insertMany([
      {
        name: 'Dhiraj',
        email: 'dhiraj@example.com',
        password: 'password123',
        role: 'seeker',
        isVerified: true,
      },
      {
        name: 'Ramesh',
        email: 'ramesh@example.com',
        password: 'password123',
        role: 'giver',
        isVerified: true,
      },
    ]);

    logger.info('Data Imported Successfully');
    process.exit();
  } catch (error) {
    logger.error(`Error with data import: ${error}`);
    process.exit(1);
  }
};

const clearData = async () => {
  try {
    await connectDB();

    // Clear existing data
    await User.deleteMany();
    await Testimonial.deleteMany();

    logger.info('Data Destroyed Successfully');
    process.exit();
  } catch (error) {
    logger.error(`Error with data destruction: ${error}`);
    process.exit(1);
  }
};

if (process.argv[2] === '-d') {
  clearData();
} else {
  seedData();
}
