import mongoose from 'mongoose';
import dns from 'dns';
import { logger } from '../utils/logger.js';

const connectDB = async () => {
  try {
    const dbUri = process.env.MONGODB_URI;

    if (!dbUri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    if (dbUri.startsWith('mongodb+srv://') && process.env.NODE_ENV !== 'production') {
      try {
        dns.setServers(['8.8.8.8', '1.1.1.1']);
      } catch (dnsErr) {
        logger.warn(`⚠️ Failed to set fallback DNS servers: ${dnsErr.message}`);
      }
    }

    const conn = await mongoose.connect(dbUri);

    logger.info(`✅ MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error(`❌ MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️ MongoDB disconnected.');
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB error: ${err.message}`);
});

export default connectDB;