import crypto from 'crypto';

const getCryptoKey = () => {
  const secret = process.env.ENCRYPTION_SECRET_KEY;
  if (!secret) throw new Error('CRITICAL: ENCRYPTION_SECRET_KEY is undefined.');
  return crypto.createHash('sha256').update(String(secret)).digest();
};

const ALGORITHM = 'aes-256-cbc';

export function encryptToken(plainText) {
  if (!plainText) throw new Error('Plaintext input string is empty.');
  const key = getCryptoKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    encryptedData: encrypted,
    encryptedText: encrypted, // Backward compatibility for existing codebase destructuring
    iv: iv.toString('hex')
  };
}

export function decryptToken(encryptedData, ivText) {
  if (!encryptedData || !ivText) throw new Error('Missing decryption parameters.');
  const key = getCryptoKey();
  const iv = Buffer.from(ivText, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
