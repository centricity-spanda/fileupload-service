const sanitizeFileName = (fileName) => {
  // Convert to lowercase, replace spaces with hyphens, remove invalid characters, and trim extra hyphens
  const newFileName = fileName
    .toLowerCase() // Convert to lowercase
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/[^a-z0-9!._*'()\-]/g, "") // Remove characters not in the allowed set (hyphen escaped)
    .replace(/-+/g, "-") // Replace multiple consecutive hyphens with a single hyphen
    .replace(/^-+/, "") // Remove leading hyphens
    .replace(/-+$/, "") // Remove trailing hyphens
    .replace(/-+\./g, "."); // Remove hyphens before dots

  return newFileName;
};

module.exports = { sanitizeFileName };