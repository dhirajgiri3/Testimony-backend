import mongoose from 'mongoose';

// src/utils/transaction.js

/**
 * Executes a function within a MongoDB transaction.
 * @param {Function} fn - The function to execute within the transaction. Receives the session as a parameter.
 * @returns {*} The result of the function.
 */
export const withTransaction = async (fn) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};
