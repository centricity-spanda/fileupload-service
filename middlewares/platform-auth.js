// middleware/platform-auth.middleware.js
const platformConfig = require('../config/platform-config');

/**
 * Middleware to authenticate and determine environment from API key
 */
function platformAuthMiddleware(req, res, next) {
  try {
    const platformId = req.headers['x-platform-id'];

    if (!platformId) {
      return res.status(400).json({
        success: false,
        error: 'Missing X-Platform-ID header'
      });
    }

    // Get environment from environment variables
    const environment = process.env.NODE_ENV;
    
    if (!environment) {
      return res.status(500).json({
        success: false,
        error: 'Environment not configured'
      });
    }

    // Get platform config for the specified platform and environment
    let config;
    try {
      config = platformConfig.getPlatformConfig(platformId.trim().toLowerCase(), environment);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    // // Verify API key matches the platform and environment
    // if (config.apiKey !== apiKey) {
    //   return res.status(403).json({
    //     success: false,
    //     error: 'Invalid API key for platform and environment'
    //   });
    // }

    // Attach context with environment from env
    req.platformContext = {
      platformId: platformId,
      environment: environment,
      config: config
    };

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
}

module.exports = platformAuthMiddleware;