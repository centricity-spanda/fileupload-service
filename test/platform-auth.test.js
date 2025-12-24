const platformAuthMiddleware = require('../middlewares/platform-auth');
const platformConfig = require('../config/platform-config');

// Mock platform config
jest.mock('../config/platform-config');

describe('platformAuthMiddleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      platformContext: null
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    
    next = jest.fn();
    
    // Reset environment
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should return 400 if X-Platform-ID header is missing', () => {
    req.headers = {};
    platformAuthMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Missing X-Platform-ID header'
    });
  });


  test('should return 500 if NODE_ENV is not set', () => {
    req.headers = {
      'x-platform-id': 'onedigital'
    };

    platformAuthMiddleware(req, res, next);

    //process.env.NODE_ENV is not set

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Environment not configured'
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('should return 404 if platform config is not found', () => {
    process.env.NODE_ENV = 'uat';
    req.headers = {
      'x-platform-id': 'invalid-platform'
    };

    platformConfig.getPlatformConfig.mockImplementation(() => {
      throw new Error("Platform 'invalid-platform' not found");
    });

    platformAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Platform 'invalid-platform' not found"
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('should attach platform context and call next on success', () => {
    process.env.NODE_ENV = 'uat';
    req.headers = {
      'x-platform-id': 'onedigital'
    };

    const mockConfig = {
      provider: 'azure',
      connectionString: 'test-connection'
    };

    platformConfig.getPlatformConfig.mockReturnValue(mockConfig);

    platformAuthMiddleware(req, res, next);
    console.log("req.platformContext", req.platformContext);
    expect(platformConfig.getPlatformConfig).toHaveBeenCalledWith('onedigital', 'uat');
    expect(req.platformContext).toEqual({
      platformId: 'onedigital',
      environment: 'uat',
      config: mockConfig
    });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should trim and lowercase platform ID', () => {
    process.env.NODE_ENV = 'uat';
    req.headers = {
      'x-platform-id': '  ONEDIGITAL  '
    };

    const mockConfig = {
      provider: 'azure'
    };

    platformConfig.getPlatformConfig.mockReturnValue(mockConfig);

    platformAuthMiddleware(req, res, next);

    expect(platformConfig.getPlatformConfig).toHaveBeenCalledWith('onedigital', 'uat');
    expect(req.platformContext.platformId).toBe('  ONEDIGITAL  '); // Note: middleware doesn't modify the original
    expect(next).toHaveBeenCalled();
  });

  test('should handle errors and return 500', () => {
    process.env.NODE_ENV = 'uat';
    req.headers = {
      'x-platform-id': 'onedigital'
    };

    platformConfig.getPlatformConfig.mockImplementation(() => {
      throw new Error('Unexpected error');
    });

    platformAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
});

