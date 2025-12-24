const sanitizeBucketName = (bucketName) => {
  return bucketName
  .trim()
  .toLowerCase()
  .replace(/-+$/, '');
};

module.exports = { sanitizeBucketName };