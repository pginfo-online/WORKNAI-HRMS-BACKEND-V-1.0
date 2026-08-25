import 'dotenv/config';
import app from './src/app.js';
import connectDB from './src/config/db.js';
import { logger } from './src/utils/logger.js';

const PORT = process.env.PORT || 5000;

// Connect to Database and start server
connectDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Server running on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    logger.error('❌ Failed to connect to database', err);
    process.exit(1);
  });
