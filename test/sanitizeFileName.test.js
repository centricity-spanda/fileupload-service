const { sanitizeFileName } = require('../utils/sanitizeFileName.js');

describe('sanitizeFileName', () => {
  test('should convert to lowercase', () => {
    expect(sanitizeFileName('MyFile.txt')).toBe('myfile.txt');
    expect(sanitizeFileName('UPPERCASE.PDF')).toBe('uppercase.pdf');
  });

  test('should replace spaces with hyphens', () => {
    expect(sanitizeFileName('my file.txt')).toBe('my-file.txt');
    expect(sanitizeFileName('my  file  name.pdf')).toBe('my-file-name.pdf');
  });

  test('should remove invalid characters', () => {
    expect(sanitizeFileName('file@name#test.txt')).toBe('filenametest.txt');
    expect(sanitizeFileName('file$name%test.pdf')).toBe('filenametest.pdf');
    expect(sanitizeFileName('file?name?test.pdf')).toBe('filenametest.pdf');
    expect(sanitizeFileName('file? name?test.pdf')).toBe('file-nametest.pdf');
  });

  test('should preserve allowed special characters', () => {
    expect(sanitizeFileName('file-name.txt')).toBe('file-name.txt');
    expect(sanitizeFileName('file_name.txt')).toBe('file_name.txt');
    expect(sanitizeFileName('file.name.txt')).toBe('file.name.txt');
    expect(sanitizeFileName('file!name.txt')).toBe('file!name.txt');
    expect(sanitizeFileName('file-name(1).txt')).toBe('file-name(1).txt');
  });

  test('should collapse multiple consecutive hyphens', () => {
    expect(sanitizeFileName('file---name.txt')).toBe('file-name.txt');
    expect(sanitizeFileName('file----name.txt')).toBe('file-name.txt');
  });

  test('should remove leading hyphens', () => {
    expect(sanitizeFileName('-filename.txt')).toBe('filename.txt');
    expect(sanitizeFileName('---filename.txt')).toBe('filename.txt');
  });

  test('should remove trailing hyphens', () => {
    expect(sanitizeFileName('filename-.txt')).toBe('filename.txt');
    expect(sanitizeFileName('filename---.txt')).toBe('filename.txt');
  });

  test('should handle complex file names', () => {
    expect(sanitizeFileName('My Document (2024).pdf')).toBe('my-document-(2024).pdf');
    expect(sanitizeFileName('Report@2024#Final.docx')).toBe('report2024final.docx');
    expect(sanitizeFileName('  file  name  .txt  ')).toBe('file-name.txt');
  });

  test('should handle empty string', () => {
    expect(sanitizeFileName('')).toBe('');
  });

  test('should handle special characters only', () => {
    expect(sanitizeFileName('@@@###$$$')).toBe('');
    expect(sanitizeFileName('---')).toBe('');
  });
});

