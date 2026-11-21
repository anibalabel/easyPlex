import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function hashPassword(password) {
  return bcrypt.hashSync(String(password), 10);
}

export function verifyPassword(password, hash) {
  if (!hash) return false;
  // Normalize PHP $2y$ / $2x$ bcrypt prefixes to $2a$ for bcryptjs compatibility
  const normalized = String(hash).replace(/^\$2[yx]\$/, '$2a$');
  try {
    return bcrypt.compareSync(String(password), normalized);
  } catch {
    return false;
  }
}

export function signAuthToken(user, extra = {}) {
  return jwt.sign(
    {
      sub: user.id,
      id: user.id,
      email: user.email,
      role: user.role,
      ...extra,
    },
    env.jwtSecret,
    { expiresIn: '7d' }
  );
}

export function verifyAuthToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch {
    return null;
  }
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function randomCode(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}
