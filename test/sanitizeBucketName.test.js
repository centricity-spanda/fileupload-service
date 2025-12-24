const { sanitizeBucketName } = require('../utils/sanitizeBucketName.js');

describe('sanitizeBucketName', () => {
  test('should convert to lowercase', () => {
    expect(sanitizeBucketName('MyBucket')).toBe('mybucket');
    expect(sanitizeBucketName('UPPERCASE')).toBe('uppercase');
  });

  test('should remove trailing hyphens', () => {
    expect(sanitizeBucketName('bucket-')).toBe('bucket');
    expect(sanitizeBucketName('bucket----')).toBe('bucket');
  });

  test('should handle empty string', () => {
    expect(sanitizeBucketName('')).toBe('');
  });


});

